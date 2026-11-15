import { $, h } from '../dom.js';
import { icon } from '../icons.js';
import { sfx } from '../audio.js';
import { store } from '../store.js';
import { state } from '../state.js';
import { createGarage, defaultProfile } from './garage.js';
import { openHelp } from './help.js';

const POLL_MS = 3000;
const PHASE_LABEL = { lobby: 'In the lobby', countdown: 'Starting', racing: 'Racing now', results: 'Between races' };

function savedProfile() {
  const fallback = defaultProfile();
  const saved = store.profile();
  if (!saved) return fallback;
  const info = state.info;
  return {
    name: typeof saved.name === 'string' && saved.name.trim() ? saved.name.slice(0, info.limits.nameMax) : fallback.name,
    style: info.styles.includes(saved.style) ? saved.style : fallback.style,
    color: info.colors.some((c) => c.hex === saved.color) ? saved.color : fallback.color,
  };
}

export function initLanding({ onCreate, onJoin }) {
  const root = $('#landing');
  const garage = createGarage({ value: savedProfile(), onChange: (value) => store.saveProfile(value) });
  $('#garage-slot').replaceChildren(garage.el);

  const createButton = $('#btn-create');
  const practiceButton = $('#btn-practice');
  const joinForm = $('#join-form');
  const joinInput = $('#join-code');
  const joinButton = $('#join-submit');
  const roomList = $('#open-rooms');
  const roomHint = $('#rooms-hint');
  const banner = $('#invite-banner');
  const soundButton = $('#landing-sound');
  let busy = false;

  const invited = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

  function join(code) {
    if (busy || !code) return;
    store.saveProfile(garage.value());
    onJoin(code, garage.value());
  }

  function renderRooms(rooms) {
    if (rooms === null) {
      roomList.replaceChildren();
      roomHint.textContent = "Can't reach the game server right now.";
      return;
    }
    roomHint.textContent = rooms.length ? 'Open races on this network:' : 'No open races yet. Create one, or type a friend\u2019s code below.';
    roomList.replaceChildren(...rooms.map((room) => {
      const full = room.players >= room.max;
      return h('li', null,
        h('button', {
          class: 'room-item', type: 'button', disabled: full || busy,
          onclick: () => join(room.code),
        },
        h('span', { class: 'plate plate-sm' }, h('span', { class: 'plate-band', 'aria-hidden': 'true' }, 'TR'), h('span', { class: 'plate-code' }, room.code)),
        h('span', { class: 'room-meta' },
          h('strong', null, room.host ? `${room.host}\u2019s race` : 'Open race'),
          h('small', null, `${room.players}/${room.max} drivers \u00b7 ${PHASE_LABEL[room.phase] || room.phase}`)),
        h('span', { class: 'room-join' }, full ? 'Full' : 'Join')));
    }));
  }

  async function poll() {
    if (root.hidden || document.hidden) return;
    try {
      const response = await fetch('/api/rooms', { cache: 'no-store' });
      renderRooms(await response.json());
    } catch {
      renderRooms(null);
    }
  }

  function renderStats() {
    const stats = store.stats();
    const chips = $('#my-stats');
    if (!stats.races) {
      chips.replaceChildren();
      return;
    }
    const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
    chips.replaceChildren(
      h('span', { class: 'chip' }, icon('flag', 14), plural(stats.races, 'race')),
      h('span', { class: 'chip' }, icon('trophy', 14), plural(stats.wins, 'win')),
      stats.bestWpm ? h('span', { class: 'chip chip-gold' }, icon('bolt', 14), `Best ${Math.round(stats.bestWpm)} WPM`) : null);
  }

  function renderSound() {
    const on = sfx.isOn();
    soundButton.replaceChildren(icon(on ? 'soundOn' : 'soundOff', 20));
    soundButton.setAttribute('aria-pressed', String(on));
    soundButton.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  }

  createButton.addEventListener('click', () => {
    if (busy) return;
    sfx.unlock();
    store.saveProfile(garage.value());
    onCreate(garage.value(), { practice: false });
  });
  practiceButton.addEventListener('click', () => {
    if (busy) return;
    sfx.unlock();
    store.saveProfile(garage.value());
    onCreate(garage.value(), { practice: true });
  });
  joinInput.addEventListener('input', () => {
    joinInput.value = joinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });
  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sfx.unlock();
    if (joinInput.value.length < 4) {
      joinInput.focus();
      return;
    }
    join(joinInput.value);
  });
  soundButton.addEventListener('click', () => {
    sfx.setOn(!sfx.isOn());
    renderSound();
  });
  $('#landing-help').addEventListener('click', openHelp);
  document.addEventListener('visibilitychange', poll);
  setInterval(poll, POLL_MS);

  if (invited) {
    joinInput.value = invited.slice(0, 4);
    $('#invite-code').textContent = invited;
    banner.hidden = false;
    $('#invite-join').addEventListener('click', () => { sfx.unlock(); join(invited); });
  }
  renderSound();
  renderStats();

  return {
    show() {
      root.hidden = false;
      renderStats();
      poll();
    },
    hide() { root.hidden = true; },
    setBusy(value) {
      busy = value;
      createButton.disabled = value;
      practiceButton.disabled = value;
      joinButton.disabled = value;
      root.classList.toggle('is-busy', value);
    },
    clearInvite() {
      banner.hidden = true;
      if (history.replaceState) history.replaceState(null, '', location.pathname);
    },
  };
}
