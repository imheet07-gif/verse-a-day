// Everything the person sees about sync: the Sync & Backup panel, the quiet
// banner, the little line under the journal box, and the two prompts (a day with
// two versions; a different account's journal already on this device).
// All strings are rendered as text. Nothing here blocks writing.

import { el, fmtLong, wordCount, todayISO, download, toast } from './util.js';
import { icon } from './icons.js';
import { openSheet } from './dialogs.js';
import { engine } from './sync-app.js';
import { JournalStore } from './store-journal.js';

const fmtStamp = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
};
const fmtClock = (iso) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function friendlyError(err) {
  if (err && err.kind === 'network') return 'Could not reach the server. Check your connection and try again.';
  return (err && err.message) || 'Something went wrong. Please try again.';
}

/**
 * One description of the sync state, shared by every place that shows it.
 * @returns {{title:string, detail:string, short:string, tone:'ok'|'warn'|'busy'|'quiet', retry:boolean, icon:string}}
 */
export function describe(st) {
  if (st.mode === 'off' || st.mode === 'starting') {
    return { title: '', detail: '', short: '', tone: 'quiet', retry: false, icon: 'check' };
  }
  if (st.mode === 'unavailable') {
    return {
      title: 'Sync is not available right now',
      detail: 'The sync library could not be loaded, so this is working on this device only. Your writing is saved here and will sync once it loads.',
      short: 'Sync unavailable',
      tone: 'warn',
      retry: true,
      icon: 'offline',
    };
  }
  if (st.mode === 'signedout') {
    if (st.authExpired) {
      return {
        title: 'Signed out, sign in again to sync',
        detail: 'Your journal is untouched and still saves on this device.',
        short: 'Signed out',
        tone: 'warn',
        retry: false,
        icon: 'offline',
      };
    }
    return { title: '', detail: '', short: '', tone: 'quiet', retry: false, icon: 'check' };
  }
  // signed in
  const waiting = st.pending ? `${plural(st.pending, 'day', 'days')} waiting to sync` : '';
  const last = st.lastSynced ? `Last synced ${fmtStamp(st.lastSynced)}` : '';
  const both = [last, waiting].filter(Boolean).join(' · ');
  if (st.ownerPrompt) {
    return { title: 'Choose what to do with this device’s journal', detail: 'It belongs to a different account. Nothing syncs until you choose.', short: 'Needs your choice', tone: 'warn', retry: false, icon: 'offline' };
  }
  if (st.conflicts.length) {
    return {
      title: 'A newer version exists on another device',
      detail: `${plural(st.conflicts.length, 'day has', 'days have')} two versions. Both are kept until you choose.`,
      short: 'Needs your review',
      tone: 'warn',
      retry: false,
      icon: 'cloud',
    };
  }
  if (st.run === 'syncing') return { title: 'Syncing…', detail: both, short: 'Syncing…', tone: 'busy', retry: false, icon: 'cloud' };
  if (st.run === 'offline') return { title: 'Waiting to sync (offline)', detail: waiting || 'Writing still saves on this device.', short: 'Waiting to sync', tone: 'warn', retry: true, icon: 'offline' };
  if (st.run === 'error') return { title: 'Sync problem, tap to retry', detail: [st.error, waiting].filter(Boolean).join(' · '), short: 'Sync problem', tone: 'warn', retry: true, icon: 'offline' };
  const justNow = st.lastSynced && Date.now() - Date.parse(st.lastSynced) < 60000;
  if (st.pending) return { title: 'Waiting to sync', detail: both, short: 'Waiting to sync', tone: 'quiet', retry: false, icon: 'cloud' };
  return {
    title: justNow ? 'Synced just now' : st.lastSynced ? `Synced at ${fmtClock(st.lastSynced)}` : 'Synced',
    detail: last && !justNow ? '' : last,
    short: justNow ? 'Synced just now' : 'Synced',
    tone: 'ok',
    retry: false,
    icon: 'check',
  };
}

