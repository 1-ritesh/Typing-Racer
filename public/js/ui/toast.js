import { $, h } from '../dom.js';

export function toast(message, kind = 'info', ms = 3400) {
  const host = $('#toasts');
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  host.append(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 260);
  }, ms);
}
