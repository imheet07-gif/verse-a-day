// Verse a Day: shell, routing and the chrome around the piece.
import { el, $, todayISO, addDays, weekStart, isISO, fmt, fmtLong, typeOf, isWide } from './util.js';
import { icon } from './icons.js';
import { prefs, set, apply, onPrefs } from './prefs.js';
import { EntryStore } from './store-entries.js';
import { JournalStore } from './store-journal.js';
import { renderPiece, syncSizeButtons } from './view-piece.js';
import { renderJournal } from './view-journal.js';
import { renderArchive } from './view-archive.js';
import { renderMonth, isYM } from './view-month.js';
import { openLookup } from './lookup.js';
import { openSettings } from './settings-ui.js';
import { anyDialogOpen } from './dialogs.js';
import { renderWelcome, renderNoPiece, renderError } from './view-states.js';

const S = {
  entries: [], // index rows, newest first
  byDate: new Map(),
  asc: [], // dates, oldest first
  journaled: new Set(),
  date: null, // day being viewed
  fellBack: null, // date we landed on because today had no piece
  loadError: null,
  journal: null, // live journal view
  token: 0,
};

const main = $('#main');
const go = (date) => {
  location.hash = `#/${date}`;
};

/* ------------------------------------------------------------------ data */

function indexEntries(rows) {
  S.entries = rows;
  S.byDate = new Map(rows.map((r) => [r.date, r]));
  S.asc = rows.map((r) => r.date).sort();
}

async function refreshJournaled() {
  try {
    S.journaled = new Set((await JournalStore.all()).map((r) => r.date));
  } catch {
    S.journaled = new Set();
  }
}

function streak() {
  let d = todayISO();
  if (!S.journaled.has(d)) d = addDays(d, -1);
  let n = 0;
  while (S.journaled.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  const ws = weekStart(todayISO());
  let week = 0;
  for (let i = 0; i < 7; i++) if (S.journaled.has(addDays(ws, i))) week++;
  return { n, week };
}

function neighbor(dir) {
  const cur = S.date || todayISO();
  return dir < 0 ? [...S.asc].reverse().find((d) => d < cur) : S.asc.find((d) => d > cur);
}

/* ---------------------------------------------------------------- chrome */

const masthead = $('#masthead');
const strip = $('#weekstrip');
const toolbar = $('#toolbar');
const rail = $('#rail');
let railView = null;

function drawMasthead() {
  const today = todayISO();
  const { n, week } = streak();
  masthead.replaceChildren(
    el(
      'div',
      { class: 'wrap' },
      el(
        'div',
        { class: 'brand-row' },
        el(
          'a',
          { class: 'brand', href: '#/', 'aria-label': 'Verse a Day, go to today' },
          el('img', { src: 'icons/mark.svg', alt: '', width: 38, height: 38 }),
          el('span', { class: 'wordmark' }, 'Verse a Day'),
        ),
        el(
          'div',
          { class: 'head-actions' },
          el('a', { class: 'icon-btn', href: '#/month', 'aria-label': 'Month view', title: 'Month' }, icon('calendar', 22)),
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => openSettings({ onImported: afterImport }) }, icon('settings', 22)),
        ),
      ),
      el(
        'div',
        { class: 'dateline' },
        el(
          'div',
          { class: 'stamp', role: 'img', 'aria-label': `Today is ${fmtLong(today)}` },
          el('span', { class: 'st-dow' }, fmt(today, { weekday: 'short' })),
          el('span', { class: 'st-day' }, fmt(today, { day: 'numeric' })),
          el('span', { class: 'st-mon' }, fmt(today, { month: 'short', year: 'numeric' })),
        ),
        el(
          'div',
          { class: 'streak' },
          el('p', { class: 'streak-main' }, n > 0 ? `Day ${n} · ${week} this week` : `No streak yet · ${week} this week`),
          el('p', { class: 'streak-sub' }, n > 0 ? 'days in a row you wrote back' : 'write one line today to begin'),
        ),
      ),
      el('p', { class: 'offline', id: 'offline', hidden: navigator.onLine, role: 'status' }, icon('offline', 16), "You're offline. Pieces you've opened are kept, and your journal still saves."),
    ),
  );
}

