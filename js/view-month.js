// Month view: which days have a piece, which were journaled.
import { el, fmt, parseISO, toISO, typeOf, todayISO } from './util.js';
import { icon } from './icons.js';

export const isYM = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** ctx: {byDate: Map<string,row>, journaled: Set<string>} */
export function renderMonth(ctx, ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday first
  const today = todayISO();
  const monthName = fmt(`${ym}-01`, { month: 'long', year: 'numeric' });

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(el('span', { class: 'mo-cell blank', 'aria-hidden': 'true' }));
  let pieces = 0;
  let journaledCount = 0;
  for (let d = 1; d <= days; d++) {
    const iso = toISO(new Date(y, m - 1, d));
    const row = ctx.byDate.get(iso);
    const done = ctx.journaled.has(iso);
    if (row) pieces++;
    if (done) journaledCount++;
    const t = row ? typeOf(row.type) : null;
    cells.push(
      el(
        'a',
        {
          class: `mo-cell ${row ? 'has' : ''} ${done ? 'done' : ''} ${iso === today ? 'today' : ''}`,
          href: `#/${iso}`,
          'aria-label': `${fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' })}${row ? `, ${t.label}, ${row.title}` : ', no piece'}${done ? ', journaled' : ''}`,
          'aria-current': iso === today ? 'date' : null,
        },
        el('span', { class: 'mo-num' }, String(d)),
        el('span', { class: `mo-type t-${row ? row.type : 'none'}`, 'aria-hidden': 'true' }, row ? t.letter : ''),
        el('span', { class: 'mo-dot', 'aria-hidden': 'true' }),
      ),
    );
  }

  const nav = (delta, label, ic) =>
    el('a', { class: 'icon-btn', href: `#/month/${shiftMonth(ym, delta)}`, 'aria-label': label }, icon(ic, 20));

  return el(
    'section',
    { class: 'month', 'aria-labelledby': 'month-title' },
    el(
      'div',
      { class: 'mo-head' },
      nav(-1, 'Previous month', 'prev'),
      el('h1', { id: 'month-title', class: 'page-title' }, monthName),
      nav(1, 'Next month', 'next'),
    ),
    el('div', { class: 'mo-week', 'aria-hidden': 'true' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => el('span', null, d))),
    el('div', { class: 'mo-grid' }, cells),
    el(
      'p',
      { class: 'mo-sum' },
      `${pieces} ${pieces === 1 ? 'piece' : 'pieces'} this month · ${journaledCount} journaled`,
    ),
    el(
      'ul',
      { class: 'legend', 'aria-label': 'Key' },
      el('li', null, el('span', { class: 'mo-dot lg' }), 'A piece arrived'),
      el('li', null, el('span', { class: 'ring-sample' }), 'You wrote back'),
      el('li', null, el('b', null, 'C M S'), 'Classic, modern, song'),
    ),
  );
}