/* ---------------------------------------------------------------- prompts */

let conflictDlg = null;

/** The "two versions of a day" prompt. One at a time; the rest wait in the queue. */
export function openConflicts() {
  if (conflictDlg || !engine.getState().conflicts.length) return;
  conflictDlg = openSheet({
    title: 'A newer version exists on another device.',
    className: 'conflict',
    build(body, close) {
      function show(note) {
        const list = engine.getState().conflicts;
        if (!list.length) {
          toast('Every day is sorted');
          close();
          return;
        }
        const c = list[0];
        const version = (label, who, v) =>
          el(
            'section',
            { class: 'cf-card' },
            el('h3', null, label),
            el('p', { class: 'cf-meta' }, `Edited ${fmtStamp(v.updatedAt)} · ${plural(wordCount(v.text), 'word', 'words')}`),
            v.text.trim() ? el('div', { class: 'cf-text', dir: 'auto', tabindex: '0', role: 'region', 'aria-label': `${who} version, full text` }, v.text) : el('div', { class: 'cf-text empty' }, 'Empty (cleared)'),
          );
        const choose = (choice, msg) => () => {
          const res = engine.resolveConflict(c.date, choice);
          if (res.stale) show('That day changed again while this was open, so here are the latest versions.');
          else {
            toast(msg);
            show();
          }
        };
        const choice = (btn, hint) => el('div', { class: 'cf-choice' }, btn, el('p', { class: 'fine' }, hint));
        body.replaceChildren(
          ...(note ? [el('p', { class: 'cf-note', role: 'status' }, note)] : []),
          el(
            'p',
            { class: 'cf-day' },
            el('b', null, fmtLong(c.date)),
            list.length > 1 ? el('span', { class: 'fine' }, ` · 1 of ${list.length} to review`) : null,
          ),
          el('div', { class: 'cf-grid' }, version('This device', 'This device’s', c.local), version('Other device', 'Other device’s', c.remote)),
          el(
            'div',
            { class: 'cf-choices' },
            choice(
              el('button', { class: 'btn primary', type: 'button', onclick: choose('both', 'Kept both versions') }, 'Keep both'),
              'Joins them with a divider line, this device’s first. Nothing is dropped.',
            ),
            choice(
              el('button', { class: 'btn', type: 'button', onclick: choose('mine', 'Kept this device’s version') }, 'Keep this device’s'),
              'The other device’s version is replaced by this one.',
            ),
            choice(
              el('button', { class: 'btn', type: 'button', onclick: choose('theirs', 'Used the other device’s version') }, 'Use the other device’s'),
              'This device’s version is replaced by the other one.',
            ),
          ),
        );
        body.scrollTop = 0;
      }
      show();
    },
  });
  conflictDlg.addEventListener('close', () => (conflictDlg = null));
}

let ownerDlg = null;

