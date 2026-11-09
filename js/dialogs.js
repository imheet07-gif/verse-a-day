// Native <dialog> sheets: focus is trapped and Esc closes, courtesy of showModal().
import { el } from './util.js';
import { icon } from './icons.js';

/**
 * Open a modal sheet. `build(body, close)` fills the body.
 * Returns the dialog element. The element is removed again on close.
 */
export function openSheet({ title, label, className = '', build }) {
  const dlg = el('dialog', { class: `sheet ${className}`, 'aria-labelledby': 'sheet-title' });
  const close = () => dlg.close();
  const head = el(
    'div',
    { class: 'sheet-head' },
    el('h2', { id: 'sheet-title', class: title ? '' : 'sr-only' }, title || label || 'Dialog'),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close', 20)),
  );
  const body = el('div', { class: 'sheet-body' });
  dlg.append(head, body);
  build(body, close);
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close(); // backdrop click
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export const anyDialogOpen = () => !!document.querySelector('dialog[open]');
