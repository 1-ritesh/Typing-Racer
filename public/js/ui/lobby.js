import { $, h, copyText } from '../dom.js';
import { icon } from '../icons.js';
import { carThumb } from '../cars.js';
import { sfx } from '../audio.js';
import { THEMES } from '../themes.js';
import { state, isHost, isLocalHost, inviteLink } from '../state.js';
import { toast } from './toast.js';
import { openDialog, closeDialog } from './dialog.js';

const card = (title, ...children) => h('section', { class: 'card lobby-card' }, h('h2', { class: 'card-title' }, title), ...children);
const skyGradient = (id) => `linear-gradient(180deg, ${THEMES[id].sky.map(([stop, color]) => `${color} ${Math.round(stop * 100)}%`).join(', ')})`;

export function initLobby({ net, editProfile }) {
  const root = $('#panel-lobby');

  // ----- invite card ------------------------------------------------------
  const plateCode = h('span', { class: 'plate-code' });
  const linkInput = h('input', {
    class: 'input input-mono', readOnly: true, 'aria-label': 'Invite link', onfocus: (event) => event.target.select(),
  });
  const copyLabel = h('span', null, 'Copy invite link');
  const copyButton = h('button', { class: 'btn btn-primary', type: 'button' }, icon('copy', 18), copyLabel);
  const otherAddress = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', hidden: true }, 'Friends can\u2019t connect? Try another address');
  const inviteNote = h('p', { class: 'muted' });
  let copyTimer = 0;

  copyButton.addEventListener('click', async () => {
    if (!state.room) return;
    const ok = await copyText(inviteLink(state.room.code));
    if (!ok) {
      linkInput.focus();
      toast('Select the link and copy it with Ctrl+C.', 'info');
      return;
    }
    sfx.click();
    copyLabel.textContent = 'Copied!';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copyLabel.textContent = 'Copy invite link'; }, 1600);
  });
  otherAddress.addEventListener('click', () => {
    state.addressIndex += 1;
    if (state.room) renderInvite(state.room);
    toast(`Invite link now uses ${inviteLink(state.room.code).split('/?')[0]}`, 'info');
  });

  const invite = card('Invite friends',
    h('div', { class: 'plate plate-lg', 'aria-label': 'Room code' },
      h('span', { class: 'plate-band', 'aria-hidden': 'true' }, 'TR'), plateCode),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Link for your friends'), linkInput),
    copyButton, otherAddress, inviteNote);

  function renderInvite(room) {
    plateCode.textContent = room.code;
    linkInput.value = inviteLink(room.code);
    const urls = state.info.urls || [];
    otherAddress.hidden = !(isLocalHost() && urls.length > 1);
    inviteNote.textContent = isLocalHost() && urls.length === 0
      ? 'Could not detect your network address. Friends can open http://YOUR-IP:PORT and use the code above.'
      : 'Friends on the same Wi-Fi or office network open the link, pick a name, and they are on the grid.';
  }

  // ----- drivers card -----------------------------------------------------
  const count = h('span', { class: 'card-count' });
  const list = h('ul', { class: 'driver-list' });
  const botButtons = state.info.levels.map((level) => h('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', title: `${level.label} bot, about ${level.wpm} WPM`,
    onclick: () => { sfx.click(); net.send({ t: 'bot_add', level: level.id }); },
  }, icon('plus', 14), level.label));
  const botRow = h('div', { class: 'bot-row' }, h('span', { class: 'field-label' }, 'Add a bot'), h('div', { class: 'bot-buttons' }, botButtons));
  const drivers = card('Drivers', count, list, botRow);

  function tagsFor(player, room) {
    const tags = [];
    if (player.id === state.you) tags.push(h('span', { class: 'tag tag-you' }, 'YOU'));
    if (player.id === room.host) tags.push(h('span', { class: 'tag tag-host' }, icon('crown', 12), 'HOST'));
    if (player.bot) tags.push(h('span', { class: 'tag tag-bot' }, `BOT \u00b7 ${(state.info.levels.find((l) => l.id === player.level) || {}).label || 'Bot'}`));
    if (!player.online) tags.push(h('span', { class: 'tag tag-away' }, 'Reconnecting\u2026'));
    return tags;
  }

  function driverRow(player, room, host) {
    const mine = player.id === state.you;
    let action = null;
    if (mine) {
      action = h('button', { class: 'btn btn-icon btn-ghost', type: 'button', title: 'Change name or car', 'aria-label': 'Edit your driver', onclick: editProfile }, icon('pencil', 18));
    } else if (host) {
      action = h('button', {
        class: 'btn btn-icon btn-ghost', type: 'button', title: player.bot ? 'Remove bot' : 'Remove driver', 'aria-label': `Remove ${player.name}`,
        onclick: () => net.send({ t: player.bot ? 'bot_remove' : 'kick', id: player.id }),
      }, icon('x', 18));
    }
    return h('li', { class: `driver${mine ? ' is-you' : ''}${player.online ? '' : ' is-away'}` },
      carThumb(player.style, player.color, 58),
      h('div', { class: 'driver-main' }, h('span', { class: 'driver-name' }, player.name), h('span', { class: 'driver-tags' }, tagsFor(player, room))),
      player.points ? h('span', { class: 'driver-points', title: `${player.wins} wins` }, `${player.points} pts`) : null,
      action);
  }

  function renderDrivers(room) {
    const host = isHost();
    count.textContent = `${room.players.length}/${room.max}`;
    list.replaceChildren(...room.players.map((player) => driverRow(player, room, host)));
    botRow.hidden = !host;
    for (const button of botButtons) button.disabled = room.players.length >= room.max;
  }

  // ----- race setup card --------------------------------------------------
  const packs = h('div', { class: 'pack-grid', role: 'radiogroup', 'aria-label': 'Text to race on' });
  const editText = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => editCustom() }, icon('pencil', 14), 'Edit your text');
  const themes = h('div', { class: 'theme-row', role: 'radiogroup', 'aria-label': 'Track' });
  const startLabel = h('span', null, 'Start race');
  const startButton = h('button', { class: 'btn btn-primary btn-lg btn-start', type: 'button' }, icon('play', 18), startLabel);
  const waiting = h('p', { class: 'waiting' });
  const setup = card('Race setup',
    h('div', { class: 'setup-body' },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Text'), packs, editText),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Track'), themes)),
    h('div', { class: 'setup-foot' }, startButton, waiting));

  startButton.addEventListener('click', () => {
    sfx.unlock();
    net.send({ t: 'start' });
  });

  function editCustom() {
    const limits = state.info.limits;
    const area = h('textarea', {
      class: 'input textarea', rows: 7, maxLength: 2000, value: state.customDraft || '',
      placeholder: 'Paste or type the paragraph your friends will race on\u2026',
    });
    const info = h('span', { class: 'muted' });
    const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Use this text');
    const update = () => {
      const length = area.value.trim().length;
      info.textContent = `${length} characters (about ${Math.round(length / 5)} words). Use ${limits.customMin}-${limits.customMax}.`;
      save.disabled = length < limits.customMin;
    };
    save.addEventListener('click', () => {
      state.customDraft = area.value;
      net.send({ t: 'settings', pack: 'custom', custom: area.value });
      closeDialog();
    });
    area.addEventListener('input', update);
    update();
    openDialog({
      title: 'Race on your own text',
      content: [area, h('div', { class: 'dialog-actions split' }, info, save)],
    });
    setTimeout(() => area.focus(), 0);
  }

  function packHint(pack, room) {
    if (pack.id === 'custom') return room.settings.customLen ? `${room.settings.customLen} characters` : 'Paste your own';
    return `about ${Math.round((pack.min + pack.max) / 10)} words`;
  }

  function renderSetup(room) {
    const host = isHost();
    const settings = room.settings;
    packs.replaceChildren(...state.info.packs.map((pack) => {
      const selected = settings.pack === pack.id;
      return h('button', {
        class: `pack${selected ? ' is-selected' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(selected), disabled: !host,
        onclick: () => {
          sfx.click();
          if (pack.id === 'custom' && !settings.customLen) editCustom();
          else net.send({ t: 'settings', pack: pack.id });
        },
      }, h('strong', null, pack.label), h('small', null, packHint(pack, room)));
    }));
    editText.hidden = !(host && settings.pack === 'custom');
    themes.replaceChildren(...state.info.themes.map((theme) => {
      const selected = settings.theme === theme.id;
      return h('button', {
        class: `theme${selected ? ' is-selected' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(selected), disabled: !host,
        onclick: () => { sfx.click(); net.send({ t: 'settings', theme: theme.id }); },
      }, h('span', { class: 'theme-dot', style: { background: skyGradient(theme.id) } }), theme.label);
    }));

    const needsText = settings.pack === 'custom' && !settings.customLen;
    startButton.hidden = !host;
    startButton.disabled = needsText;
    startLabel.textContent = room.players.length > 1 ? `Start race with ${room.players.length} drivers` : 'Start a solo race';
    startButton.title = needsText ? 'Add your own text first' : '';
    const hostPlayer = room.players.find((p) => p.id === room.host);
    waiting.hidden = host;
    waiting.textContent = hostPlayer ? `Waiting for ${hostPlayer.name} to start the race\u2026` : 'Waiting for the host\u2026';
  }

  root.replaceChildren(h('div', { class: 'lobby' }, invite, drivers, setup));

  return {
    render(room) {
      renderInvite(room);
      renderDrivers(room);
      renderSetup(room);
    },
  };
}