/** "A different account's journal is on this device." */
export function openOwnerPrompt() {
  const st = engine.getState();
  if (ownerDlg || !st.ownerPrompt) return;
  const n = st.ownerPrompt.count;
  ownerDlg = openSheet({
    title: 'Another account’s journal is here',
    className: 'conflict',
    build(body, close) {
      const pick = (choice, msg) => async () => {
        close();
        await engine.resolveOwner(choice);
        toast(msg);
        if (engine.getState().conflicts.length) openConflicts();
      };
      body.append(
        el('p', null, `This device still holds ${plural(n, 'day', 'days')} of journal from a different account than the one you just signed in to. Nothing has been changed or sent.`),
        el(
          'div',
          { class: 'cf-choices' },
          el(
            'div',
            { class: 'cf-choice' },
            el('button', { class: 'btn primary', type: 'button', onclick: pick('merge', 'Merged into this account') }, 'Keep and merge into this account'),
            el('p', { class: 'fine' }, 'Everything here is added to the account you signed in to. Only days with two different versions will ask you.'),
          ),
          el(
            'div',
            { class: 'cf-choice' },
            el('button', { class: 'btn', type: 'button', onclick: pick('clear', 'Cleared this device’s copy') }, 'Clear this device’s copy'),
            el('p', { class: 'fine' }, 'Removes these days from this device only. Anything that never reached the other account is gone for good, so export a copy first if unsure.'),
            el(
              'button',
              {
                class: 'btn small',
                type: 'button',
                onclick: async () => download(`verse-a-day-journal-${todayISO()}.json`, 'application/json', JSON.stringify(await JournalStore.export(), null, 2)),
              },
              icon('download', 16),
              'Export a copy first',
            ),
          ),
          el(
            'div',
            { class: 'cf-choice' },
            el('button', { class: 'btn', type: 'button', onclick: pick('cancel', 'Signed out') }, 'Cancel and sign out'),
            el('p', { class: 'fine' }, 'Leaves everything on this device exactly as it is.'),
          ),
        ),
      );
    },
  });
  ownerDlg.addEventListener('close', () => (ownerDlg = null));
}

/* ---------------------------------------------------------------- banner */

/** Quiet strip under the masthead: only for things that need the person. */
export function initSyncUI({ openSettings }) {
  const bar = document.getElementById('syncbar');
  if (!bar) return;
  function draw(st) {
    const d = describe(st);
    let msg = null;
    let action = null;
    if (st.mode === 'signedin' && st.ownerPrompt) {
      msg = 'This device holds a different account’s journal.';
      action = ['Choose', openOwnerPrompt];
    } else if (st.mode === 'signedin' && st.conflicts.length) {
      msg = 'A newer version exists on another device.';
      action = ['Review', openConflicts];
    } else if (st.mode === 'signedout' && st.authExpired) {
      msg = d.title + '.';
      action = ['Sign in', () => openSettings()];
    } else if (st.mode === 'signedin' && st.run === 'error') {
      msg = 'Sync problem. Your writing is safe on this device.';
      action = ['Retry', () => engine.syncNow()];
    }
    if (!msg) {
      bar.hidden = true;
      bar.replaceChildren();
      return;
    }
    bar.hidden = false;
    bar.replaceChildren(
      el('div', { class: 'wrap' }, el('div', { class: 'syncbar-in', role: 'status' }, icon('cloud', 16), el('span', null, msg), el('button', { class: 'btn small', type: 'button', onclick: action[1] }, action[0]))),
    );
  }
  engine.subscribe(draw);
  draw(engine.getState());
}

/* ------------------------------------------------ line under the journal */

/**
 * A small separate "sync" label for the journal's meta row. Empty (and hidden)
 * unless the person has sync on, so a device-only user sees no change.
 * @returns {{node:HTMLElement, destroy:()=>void}}
 */
export function journalSyncLine(date) {
  const node = el('span', { class: 'j-sync', hidden: true });
  function draw(st) {
    const configuredOn = st.mode === 'signedin' || st.mode === 'unavailable' || (st.mode === 'signedout' && st.authExpired);
    if (!configuredOn) {
      node.hidden = true;
      node.replaceChildren();
      return;
    }
    const d = describe(st);
    const conflict = st.conflicts.some((c) => c.date === date);
    node.hidden = false;
    node.className = `j-sync ${conflict || d.tone === 'warn' ? 'warn' : ''}`;
    if (conflict) {
      node.replaceChildren(el('button', { class: 'linkish', type: 'button', onclick: openConflicts }, 'Two versions · Review'));
    } else if (d.retry) {
      node.replaceChildren(
        el('button', { class: 'linkish', type: 'button', onclick: () => (st.mode === 'unavailable' ? engine.retryLoad() : engine.syncNow()) }, `${d.short} · Retry`),
      );
    } else {
      node.replaceChildren(d.short);
    }
  }
  const off = engine.subscribe(draw);
  draw(engine.getState());
  return { node, destroy: off };
}

