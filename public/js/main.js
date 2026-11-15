import { $, h, ordinal } from './dom.js';
import { Net } from './net.js';
import { Track } from './track.js';
import { sfx } from './audio.js';
import { store } from './store.js';
import { state, me } from './state.js';
import { toast } from './ui/toast.js';
import { initLanding } from './ui/landing.js';
import { initTopbar } from './ui/topbar.js';
import { initLobby } from './ui/lobby.js';
import { initRace } from './ui/race.js';
import { initResults } from './ui/results.js';
import { createGarage } from './ui/garage.js';
import { openDialog, closeDialog } from './ui/dialog.js';

const net = new Net();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PANELS = ['lobby', 'race', 'results'];

let hero;
let track;
let landing;
let topbar;
let lobby;
let race;
let results;
let reconnecting = false;
let practiceBots = [];

const app = $('#app');
const game = $('#game');
const connectionBanner = $('#conn-banner');

// ----- screens -------------------------------------------------------------

function showLanding() {
  game.hidden = true;
  track.stop();
  landing.show();
  hero.start();
}

function showGame() {
  landing.hide();
  hero.stop();
  game.hidden = false;
  track.start();
}

function showPanel(name) {
  for (const panel of PANELS) $(`#panel-${panel}`).hidden = panel !== name;
}

function exitRoom() {
  store.clearSession();
  race.stop();
  closeDialog();
  Object.assign(state, { room: null, you: '', token: '', deadlineAt: 0 });
  state.ticks.clear();
  reconnecting = false;
  connectionBanner.hidden = true;
  landing.setBusy(false);
  showLanding();
}

// ----- room state ----------------------------------------------------------

function carsFor(room) {
  const drivers = room.phase === 'lobby' ? room.players : room.players.filter((p) => p.inRace);
  return drivers.map((p) => ({ id: p.id, name: p.name, style: p.style, color: p.color, you: p.id === state.you, bot: p.bot }));
}

function announceRoster(previous, room) {
  for (const player of room.players) {
    if (player.bot || player.id === state.you || previous.players.some((p) => p.id === player.id)) continue;
    toast(`${player.name} joined the race`, 'info');
    sfx.join();
  }
  for (const player of previous.players) {
    if (player.bot || player.id === state.you || room.players.some((p) => p.id === player.id)) continue;
    toast(`${player.name} left`, 'info');
    sfx.leave();
  }
  if (previous.host !== room.host) {
    const host = room.players.find((p) => p.id === room.host);
    if (host) toast(host.id === state.you ? 'You are now the host' : `${host.name} is now the host`, 'info');
  }
}

function placeCarsFromSnapshot(room) {
  const length = room.race ? room.race.len : 1;
  for (const player of room.players) {
    if (!player.inRace) continue;
    track.setTarget(player.id, player.prog / length, { place: player.place });
  }
}

function enterPhase(room, previous) {
  switch (room.phase) {
    case 'lobby':
      race.stop();
      track.setPhase('lobby');
      showPanel('lobby');
      break;
    case 'countdown':
      showPanel('race');
      track.setPhase('countdown');
      track.setTextLength(room.race.len);
      race.prepare(room);
      break;
    case 'racing': {
      showPanel('race');
      const joinedLate = !previous || previous.phase !== 'countdown';
      track.setPhase('racing');
      track.setTextLength(room.race.len);
      if (joinedLate) placeCarsFromSnapshot(room);
      race.go(room);
      break;
    }
    case 'results':
      race.stop();
      showPanel('results');
      track.setPhase('results');
      placeCarsFromSnapshot(room);
      for (const result of room.results) {
        track.setTarget(result.id, result.dnf ? result.prog / room.race.len : 1, { wpm: result.wpm, place: result.dnf ? 0 : result.place });
      }
      results.render(room);
      break;
    default:
  }
}

function applyRoom(room, { first = false } = {}) {
  const previous = first ? null : state.room;
  state.room = room;
  if (previous) announceRoster(previous, room);
  app.dataset.phase = room.phase;
  topbar.render(room);
  track.setTheme(room.settings.theme);
  track.setCars(carsFor(room));
  const changed = !previous || previous.phase !== room.phase || previous.round !== room.round;
  if (changed) enterPhase(room, previous);
  if (room.phase === 'lobby') lobby.render(room);
  else if (room.phase === 'results' && !changed) results.render(room);
}

function enterRoom(room) {
  state.ticks.clear();
  state.deadlineAt = 0;
  state.room = null;
  showGame();
  applyRoom(room, { first: true });
}

function applyTick(message) {
  const room = state.room;
  if (!room || !room.race) return;
  state.deadlineAt = message.d != null ? performance.now() + message.d : 0;
  const localDriven = race.active && me() && me().inRace;
  for (const [id, entry] of Object.entries(message.p)) {
    state.ticks.set(id, entry);
    if (id === state.you && localDriven) continue;
    track.setTarget(id, entry[0] / room.race.len, { wpm: entry[1], nitro: entry[2] === 1, place: entry[3] });
  }
  race.onTick(message);
}

