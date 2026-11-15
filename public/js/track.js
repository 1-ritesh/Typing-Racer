import { CAR_H, CAR_W, drawCar, roundRect } from './cars.js';
import { buildScenery, themeOf } from './themes.js';
import { clamp } from './dom.js';

const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const EMOJI = { fire: '\u{1F525}', laugh: '\u{1F602}', wow: '\u{1F631}', clap: '\u{1F44F}', flag: '\u{1F3C1}', wind: '\u{1F4A8}' };
const MEDALS = ['#ffd23f', '#d5dae8', '#e29a62'];
const CONFETTI = ['#ff3fa4', '#28e1ff', '#ffd23f', '#7dff8a', '#a259ff', '#ffffff'];
const STAGE_PHASES = ['countdown', 'racing', 'results'];
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

const ease = (t) => 1 - (1 - t) ** 3;

function makeCar(id) {
  return {
    id, name: '', style: 'coupe', color: '#28d7ff', you: false, bot: false,
    frac: 0, target: 0, fast: false, speed: 0, norm: 0, wheel: Math.random() * 6, roadOffset: 0,
    nitro: false, nitroLevel: 0, wpm: 0, place: 0, rank: 0, finished: false, after: 0, flip: -1,
    phase: Math.random() * 6.28, alpha: 1, alphaGoal: 1, demoSpeed: 0, demoWait: 0, bubbles: [], labelCache: null,
  };
}

