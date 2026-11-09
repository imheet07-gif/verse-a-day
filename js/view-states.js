// First-run, empty and error screens.
import { el, fmtLong } from './util.js';
import { icon } from './icons.js';

export function renderWelcome({ hasEntries, onBegin, retry }) {
  const step = (n, title, text) =>
    el('li', null, el('span', { class: 'step-n', 'aria-hidden': 'true' }, String(n)), el('div', null, el('h2', null, title), el('p', null, text)));
  return el(
    'section',
    { class: 'welcome card-letter' },
    el('img', { class: 'welcome-mark', src: 'icons/mark.svg', alt: '', width: 64, height: 64 }),
    el('p', { class: 'eyebrow' }, hasEntries ? 'Welcome' : 'Nothing here yet'),
    el('h1', null, hasEntries ? 'One poem or song, each morning.' : 'The first piece has not arrived.'),
    hasEntries
      ? el(
          'ol',
          { class: 'steps' },
          step(1, 'Read', 'A classic poem, a modern poem or a song arrives each morning, in a weekly rhythm: classics on Monday, Thursday and Sunday, modern poems on Tuesday and Friday, songs on Wednesday and Saturday.'),
          step(2, 'Learn', 'Under each piece: who made it, why it was written when that is known, and one thing to notice.'),
          step(3, 'Write back', 'Two prompts and a private page. It saves on this device as you type and goes nowhere else.'),
        )
      : el('p', { class: 'lede' }, 'A new piece appears here every morning. If you expected one, check your connection and try again.'),
    hasEntries
      ? el('div', { class: 'welcome-actions' }, el('button', { class: 'btn primary big', type: 'button', onclick: onBegin }, 'Open the latest piece'), el('p', { class: 'fine' }, 'The pieces you will see at first are marked Sample.'))
      : el('div', { class: 'welcome-actions' }, el('button', { class: 'btn primary', type: 'button', onclick: retry }, 'Try again')),
  );
}

export function renderNoPiece({ date, latest, today }) {
  const future = date > today;
  return el(
    'section',
    { class: 'state card-letter' },
    icon('calendar', 36),
    el('h1', null, 'No piece for this day'),
    el('p', null, fmtLong(date)),
    el('p', { class: 'lede' }, future ? 'This one has not arrived yet. A new piece appears each morning.' : 'Nothing was sent for this date. The week strip above shows the days that have a piece.'),
    el(
      'div',
      { class: 'btn-row center' },
      latest ? el('a', { class: 'btn primary', href: `#/${latest.date}` }, 'Go to the latest piece') : null,
      el('a', { class: 'btn', href: '#/archive' }, 'Open the archive'),
    ),
  );
}

export function renderError({ offline, retry }) {
  return el(
    'section',
    { class: 'state card-letter', role: 'alert' },
    icon(offline ? 'offline' : 'cloud', 36),
    el('h1', null, offline ? "You're offline" : 'Could not load this'),
    el(
      'p',
      { class: 'lede' },
      offline
        ? 'Pieces you have already opened are kept on this device, and your journal keeps saving. Reconnect to fetch the rest.'
        : 'Something went wrong while fetching the piece. Your journal is safe on this device.',
    ),
    el('div', { class: 'btn-row center' }, el('button', { class: 'btn primary', type: 'button', onclick: retry }, 'Try again')),
  );
}
