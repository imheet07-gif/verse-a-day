// Archive: newest first, search by title or poet, filters by type, journaled, language.
// Used full-page (phone, #/archive) and compact as the side rail (wide).
import { el, fmt, typeOf, TYPES, langName } from './util.js';
import { icon } from './icons.js';

// Filter state is shared so the rail and the full page agree.
const f = { q: '', type: 'all', journaled: false, lang: 'all' };

/**
 * @param ctx {{entries: object[], journaled: Set<string>, current: () => string|null}}
 * @returns {HTMLElement & {refresh: () => void}}
 */
export function renderArchive(ctx, { compact = false } = {}) {
  const root = el('section', { class: `archive ${compact ? 'compact' : ''}`, 'aria-label': 'Archive' });
  const uid = compact ? 'rail' : 'page';

  const search = el('input', {
    id: `ar-q-${uid}`,
    class: 'field',
    type: 'search',
    placeholder: 'Search title or poet',
    autocomplete: 'off',
    value: f.q,
    'aria-label': 'Search the archive by title or poet',
  });
  const list = el('div', { class: 'ar-list' });
  const count = el('p', { class: 'ar-count', role: 'status', 'aria-live': 'polite' });

  const langs = [...new Set(ctx.entries.map((e) => e.lang || 'en'))];
  const chip = (label, active, on, extra = {}) =>
    el('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(active), onclick: on, ...extra }, label);

  const filters = el('div', { class: 'filters', role: 'group', 'aria-label': 'Filters' });
  function drawFilters() {
    filters.replaceChildren(
      ...[
      chip('All', f.type === 'all', () => ((f.type = 'all'), drawFilters(), draw())),
      ...Object.entries(TYPES).map(([k, v]) => chip(v.short, f.type === k, () => ((f.type = f.type === k ? 'all' : k), drawFilters(), draw()))),
      chip('Journaled', f.journaled, () => ((f.journaled = !f.journaled), drawFilters(), draw())),
      langs.length > 1
        ? el(
            'select',
            {
              class: 'field small',
              'aria-label': 'Filter by language',
              onchange: (e) => ((f.lang = e.target.value), draw()),
            },
            el('option', { value: 'all' }, 'Any language'),
            langs.map((l) => el('option', { value: l, selected: f.lang === l }, langName(l))),
          )
        : null,
      ].filter(Boolean),
    );
  }

  function matches(e) {
    if (f.type !== 'all' && e.type !== f.type) return false;
    if (f.journaled && !ctx.journaled.has(e.date)) return false;
    if (f.lang !== 'all' && (e.lang || 'en') !== f.lang) return false;
    const q = f.q.trim().toLowerCase();
    return !q || `${e.title} ${e.author}`.toLowerCase().includes(q);
  }

  function draw() {
    const rows = ctx.entries.filter(matches);
    const cur = ctx.current();
    count.textContent = rows.length === ctx.entries.length ? `${rows.length} pieces` : `${rows.length} of ${ctx.entries.length} pieces`;
    if (!rows.length) {
      list.replaceChildren(
        el(
          'div',
          { class: 'empty-note' },
          el('p', null, 'Nothing matches.'),
          el('button', { class: 'btn small', type: 'button', onclick: reset }, 'Clear search and filters'),
        ),
      );
      return;
    }
    const out = [];
    let month = '';
    for (const e of rows) {
      const m = e.date.slice(0, 7);
      if (m !== month) {
        month = m;
        out.push(el('h3', { class: 'ar-month' }, fmt(e.date, { month: 'long', year: 'numeric' })));
      }
      const t = typeOf(e.type);
      const done = ctx.journaled.has(e.date);
      out.push(
        el(
          'a',
          {
            class: `ar-row ${e.date === cur ? 'current' : ''}`,
            href: `#/${e.date}`,
            'aria-current': e.date === cur ? 'page' : null,
            'aria-label': `${fmt(e.date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${t.label}, ${e.title} by ${e.author}${done ? ', journaled' : ''}`,
          },
          el('span', { class: 'ar-date' }, el('b', null, fmt(e.date, { day: 'numeric' })), fmt(e.date, { weekday: 'short' })),
          el(
            'span',
            { class: 'ar-main' },
            el('span', { class: 'ar-title', lang: e.lang || null }, e.title),
            el('span', { class: 'ar-author' }, e.author),
          ),
          el('span', { class: `ar-type t-${e.type}`, 'aria-hidden': 'true' }, t.letter),
          done ? el('span', { class: 'ar-done', 'aria-hidden': 'true' }, icon('check', 16)) : null,
        ),
      );
    }
    list.replaceChildren(...out);
  }

  function reset() {
    Object.assign(f, { q: '', type: 'all', journaled: false, lang: 'all' });
    search.value = '';
    drawFilters();
    draw();
  }

  search.addEventListener('input', () => {
    f.q = search.value;
    draw();
  });

  if (!compact) root.append(el('h1', { class: 'page-title' }, 'Archive'));
  else root.append(el('h2', { class: 'rail-title' }, 'Archive'));
  root.append(el('div', { class: 'ar-tools' }, search, filters), count, list);
  drawFilters();
  draw();
  root.refresh = draw;
  return root;
}
