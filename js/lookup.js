// Look up: one overlay that searches the pieces and the reader's own journal.
import { el, fmt, typeOf, debounce } from './util.js';
import { openSheet } from './dialogs.js';
import { EntryStore } from './store-entries.js';
import { JournalStore } from './store-journal.js';

/** Break `text` around the first match of any term so we can wrap it in <mark> as DOM nodes. */
function highlight(text, terms) {
  const low = text.toLowerCase();
  let at = -1;
  let len = 0;
  for (const t of terms) {
    const i = low.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) {
      at = i;
      len = t.length;
    }
  }
  if (at === -1) return [text];
  return [text.slice(0, at), el('mark', null, text.slice(at, at + len)), text.slice(at + len)];
}

function snippet(text, terms) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const low = flat.toLowerCase();
  const hit = terms.map((t) => low.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 40);
  const piece = flat.slice(start, start + 140);
  return (start > 0 ? '…' : '') + piece + (start + 140 < flat.length ? '…' : '');
}

export function openLookup() {
  let entries = [];
  let journal = [];
  const input = el('input', {
    class: 'field big',
    type: 'search',
    placeholder: 'Search poems, poets, your own words',
    autocomplete: 'off',
    autofocus: true,
    'aria-label': 'Search pieces and your journal',
  });
  const results = el('div', { class: 'lk-results', 'aria-live': 'polite' });

  const dlg = openSheet({
    label: 'Look up',
    className: 'lookup',
    build(body, close) {
      body.append(input, results);
      results.addEventListener('click', (e) => {
        if (e.target.closest('a')) close();
      });
    },
  });

  function row(date, title, sub, extra) {
    return el(
      'a',
      { class: 'lk-row', href: `#/${date}` },
      el('span', { class: 'lk-date' }, fmt(date, { day: 'numeric', month: 'short' })),
      el('span', { class: 'lk-main' }, el('span', { class: 'lk-title' }, title), sub ? el('span', { class: 'lk-sub' }, sub) : null, extra),
    );
  }

  function run() {
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      results.replaceChildren(el('p', { class: 'lk-hint' }, 'Type a title, a poet, a line you remember, or something you once wrote.'));
      return;
    }
    const hay = (s) => terms.every((t) => s.toLowerCase().includes(t));
    const pieces = entries.filter((e) => hay(`${e.title} ${e.author} ${typeOf(e.type).label} ${e.type === 'classic' ? e.text || '' : ''}`));
    const mine = journal.filter((r) => hay(r.text));

    const out = [];
    if (pieces.length) {
      out.push(
        el(
          'section',
          { class: 'lk-group' },
          el('h3', null, `Pieces (${pieces.length})`),
          pieces.map((e) => {
            const inText = e.type === 'classic' && e.text && !hay(`${e.title} ${e.author}`);
            return row(
              e.date,
              e.title,
              `${e.author} · ${typeOf(e.type).short}`,
              inText ? el('span', { class: 'lk-snip' }, highlight(snippet(e.text, terms), terms)) : null,
            );
          }),
        ),
      );
    }
    if (mine.length) {
      out.push(
        el(
          'section',
          { class: 'lk-group' },
          el('h3', null, `Your journal (${mine.length})`),
          mine.map((r) => {
            const e = entries.find((x) => x.date === r.date);
            return row(r.date, e ? e.title : fmt(r.date, { weekday: 'long', day: 'numeric', month: 'long' }), null, el('span', { class: 'lk-snip' }, highlight(snippet(r.text, terms), terms)));
          }),
        ),
      );
    }
    if (!out.length) out.push(el('p', { class: 'lk-hint' }, `Nothing found for “${input.value.trim()}”.`));
    results.replaceChildren(...out);
  }

  const debounced = debounce(run, 120);
  input.addEventListener('input', debounced);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      const first = results.querySelector('a');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  results.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = [...results.querySelectorAll('a')];
    const i = all.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next = all[i + (e.key === 'ArrowDown' ? 1 : -1)];
    (next || input).focus();
  });

  results.replaceChildren(el('p', { class: 'lk-hint' }, 'Loading…'));
  Promise.all([EntryStore.all().catch(() => []), JournalStore.all().catch(() => [])]).then(([e, j]) => {
    entries = e;
    journal = j;
    run();
  });
  return dlg;
}
