// The piece itself: title, byline, poem text (classics only), links, notes, sources.
import { el, typeOf, safeUrl, copyText, toast, RTL_LANGS } from './util.js';
import { icon } from './icons.js';
import { prefs, set, SIZES } from './prefs.js';
import { ensureScriptFont } from './fonts.js';

function paragraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => el('p', null, p));
}

function note(title, text, cls) {
  const body = paragraphs(text);
  if (!body.length) return null;
  return el('section', { class: `note ${cls}` }, el('h2', null, title), body);
}

function poemBlock(entry) {
  const lang = entry.lang || 'en';
  const dir = entry.dir || (RTL_LANGS.includes(lang) ? 'rtl' : 'ltr');
  ensureScriptFont(lang);
  const wrap = el('div', { class: 'poem', lang, dir, role: 'group', 'aria-label': 'Poem text' });
  String(entry.text)
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n[ \t]*\n/)
    .forEach((block) => {
      wrap.append(
        el(
          'div',
          { class: 'stanza' },
          block.split('\n').map((line) => el('span', { class: 'line' }, line)),
        ),
      );
    });
  return wrap;
}

function noTextNote(entry) {
  const song = entry.type === 'song';
  return el(
    'aside',
    { class: 'no-text' },
    el('p', null, song ? 'Lyrics stay with the song.' : 'This poem is still in copyright.'),
    el(
      'p',
      null,
      song
        ? 'Listen first, then come back for the story and the journal. The links below search for it.'
        : 'Its text is not reproduced here. Read it at the source or hear it read aloud using the links below.',
    ),
  );
}

const atLimit = (delta) => (delta < 0 && prefs.size === 0) || (delta > 0 && prefs.size === SIZES.length - 1);

/** Keep the A- / A+ buttons in step with the stored size (also called after Settings changes it). */
export function syncSizeButtons() {
  document.querySelectorAll('[data-size-delta]').forEach((b) => {
    b.disabled = atLimit(Number(b.dataset.sizeDelta));
  });
}

export function renderPiece(entry, { note: banner } = {}) {
  const t = typeOf(entry.type);
  const sizeBtn = (delta, label, text) =>
    el(
      'button',
      {
        class: 'icon-btn txt',
        type: 'button',
        'aria-label': label,
        'data-size-delta': delta,
        disabled: atLimit(delta),
        onclick: () => {
          set('size', prefs.size + delta);
          syncSizeButtons();
        },
      },
      text,
    );

  const tools = el(
    'div',
    { class: 'piece-tools' },
    sizeBtn(-1, 'Smaller text', 'A−'),
    sizeBtn(1, 'Larger text', 'A+'),
    el(
      'button',
      {
        class: 'icon-btn',
        type: 'button',
        'aria-label': 'Copy a link to this day',
        title: 'Copy link to this day',
        onclick: async () => {
          const url = new URL(location.href);
          url.hash = `#/${entry.date}`;
          toast((await copyText(url.href)) ? 'Link copied' : 'Could not copy the link');
        },
      },
      icon('share', 20),
    ),
  );

  const links = (entry.links || [])
    .map((l) => ({ label: l && l.label, href: l && safeUrl(l.url) }))
    .filter((l) => l.label && l.href);

  const article = el('article', { class: 'piece', 'aria-labelledby': 'piece-title' });
  const parts = [
    el('div', { class: 'piece-top' }, el('div', { class: 'chips' }, el('span', { class: `chip t-${entry.type}` }, t.label), entry.sample ? el('span', { class: 'chip ghost' }, 'Sample') : null), tools),
    banner ? el('p', { class: 'banner' }, banner) : null,
    el('h1', { id: 'piece-title', class: 'title' }, entry.title),
    el(
      'p',
      { class: 'byline' },
      entry.author,
      entry.year ? el('span', { class: 'year' }, ` · ${entry.year}`) : null,
    ),
    entry.type === 'song' && entry.credits ? el('p', { class: 'credits' }, entry.credits) : null,
    entry.type === 'classic' && entry.text ? poemBlock(entry) : noTextNote(entry),
    links.length
      ? el(
          'ul',
          { class: 'links', 'aria-label': 'Where to find it' },
          links.map((l) =>
            el(
              'li',
              null,
              el('a', { class: 'btn', href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.label, icon('external', 16)),
            ),
          ),
        )
      : null,
    note('Who they are', entry.who, 'who'),
    note('Why it was written', entry.why, 'why'),
    note('What to notice', entry.notice, 'notice'),
  ];
  article.append(...parts.filter(Boolean));

  const sources = (entry.sources || [])
    .map((s) => ({ title: s && s.title, href: s && safeUrl(s.url) }))
    .filter((s) => s.title && s.href);
  if (sources.length) {
    article.append(
      el(
        'section',
        { class: 'sources' },
        el('h2', null, 'Sources'),
        el(
          'ul',
          null,
          sources.map((s) => el('li', null, el('a', { href: s.href, target: '_blank', rel: 'noopener noreferrer' }, s.title))),
        ),
      ),
    );
  }
  return article;
}
