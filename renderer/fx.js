// Controls every widget gets, whatever its module:
//   Audio: how the widget hears the music (reactivity, focus band, smoothing, hits, speed)
//   Look:  a post pass over the module's picture (color, transform, mirror, glow, trails, pixels)

export const FX_DEFAULTS = {
  react: 1, focus: 'full', smooth: 0, hits: 1, speed: 1,
  hue: 0, sat: 1, bright: 1, contrast: 1, invert: false,
  scale: 1, rotate: 0, spin: 0, x: 0, y: 0, flipX: false, flipY: false,
  mirror: 'none', segments: 6,
  glow: 0, trails: 0, pixel: 0, vignette: 0
};

export const FX_PARAMS = {
  audio: [
    { key: 'react', label: 'Reactivity', type: 'range', min: 0, max: 3, step: 0.05, section: 'Response' },
    { key: 'focus', label: 'Listen to', type: 'select', options: [['full', 'Whole mix'], ['bass', 'Bass and kicks'], ['mids', 'Mids and vocals'], ['highs', 'Highs and hats']] },
    { key: 'smooth', label: 'Smoothing', type: 'range', min: 0, max: 0.95, step: 0.01 },
    { key: 'hits', label: 'Hit strength', type: 'range', min: 0, max: 2.5, step: 0.05 },
    { key: 'speed', label: 'Motion speed', type: 'range', min: 0, max: 4, step: 0.05, section: 'Time' }
  ],
  look: [
    { key: 'hue', label: 'Hue shift', type: 'range', min: -180, max: 180, step: 1, unit: '°', section: 'Color' },
    { key: 'sat', label: 'Saturation', type: 'range', min: 0, max: 2.5, step: 0.01, pct: true },
    { key: 'bright', label: 'Brightness', type: 'range', min: 0, max: 2.5, step: 0.01, pct: true },
    { key: 'contrast', label: 'Contrast', type: 'range', min: 0.2, max: 2.5, step: 0.01, pct: true },
    { key: 'invert', label: 'Invert', type: 'toggle' },
    { key: 'scale', label: 'Zoom', type: 'range', min: 0.2, max: 3, step: 0.01, pct: true, section: 'Transform' },
    { key: 'rotate', label: 'Rotation', type: 'range', min: -180, max: 180, step: 1, unit: '°' },
    { key: 'spin', label: 'Spin', type: 'range', min: -90, max: 90, step: 1, unit: '°/s' },
    { key: 'x', label: 'Offset X', type: 'range', min: -1, max: 1, step: 0.01 },
    { key: 'y', label: 'Offset Y', type: 'range', min: -1, max: 1, step: 0.01 },
    { key: 'flipX', label: 'Flip horizontally', type: 'toggle' },
    { key: 'flipY', label: 'Flip vertically', type: 'toggle' },
    { key: 'mirror', label: 'Mirror', type: 'select', section: 'Symmetry', options: [['none', 'None'], ['h', 'Left ↔ right'], ['v', 'Top ↕ bottom'], ['quad', 'Four quadrants'], ['kaleido', 'Kaleidoscope']] },
    { key: 'segments', label: 'Kaleidoscope segments', type: 'range', min: 3, max: 16, step: 1, showIf: { mirror: 'kaleido' } },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 2, step: 0.01, section: 'Effects' },
    { key: 'trails', label: 'Trails', type: 'range', min: 0, max: 0.97, step: 0.01, pct: true },
    { key: 'pixel', label: 'Pixelate', type: 'range', min: 0, max: 40, step: 1 },
    { key: 'vignette', label: 'Vignette', type: 'range', min: 0, max: 1, step: 0.01, pct: true }
  ]
};

