import { h } from '../dom.js';
import { icon } from '../icons.js';
import { carThumb } from '../cars.js';
import { sfx } from '../audio.js';
import { state } from '../state.js';

const ADJECTIVES = ['Speedy', 'Turbo', 'Nitro', 'Rapid', 'Swift', 'Blazing', 'Rocket', 'Sonic', 'Neon', 'Lightning', 'Chrome', 'Wild'];
const ANIMALS = ['Fox', 'Panda', 'Falcon', 'Tiger', 'Otter', 'Gecko', 'Hawk', 'Koala', 'Lynx', 'Wolf', 'Cobra', 'Moose'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export const randomName = () => `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;

export function defaultProfile() {
  const colors = state.info.colors;
  return { name: randomName(), style: pick(state.info.styles), color: pick(colors).hex };
}

const STYLE_LABELS = { coupe: 'Coupe', formula: 'Formula', hatch: 'Hatchback', pickup: 'Pickup' };

// A name + car picker used on the landing page and in the lobby's "edit driver" dialog.
export function createGarage({ value, taken = [], onChange }) {
  const info = state.info;
  let current = { ...value };
  let blocked = new Set(taken.map((c) => c.toLowerCase()));

  const nameInput = h('input', {
    class: 'input', type: 'text', maxLength: info.limits.nameMax, value: current.name, placeholder: 'Your driver name',
    autocomplete: 'off', 'aria-label': 'Driver name',
  });
  const dice = h('button', { class: 'btn btn-icon btn-ghost', type: 'button', title: 'Surprise me', 'aria-label': 'Random name' }, icon('dice', 20));
  const preview = h('div', { class: 'garage-preview' });
  const styles = h('div', { class: 'picker', role: 'radiogroup', 'aria-label': 'Car style' });
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Car paint' });

  const emit = () => onChange && onChange(read());
  const read = () => ({ ...current, name: nameInput.value.trim() || current.name });

  function drawPreview() {
    preview.replaceChildren(carThumb(current.style, current.color, 230));
  }

  function drawStyles() {
    styles.replaceChildren(...info.styles.map((style) => {
      const selected = style === current.style;
      return h('button', {
        class: `pick${selected ? ' is-selected' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(selected),
        'aria-label': STYLE_LABELS[style] || style, title: STYLE_LABELS[style] || style,
        onclick: () => { current.style = style; sfx.click(); refresh(); emit(); },
      }, carThumb(style, current.color, 64), h('span', null, STYLE_LABELS[style] || style));
    }));
  }

  function drawSwatches() {
    swatches.replaceChildren(...info.colors.map(({ name, hex }) => {
      const selected = hex === current.color;
      const isTaken = blocked.has(hex) && !selected;
      return h('button', {
        class: `swatch${selected ? ' is-selected' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(selected),
        'aria-label': isTaken ? `${name} (taken)` : name, title: isTaken ? `${name} is taken` : name, disabled: isTaken,
        style: { '--swatch': hex },
        onclick: () => { current.color = hex; sfx.click(); refresh(); emit(); },
      }, selected ? icon('check', 16) : null);
    }));
  }

  function refresh() {
    drawPreview();
    drawStyles();
    drawSwatches();
  }

  nameInput.addEventListener('input', emit);
  dice.addEventListener('click', () => {
    nameInput.value = randomName();
    sfx.click();
    emit();
  });
  refresh();

  const el = h('div', { class: 'garage' },
    h('label', { class: 'field' },
      h('span', { class: 'field-label' }, 'Driver name'),
      h('div', { class: 'input-row' }, nameInput, dice)),
    preview,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Car'), styles),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Paint'), swatches));

  return {
    el,
    value: read,
    focusName: () => nameInput.focus(),
    setTaken(colors) {
      blocked = new Set(colors.map((c) => c.toLowerCase()));
      drawSwatches();
    },
  };
}
