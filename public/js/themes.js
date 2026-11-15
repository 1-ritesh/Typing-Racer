export const THEMES = {
  neon: {
    id: 'neon',
    night: true,
    sky: [[0, '#06031c'], [0.45, '#1a0a4d'], [0.8, '#6d1a90'], [1, '#ff4fa0']],
    road: '#17172b',
    roadAlt: '#1d1d36',
    dash: 'rgba(255,255,255,.7)',
    kerbA: '#ff3d5a',
    kerbB: '#f4f4ff',
    verge: '#0b0825',
    vergeLine: '#28e1ff',
    runoff: 'rgba(0,0,0,.32)',
    far: 0.18,
    mid: 0.4,
  },
  sunny: {
    id: 'sunny',
    night: false,
    sky: [[0, '#4aa8f5'], [0.55, '#9fd8ff'], [1, '#eaf8ff']],
    road: '#383c4b',
    roadAlt: '#41465a',
    dash: 'rgba(255,255,255,.8)',
    kerbA: '#e8384f',
    kerbB: '#ffffff',
    verge: '#3da95a',
    vergeLine: '#7be08f',
    runoff: 'rgba(0,0,0,.22)',
    far: 0.1,
    mid: 0.32,
  },
  desert: {
    id: 'desert',
    night: true,
    sky: [[0, '#241150'], [0.4, '#a63a7c'], [0.78, '#ff8f4d'], [1, '#ffd48a']],
    road: '#3a2e3c',
    roadAlt: '#43364a',
    dash: 'rgba(255,240,210,.75)',
    kerbA: '#ff6a3d',
    kerbB: '#fff1d6',
    verge: '#b9763f',
    vergeLine: '#ffc27a',
    runoff: 'rgba(30,8,30,.3)',
    far: 0.14,
    mid: 0.36,
  },
  moon: {
    id: 'moon',
    night: true,
    sky: [[0, '#050b18'], [0.48, '#14243a'], [1, '#485b70']],
    road: '#252d38',
    roadAlt: '#303a46',
    dash: 'rgba(238,247,255,.78)',
    kerbA: '#9dc7e2',
    kerbB: '#f1f5f8',
    verge: '#111b2b',
    vergeLine: '#83c9ed',
    runoff: 'rgba(1,5,12,.38)',
    far: 0.12,
    mid: 0.34,
  },
};

export const themeOf = (id) => THEMES[id] || THEMES.neon;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function surface(width, height, ratio) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  return { canvas, ctx, width, height };
}

function skyGradient(ctx, theme, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  for (const [stop, color] of theme.sky) gradient.addColorStop(stop, color);
  return gradient;
}