/* ----------------------------------------------------- settings: the panel */

/** The whole Sync section body (status, sign-in or account controls). Re-renders itself as state changes. */
export function syncPanel({ localSaved }) {
  const root = el('div', { class: 'sync-panel' });
  let mode = null;
  let parts = {};

  const deviceBox = () => {
    // Exactly the phase 1 wording when sync is off or signed out.
    return el(
      'div',
      { class: `sync-status ${localSaved ? '' : 'warn'}` },
      icon(localSaved ? 'check' : 'offline', 18),
      el(
        'div',
        null,
        el('b', null, localSaved ? 'Saved on this device' : 'Not saved: storage is blocked'),
        el(
          'p',
          { class: 'fine' },
          localSaved
            ? 'Your journal stays in this browser. Clearing site data removes it, so export a copy now and then.'
            : 'This browser is blocking storage, so writing lasts only until you close the tab. Export before you leave.',
        ),
      ),
    );
  };

  /* ---- signed-out form ---- */
  function buildForm() {
    const email = el('input', { class: 'field', id: 'sync-email', type: 'email', name: 'email', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', required: true });
    const pass = el('input', { class: 'field', id: 'sync-pass', type: 'password', name: 'password', autocomplete: 'current-password', minlength: 6, required: true });
    const err = el('p', { class: 'sync-msg warn', role: 'alert', hidden: true });
    const note = el('p', { class: 'sync-msg', role: 'status', hidden: true });
    const inBtn = el('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
    const upBtn = el('button', { class: 'btn', type: 'button' }, 'Create account');
    const form = el(
      'form',
      { class: 'sync-form', novalidate: true },
      el('div', { class: 'set-col' }, el('label', { class: 'set-label', for: 'sync-email' }, 'Email'), email),
      el('div', { class: 'set-col' }, el('label', { class: 'set-label', for: 'sync-pass' }, 'Password'), pass),
      err,
      note,
      el('div', { class: 'btn-row' }, inBtn, upBtn),
      el('p', { class: 'fine' }, 'Sync is optional. Without it your journal simply stays on this device. With it, the same journal follows you to your other devices, and writing still works offline.'),
    );
    const busy = (b, label) => {
      inBtn.disabled = upBtn.disabled = b;
      inBtn.textContent = b && label === 'in' ? 'Signing in…' : 'Sign in';
      upBtn.textContent = b && label === 'up' ? 'Creating…' : 'Create account';
    };
    const check = () => {
      err.hidden = true;
      note.hidden = true;
      if (!email.value.trim() || !pass.value) {
        err.hidden = false;
        err.textContent = 'Enter your email and a password.';
        (email.value.trim() ? pass : email).focus();
        return false;
      }
      return true;
    };
    async function afterAuth(p) {
      try {
        const res = await p;
        if (res && res.needsConfirmation) {
          note.hidden = false;
          note.textContent = 'Almost there: we sent a message to confirm your email. Open it, then come back here and sign in.';
          return;
        }
        await engine.settled();
        const st = engine.getState();
        if (st.ownerPrompt) openOwnerPrompt();
        else if (st.conflicts.length) openConflicts();
      } catch (e) {
        err.hidden = false;
        err.textContent = friendlyError(e);
      } finally {
        busy(false);
      }
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!check()) return;
      busy(true, 'in');
      afterAuth(engine.signIn(email.value.trim(), pass.value));
    });
    upBtn.addEventListener('click', () => {
      if (!check()) return;
      pass.autocomplete = 'new-password';
      busy(true, 'up');
      afterAuth(engine.signUp(email.value.trim(), pass.value));
    });
    return form;
  }

  /* ---- signed-in controls ---- */
  function buildAccount() {
    const who = el('b', null, '');
    const syncBtn = el('button', { class: 'btn', type: 'button', onclick: async () => engine.syncNow() }, icon('cloud', 16), 'Sync now');
    const review = el('button', { class: 'btn primary', type: 'button', hidden: true, onclick: () => (engine.getState().ownerPrompt ? openOwnerPrompt() : openConflicts()) }, 'Review');
    const out = el(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: async () => {
          await engine.signOut();
          toast('Signed out. Your journal stays on this device.');
        },
      },
      'Sign out',
    );
    parts.who = who;
    parts.syncBtn = syncBtn;
    parts.review = review;
    return el(
      'div',
      { class: 'sync-account' },
      el('p', { class: 'set-row' }, el('span', { class: 'set-label' }, 'Signed in as'), who),
      el('div', { class: 'btn-row' }, syncBtn, review, out),
      el('p', { class: 'fine' }, 'Signing out keeps your journal on this device. It just stops syncing.'),
    );
  }

  /* ---- status box for signed-in and trouble states ---- */
  function buildStatus() {
    const ic = el('span', { class: 'ss-icon' });
    const title = el('b', null);
    const detail = el('p', { class: 'fine' });
    const retry = el('button', { class: 'btn small', type: 'button', hidden: true }, 'Retry');
    const box = el('div', { class: 'sync-status', 'aria-live': 'polite' }, ic, el('div', null, title, detail, retry));
    parts.status = { box, ic, title, detail, retry };
    return box;
  }

  function render(st) {
    const next = st.mode === 'starting' ? 'starting' : st.mode === 'signedin' ? 'in' : st.mode === 'signedout' ? (st.authExpired ? 'expired' : 'out') : st.mode === 'unavailable' ? 'unavailable' : 'off';
    if (next === mode) return update(st);
    mode = next;
    parts = {};
    if (mode === 'starting') {
      root.replaceChildren(deviceBox(), el('p', { class: 'fine sync-off' }, 'Getting sync ready…'));
    } else if (mode === 'off') {
      root.replaceChildren(deviceBox(), el('p', { class: 'fine sync-off' }, 'Sync is not set up for this copy yet.'));
    } else if (mode === 'out') {
      root.replaceChildren(deviceBox(), buildForm());
    } else if (mode === 'expired') {
      root.replaceChildren(buildStatus(), deviceBox(), buildForm());
    } else if (mode === 'unavailable') {
      root.replaceChildren(buildStatus(), deviceBox());
    } else {
      root.replaceChildren(buildStatus(), buildAccount());
    }
    update(st);
  }

  function update(st) {
    if (!parts.status) return;
    const d = describe(st);
    const s = parts.status;
    s.box.classList.toggle('warn', d.tone === 'warn');
    s.ic.replaceChildren(icon(d.icon, 18));
    s.title.textContent = d.title;
    s.detail.textContent = d.detail;
    s.detail.hidden = !d.detail;
    s.retry.hidden = !d.retry;
    s.retry.onclick = () => (st.mode === 'unavailable' ? engine.retryLoad() : engine.syncNow());
    if (parts.who) parts.who.textContent = (st.user && st.user.email) || '';
    if (parts.syncBtn) parts.syncBtn.disabled = st.run === 'syncing' || !!st.ownerPrompt;
    if (parts.review) {
      const need = !!st.ownerPrompt || st.conflicts.length > 0;
      parts.review.hidden = !need;
      parts.review.textContent = st.ownerPrompt ? 'Choose' : `Review ${plural(st.conflicts.length, 'day', 'days')}`;
    }
  }

  const off = engine.subscribe(render);
  render(engine.getState());
  // Stop listening once the sheet closes (the node leaves the document).
  const watch = new MutationObserver(() => {
    if (!root.isConnected) {
      off();
      watch.disconnect();
    }
  });
  queueMicrotask(() => root.isConnected && watch.observe(document.body, { childList: true }));
  return root;
}
