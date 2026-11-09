// The journal panel: prompts, autosaving text box, focus mode, "Ask in Claude".
import { el, debounce, fmtTime, wordCount, typeOf, fmt } from './util.js';
import { icon } from './icons.js';
import { JournalStore } from './store-journal.js';

const FALLBACK_PROMPTS = ['What stayed with you from this?', 'What would you say back?'];
const INERT_WHILE_FOCUS = '#masthead, #weekstrip, #rail, #toolbar, .piece-col';

/** Hand-off link. The prompt carries title/author/type/year and the prompts: never journal text. */
export function askUrl(entry) {
  const t = typeOf(entry.type).label.toLowerCase();
  const prompts = entry.prompts && entry.prompts.length ? entry.prompts : FALLBACK_PROMPTS;
  const lines = [
    `I'm reading a ${t} today: "${entry.title}" by ${entry.author}${entry.year ? ` (${entry.year})` : ''}.`,
    'I would like to talk it over with you. Two questions I am thinking about:',
    ...prompts.map((p, i) => `${i + 1}. ${p}`),
    'Please do not reproduce song lyrics or the text of copyrighted poems. Describe, summarise or ask me to quote only the few words I want to discuss.',
  ];
  return 'https://claude.ai/new?q=' + encodeURIComponent(lines.join('\n'));
}

/**
 * @returns {{node: HTMLElement, flush: () => Promise<void>, destroy: () => void}}
 */
export function renderJournal(entry, { onSaved } = {}) {
  const date = entry.date;
  const prompts = (entry.prompts && entry.prompts.length ? entry.prompts : FALLBACK_PROMPTS).slice(0, 4);

  const ta = el('textarea', {
    id: 'journal-text',
    class: 'j-text',
    rows: 7,
    dir: 'auto',
    spellcheck: 'true',
    autocomplete: 'off',
    'aria-label': `Journal for ${fmt(date, { day: 'numeric', month: 'long' })}`,
    'aria-describedby': 'j-status j-count',
    placeholder: 'Write one line. A sentence is enough.',
  });
  const status = el('span', { id: 'j-status', class: 'j-status', role: 'status', 'aria-live': 'polite' }, 'Nothing written yet');
  const count = el('span', { id: 'j-count', class: 'j-count' }, '0 words');
  const nudge = el('p', { class: 'nudge' }, 'Write one line. It keeps the thread going.');

  let last = '';
  let busy = false;
  let again = false;
  let running = Promise.resolve();

  function setStatus(text, warn = false) {
    status.textContent = text;
    status.classList.toggle('warn', warn);
  }
  function refreshMeta() {
    const n = wordCount(ta.value);
    count.textContent = `${n} ${n === 1 ? 'word' : 'words'}`;
    nudge.hidden = ta.value.trim().length > 0;
  }

  // One write at a time. A change that lands during a write queues exactly one more pass.
  function save() {
    if (busy) {
      again = true;
      return running;
    }
    busy = true;
    running = (async () => {
      try {
        do {
          again = false;
          const text = ta.value;
          if (text === last) continue;
          setStatus('Saving…');
          try {
            const { record, persisted } = await JournalStore.set(date, text);
            last = text;
            setStatus(
              persisted ? `Saved · ${fmtTime(new Date(record.updatedAt))}` : 'Kept for this visit only: storage is blocked',
              !persisted,
            );
            onSaved && onSaved(date, text);
          } catch {
            setStatus('Could not save on this device', true);
          }
        } while (again);
      } finally {
        busy = false;
      }
    })();
    return running;
  }
  const debounced = debounce(save, 700);

  ta.addEventListener('input', () => {
    refreshMeta();
    setStatus(ta.value === last ? status.textContent : 'Writing…');
    debounced();
  });
  ta.addEventListener('blur', () => {
    debounced.cancel();
    save();
  });

  JournalStore.get(date).then((r) => {
    if (r && !ta.value) {
      ta.value = r.text;
      last = r.text;
      refreshMeta();
      if (r.text.trim()) setStatus(`Saved · ${fmtTime(new Date(r.updatedAt))}`);
    }
  });

  /* ---- focus mode ---- */
  const root = el('section', { class: 'journal', 'aria-labelledby': 'journal-title' });
  const focusBtn = el(
    'button',
    { class: 'btn ghost small', type: 'button', 'aria-pressed': 'false', onclick: () => setFocus(!root.classList.contains('is-focus')) },
    icon('expand', 16),
    el('span', { class: 'lbl' }, 'Focus'),
  );
  function setFocus(on) {
    root.classList.toggle('is-focus', on);
    focusBtn.setAttribute('aria-pressed', String(on));
    focusBtn.lastChild.textContent = on ? 'Done' : 'Focus';
    document.body.classList.toggle('no-scroll', on);
    document.querySelectorAll(INERT_WHILE_FOCUS).forEach((n) => (n.inert = on));
    if (on) {
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      ta.focus();
    } else {
      root.removeAttribute('role');
      root.removeAttribute('aria-modal');
      focusBtn.focus();
    }
  }
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-focus')) {
      e.stopPropagation();
      setFocus(false);
    }
  });

  root.append(
    el('div', { class: 'j-head' }, el('h2', { id: 'journal-title' }, 'Write back'), focusBtn),
    el('ol', { class: 'prompts' }, prompts.map((p) => el('li', null, p))),
    ta,
    nudge,
    el('div', { class: 'j-meta' }, status, count),
    el(
      'div',
      { class: 'j-actions' },
      el('a', { class: 'btn', href: askUrl(entry), target: '_blank', rel: 'noopener noreferrer' }, icon('chat', 16), 'Ask in Claude'),
      el('p', { class: 'fine' }, 'Opens Claude in a new tab with the title and the two prompts. Your writing is never sent.'),
    ),
  );

  return {
    node: root,
    async flush() {
      debounced.cancel();
      await save();
    },
    destroy() {
      debounced.cancel();
      if (root.classList.contains('is-focus')) setFocus(false);
    },
  };
}