function glow(ctx, x, y, radius, inner, outer = 'rgba(0,0,0,0)') {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function skyline(ctx, rand, tileWidth, baseY, maxHeight, widths, look) {
  let x = 0;
  while (x < tileWidth - 6) {
    let w = widths[0] + rand() * (widths[1] - widths[0]);
    if (x + w > tileWidth) w = tileWidth - x;
    const height = maxHeight * (0.25 + rand() * 0.75);
    const top = baseY - height;
    ctx.fillStyle = look.fill;
    ctx.fillRect(x, top, w, height);
    if (look.windows) {
      for (let wy = top + 5; wy < baseY - 4; wy += 7) {
        for (let wx = x + 4; wx < x + w - 4; wx += 6) {
          if (rand() < look.density) {
            ctx.fillStyle = rand() < 0.5 ? look.windows[0] : look.windows[1];
            ctx.fillRect(wx, wy, 2.4, 3.2);
          }
        }
      }
    }
    if (look.neon && rand() < 0.35) {
      ctx.save();
      ctx.shadowBlur = 8;
      ctx.shadowColor = look.neon[0];
      ctx.fillStyle = rand() < 0.5 ? look.neon[0] : look.neon[1];
      ctx.fillRect(x, top, w, 1.6);
      ctx.restore();
    }
    if (w > 22 && height > maxHeight * 0.7 && rand() < 0.5) {
      ctx.fillStyle = look.fill;
      ctx.fillRect(x + w / 2 - 0.8, top - 12, 1.6, 12);
      ctx.fillStyle = '#ff4d6a';
      ctx.fillRect(x + w / 2 - 1.5, top - 13, 3, 3);
    }
    x += w + rand() * 5;
  }
}

function hills(ctx, rand, tileWidth, baseY, amplitude, color, waves = 3) {
  const phases = Array.from({ length: waves }, () => rand() * Math.PI * 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  for (let x = 0; x <= tileWidth; x += 4) {
    let y = 0;
    for (let i = 0; i < waves; i++) {
      const cycles = i + 1;
      y += Math.sin((x / tileWidth) * Math.PI * 2 * cycles + phases[i]) / cycles;
    }
    ctx.lineTo(x, baseY - amplitude * (0.55 + 0.3 * y));
  }
  ctx.lineTo(tileWidth, baseY);
  ctx.closePath();
  ctx.fill();
}

function pine(ctx, x, baseY, height, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const w = height * (0.5 - i * 0.1);
    const y = baseY - height * (0.28 * i);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x, y - height * 0.45);
    ctx.lineTo(x + w / 2, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillRect(x - 1.2, baseY, 2.4, 4);
}

function cactus(ctx, x, baseY, height, color) {
  ctx.fillStyle = color;
  const w = Math.max(3, height * 0.16);
  ctx.fillRect(x - w / 2, baseY - height, w, height);
  ctx.fillRect(x - w * 2.1, baseY - height * 0.62, w * 1.6, w * 0.9);
  ctx.fillRect(x - w * 2.1, baseY - height * 0.62 - height * 0.22, w * 0.9, height * 0.22 + w * 0.9);
  ctx.fillRect(x + w * 0.5, baseY - height * 0.46, w * 1.6, w * 0.9);
  ctx.fillRect(x + w * 1.2, baseY - height * 0.46 - height * 0.2, w * 0.9, height * 0.2 + w * 0.9);
}

function mesa(ctx, x, baseY, width, height, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.lineTo(x + width * 0.08, baseY - height * 0.55);
  ctx.lineTo(x + width * 0.14, baseY - height * 0.58);
  ctx.lineTo(x + width * 0.2, baseY - height);
  ctx.lineTo(x + width * 0.8, baseY - height);
  ctx.lineTo(x + width * 0.86, baseY - height * 0.6);
  ctx.lineTo(x + width * 0.93, baseY - height * 0.56);
  ctx.lineTo(x + width, baseY);
  ctx.closePath();
  ctx.fill();
}

function cloud(ctx, x, y, size) {
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  for (const [dx, dy, r] of [[0, 0, 1], [0.9, -0.25, 1.2], [1.9, 0, 1], [0.95, 0.15, 1.1]]) {
    ctx.beginPath();
    ctx.arc(x + dx * size, y + dy * size, r * size * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

function buildNeon(sky, far, mid, width, height, rand) {
  const { ctx } = sky;
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = `rgba(${rand() < 0.2 ? '255,170,220' : '220,230,255'},${0.25 + rand() * 0.6})`;
    const r = 0.4 + rand() * 1;
    ctx.beginPath();
    ctx.arc(rand() * width, rand() * height * 0.62, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const radius = Math.max(36, Math.min(150, height * 0.46));
  const sunX = width * 0.68;
  const sunY = height * 0.78;
  glow(ctx, sunX, sunY, radius * 2.2, 'rgba(255,63,164,.38)');
  const sun = surface(radius * 2, radius * 2, 1);
  const gradient = sun.ctx.createLinearGradient(0, 0, 0, radius * 2);
  gradient.addColorStop(0, '#ffe45e');
  gradient.addColorStop(0.55, '#ff8a4a');
  gradient.addColorStop(1, '#ff2f9a');
  sun.ctx.fillStyle = gradient;
  sun.ctx.beginPath();
  sun.ctx.arc(radius, radius, radius, 0, Math.PI * 2);
  sun.ctx.fill();
  sun.ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 6; i++) {
    const y = radius * (1.05 + i * 0.16);
    sun.ctx.fillRect(0, y, radius * 2, 1.2 + i * 0.9);
  }
  ctx.drawImage(sun.canvas, sunX - radius, sunY - radius, radius * 2, radius * 2);

  skyline(far.ctx, rand, far.width, height, height * 0.62, [26, 64], {
    fill: '#1b0f4f', windows: ['rgba(255,63,164,.5)', 'rgba(40,225,255,.45)'], density: 0.1,
  });
  skyline(mid.ctx, rand, mid.width, height, height * 0.4, [34, 84], {
    fill: '#0f0838', windows: ['rgba(255,214,90,.55)', 'rgba(40,225,255,.5)'], density: 0.08, neon: ['#28e1ff', '#ff3fa4'],
  });
}

function buildSunny(sky, far, mid, width, height, rand) {
  const { ctx } = sky;
  glow(ctx, width * 0.16, height * 0.3, 120, 'rgba(255,250,200,.85)');
  ctx.fillStyle = '#fffbe0';
  ctx.beginPath();
  ctx.arc(width * 0.16, height * 0.3, Math.max(18, Math.min(34, height * 0.14)), 0, Math.PI * 2);
  ctx.fill();

  hills(far.ctx, rand, far.width, height, height * 0.78, '#8ec4f2', 3);
  hills(far.ctx, rand, far.width, height, height * 0.55, '#6faee6', 4);
  for (let i = 0; i < 6; i++) cloud(far.ctx, rand() * far.width, height * (0.1 + rand() * 0.3), 12 + rand() * 12);

  hills(mid.ctx, rand, mid.width, height, height * 0.42, '#46ad60', 3);
  hills(mid.ctx, rand, mid.width, height, height * 0.26, '#2f9450', 4);
  for (let x = 20; x < mid.width; x += 26 + rand() * 60) pine(mid.ctx, x, height - 2, 18 + rand() * 20, '#1d6b3a');
}

function buildDesert(sky, far, mid, width, height, rand) {
  const { ctx } = sky;
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,240,255,${0.15 + rand() * 0.45})`;
    ctx.beginPath();
    ctx.arc(rand() * width, rand() * height * 0.4, 0.4 + rand() * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  const radius = Math.max(34, Math.min(140, height * 0.4));
  const sunX = width * 0.3;
  const sunY = height * 0.86;
  glow(ctx, sunX, sunY, radius * 2.4, 'rgba(255,170,90,.55)');
  const gradient = ctx.createLinearGradient(0, sunY - radius, 0, sunY + radius);
  gradient.addColorStop(0, '#fff0b8');
  gradient.addColorStop(1, '#ff9a4d');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(sunX, sunY, radius, 0, Math.PI * 2);
  ctx.fill();

  for (let x = rand() * 60; x < far.width; x += 90 + rand() * 120) {
    mesa(far.ctx, x, height, 70 + rand() * 90, height * (0.35 + rand() * 0.35), '#6b2c6e');
  }
  hills(mid.ctx, rand, mid.width, height, height * 0.34, '#8f3f5a', 3);
  hills(mid.ctx, rand, mid.width, height, height * 0.2, '#6d2a4f', 4);
  for (let x = 30; x < mid.width; x += 70 + rand() * 140) cactus(mid.ctx, x, height - 2, 16 + rand() * 18, '#3a1235');
}

function buildMoon(sky, far, mid, width, height, rand) {
  const { ctx } = sky;
  for (let i = 0; i < 110; i++) {
    ctx.fillStyle = `rgba(220,238,255,${0.25 + rand() * 0.65})`;
    const radius = 0.35 + rand() * 0.9;
    ctx.beginPath();
    ctx.arc(rand() * width, rand() * height, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  hills(far.ctx, rand, far.width, height, height * 0.55, '#34475b', 3);
  hills(far.ctx, rand, far.width, height, height * 0.36, '#293a4d', 4);
  hills(mid.ctx, rand, mid.width, height, height * 0.24, '#1d2b3a', 3);

  const radius = Math.max(30, Math.min(120, height * 0.38));
  const moonX = width * 0.76;
  const moonY = height * 0.78;
  const moonCtx = mid.ctx;
  glow(moonCtx, moonX, moonY, radius * 2.2, 'rgba(177,215,244,.24)');
  const moon = moonCtx.createLinearGradient(moonX - radius, moonY - radius, moonX + radius, moonY + radius);
  moon.addColorStop(0, '#f4f3e8');
  moon.addColorStop(1, '#9baec0');
  moonCtx.fillStyle = moon;
  moonCtx.beginPath();
  moonCtx.arc(moonX, moonY, radius, 0, Math.PI * 2);
  moonCtx.fill();
  for (let i = 0; i < 14; i++) {
    const angle = rand() * Math.PI * 2;
    const distance = Math.sqrt(rand()) * radius * 0.78;
    const craterRadius = 1.5 + rand() * radius * 0.09;
    moonCtx.fillStyle = 'rgba(90,111,132,.18)';
    moonCtx.beginPath();
    moonCtx.arc(moonX + Math.cos(angle) * distance, moonY + Math.sin(angle) * distance, craterRadius, 0, Math.PI * 2);
    moonCtx.fill();
  }

  for (let i = 0; i < 12; i++) {
    const x = rand() * mid.width;
    const y = height - 8 - rand() * height * 0.12;
    const rx = 4 + rand() * 13;
    const ry = rx * 0.28;
    mid.ctx.fillStyle = 'rgba(6,13,22,.36)';
    mid.ctx.beginPath();
    mid.ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    mid.ctx.fill();
    mid.ctx.strokeStyle = 'rgba(172,202,225,.2)';
    mid.ctx.lineWidth = 1;
    mid.ctx.beginPath();
    mid.ctx.ellipse(x, y - 1, rx, ry, 0, Math.PI, Math.PI * 2);
    mid.ctx.stroke();
  }
}

const BUILDERS = { neon: buildNeon, sunny: buildSunny, desert: buildDesert, moon: buildMoon };

// Builds three offscreen layers (static sky plus two tileable parallax layers) for a band of `height` px.
export function buildScenery(themeId, width, height, ratio) {
  const theme = themeOf(themeId);
  const tileWidth = Math.max(Math.ceil(width), 960);
  const rand = rng(theme.id.length * 7919 + 17);
  const sky = surface(width, height, ratio);
  sky.ctx.fillStyle = skyGradient(sky.ctx, theme, height);
  sky.ctx.fillRect(0, 0, width, height);
  const far = surface(tileWidth, height, ratio);
  const mid = surface(tileWidth, height, ratio);
  (BUILDERS[theme.id] || buildNeon)(sky, far, mid, width, height, rand);
  return { theme, sky, far, mid };
}
