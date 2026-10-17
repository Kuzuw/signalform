// Shared helpers for modules: noise, color, drawing.

// ---- 3D simplex noise (Stefan Gustavson, public domain), returns -1..1
const grad3 = new Float32Array([1,1,0,-1,1,0,1,-1,0,-1,-1,0,1,0,1,-1,0,1,1,0,-1,-1,0,-1,0,1,1,0,-1,1,0,1,-1,0,-1,-1]);
const perm = new Uint8Array(512);
const permMod12 = new Uint8Array(512);
(function seed(s) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }
})(1337);
const F3 = 1 / 3, G3 = 1 / 6;
export function noise3(x, y, z) {
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }
  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  let n = 0, t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 > 0) { const g = permMod12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n += t0 * t0 * (grad3[g] * x0 + grad3[g + 1] * y0 + grad3[g + 2] * z0); }
  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 > 0) { const g = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n += t1 * t1 * (grad3[g] * x1 + grad3[g + 1] * y1 + grad3[g + 2] * z1); }
  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 > 0) { const g = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n += t2 * t2 * (grad3[g] * x2 + grad3[g + 1] * y2 + grad3[g + 2] * z2); }
  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 > 0) { const g = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n += t3 * t3 * (grad3[g] * x3 + grad3[g + 1] * y3 + grad3[g + 2] * z3); }
  return 32 * n;
}

// ---- color
export function hexToRgb(hex) {
  const h = String(hex || '#ffffff').replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
export function mixRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export function rgba(c, a = 1) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
export function hsl(h, s, l, a = 1) { return `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`; }
export function hexToVec(hex) { const c = hexToRgb(hex); return [c[0] / 255, c[1] / 255, c[2] / 255]; }
export function scaleRgb(c, k) { return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)]; }

// Gradient lookup across several stops (rgb arrays)
export function gradient(stops, t) {
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return mixRgb(stops[i], stops[i + 1], t - i);
}

// ---- drawing
export function fade(ctx, w, h, keep) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.02, 1 - keep)})`;
  ctx.fillRect(0, 0, w, h);
}
export function clear(ctx, w, h) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
}

// Stroke the same path several times, wide and faint to thin and bright: a cheap glow.
export function glowStroke(ctx, build, color, width, glow) {
  const passes = glow > 0 ? [[width * (4 + glow * 6), 0.06 * glow], [width * 2.2, 0.22], [width, 1]] : [[width, 1]];
  for (const [lw, a] of passes) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = rgba(color, a);
    ctx.beginPath(); build(ctx); ctx.stroke();
  }
}

export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(v, a = 0, b = 1) { return v < a ? a : v > b ? b : v; }
export const TAU = Math.PI * 2;

// ---- additive light buffer: splat points into a float buffer, then tone-map to a color ramp.
// Used by the particle modules so thousands of faint points build up into glowing bodies.
const KERNELS = [];
function makeKernel(r) {
  const R = Math.min(5, Math.ceil(r)), side = 2 * R + 1, w = new Float32Array(side * side);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const d2 = (dx * dx + dy * dy) / (r * r); if (d2 < 1) w[(dy + R) * side + dx + R] = 1 - d2; }
  for (let i = 0; i < w.length; i++) w[i] /= r * r * 3.1;   // same energy as the original per-pixel formula
  return { R, w };
}
const TONE_RES = 64, TONE = new Uint8Array(10 * TONE_RES);
for (let i = 0; i < TONE.length; i++) TONE[i] = Math.min(255, ((1 - Math.exp(-i / TONE_RES)) * 255) | 0);
export class Accum {
  constructor() {
    this.off = document.createElement('canvas');
    this.octx = this.off.getContext('2d');
    this.w = 0; this.h = 0; this.buf = null; this.img = null; this.lutKey = '';
    this.lut = new Uint8ClampedArray(256 * 3);
  }
  ensure(W, H, scale) {
    const w = Math.max(16, Math.ceil(W / scale)), h = Math.max(16, Math.ceil(H / scale));
    if (w !== this.w || h !== this.h) {
      this.w = w; this.h = h; this.off.width = w; this.off.height = h;
      this.buf = new Float32Array(w * h);
      this.img = this.octx.createImageData(w, h);
    }
    return this;
  }
  decay(k) { const b = this.buf; if (k <= 0) b.fill(0); else for (let i = 0; i < b.length; i++) b[i] *= k; }
  // bilinear splat
  splat(x, y, v) {
    if (x < 0 || y < 0 || x >= this.w - 1 || y >= this.h - 1) return;
    const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, i = yi * this.w + xi, b = this.buf;
    b[i] += v * (1 - fx) * (1 - fy); b[i + 1] += v * fx * (1 - fy);
    b[i + this.w] += v * (1 - fx) * fy; b[i + this.w + 1] += v * fx * fy;
  }
  // soft disc of radius r (in buffer pixels), total energy v. Kernels are cached per quarter pixel of radius.
  splatSoft(x, y, v, r) {
    if (r < 0.75) return this.splat(x, y, v);
    const q = Math.min(20, Math.round(r * 4));
    let K = KERNELS[q];
    if (!K) K = KERNELS[q] = makeKernel(q / 4);
    const R = K.R, w = this.w, b = this.buf, kw = K.w;
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < R || yi < R || xi >= w - R || yi >= this.h - R) return;
    const side = 2 * R + 1;
    let o = (yi - R) * w + xi - R, k = 0;
    for (let dy = 0; dy < side; dy++, o += w) for (let dx = 0; dx < side; dx++, k++) { const c = kw[k]; if (c) b[o + dx] += v * c; }
  }
  ramp(stops) {
    const key = stops.join('|');
    if (key === this.lutKey) return;
    this.lutKey = key;
    const cols = stops.map(hexToRgb);
    for (let i = 0; i < 256; i++) { const c = gradient(cols, i / 255); this.lut[i * 3] = c[0]; this.lut[i * 3 + 1] = c[1]; this.lut[i * 3 + 2] = c[2]; }
  }
  // tone-map and draw scaled onto ctx (1 - e^-x through a lookup table: no exp per pixel)
  blit(ctx, W, H, exposure, bloom = 0) {
    const b = this.buf, d = this.img.data, L = this.lut, T = TONE, k = exposure * TONE_RES, top = T.length - 1;
    for (let i = 0, j = 0; i < b.length; i++, j += 4) {
      let x = (b[i] * k) | 0; if (x > top) x = top; else if (x < 0) x = 0;
      const t = T[x] * 3;
      d[j] = L[t]; d[j + 1] = L[t + 1]; d[j + 2] = L[t + 2]; d[j + 3] = 255;
    }
    this.octx.putImageData(this.img, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.off, 0, 0, W, H);
    if (bloom > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, bloom * 0.6);
      ctx.filter = `blur(${Math.round(Math.min(W, H) * 0.012 * (1 + bloom))}px)`;
      ctx.drawImage(this.off, 0, 0, W, H);
      ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }
}