const LEVELS = ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'high', 'level'];
const HITS = ['kick', 'snare', 'hat', 'beat', 'hit'];
const OTHER = ['dt', 'time', 'sampleRate', 'active', 'peak', 'build', 'drop', 'centroid', 'pitch'];
const FOCUS = {
  full: { sub: 1, bass: 1, lowMid: 1, mid: 1, highMid: 1, high: 1, level: 1, kick: 1, snare: 1, hat: 1 },
  bass: { sub: 1.35, bass: 1.35, lowMid: 0.9, mid: 0.45, highMid: 0.3, high: 0.25, level: 1.1, kick: 1.3, snare: 0.4, hat: 0.15 },
  mids: { sub: 0.4, bass: 0.55, lowMid: 1.2, mid: 1.4, highMid: 1.1, high: 0.5, level: 1, kick: 0.5, snare: 1.3, hat: 0.5 },
  highs: { sub: 0.2, bass: 0.3, lowMid: 0.5, mid: 0.8, highMid: 1.35, high: 1.5, level: 1, kick: 0.3, snare: 0.8, hat: 1.4 }
};

export function isNeutralAudio(fx) { return fx.react === 1 && fx.focus === 'full' && fx.smooth === 0 && fx.hits === 1; }

// A per-widget view of the audio frame. Arrays are shared; scalars are reshaped.
export function shapeFrame(F, fx, st) {
  if (isNeutralAudio(fx)) return F;
  const o = st.F || (st.F = { ...F, onsets: [] });
  const g = FOCUS[fx.focus] || FOCUS.full;
  const k = 1 - fx.smooth;
  for (const n of OTHER) o[n] = F[n];
  for (const n of LEVELS) { const v = Math.min(1.5, F[n] * fx.react * g[n]); o[n] = st.init ? o[n] + (v - o[n]) * k : v; }
  for (const n of HITS) { const gn = g[n] ?? 1; o[n] = Math.min(1.5, F[n] * fx.hits * gn * (0.5 + 0.5 * fx.react)); }
  o.onsets.length = 0;
  for (const e of F.onsets) { const s = e.strength * fx.hits * (g[e.band] ?? 1); if (s > 0.3) o.onsets.push({ band: e.band, strength: Math.min(1.3, s) }); }
  o.waveL = F.waveL; o.waveR = F.waveR; o.wave = F.wave; o.spectrum = F.spectrum; o.bands = F.bands; o.scope = F.scope;
  st.init = true;
  return o;
}

export function isNeutralLook(fx) {
  return fx.hue === 0 && fx.sat === 1 && fx.bright === 1 && fx.contrast === 1 && !fx.invert && fx.scale === 1 && fx.rotate === 0 && fx.spin === 0 &&
    fx.x === 0 && fx.y === 0 && !fx.flipX && !fx.flipY && fx.mirror === 'none' && fx.glow === 0 && fx.trails === 0 && fx.pixel === 0 && fx.vignette === 0;
}

export function filterString(fx) {
  const f = [];
  if (fx.hue) f.push(`hue-rotate(${fx.hue}deg)`);
  if (fx.sat !== 1) f.push(`saturate(${fx.sat})`);
  if (fx.bright !== 1) f.push(`brightness(${fx.bright})`);
  if (fx.contrast !== 1) f.push(`contrast(${fx.contrast})`);
  if (fx.invert) f.push('invert(1)');
  return f.join(' ') || 'none';
}

