import { $, h, copyText } from '../dom.js';
import { icon } from '../icons.js';
import { sfx } from '../audio.js';
import { state, inviteLink } from '../state.js';
import { toast } from './toast.js';
import { openHelp } from './help.js';
import { openDialog, closeDialog } from './dialog.js';

const STATUS = {
  lobby: (room) => `Lobby \u00b7 ${room.players.length}/${room.max} drivers`,
  countdown: (room) => `Race ${room.round} \u00b7 Get ready!`,
  racing: (room) => `Race ${room.round} \u00b7 Go go go!`,
  results: (room) => `Race ${room.round} \u00b7 Results`,
};

export function initTopbar({ onLeave }) {
  const plate = $('#plate');
  const soundButton = $('#btn-sound');
  const fullscreenButton = $('#btn-full');
  const leaveButton = $('#btn-leave');

  $('#plate-copy').replaceChildren(icon('copy', 16));
  fullscreenButton.replaceChildren(icon('fullscreen', 20));
  $('#btn-help').replaceChildren(icon('help', 20));
  leaveButton.replaceChildren(icon('leave', 20));

  function renderSound() {
    const on = sfx.isOn();
    soundButton.replaceChildren(icon(on ? 'soundOn' : 'soundOff', 20));
    soundButton.setAttribute('aria-pressed', String(on));
    soundButton.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  }

  plate.addEventListener('click', async () => {
    if (!state.room) return;
    const ok = await copyText(inviteLink(state.room.code));
    toast(ok ? 'Invite link copied. Send it to your friends!' : 'Could not copy automatically. Use the link in the lobby.', ok ? 'success' : 'error');
  });
  soundButton.addEventListener('click', () => {
    sfx.setOn(!sfx.isOn());
    renderSound();
  });
  fullscreenButton.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  });
  $('#btn-help').addEventListener('click', openHelp);
  leaveButton.addEventListener('click', () => {
    const racing = state.room && (state.room.phase === 'countdown' || state.room.phase === 'racing');
    if (!racing) {
      onLeave();
      return;
    }
    openDialog({
      title: 'Leave this race?',
      content: [
        h('p', null, 'Your car will be removed from the track.'),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: closeDialog }, 'Keep racing'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { closeDialog(); onLeave(); } }, 'Leave')),
      ],
    });
  });
  renderSound();

  return {
    render(room) {
      $('#plate-code').textContent = room.code;
      $('#status').textContent = (STATUS[room.phase] || (() => ''))(room);
    },
  };
}