function applyFinish(message) {
  race.onFin(message);
  const player = state.room && state.room.players.find((p) => p.id === message.id);
  if (player && player.id !== state.you) toast(`${player.name} finished ${ordinal(message.place)} \u00b7 ${Math.round(message.wpm)} WPM`, 'info');
}

// ----- connection ----------------------------------------------------------

async function connectThen(message, { practice = false } = {}) {
  landing.setBusy(true);
  try {
    await net.connect();
  } catch {
    toast('Cannot reach the game server. Is it still running?', 'error');
    landing.setBusy(false);
    return;
  }
  practiceBots = practice ? ['rookie', 'casual', 'pro'] : [];
  net.send(message);
  setTimeout(() => { if (!state.room) landing.setBusy(false); }, 8000);
}

async function reconnect(immediate = false) {
  if (reconnecting) return;
  reconnecting = true;
  connectionBanner.hidden = false;
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!(immediate && attempt === 0)) await sleep(Math.min(4000, 400 * 2 ** attempt));
      const session = store.session();
      if (!session) return;
      try {
        await net.connect();
        net.send({ t: 'resume', room: session.room, token: session.token });
        return;
      } catch {
        // server still unreachable; keep trying
      }
    }
    toast('Could not get back into the race.', 'error');
    exitRoom();
  } finally {
    reconnecting = false;
  }
}

function leaveRoom() {
  net.send({ t: 'leave' });
  exitRoom();
}

function editProfile() {
  const player = me();
  if (!player) return;
  const taken = state.room.players.filter((p) => p.id !== state.you).map((p) => p.color);
  const garage = createGarage({ value: { name: player.name, style: player.style, color: player.color }, taken });
  const save = () => {
    const value = garage.value();
    store.saveProfile(value);
    net.send({ t: 'profile', name: value.name, style: value.style, color: value.color });
    closeDialog();
  };
  openDialog({
    title: 'Your driver',
    content: [
      garage.el,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: closeDialog }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Save')),
    ],
  });
}

function wireNet() {
  net.on('welcome', (message) => {
    Object.assign(state, { you: message.you, token: message.token });
    store.saveSession({ room: message.room.code, token: message.token });
    connectionBanner.hidden = true;
    landing.setBusy(false);
    landing.clearInvite();
    enterRoom(message.room);
    for (const level of practiceBots) net.send({ t: 'bot_add', level });
    practiceBots = [];
    if (message.resumed) toast('Welcome back! You are in the race.', 'success');
  });
  net.on('room', (room) => applyRoom(room));
  net.on('tick', applyTick);
  net.on('fin', applyFinish);
  net.on('react', (message) => {
    track.react(message.id, message.e);
    sfx.react();
  });
  net.on('kicked', () => {
    toast('The host removed you from the race.', 'error');
    exitRoom();
  });
  net.on('replaced', () => {
    toast('This race was opened in another tab.', 'error');
    exitRoom();
  });
  net.on('error', (message) => {
    landing.setBusy(false);
    if (message.code === 'no_session') {
      exitRoom();
      toast('That race has ended. Start or join a new one!', 'info');
      return;
    }
    toast(message.msg || 'Something went wrong.', 'error');
  });
  net.on('close', () => {
    if (store.session()) reconnect();
    else landing.setBusy(false);
  });
}

// ----- boot ----------------------------------------------------------------

function showFatal() {
  $('#landing').hidden = false;
  $('.landing-inner').replaceChildren(
    h('div', { class: 'card fatal' },
      h('h2', { class: 'card-title' }, 'Can\u2019t reach the game'),
      h('p', null, 'The server may have stopped. Start it again with start.bat, then reload this page.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, 'Reload')));
}

async function boot() {
  try {
    const response = await fetch('/api/info', { cache: 'no-store' });
    state.info = await response.json();
  } catch {
    showFatal();
    return;
  }
  document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

  hero = new Track($('#hero-canvas'), { demo: true });
  track = new Track($('#track'));
  const palette = state.info.colors.map((c) => c.hex);
  hero.setCars(Array.from({ length: 4 }, (_, i) => ({
    id: `demo${i}`, name: '', style: state.info.styles[i % state.info.styles.length], color: palette[(i * 3 + 1) % palette.length],
  })));

  landing = initLanding({
    onCreate: (profile, options) => connectThen({ t: 'create', ...profile }, options),
    onJoin: (code, profile) => connectThen({ t: 'join', room: code, ...profile }),
  });
  topbar = initTopbar({ onLeave: leaveRoom });
  lobby = initLobby({ net, editProfile });
  race = initRace({ net, track });
  results = initResults({ net });
  wireNet();

  showLanding();
  if (store.session()) reconnect(true);
}

boot();
