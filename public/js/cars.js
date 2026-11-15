// Cars are drawn in a 120x48 box facing right; the ground is y=48.
export const CAR_W = 120;
export const CAR_H = 48;

const shadeCache = new Map();

export function shade(hex, amount) {
  const key = hex + amount;
  let out = shadeCache.get(key);
  if (out) return out;
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  const mix = (c) => Math.round(c + (target - c) * k);
  out = `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
  shadeCache.set(key, out);
  return out;
}

export function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function paint(ctx, path, color) {
  const gradient = ctx.createLinearGradient(0, 6, 0, 40);
  gradient.addColorStop(0, shade(color, 0.34));
  gradient.addColorStop(0.45, color);
  gradient.addColorStop(1, shade(color, -0.45));
  ctx.fillStyle = gradient;
  ctx.fill(path);
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(8,6,24,.6)';
  ctx.stroke(path);
}

function glass(ctx, path, shine) {
  const gradient = ctx.createLinearGradient(0, 8, 0, 24);
  gradient.addColorStop(0, '#1d2f66');
  gradient.addColorStop(1, '#0a1230');
  ctx.fillStyle = gradient;
  ctx.fill(path);
  if (shine) {
    ctx.fillStyle = 'rgba(160,225,255,.28)';
    ctx.fill(new Path2D(shine));
  }
}

function line(ctx, d, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke(new Path2D(d));
}

function arches(ctx, body, wheels, radius) {
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = '#0a0916';
  for (const [x, y] of wheels) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function wheel(ctx, cx, cy, r, angle, rim) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#0c0b16';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a2940';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.68, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(angle);
  ctx.strokeStyle = rim;
  ctx.lineWidth = Math.max(1, r * 0.15);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
  }
  ctx.stroke();
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function lamps(ctx, headX, headY, tailX, tailY) {
  ctx.fillStyle = '#fff6c4';
  roundRect(ctx, headX - 5, headY - 1.6, 5.4, 3.2, 1.2);
  ctx.fill();
  ctx.fillStyle = '#ff2f55';
  roundRect(ctx, tailX - 0.4, tailY - 1.6, 4.6, 3.2, 1.2);
  ctx.fill();
}

const STYLES = {
  coupe: {
    body: new Path2D('M6 38 L4 30 Q4 25 10 24 L30 22 Q38 9 54 8 L70 8 Q84 9 94 21 L110 24 Q118 26 118 32 L118 38 Z'),
    wheels: [[27, 38, 9.5], [93, 38, 9.5]],
    exhaust: [3, 32],
    head: [118, 28],
    draw(ctx, color, spin) {
      paint(ctx, this.body, color);
      glass(ctx, new Path2D('M41 21 L50 12 L70 12 L82 21 Z'), 'M52 12 L58 12 L50 21 L44 21 Z');
      line(ctx, 'M62 12 L62 21', '#0a0f26', 1.6);
      line(ctx, 'M62 21 L62 36', 'rgba(8,6,24,.35)', 0.8);
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.fillRect(10, 30.2, 100, 1.5);
      line(ctx, 'M54 8.7 L70 8.7', 'rgba(255,255,255,.4)', 1);
      ctx.fillStyle = shade(color, -0.5);
      ctx.fillRect(5, 20, 1.6, 4.6);
      ctx.fillRect(12, 20, 1.6, 3.8);
      roundRect(ctx, 1, 17.4, 17, 2.8, 1);
      ctx.fill();
      arches(ctx, this.body, this.wheels, 11.8);
      for (const [x, y, r] of this.wheels) wheel(ctx, x, y, r, spin, shade(color, 0.5));
      lamps(ctx, 118, 28, 4, 28);
    },
  },

  formula: {
    body: new Path2D('M10 37 L10 31 Q10 28 14 28 L46 27 L70 27 L100 32 L118 35 L118 37 Z'),
    wheels: [[25, 36, 11], [99, 37.5, 9.5]],
    exhaust: [9, 33],
    head: [118, 35.5],
    draw(ctx, color, spin) {
      const dark = shade(color, -0.5);
      ctx.fillStyle = dark;
      ctx.fillRect(3, 11.5, 6, 23);
      ctx.fillRect(15, 15, 1.8, 14);
      paint(ctx, this.body, color);
      ctx.fillStyle = shade(color, -0.2);
      ctx.fill(new Path2D('M28 28 L36 17 L48 16.5 L54 27.5 Z'));
      ctx.fillStyle = 'rgba(8,6,24,.5)';
      ctx.fillRect(14, 35.4, 104, 1.8);
      ctx.fillStyle = shade(color, 0.45);
      roundRect(ctx, 0.5, 12, 23, 3.2, 1);
      ctx.fill();
      ctx.fillStyle = '#f4f4ff';
      ctx.beginPath();
      ctx.arc(62, 23, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#10101c';
      ctx.beginPath();
      ctx.ellipse(64.6, 23, 2.6, 1.9, 0, 0, Math.PI * 2);
      ctx.fill();
      line(ctx, 'M52 27 Q60 15 72 26.5', '#161625', 1.8);
      ctx.fillStyle = dark;
      ctx.fillRect(117, 33, 2.6, 8);
      ctx.fillStyle = shade(color, 0.45);
      roundRect(ctx, 103, 38.4, 16, 2.4, 1);
      ctx.fill();
      for (const [x, y, r] of this.wheels) wheel(ctx, x, y, r, spin, shade(color, 0.45));
      lamps(ctx, 118, 33, 9, 31);
    },
  },

  hatch: {
    body: new Path2D('M7 38 L6 27 Q6 24 10 23 L26 10 Q28 8 32 8 L76 8 Q82 8 86 13 L98 23 L112 25 Q118 26 118 32 L118 38 Z'),
    wheels: [[26, 38, 9.5], [94, 38, 9.5]],
    exhaust: [5, 33],
    head: [118, 29],
    draw(ctx, color, spin) {
      paint(ctx, this.body, color);
      glass(ctx, new Path2D('M28 13 L52 13 L52 22 L15 22 Z'), 'M34 13 L40 13 L31 22 L25 22 Z');
      glass(ctx, new Path2D('M56 13 L76 13 L82 15 L94 22 L56 22 Z'), null);
      line(ctx, 'M54 11 L54 36', 'rgba(8,6,24,.55)', 1.2);
      line(ctx, 'M32 8.7 L76 8.7', 'rgba(255,255,255,.35)', 1);
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.fillRect(10, 30.6, 100, 1.5);
      ctx.fillStyle = shade(color, -0.5);
      ctx.fillRect(38, 5.2, 28, 2.2);
      arches(ctx, this.body, this.wheels, 11.8);
      for (const [x, y, r] of this.wheels) wheel(ctx, x, y, r, spin, shade(color, 0.5));
      lamps(ctx, 118, 29, 5, 29);
    },
  },

  pickup: {
    body: new Path2D('M5 38 L5 20 L52 20 L54 12 Q55 8 60 8 L80 8 Q86 8 90 13 L98 22 L112 24 Q118 25 118 31 L118 38 Z'),
    wheels: [[24, 38, 10.5], [96, 38, 10.5]],
    exhaust: [4, 33],
    head: [118, 28],
    draw(ctx, color, spin) {
      paint(ctx, this.body, color);
      ctx.fillStyle = 'rgba(8,6,24,.38)';
      ctx.fillRect(5.6, 20.6, 46, 3);
      line(ctx, 'M9 20 L9 37', 'rgba(8,6,24,.4)', 0.9);
      glass(ctx, new Path2D('M58 12 L78 12 L86 13.5 L94 21 L58 21 Z'), 'M62 12 L68 12 L60 21 L56 21 Z');
      line(ctx, 'M56 12 L56 36', 'rgba(8,6,24,.5)', 1.1);
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.fillRect(6, 30.6, 104, 1.5);
      ctx.fillStyle = '#10101c';
      ctx.fillRect(64, 4.6, 14, 3.2);
      ctx.fillStyle = '#ffe066';
      for (let i = 0; i < 4; i++) ctx.fillRect(65.5 + i * 3.4, 5.3, 2, 1.8);
      arches(ctx, this.body, this.wheels, 12.8);
      for (const [x, y, r] of this.wheels) wheel(ctx, x, y, r, spin, shade(color, 0.5));
      lamps(ctx, 118, 28, 4, 28);
    },
  },
};

function flame(ctx, x, y, level, flicker) {
  const length = (16 + 26 * level) * (0.85 + flicker * 0.3);
  const width = 3.2 + 3 * level;
  const layers = [['rgba(255,110,40,.85)', 1, 1], ['rgba(255,210,70,.9)', 0.68, 0.7], ['rgba(255,255,230,.95)', 0.36, 0.45]];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [fill, lengthK, widthK] of layers) {
    const l = length * lengthK;
    const w = width * widthK;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x, y - w);
    ctx.quadraticCurveTo(x - l * 0.6, y - w * 0.9, x - l, y);
    ctx.quadraticCurveTo(x - l * 0.6, y + w * 0.9, x, y + w);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function beam(ctx, x, y) {
  const gradient = ctx.createLinearGradient(x, 0, x + 72, 0);
  gradient.addColorStop(0, 'rgba(255,245,190,.4)');
  gradient.addColorStop(1, 'rgba(255,245,190,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(x, y - 1.5);
  ctx.lineTo(x + 72, y - 15);
  ctx.lineTo(x + 72, y + 11);
  ctx.lineTo(x, y + 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawCar(ctx, style, color, { spin = 0, nitro = 0, flicker = 0, lights = false } = {}) {
  const spec = STYLES[style] || STYLES.coupe;
  if (nitro > 0.02) flame(ctx, spec.exhaust[0], spec.exhaust[1], nitro, flicker);
  if (lights) beam(ctx, spec.head[0], spec.head[1]);
  spec.draw(ctx, color, spin);
}

export function carThumb(style, color, width = 72) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const height = Math.round(width * (CAR_H / CAR_W));
  const canvas = document.createElement('canvas');
  canvas.className = 'car-thumb';
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  const scale = (width * ratio) / CAR_W;
  ctx.scale(scale, scale);
  drawCar(ctx, style, color, { spin: 0.4 });
  return canvas;
}