function drawWeek() {
  const anchor = S.date || todayISO();
  const ws = weekStart(anchor);
  const today = todayISO();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDays(ws, i);
    const row = S.byDate.get(iso);
    const done = S.journaled.has(iso);
    const t = row ? typeOf(row.type) : null;
    const label = `${fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' })}, ${row ? t.label : 'no piece'}${done ? ', journaled' : ''}`;
    days.push(
      el(
        'a',
        {
          class: `wk ${iso === S.date ? 'sel' : ''} ${iso === today ? 'today' : ''} ${row ? 'has' : 'none'} ${done ? 'done' : ''}`,
          href: `#/${iso}`,
          'aria-label': label,
          'aria-current': iso === S.date ? 'page' : null,
        },
        el('span', { class: 'wk-dow' }, fmt(iso, { weekday: 'short' })),
        el('span', { class: 'wk-num' }, fmt(iso, { day: 'numeric' })),
        el('span', { class: `wk-type t-${row ? row.type : 'none'}` }, t ? t.letter : '·'),
        el('span', { class: 'wk-dot' }),
      ),
    );
  }
  strip.replaceChildren(el('div', { class: 'wrap' }, el('div', { class: 'wk-row' }, days)));
}

function tbBtn(id, ic, label, on, extra = {}) {
  return el('button', { class: 'tb', id, type: 'button', onclick: on, ...extra }, icon(ic, 24), el('span', null, label));
}
function buildToolbar() {
  toolbar.replaceChildren(
    tbBtn('tb-prev', 'prev', 'Previous', () => step(-1)),
    tbBtn('tb-next', 'next', 'Next', () => step(1)),
    tbBtn('tb-archive', 'archive', 'Archive', toggleArchive, { 'aria-pressed': 'false' }),
    tbBtn('tb-look', 'search', 'Look up', () => openLookup(), { 'aria-keyshortcuts': '/' }),
  );
}
function drawToolbar() {
  const p = neighbor(-1);
  const n = neighbor(1);
  const prev = $('#tb-prev');
  const next = $('#tb-next');
  prev.disabled = !p;
  next.disabled = !n;
  const arch = $('#tb-archive');
  const onArchive = location.hash === '#/archive';
  arch.setAttribute('aria-pressed', String(isWide() ? prefs.rail : onArchive));
}
function step(dir) {
  const d = neighbor(dir);
  if (d) go(d);
}
function toggleArchive() {
  if (isWide()) {
    set('rail', !prefs.rail);
    drawToolbar();
  } else {
    location.hash = '#/archive';
  }
}

function buildRail() {
  rail.replaceChildren();
  railView = null;
  if (!S.entries.length) return;
  railView = renderArchive({ entries: S.entries, journaled: S.journaled, current: () => S.date }, { compact: true });
  rail.append(
    el('button', { class: 'icon-btn rail-close', type: 'button', 'aria-label': 'Hide archive', onclick: () => (set('rail', false), drawToolbar()) }, icon('close', 18)),
    railView,
  );
}

function redrawChrome() {
  drawMasthead();
  drawWeek();
  drawToolbar();
  railView && railView.refresh();
}

async function afterImport() {
  await refreshJournaled();
  redrawChrome();
  if (S.journal) await route(); // re-load the journal box with imported text
}

/* ----------------------------------------------------------------- views */

function setMain(node, title) {
  main.replaceChildren(node);
  document.title = title ? `${title} · Verse a Day` : 'Verse a Day';
  window.scrollTo(0, 0);
}

async function viewDay(date, dir) {
  const token = S.token;
  S.date = date;
  const row = S.byDate.get(date);
  let entry = null;
  let err = null;
  if (row) {
    try {
      entry = await EntryStore.get(date);
    } catch (e) {
      err = e;
    }
  }
  if (token !== S.token) return; // a newer navigation took over
  drawWeek();
  drawToolbar();
  railView && railView.refresh();

  if (err) {
    setMain(renderError({ offline: !navigator.onLine, retry: () => route() }), 'Could not load');
    return;
  }
  if (!entry) {
    setMain(renderNoPiece({ date, latest: S.entries[0], today: todayISO() }), 'No piece');
    return;
  }
  const fell = S.fellBack === date ? "Today's piece hasn't arrived yet, so here is the latest." : null;
  const journal = renderJournal(entry, { onSaved: onJournalSaved });
  S.journal = journal;
  const day = el(
    'div',
    { class: `day ${dir ? `enter-${dir}` : ''}` },
    el('div', { class: 'piece-col' }, renderPiece(entry, { note: fell })),
    el('div', { class: 'journal-col' }, journal.node),
  );
  setMain(day, entry.title);
}

async function onJournalSaved(date, text) {
  if (text.trim()) S.journaled.add(date);
  else S.journaled.delete(date);
  redrawChrome();
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h) return { name: 'default' };
  if (isISO(h)) return { name: 'day', date: h };
  if (h === 'archive') return { name: 'archive' };
  if (h === 'month') return { name: 'month', ym: (S.date || todayISO()).slice(0, 7) };
  const m = /^month\/(\d{4}-\d{2})$/.exec(h);
  if (m && isYM(m[1])) return { name: 'month', ym: m[1] };
  return { name: 'default' };
}