export class Track {
  constructor(canvas, { demo = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.demo = demo;
    this.cars = new Map();
    this.order = [];
    this.phase = demo ? 'demo' : 'lobby';
    this.textLength = demo ? 160 : 200;
    this.themeId = 'neon';
    this.scenery = null;
    this.sceneryKey = '';
    this.scroll = 0;
    this.time = 0;
    this.particles = [];
    this.running = false;
    this.raf = 0;
    this.last = 0;
    this.w = 0;
    this.h = 0;
    this.ratio = 1;
    this.road = { n: 1, laneH: 60, top: 0, height: 60, kerb: 7, verge: 12 };
    this.startX = 22;
    this.finishX = 0;
    this.maxLane = demo ? 46 : 0;
    this.frame = this.frame.bind(this);
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement || canvas);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else if (this.running) this.kick();
    });
  }

  // ----- public API -----------------------------------------------------

  setTheme(id) {
    if (id === this.themeId && this.scenery) return;
    this.themeId = themeOf(id).id;
    this.sceneryKey = '';
    this.layout();
  }

  setTextLength(length) {
    this.textLength = Math.max(20, length || 200);
  }

  setCars(list) {
    const ids = new Set(list.map((c) => c.id));
    for (const id of [...this.cars.keys()]) if (!ids.has(id)) this.cars.delete(id);
    this.order = list.map((c) => c.id);
    for (const info of list) {
      let car = this.cars.get(info.id);
      if (!car) {
        car = makeCar(info.id);
        this.cars.set(info.id, car);
        if (this.demo) this.resetDemoCar(car, true);
      }
      Object.assign(car, { name: info.name, style: info.style, color: info.color, you: !!info.you, bot: !!info.bot });
      car.labelCache = null;
    }
    this.layout();
  }

  setPhase(phase) {
    this.phase = phase;
    if (phase === 'lobby' || phase === 'countdown') {
      for (const car of this.cars.values()) {
        Object.assign(car, { frac: 0, target: 0, speed: 0, norm: 0, nitro: false, wpm: 0, place: 0, rank: 0, finished: false, after: 0, fast: false, flip: -1 });
      }
    }
  }

  setTarget(id, fraction, { wpm = 0, nitro = false, place = 0, fast = false } = {}) {
    const car = this.cars.get(id);
    if (!car) return;
    car.target = clamp(fraction, 0, 1);
    car.fast = fast;
    car.wpm = wpm;
    car.nitro = nitro;
    if (place > 0 && !car.finished) {
      car.finished = true;
      car.after = 0;
    }
    car.place = place;
  }

  react(id, kind) {
    const car = this.cars.get(id);
    if (car && EMOJI[kind]) car.bubbles.push({ kind, t: 0 });
  }

  backflip(id) {
    const car = this.cars.get(id);
    if (car && (car.finished || car.target >= 1)) car.flip = 0;
  }

  celebrate(id) {
    const index = this.order.indexOf(id);
    if (index < 0 || motion.matches) return;
    const y = this.road.top + this.road.laneH * (index + 0.5);
    for (let i = 0; i < 44; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
      const speed = 120 + Math.random() * 260;
      this.particles.push({
        kind: 'confetti', x: this.finishX, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        g: 520, life: 1.6 + Math.random() * 0.8, max: 2.4, spin: Math.random() * 6, spinRate: (Math.random() - 0.5) * 14,
        color: CONFETTI[i % CONFETTI.length], size: 3 + Math.random() * 3,
      });
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    this.kick();
  }

  stop() {
    this.running = false;
    this.pause();
  }

  // ----- sizing ---------------------------------------------------------

  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const box = parent.getBoundingClientRect();
    const w = Math.max(1, Math.floor(box.width));
    const h = Math.max(1, Math.floor(box.height));
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && ratio === this.ratio) return;
    this.w = w;
    this.h = h;
    this.ratio = ratio;
    this.canvas.width = Math.round(w * ratio);
    this.canvas.height = Math.round(h * ratio);
    this.sceneryKey = '';
    this.layout();
    if (!this.raf) this.render(0);
  }

  layout() {
    if (!this.w) return;
    const n = Math.max(1, this.order.length);
    const kerb = 7;
    const verge = 12;
    const sky = Math.min(72, this.h * 0.22);
    const cap = this.maxLane || (n <= 2 ? 120 : n <= 4 ? 104 : 92);
    const laneH = clamp((this.h - sky - kerb * 2 - verge) / n, 30, cap);
    const height = laneH * n;
    const top = Math.max(verge + kerb, this.h - height - kerb);
    this.road = { n, laneH, top, height, kerb, verge };
    this.startX = clamp(this.w * 0.025, 12, 30);
    this.finishX = this.w - clamp(this.w * 0.07, 50, 96);
    const key = `${this.themeId}:${this.w}x${this.h}@${this.ratio}`;
    if (key !== this.sceneryKey) {
      this.sceneryKey = key;
      this.scenery = buildScenery(this.themeId, this.w, this.h, this.ratio);
    }
  }

  // ----- loop -----------------------------------------------------------

  kick() {
    if (this.raf || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  pause() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  frame(now) {
    this.raf = 0;
    if (!this.running) return;
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.update(dt);
    this.render(dt);
    this.raf = requestAnimationFrame(this.frame);
  }

  update(dt) {
    this.time += dt;
    let moving = 0;
    let count = 0;
    for (const car of this.cars.values()) {
      if (this.demo) this.stepDemo(car, dt);
      const before = car.frac;
      car.frac += (car.target - car.frac) * (1 - Math.exp(-dt * (car.fast ? 20 : 9)));
      if (Math.abs(car.target - car.frac) < 0.0002) car.frac = car.target;
      const velocity = dt > 0 ? (car.frac - before) / dt : 0;
      car.speed += (velocity - car.speed) * (1 - Math.exp(-dt * 5));
      car.norm = car.finished ? Math.max(0, car.norm - dt * 1.4) : clamp((car.speed * this.textLength) / 8, 0, 1.4);
      car.wheel += (3 + car.norm * 38) * dt;
      car.roadOffset += car.norm * 460 * dt;
      car.nitroLevel += ((car.nitro && !car.finished ? 1 : 0) - car.nitroLevel) * (1 - Math.exp(-dt * 8));
      car.alpha += (car.alphaGoal - car.alpha) * (1 - Math.exp(-dt * 7));
      if (car.finished) car.after = Math.min(1, car.after + dt / 1.3);
      if (car.flip >= 0) {
        car.flip += dt;
        if (car.flip >= 1.1) car.flip = -1;
      }
      for (const bubble of car.bubbles) bubble.t += dt;
      car.bubbles = car.bubbles.filter((b) => b.t < 1.9);
      moving += car.norm;
      count += 1;
    }
    const idle = this.phase === 'lobby' ? 12 : 0;
    const drive = count ? (moving / count) * 360 : 0;
    if (!motion.matches) this.scroll += (drive + idle) * dt;
    this.rankCars();
    this.stepParticles(dt);
  }

  rankCars() {
    if (!STAGE_PHASES.includes(this.phase)) return;
    const cars = [...this.cars.values()];
    cars.sort((a, b) => {
      if (a.place && b.place) return a.place - b.place;
      if (a.place) return -1;
      if (b.place) return 1;
      return b.frac - a.frac;
    });
    cars.forEach((car, index) => { car.rank = index + 1; });
  }

  stepDemo(car, dt) {
    if (car.finished) {
      car.demoWait += dt;
      if (car.demoWait > 1.6) car.alphaGoal = 0;
      if (car.demoWait > 2.2) this.resetDemoCar(car, false);
      return;
    }
    car.target = Math.min(1, car.target + car.demoSpeed * dt);
    if (car.target >= 1) {
      car.finished = true;
      car.place = 1;
      car.after = 0;
      car.demoWait = 0;
    }
  }

  resetDemoCar(car, scatter) {
    Object.assign(car, {
      frac: 0, target: scatter ? Math.random() * 0.8 : 0, speed: 0, finished: false, place: 0, after: 0,
      demoSpeed: 0.03 + Math.random() * 0.035, demoWait: 0, alphaGoal: 1,
    });
    if (scatter) car.frac = car.target;
    else car.alpha = 0;
    car.nitro = Math.random() < 0.3;
  }

  stepParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += (p.spinRate || 0) * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
  }

  // ----- drawing --------------------------------------------------------

  render(dt) {
    if (!this.w) return;
    const { ctx } = this;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const theme = themeOf(this.themeId);
    this.drawScenery(theme);
    this.drawRoad(theme);
    this.drawCars(theme, dt);
    this.drawParticles();
  }

  drawScenery(theme) {
    const { ctx, scenery, road } = this;
    if (!scenery) return;
    const band = road.top - road.kerb - road.verge;
    const shift = band - this.h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.w, Math.max(0, band));
    ctx.clip();
    ctx.drawImage(scenery.sky.canvas, 0, shift, this.w, this.h);
    this.tile(scenery.far, this.scroll * theme.far, shift);
    this.tile(scenery.mid, this.scroll * theme.mid, shift);
    ctx.restore();
    ctx.fillStyle = theme.verge;
    ctx.fillRect(0, band, this.w, road.verge);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = theme.vergeLine;
    ctx.fillRect(0, band, this.w, 1.5);
    ctx.globalAlpha = 1;
  }

  tile(layer, offset, y) {
    const x = -(offset % layer.width);
    this.ctx.drawImage(layer.canvas, x, y, layer.width, this.h);
    this.ctx.drawImage(layer.canvas, x + layer.width, y, layer.width, this.h);
  }

  drawRoad(theme) {
    const { ctx, road } = this;
    const { n, laneH, top, height, kerb } = road;
    const segment = 18;
    const kerbOffset = this.scroll % (segment * 2);
    for (const y of [top - kerb, top + height]) {
      for (let x = -kerbOffset - segment * 2; x < this.w; x += segment * 2) {
        ctx.fillStyle = theme.kerbA;
        ctx.fillRect(x, y, segment, kerb);
        ctx.fillStyle = theme.kerbB;
        ctx.fillRect(x + segment, y, segment, kerb);
      }
    }
    for (let i = 0; i < n; i++) {
      const y = top + i * laneH;
      ctx.fillStyle = i % 2 ? theme.roadAlt : theme.road;
      ctx.fillRect(0, y, this.w, laneH);
      const car = this.cars.get(this.order[i]);
      if (car && !this.demo) {
        const period = 64;
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        for (let x = -(car.roadOffset % period) - period; x < this.w; x += period) ctx.fillRect(x, y + laneH / 2 - 1, 20, 2);
      }
      if (car && car.you) {
        ctx.fillStyle = 'rgba(40,225,255,.07)';
        ctx.fillRect(0, y, this.w, laneH);
        ctx.fillStyle = 'rgba(40,225,255,.45)';
        ctx.fillRect(0, y, this.w, 1);
        ctx.fillRect(0, y + laneH - 1, this.w, 1);
      }
    }
    const period = 48;
    ctx.fillStyle = theme.dash;
    for (let i = 1; i < n; i++) {
      for (let x = -(this.scroll % period) - period; x < this.w; x += period) ctx.fillRect(x, top + i * laneH - 1, 26, 2);
    }
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillRect(this.startX - 7, top, 3, height);
    const cell = Math.max(4, laneH / 4);
    for (let row = 0; row * cell < height; row++) {
      for (let col = 0; col < 2; col++) {
        ctx.fillStyle = (row + col) % 2 ? '#10101c' : '#f6f6ff';
        ctx.fillRect(this.finishX + col * cell, top + row * cell, cell, Math.min(cell, height - row * cell));
      }
    }
    ctx.fillStyle = theme.runoff;
    ctx.fillRect(this.finishX + cell * 2, top, this.w - this.finishX - cell * 2, height);
  }

  drawCars(theme, dt) {
    const { ctx, road } = this;
    const { laneH, top } = road;
    const carH = Math.min(laneH * 0.62, 66);
    const carW = carH * (CAR_W / CAR_H);
    const scale = carH / CAR_H;
    const endX = this.finishX - carW;
    const parkX = Math.max(endX, this.w - 8 - carW);

    this.order.forEach((id, index) => {
      const car = this.cars.get(id);
      if (!car) return;
      const laneTop = top + index * laneH;
      const ground = laneTop + laneH - laneH * 0.1;
      const raceX = this.startX + (endX - this.startX) * clamp(car.frac, 0, 1);
      const x = raceX + (parkX - endX) * ease(car.after);
      const revving = this.phase === 'countdown' ? 0.9 : this.phase === 'lobby' ? 0.3 : 0;
      const shake = motion.matches ? 0 : Math.sin(this.time * 38 + car.phase) * revving * 0.5 * scale;
      const bob = motion.matches ? 0 : Math.sin(this.time * 15 + car.phase) * (0.3 + car.norm * 1.1) * scale + shake;

      ctx.save();
      ctx.globalAlpha = clamp(car.alpha, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.38)';
      ctx.beginPath();
      ctx.ellipse(x + carW / 2, ground, carW * 0.47, Math.max(2, carH * 0.075), 0, 0, Math.PI * 2);
      ctx.fill();
      if (car.nitroLevel > 0.05) this.drawStreaks(x, ground - carH, carH, car.nitroLevel);
      const flipProgress = car.flip >= 0 ? clamp(car.flip / 1.1, 0, 1) : 0;
      const flipHop = car.flip >= 0 ? Math.sin(Math.PI * flipProgress) * carH * 1.35 : 0;
      ctx.translate(x + carW / 2, ground - carH / 2 + bob - flipHop);
      if (car.flip >= 0) ctx.rotate(Math.PI * 2 * ease(flipProgress));
      ctx.scale(scale, scale);
      ctx.translate(-CAR_W / 2, -CAR_H / 2);
      drawCar(ctx, car.style, car.color, {
        spin: car.wheel, nitro: car.nitroLevel, flicker: Math.random(), lights: theme.night,
      });
      ctx.restore();

      if (car.nitroLevel > 0.4 && !motion.matches && dt > 0 && Math.random() < dt * 40 * car.nitroLevel) {
        this.particles.push({
          kind: 'spark', x: x + 2 * scale, y: ground - carH + 33 * scale, vx: -(90 + Math.random() * 160), vy: (Math.random() - 0.5) * 50,
          g: 60, life: 0.35, max: 0.35, color: Math.random() < 0.5 ? '#ffb347' : '#fff1b0', size: 1.6 + Math.random() * 1.6,
        });
      }
      if (!this.demo) this.drawLabel(car, x + carW / 2, laneTop, laneH);
      this.drawBubbles(car, x + carW / 2, ground - carH, scale);
    });
  }

  drawStreaks(x, y, carH, level) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = `rgba(170,235,255,${0.4 * level})`;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    const tick = Math.floor(this.time * 24);
    for (let k = 0; k < 4; k++) {
      const ly = y + carH * (0.25 + k * 0.2);
      const length = carH * (0.9 + (((k * 37 + tick) % 7) / 7) * 1.2);
      ctx.beginPath();
      ctx.moveTo(x - 6, ly);
      ctx.lineTo(x - 6 - length, ly);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLabel(car, centerX, laneTop, laneH) {
    const { ctx } = this;
    const size = clamp(laneH * 0.2, 10, 14);
    const showRank = STAGE_PHASES.includes(this.phase) && car.rank > 0;
    const showWpm = this.phase === 'racing' && car.wpm > 0 && !car.finished;
    ctx.font = `700 ${size}px ${FONT}`;
    const pad = 6;
    const nameWidth = ctx.measureText(car.name).width;
    const rankWidth = showRank ? size + 4 : 0;
    const wpmText = showWpm ? String(Math.round(car.wpm)) : '';
    const wpmWidth = wpmText ? ctx.measureText(wpmText).width + 8 : 0;
    const youWidth = car.you ? ctx.measureText('YOU').width + 10 : 0;
    const width = pad * 2 + rankWidth + nameWidth + wpmWidth + youWidth;
    const height = size + 7;
    const x = clamp(centerX - width / 2, 4, this.w - width - 4);
    const y = laneTop + 2;

    ctx.save();
    ctx.globalAlpha = clamp(car.alpha, 0, 1);
    roundRect(ctx, x, y, width, height, height / 2);
    ctx.fillStyle = 'rgba(7,5,26,.84)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = car.color;
    ctx.stroke();
    let cursor = x + pad;
    const mid = y + height / 2;
    ctx.textBaseline = 'middle';
    if (showRank) {
      ctx.fillStyle = car.rank <= 3 ? MEDALS[car.rank - 1] : '#4a4685';
      ctx.beginPath();
      ctx.arc(cursor + size / 2 - 1, mid, size / 2 + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = car.rank <= 3 ? '#1a1030' : '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(String(car.rank), cursor + size / 2 - 1, mid + 0.5);
      cursor += rankWidth;
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(car.name, cursor, mid + 0.5);
    cursor += nameWidth;
    if (car.you) {
      cursor += 5;
      ctx.fillStyle = '#28e1ff';
      ctx.fillText('YOU', cursor, mid + 0.5);
      cursor += ctx.measureText('YOU').width + 5;
    }
    if (wpmText) {
      ctx.fillStyle = '#9be7ff';
      ctx.fillText(wpmText, cursor + 8, mid + 0.5);
    }
    ctx.restore();
  }

  drawBubbles(car, centerX, carTop, scale) {
    if (!car.bubbles.length) return;
    const { ctx } = this;
    for (const bubble of car.bubbles) {
      const p = bubble.t / 1.9;
      ctx.save();
      ctx.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      ctx.font = `${clamp(28 * Math.max(scale, 0.8), 22, 36)}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(EMOJI[bubble.kind], centerX + Math.sin(bubble.t * 6) * 4, carTop - 8 - ease(Math.min(1, bubble.t / 1.2)) * 36);
      ctx.restore();
    }
  }

  drawParticles() {
    const { ctx } = this;
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / (p.max * 0.5), 0, 1);
      ctx.fillStyle = p.color;
      if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
