import { $, h, formatClock, formatRaceTime, ordinal } from '../dom.js';
import { icon } from '../icons.js';
import { sfx } from '../audio.js';
import { state, me } from '../state.js';
import { TypingEngine, TypingView } from '../typing.js';

const SEND_GAP_MS = 90;
const BLOCKED_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Enter']);

function stat(label, initial, extraClass = '') {
  const main = h('span', { class: 'stat-main' }, initial);
  const small = h('small', { class: 'stat-small' });
  return {
    el: h('div', { class: `stat ${extraClass}`.trim() }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, main, small)),
    set(text, extra = '') {
      if (main.textContent !== text) main.textContent = text;
      if (small.textContent !== extra) small.textContent = extra;
    },
  };
}

export function initRace({ net, track }) {
  const panel = $('#panel-race');
  const countdown = $('#countdown');
  const lights = $('#lights');
  const chip = $('#stage-chip');
  const view = new TypingView();

  const input = h('input', { class: 'type-input', type: 'text', 'aria-label': 'Type the paragraph shown above' });
  const inputAttributes = { autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', inputmode: 'text', enterkeyhint: 'done' };
  for (const [name, value] of Object.entries(inputAttributes)) input.setAttribute(name, value);

  const position = stat('Position', '-');
  const wpm = stat('WPM', '0', 'racer-only');
  const accuracy = stat('Accuracy', '100%', 'racer-only');
  const time = stat('Time', '0:00');
  const fill = h('div', { class: 'meter-fill' });
  const meter = h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Race progress', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
  const heat = h('div', { class: 'heat-fill' });
  const nitroTag = h('span', { class: 'nitro-tag' }, icon('bolt', 13), 'NITRO');
  const meterBlock = h('div', { class: 'meter-block' }, meter, h('div', { class: 'heat' }, h('div', { class: 'heat-bar' }, heat), nitroTag));
  const overlayTitle = h('strong', { class: 'ov-title' });
  const overlaySub = h('span', { class: 'ov-sub' });
  const overlay = h('div', { class: 'typing-overlay', hidden: true }, overlayTitle, overlaySub);
  const card = h('div', { class: 'typing-card' }, view.el, overlay, h('span', { class: 'caps-tag' }, 'Caps Lock is on'), input);
  panel.replaceChildren(
    h('div', { class: 'race' },
      h('div', { class: 'race-stats' }, position.el, meterBlock, wpm.el, accuracy.el, time.el),
      card,
      h('p', { class: 'race-hint' }, 'Wrong letters turn red. Press Backspace, fix them, and your car rolls on.')));

  let run = null;
  let countdownTimer = 0;
  let clock = 0;

  // ----- stage overlays ---------------------------------------------------

  function setOverlay(kind, title = '', sub = '') {
    overlay.hidden = !kind;
    overlay.dataset.kind = kind;
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
  }

  function showCountdown(text, kind, lit) {
    countdown.textContent = text;
    countdown.dataset.kind = kind;
    countdown.hidden = false;
    countdown.classList.remove('pop');
    void countdown.offsetWidth;
    countdown.classList.add('pop');
    lights.dataset.lit = String(lit);
    lights.classList.add('show');
  }

  function hideCountdown() {
    countdown.hidden = true;
    countdown.textContent = '';
    lights.classList.remove('show');
  }

  // ----- run lifecycle ----------------------------------------------------

  function newRun(room, racing) {
    const race = room.race;
    return {
      text: race.text, len: race.len, racing,
      engine: racing ? new TypingEngine(race.text, state.info.game.nitroStreak) : null,
      goAt: performance.now() + race.startsIn, startedAt: 0, started: false, finished: false, finishedAt: 0,
      place: 0, lastSent: 0, sendTimer: 0, shown: '',
    };
  }

  function stop() {
    clearInterval(countdownTimer);
    clearInterval(clock);
    if (run) clearTimeout(run.sendTimer);
    countdownTimer = clock = 0;
    run = null;
    hideCountdown();
    chip.hidden = true;
    panel.classList.remove('is-nitro', 'is-spectating');
    input.blur();
  }

  function prepare(room) {
    stop();
    const racing = Boolean(me() && me().inRace);
    run = newRun(room, racing);
    track.setTextLength(run.len);
    view.setText(run.text);
    input.value = '';
    position.set(racing ? '-' : 'Watching');
    wpm.set('0');
    accuracy.set('100%');
    time.set('0:00');
    fill.style.width = '0%';
    heat.style.width = '0%';
    panel.classList.toggle('is-spectating', !racing);
    if (racing) {
      setOverlay('ready', 'Get ready', 'Hands on the keys. The race starts at the green light.');
      input.focus({ preventScroll: true });
    } else {
      setOverlay('watch', 'Race in progress', 'You joined mid-race. Watch the action, you will be on the grid next round!');
    }
    tickCountdown();
    countdownTimer = setInterval(tickCountdown, 50);
    clock = setInterval(refresh, 100);
  }

  function tickCountdown() {
    if (!run || run.started) return;
    const left = run.goAt - performance.now();
    if (left <= 0) {
      begin(-left);
      return;
    }
    const step = left > 3000 ? ['Get ready', 'ready', 0] : left > 2000 ? ['3', 'count', 1] : left > 1000 ? ['2', 'count', 2] : ['1', 'count', 3];
    if (step[0] !== run.shown) {
      run.shown = step[0];
      showCountdown(...step);
      if (step[1] === 'count') sfx.count();
    }
  }

  function begin(elapsedMs) {
    if (!run) return;
    clearInterval(countdownTimer);
    countdownTimer = 0;
    if (!run.started) {
      run.started = true;
      showCountdown('GO!', 'go', 'go');
      sfx.go();
      setTimeout(hideCountdown, 850);
      if (run.racing) {
        setOverlay('');
        input.focus({ preventScroll: true });
      }
    }
    run.startedAt = performance.now() - elapsedMs;
  }

  // Called for the server's "racing" snapshot, and for joining or reloading mid-race.
  function go(room) {
    if (!run) {
      resume(room);
      return;
    }
    if (!run.started) begin(room.race.elapsed);
    else run.startedAt = performance.now() - room.race.elapsed;
  }

  function resume(room) {
    stop();
    const player = me();
    const racing = Boolean(player && player.inRace);
    run = newRun(room, racing);
    run.started = true;
    run.startedAt = performance.now() - room.race.elapsed;
    track.setTextLength(run.len);
    view.setText(run.text);
    panel.classList.toggle('is-spectating', !racing);
    if (racing) {
      run.engine.reset(Math.min(player.prog, run.len));
      input.value = run.engine.typed;
      view.render(run.engine.typed.length, run.engine.prefix);
      if (player.place) {
        run.finished = true;
        run.place = player.place;
        run.finishedAt = performance.now();
        setOverlay('done', `${ordinal(player.place)} place!`, 'Waiting for the other drivers\u2026');
      } else {
        input.focus({ preventScroll: true });
      }
    } else {
      position.set('Watching');
      setOverlay('watch', 'Race in progress', 'You joined mid-race. Watch the action, you will be on the grid next round!');
    }
    clock = setInterval(refresh, 100);
    refresh();
  }

  // ----- typing -----------------------------------------------------------

  function elapsedMs() {
    if (!run || !run.started) return 0;
    return Math.max(0, (run.finished ? run.finishedAt : performance.now()) - run.startedAt);
  }

  const currentWpm = () => (run && run.engine ? Math.round(run.engine.prefix / 5 / (Math.max(elapsedMs(), 2000) / 60000)) : 0);

  function flush() {
    if (!run || !run.engine) return;
    clearTimeout(run.sendTimer);
    run.sendTimer = 0;
    run.lastSent = performance.now();
    const engine = run.engine;
    net.send({ t: 'p', c: engine.prefix, k: engine.keys, x: engine.wrong, s: engine.streak });
  }

  function scheduleSend() {
    const wait = SEND_GAP_MS - (performance.now() - run.lastSent);
    if (wait <= 0) flush();
    else if (!run.sendTimer) run.sendTimer = setTimeout(flush, wait);
  }

  function pushLocalCar() {
    const engine = run.engine;
    track.setTarget(state.you, engine.prefix / run.len, { wpm: currentWpm(), nitro: engine.nitro && !run.finished, place: run.place, fast: true });
  }

  function finish() {
    run.finished = true;
    run.finishedAt = performance.now();
    flush();
    pushLocalCar();
    setOverlay('done', 'Finished!', 'Waiting for the other drivers\u2026');
    sfx.finish();
    refresh();
  }

  function onInput() {
    if (!run || !run.engine) {
      input.value = '';
      return;
    }
    const engine = run.engine;
    if (!run.started || run.finished) {
      input.value = engine.typed;
      return;
    }
    const outcome = engine.input(input.value);
    if (input.value !== outcome.value) input.value = outcome.value;
    view.render(engine.typed.length, engine.prefix);
    if (outcome.wrong) {
      sfx.error();
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    }
    if (outcome.nitroStarted) sfx.nitro();
    pushLocalCar();
    if (outcome.finished) finish();
    else scheduleSend();
  }

  input.addEventListener('beforeinput', (event) => {
    if (/^(insertFrom|history|deleteByCut)/.test(event.inputType)) event.preventDefault();
  });
  track.canvas.addEventListener('contextmenu', (event) => {
    if (!run || !run.racing || !run.finished) return;
    event.preventDefault();
    track.backflip(state.you);
  });
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (event) => {
    if (BLOCKED_KEYS.has(event.key) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) event.preventDefault();
  });
  for (const type of ['keydown', 'keyup']) {
    input.addEventListener(type, (event) => card.classList.toggle('caps', Boolean(event.getModifierState && event.getModifierState('CapsLock'))));
  }
  for (const type of ['select', 'click', 'focus']) {
    input.addEventListener(type, () => input.setSelectionRange(input.value.length, input.value.length));
  }
  input.addEventListener('blur', () => {
    if (run && run.started && !run.finished && run.racing) setOverlay('blur', 'Click here to keep typing', 'Or just press any key.');
  });
  input.addEventListener('focus', () => {
    if (overlay.dataset.kind === 'blur') setOverlay('');
  });
  document.addEventListener('keydown', (event) => {
    if (!run || !run.started || run.finished || !run.racing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (document.activeElement === input || document.querySelector('dialog[open]')) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (event.key.length === 1 || event.key === 'Backspace') input.focus({ preventScroll: true });
  });
  $('#dialog').addEventListener('close', () => {
    if (run && run.started && !run.finished && run.racing) input.focus({ preventScroll: true });
  });

  // ----- live numbers -----------------------------------------------------

  function standing() {
    const racers = state.room.players.filter((p) => p.inRace);
    if (run.place) return { rank: run.place, total: racers.length };
    const mine = run.engine.prefix;
    let ahead = 0;
    for (const racer of racers) {
      if (racer.id === state.you) continue;
      const tick = state.ticks.get(racer.id);
      if (tick && (tick[3] > 0 || tick[0] > mine)) ahead += 1;
    }
    return { rank: ahead + 1, total: racers.length };
  }

  function refresh() {
    if (!run) return;
    const elapsed = elapsedMs();
    time.set(formatClock(elapsed));
    const engine = run.engine;
    if (engine && state.room) {
      wpm.set(String(run.started ? currentWpm() : 0));
      accuracy.set(`${Math.round(engine.accuracy * 100)}%`);
      const percent = run.len ? (engine.prefix / run.len) * 100 : 0;
      fill.style.width = `${percent}%`;
      meter.setAttribute('aria-valuenow', String(Math.round(percent)));
      heat.style.width = `${Math.min(1, engine.streak / engine.nitroStreak) * 100}%`;
      panel.classList.toggle('is-nitro', engine.nitro && !run.finished);
      const { rank, total } = standing();
      position.set(ordinal(rank), `/ ${total}`);
      if (run.started && !run.finished) pushLocalCar();
    }
    const left = state.deadlineAt - performance.now();
    const lastCall = state.deadlineAt > 0 && left > 0 && state.room && state.room.phase === 'racing';
    chip.hidden = !lastCall;
    if (lastCall) chip.textContent = `Last call: ${Math.ceil(left / 1000)}s left`;
  }

  return {
    prepare,
    go,
    stop,
    get active() { return run !== null; },
    onTick(message) {
      const mine = message.p[state.you];
      if (run && mine && mine[3] && !run.place) run.place = mine[3];
    },
    onFin(message) {
      track.setTarget(message.id, 1, { wpm: message.wpm, nitro: false, place: message.place });
      track.celebrate(message.id);
      if (message.id !== state.you || !run) return;
      run.place = message.place;
      if (!run.finished) {
        run.finished = true;
        run.finishedAt = performance.now();
      }
      setOverlay('done', `${ordinal(message.place)} place!`,
        `${Math.round(message.wpm)} WPM \u00b7 ${Math.round(message.acc)}% accuracy \u00b7 ${formatRaceTime(message.ms)}`);
      if (message.place === 1) sfx.win();
    },
  };
}
