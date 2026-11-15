import { store } from './store.js';

let context = null;
let master = null;
let enabled = store.sound();
let lastErrorAt = 0;

function audio() {
  if (!enabled) return null;
  if (!context) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.9;
    master.connect(context.destination);
  }
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
}

function tone({ f = 440, to = 0, dur = 0.12, type = 'sine', vol = 0.1, at = 0 }) {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

const melody = (notes, step, options) => notes.forEach((f, i) => tone({ f, at: i * step, ...options }));

export const sfx = {
  isOn: () => enabled,
  setOn(on) {
    enabled = on;
    store.saveSound(on);
    if (on) this.click();
  },
  unlock: () => { audio(); },
  click: () => tone({ f: 700, to: 460, dur: 0.05, type: 'triangle', vol: 0.05 }),
  join: () => melody([520, 780], 0.07, { dur: 0.09, type: 'triangle', vol: 0.06 }),
  leave: () => melody([600, 400], 0.07, { dur: 0.09, type: 'triangle', vol: 0.05 }),
  react: () => tone({ f: 500, to: 900, dur: 0.12, type: 'sine', vol: 0.07 }),
  count: () => tone({ f: 440, dur: 0.2, type: 'sine', vol: 0.16 }),
  go: () => {
    tone({ f: 880, dur: 0.55, type: 'square', vol: 0.09 });
    tone({ f: 440, to: 1320, dur: 0.4, type: 'sawtooth', vol: 0.05 });
  },
  error() {
    const now = performance.now();
    if (now - lastErrorAt < 120) return;
    lastErrorAt = now;
    tone({ f: 150, to: 90, dur: 0.1, type: 'sawtooth', vol: 0.05 });
  },
  nitro: () => tone({ f: 260, to: 1500, dur: 0.5, type: 'sawtooth', vol: 0.06 }),
  finish: () => melody([523, 659, 784, 1046], 0.09, { dur: 0.16, type: 'triangle', vol: 0.1 }),
  win: () => melody([523, 523, 523, 659, 784, 659, 784, 1046], 0.11, { dur: 0.2, type: 'square', vol: 0.06 }),
};