async function route() {
  const token = ++S.token;
  if (S.journal) {
    const j = S.journal;
    S.journal = null;
    await j.flush();
    j.destroy();
    if (token !== S.token) return;
  }
  const r = parseHash();
  const prevDate = S.date;
  const isArchiveRoute = r.name === 'archive';
  document.body.dataset.route = r.name;

  if (S.loadError) {
    drawWeek();
    drawToolbar();
    setMain(renderError({ offline: !navigator.onLine, retry: () => boot(true) }), 'Could not load');
    return;
  }

  if (r.name === 'default') {
    if (!S.entries.length) {
      S.date = todayISO();
      drawWeek();
      drawToolbar();
      setMain(renderWelcome({ hasEntries: false, retry: () => boot(true) }), 'Welcome');
      return;
    }
    const today = todayISO();
    const target = S.byDate.has(today) ? today : S.entries[0].date;
    S.fellBack = target === today ? null : target;
    if (!prefs.welcomed) {
      S.date = target;
      drawWeek();
      drawToolbar();
      setMain(
        renderWelcome({
          hasEntries: true,
          onBegin: () => {
            set('welcomed', true);
            go(target);
          },
        }),
        'Welcome',
      );
      return;
    }
    history.replaceState(null, '', `#/${target}`);
    return viewDay(target, null);
  }

  if (r.name === 'day') {
    if (!prefs.welcomed) set('welcomed', true);
    const dir = prevDate && prevDate !== r.date ? (r.date > prevDate ? 'next' : 'prev') : null;
    return viewDay(r.date, dir);
  }

  if (isArchiveRoute) {
    drawToolbar();
    const view = renderArchive({ entries: S.entries, journaled: S.journaled, current: () => S.date }, { compact: false });
    setMain(view, 'Archive');
    window.scrollTo(0, 0);
    return;
  }

  if (r.name === 'month') {
    drawToolbar();
    setMain(renderMonth({ byDate: S.byDate, journaled: S.journaled }, r.ym), 'Month');
    window.scrollTo(0, 0);
  }
}

/* ------------------------------------------------------------ interaction */

function inField(t) {
  return t && (t.closest ? t.closest('input, textarea, select, [contenteditable="true"]') : null);
}

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || anyDialogOpen() || inField(e.target)) return;
  if (document.querySelector('.journal.is-focus')) return;
  if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === '/') {
    e.preventDefault();
    openLookup();
  }
});

// Swipe left/right on the piece to change day.
let touch = null;
main.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length !== 1 || inField(e.target) || document.querySelector('.journal.is-focus')) return (touch = null);
    const t = e.touches[0];
    touch = { x: t.clientX, y: t.clientY, at: Date.now() };
  },
  { passive: true },
);
main.addEventListener(
  'touchend',
  (e) => {
    if (!touch || document.body.dataset.route !== 'day') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    const fast = Date.now() - touch.at < 700;
    touch = null;
    if (fast && Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.5) step(dx < 0 ? 1 : -1);
  },
  { passive: true },
);

window.addEventListener('hashchange', route);
window.addEventListener('offline', () => $('#offline') && ($('#offline').hidden = false));
window.addEventListener('online', () => $('#offline') && ($('#offline').hidden = true));
window.addEventListener('pagehide', () => S.journal && S.journal.flush());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && S.journal && S.journal.flush());
window.addEventListener('storage', async (e) => {
  if (e.key && !e.key.startsWith('vad:j:')) return;
  await refreshJournaled();
  redrawChrome();
});
window.matchMedia('(min-width: 900px)').addEventListener?.('change', drawToolbar);
onPrefs((k) => {
  if (k === 'size') syncSizeButtons();
  if (k === 'rail') drawToolbar();
});

/* ------------------------------------------------------------------ boot */

async function boot(retry = false) {
  S.loadError = null;
  try {
    indexEntries(await EntryStore.list(retry));
  } catch (e) {
    S.loadError = e;
    indexEntries([]);
  }
  await refreshJournaled();
  if (!retry) buildToolbar();
  drawMasthead();
  buildRail();
  await route();
}

function registerWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', async (e) => {
    if (!e.data || e.data.type !== 'entries-updated') return;
    try {
      indexEntries(await EntryStore.list(true));
      buildRail();
      redrawChrome();
      if (['archive', 'month'].includes(parseHash().name)) route();
    } catch {
      /* keep what we have */
    }
  });
}

apply();
registerWorker();
boot();