// Draw the module picture `src` into the visible canvas `dst` through the Look settings.
export function post(dst, dctx, src, fx, st, dt) {
  const W = dst.width, H = dst.height;
  dctx.save();
  dctx.setTransform(1, 0, 0, 1, 0, 0);
  dctx.globalAlpha = 1; dctx.filter = 'none';
  if (fx.trails > 0) {
    dctx.globalCompositeOperation = 'source-over';
    dctx.fillStyle = `rgba(0,0,0,${(1 - Math.pow(fx.trails, dt * 60)).toFixed(4)})`;
    dctx.fillRect(0, 0, W, H);
  } else { dctx.globalCompositeOperation = 'source-over'; dctx.fillStyle = '#000'; dctx.fillRect(0, 0, W, H); }

  // pixelate: shrink into a scratch canvas, then draw back without smoothing
  let img = src;
  if (fx.pixel >= 2) {
    const p = st.pix || (st.pix = document.createElement('canvas'));
    const pw = Math.max(2, Math.round(W / fx.pixel)), ph = Math.max(2, Math.round(H / fx.pixel));
    if (p.width !== pw || p.height !== ph) { p.width = pw; p.height = ph; }
    p.getContext('2d').drawImage(src, 0, 0, pw, ph);
    img = p;
  }
  dctx.imageSmoothingEnabled = !(fx.pixel >= 2);
  st.angle = (st.angle || 0) + (fx.spin * Math.PI / 180) * dt;
  const base = filterString(fx);
  const draw = (filter, op, alpha) => {
    dctx.filter = filter; dctx.globalCompositeOperation = op; dctx.globalAlpha = alpha;
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.translate(W / 2 + fx.x * W / 2, H / 2 - fx.y * H / 2);
    dctx.rotate(fx.rotate * Math.PI / 180 + st.angle);
    dctx.scale(fx.scale * (fx.flipX ? -1 : 1), fx.scale * (fx.flipY ? -1 : 1));
    drawMirrored(dctx, img, W, H, fx);
  };
  draw(base, fx.trails > 0 ? 'lighten' : 'source-over', 1);
  if (fx.glow > 0) {
    const r = Math.max(1, Math.round(Math.min(W, H) * 0.012 * (0.5 + fx.glow)));
    draw((base === 'none' ? '' : base + ' ') + `blur(${r}px)`, 'lighter', Math.min(1, fx.glow * 0.7));
  }
  dctx.setTransform(1, 0, 0, 1, 0, 0);
  dctx.filter = 'none'; dctx.globalAlpha = 1;
  if (fx.vignette > 0) {
    const g = dctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.55);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${fx.vignette})`);
    dctx.globalCompositeOperation = 'source-over'; dctx.fillStyle = g; dctx.fillRect(0, 0, W, H);
  }
  dctx.restore();
}

// Draw `img` centered at the origin (W×H), with the chosen symmetry.
function drawMirrored(c, img, W, H, fx) {
  const sw = img.width, sh = img.height;
  if (fx.mirror === 'h') {
    c.drawImage(img, 0, 0, sw / 2, sh, -W / 2, -H / 2, W / 2, H);
    c.save(); c.scale(-1, 1); c.drawImage(img, 0, 0, sw / 2, sh, -W / 2, -H / 2, W / 2, H); c.restore();
  } else if (fx.mirror === 'v') {
    c.drawImage(img, 0, 0, sw, sh / 2, -W / 2, -H / 2, W, H / 2);
    c.save(); c.scale(1, -1); c.drawImage(img, 0, 0, sw, sh / 2, -W / 2, -H / 2, W, H / 2); c.restore();
  } else if (fx.mirror === 'quad') {
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      c.save(); c.scale(sx, sy); c.drawImage(img, 0, 0, sw / 2, sh / 2, -W / 2, -H / 2, W / 2, H / 2); c.restore();
    }
  } else if (fx.mirror === 'kaleido') {
    const n = Math.max(3, Math.round(fx.segments)), a = Math.PI * 2 / n, R = Math.hypot(W, H) / 2 + 2;
    for (let i = 0; i < n; i++) {
      c.save();
      c.rotate(i * a);
      if (i % 2) { c.rotate(a); c.scale(1, -1); } // mirrored wedge lands in the same slot
      c.beginPath(); c.moveTo(0, 0); c.lineTo(R, 0); c.lineTo(R * Math.cos(a), R * Math.sin(a)); c.closePath(); c.clip();
      c.drawImage(img, -W / 2, -H / 2, W, H);
      c.restore();
    }
  } else c.drawImage(img, -W / 2, -H / 2, W, H);
}
