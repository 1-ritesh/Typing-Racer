import { $, h } from '../dom.js';
import { icon } from '../icons.js';

let wired = false;

export function openDialog({ title, content, wide = false, onClose }) {
  const dialog = $('#dialog');
  if (!wired) {
    wired = true;
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  }
  if (dialog.open) dialog.close();
  dialog.className = `dialog${wide ? ' dialog-wide' : ''}`;
  const closeButton = h('button', {
    class: 'btn btn-icon btn-ghost', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close(),
  }, icon('x', 18));
  dialog.replaceChildren(
    h('div', { class: 'dialog-card' },
      h('header', { class: 'dialog-head' }, h('h2', null, title), closeButton),
      h('div', { class: 'dialog-body' }, content)),
  );
  const finished = () => {
    dialog.removeEventListener('close', finished);
    dialog.replaceChildren();
    if (onClose) onClose();
  };
  dialog.addEventListener('close', finished);
  dialog.showModal();
  return { close: () => dialog.close() };
}

export const closeDialog = () => { const dialog = $('#dialog'); if (dialog.open) dialog.close(); };
