import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { openDialog } from './dialog.js';

const step = (symbol, title, text) =>
  h('li', { class: 'help-step' },
    h('span', { class: 'help-icon' }, symbol),
    h('div', null, h('strong', null, title), h('p', null, text)));

export function openHelp() {
  const points = state.info?.game?.points || [10, 8, 6, 5, 4, 3, 2, 1];
  const nitro = state.info?.game?.nitroStreak || 15;
  openDialog({
    title: 'How to play',
    wide: true,
    content: [
      h('ol', { class: 'help-steps' },
        step(icon('users', 22), 'Gather the grid', 'One player creates a race and shares the link or the 4 letter code. Everyone on the same Wi-Fi or network can join.'),
        step(icon('keyboard', 22), 'Type the paragraph', 'When the lights go green, type the text at the bottom. Your car moves as you type correctly.'),
        step(icon('x', 22), 'Fix mistakes', 'A wrong letter turns red and blocks your car. Press Backspace, fix it, and carry on.'),
        step(icon('bolt', 22), 'Light the nitro', `Type ${nitro} letters in a row with no mistake and your car lights its nitro flame. One slip and it goes out.`),
        step(icon('trophy', 22), 'Win the Grand Prix', `Every race awards points (${points.join(', ')}). Keep racing and the champion crown goes to the best total.`)),
      h('div', { class: 'help-tips' },
        h('h3', null, 'Handy tips'),
        h('ul', null,
          h('li', null, 'WPM counts 5 letters as one word, so punctuation and capitals count too.'),
          h('li', null, 'No friends around? The host can add bots at four skill levels.'),
          h('li', null, 'The host can paste their own text, pick the track, and remove drivers.'),
          h('li', null, 'Lost your connection? Reload the page and you slide back into your seat.'))),
    ],
  });
}
