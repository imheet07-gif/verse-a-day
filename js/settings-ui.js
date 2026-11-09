// Settings sheet: reading preferences plus "Sync & Backup".
import { el, download, todayISO, fmt, toast } from './util.js';
import { icon } from './icons.js';
import { openSheet } from './dialogs.js';
import { prefs, set, SIZES, THEMES } from './prefs.js';
import { JournalStore } from './store-journal.js';
import { EntryStore } from './store-entries.js';
import { syncSizeButtons } from './view-piece.js';
import { syncPanel } from './sync-ui.js';

async function toMarkdown() {
  const [records, rows] = await Promise.all([JournalStore.all(), EntryStore.list().catch(() => [])]);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out = ['# Verse a Day: journal', '', `Exported ${todayISO()}`, ''];
  for (const r of [...records].sort((a, b) => a.date.localeCompare(b.date))) {
    const e = byDate.get(r.date);
    out.push(`## ${fmt(r.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`);
    if (e) out.push('', `*${e.title}, ${e.author}*`);
    out.push('', r.text.trim(), '');
  }
  if (!records.length) out.push('_No journal entries yet._', '');
  return out.join('\n');
}

export function openSettings({ onImported } = {}) {
  return openSheet({
    title: 'Settings',
    className: 'settings',
    build(body) {
      /* ---- reading ---- */
      const sizeVal = el('span', { class: 'size-val', 'aria-live': 'polite' });
      const minus = el('button', { class: 'icon-btn txt', type: 'button', 'aria-label': 'Smaller text', onclick: () => bump(-1) }, 'A−');
      const plus = el('button', { class: 'icon-btn txt', type: 'button', 'aria-label': 'Larger text', onclick: () => bump(1) }, 'A+');
      function drawSize() {
        sizeVal.textContent = `${prefs.size + 1} of ${SIZES.length}`;
        minus.disabled = prefs.size === 0;
        plus.disabled = prefs.size === SIZES.length - 1;
      }
      function bump(d) {
        set('size', prefs.size + d);
        syncSizeButtons();
        drawSize();
      }
      drawSize();

      const themeRow = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Theme' });
      function drawThemes() {
        themeRow.replaceChildren(
          ...THEMES.map((t) =>
            el(
              'button',
              {
                class: 'seg-btn',
                type: 'button',
                role: 'radio',
                'aria-checked': String(prefs.theme === t.id),
                onclick: () => {
                  set('theme', t.id);
                  drawThemes();
                  themeRow.querySelector('[aria-checked="true"]').focus();
                },
              },
              t.label,
            ),
          ),
        );
      }
      drawThemes();

      /* ---- sync & backup ---- */
      const importBox = el('div', { class: 'import-box', hidden: true });
      const fileInput = el('input', {
        type: 'file',
        accept: 'application/json,.json',
        class: 'sr-only',
        tabindex: '-1',
        onchange: async () => {
          const file = fileInput.files[0];
          fileInput.value = '';
          if (!file) return;
          try {
            const data = JSON.parse(await file.text());
            const sum = await JournalStore.import(data, { apply: false });
            showConfirm(data, sum, file.name);
          } catch (err) {
            importBox.hidden = false;
            importBox.replaceChildren(el('p', { class: 'warn', role: 'alert' }, err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message));
          }
        },
      });
      function showConfirm(data, sum, name) {
        importBox.hidden = false;
        queueMicrotask(() => importBox.scrollIntoView({ block: 'nearest' }));
        const nothing = !sum.added && !sum.updated;
        importBox.replaceChildren(
          el('p', { class: 'ib-title' }, `Import from ${name}?`),
          el(
            'ul',
            { class: 'ib-list' },
            el('li', null, `${sum.added} new ${sum.added === 1 ? 'day' : 'days'} will be added`),
            el('li', null, `${sum.updated} will be replaced by a newer version from the file`),
            el('li', null, `${sum.kept} already here and newer or equal, kept as they are`),
            sum.skipped ? el('li', null, `${sum.skipped} could not be read and will be skipped`) : null,
          ),
          el(
            'div',
            { class: 'ib-actions' },
            el(
              'button',
              {
                class: 'btn primary',
                type: 'button',
                disabled: nothing,
                onclick: async () => {
                  await JournalStore.import(data, { apply: true });
                  importBox.hidden = true;
                  toast('Journal imported');
                  onImported && onImported();
                },
              },
              nothing ? 'Nothing to import' : 'Import',
            ),
            el('button', { class: 'btn', type: 'button', onclick: () => (importBox.hidden = true) }, 'Cancel'),
          ),
        );
      }

      body.append(
        el(
          'section',
          { class: 'set-group' },
          el('h3', null, 'Reading'),
          el('div', { class: 'set-row' }, el('span', { class: 'set-label' }, 'Text size'), el('span', { class: 'size-ctl' }, minus, sizeVal, plus)),
          el('div', { class: 'set-col' }, el('span', { class: 'set-label' }, 'Theme'), themeRow, el('p', { class: 'fine' }, 'Paper is warmer and softer. Night is the darkest, for reading in bed.')),
        ),
        el(
          'section',
          { class: 'set-group' },
          el('h3', null, 'Sync & backup'),
          syncPanel({ localSaved: JournalStore.persistent }),
          el(
            'div',
            { class: 'btn-row' },
            el(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async () => {
                  const data = await JournalStore.export();
                  download(`verse-a-day-journal-${todayISO()}.json`, 'application/json', JSON.stringify(data, null, 2));
                },
              },
              icon('download', 16),
              'Export JSON',
            ),
            el(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async () => download(`verse-a-day-journal-${todayISO()}.md`, 'text/markdown', await toMarkdown()),
              },
              icon('download', 16),
              'Export Markdown',
            ),
            el('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, icon('upload', 16), 'Import JSON'),
            fileInput,
          ),
          importBox,
          el('p', { class: 'fine' }, 'Import merges by day: when both sides have a day, the most recently edited one wins. You are asked before anything changes.'),
        ),
        el('p', { class: 'fine about' }, 'Verse a Day · a poem or song each morning, the story behind it, and a private page to write back.'),
      );
    },
  });
}
