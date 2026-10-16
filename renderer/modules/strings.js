import { hexToRgb, mixRgb, rgba, clear, fade, TAU, clamp } from './util.js';

// Strings that are plucked by the hits and bowed by the level of their own band.
// Each string is a sum of standing waves, drawn over a short shutter so fast vibration blurs
// into the glowing envelope you see on a real instrument.
const MAXM = 8, SEG = 72;
const SIN = new Float32Array((MAXM + 1) * (SEG + 1)), POW = new Float32Array(MAXM + 1);
for (let m = 1; m <= MAXM; m++) { POW[m] = Math.pow(m, 0.85); for (let q = 0; q <= SEG; q++) SIN[m * (SEG + 1) + q] = Math.sin(m * Math.PI * q / SEG); }

export default {
  id: 'strings',
  name: 'Strings',
  tagline: 'Plucked by the hits, bowed by the mix.',
  params: [
    { key: 'layout', label: 'Layout', type: 'select', default: 'horizontal', options: [['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['harp', 'Harp'], ['star', 'Across a circle']] },
    { key: 'count', label: 'Strings', type: 'range', min: 3, max: 40, step: 1, default: 14 },
    { key: 'spread', label: 'Spread', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.78 },
    { key: 'pluck', label: 'Pluck on hits', type: 'range', min: 0, max: 2, step: 0.05, default: 1, section: 'Vibration' },
    { key: 'bow', label: 'Bowed by the level', type: 'range', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'amp', label: 'Amplitude', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1.4 },
    { key: 'sustain', label: 'Sustain', type: 'range', min: 0.1, max: 5, step: 0.05, default: 1.4, unit: 's' },
    { key: 'harmonics', label: 'Harmonics', type: 'range', min: 1, max: MAXM, step: 1, default: 5 },
    { key: 'tension', label: 'Vibration speed', type: 'range', min: 0.1, max: 3, step: 0.05, default: 1 },
    { key: 'blur', label: 'Shutter blur', type: 'range', min: 1, max: 12, step: 1, default: 6 },
    { key: 'width', label: 'Line width', type: 'range', min: 0.3, max: 4, step: 0.05, default: 1.2, section: 'Light' },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'trails', label: 'Afterglow', type: 'range', min: 0, max: 0.95, step: 0.01, default: 0.35 },
    { key: 'pegs', label: 'Show the ends', type: 'toggle', default: true },
    { key: 'coloring', label: 'Coloring', type: 'select', default: 'pitch', section: 'Color', options: [['pitch', 'Low to high'], ['energy', 'By energy'], ['mono', 'Single color']] },
    { key: 'colorLow', label: 'Low strings', type: 'color', default: '#ff9a3d' },
    { key: 'colorHigh', label: 'High strings', type: 'color', default: '#7ad7ff' }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let N = 0, re = null, im = null, energy = null, clock = 0;
    function ensure(n) {
      if (n === N) return;
      N = n; re = new Float32Array(n * MAXM); im = new Float32Array(n * MAXM); energy = new Float32Array(n);
    }
    const pluck = (i, s) => {
      const x0 = 0.18 + Math.random() * 0.64;
      for (let m = 1; m <= MAXM; m++) re[i * MAXM + m - 1] += s * Math.sin(m * Math.PI * x0) / Math.pow(m, 1.3);
    };
    function geom(i, n, p, W, H) {
      const t = n === 1 ? 0.5 : i / (n - 1), sp = p.spread;
      if (p.layout === 'vertical') { const x = W * (0.5 + (t - 0.5) * sp); return [x, H * 0.08, x, H * 0.92]; }
      if (p.layout === 'harp') {
        const xb = W * (0.5 + (t - 0.5) * sp * 1.05), xt = W * (0.5 + (t - 0.5) * sp * 0.45);
        const yt = H * (0.1 + 0.32 * (1 - t) * (1 - t)), yb = H * 0.92;
        return [xt, yt, xb, yb];
      }
      if (p.layout === 'star') {
        const a = (i / n) * Math.PI, R = Math.min(W, H) * 0.46 * (0.4 + sp * 0.6);
        return [W / 2 - Math.cos(a) * R, H / 2 - Math.sin(a) * R, W / 2 + Math.cos(a) * R, H / 2 + Math.sin(a) * R];
      }
      const y = H * (0.5 + (t - 0.5) * sp);
      return [W * 0.06, y, W * 0.94, y];
    }
    return {
      render(F, { dt, W, H, S, params: p }) {
        dt = Math.max(0, dt);
        const n = Math.round(p.count);
        ensure(n);
        clock += dt;
        const M = Math.round(p.harmonics);
        const nb = F.bands.length;
        // hits pluck the strings of their register; a drop strums them all
        for (const o of F.onsets) {
          const lo = o.band === 'kick' ? 0 : o.band === 'snare' ? 0.3 : 0.62, hi = o.band === 'kick' ? 0.38 : o.band === 'snare' ? 0.72 : 1;
          const a = Math.floor(lo * (n - 1) + 0.5), b = Math.max(a, Math.floor(hi * (n - 1) + 0.5));
          const k = 1 + Math.floor(Math.random() * 2);
          for (let c = 0; c < k; c++) pluck(a + Math.floor(Math.random() * (b - a + 1)), o.strength * p.pluck * (o.band === 'hat' ? 0.45 : 1));
        }
        if (F.drop > 0.95) for (let i = 0; i < n; i++) pluck(i, p.pluck * 0.9);
        const tens = p.tension * (1 + F.build * 0.9);
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0.5 : i / (n - 1);
          const band = F.bands[Math.min(nb - 1, Math.floor(t * (nb - 1) * 0.9))];
          let e = 0;
          for (let m = 1; m <= MAXM; m++) {
            const j = i * MAXM + m - 1;
            if (m > M) { re[j] = im[j] = 0; continue; }
            const w = TAU * (1.2 + t * 4.5) * tens * Math.pow(m, 0.85);
            const decay = Math.exp(-dt / (p.sustain / Math.sqrt(m)));
            const c = Math.cos(w * dt), s = Math.sin(w * dt);
            const r0 = re[j], i0 = im[j];
            re[j] = (r0 * c - i0 * s) * decay; im[j] = (r0 * s + i0 * c) * decay;
            // bowing keeps the fundamental and low partials alive in proportion to the band level
            const mag = Math.hypot(re[j], im[j]), target = band * band * p.bow * 0.5 / m;
            if (mag < target) { const g = mag > 1e-4 ? target / mag : 0; if (g) { re[j] *= g; im[j] *= g; } else re[j] = target; }
            e += Math.hypot(re[j], im[j]);
          }
          energy[i] = e;
        }

        if (p.trails > 0) fade(ctx, W, H, p.trails); else clear(ctx, W, H);
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const low = hexToRgb(p.colorLow), high = hexToRgb(p.colorHigh);
        const K = Math.round(p.blur), shutter = 0.035;
        const pts = new Float32Array((SEG + 1) * 2), coef = new Float32Array(MAXM + 1);
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0.5 : i / (n - 1);
          const [x0, y0, x1, y1] = geom(i, n, p, W, H);
          const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L, nx = -uy, ny = ux;
          const gap = p.layout === 'star' ? Math.min(W, H) * 0.1 : (p.layout === 'vertical' ? W : H) * p.spread / Math.max(1, n - 1);
          const unit = Math.max(gap, Math.min(W, H) * 0.04) * 0.9 * p.amp;
          const e = clamp(energy[i] * 1.5);
          const col = p.coloring === 'mono' ? low : p.coloring === 'energy' ? mixRgb(low, high, e) : mixRgb(low, high, t);
          const tens2 = tens * (1.2 + t * 4.5);
          for (let k = 0; k < K; k++) {
            const back = (k / Math.max(1, K - 1)) * shutter;
            // each partial's displacement at this instant (the shape along the string comes from the table)
            for (let m = 1; m <= M; m++) {
              const j = i * MAXM + m - 1, w = TAU * tens2 * POW[m] * back;
              coef[m] = re[j] * Math.cos(w) + im[j] * Math.sin(w);
            }
            for (let q = 0; q <= SEG; q++) {
              const x = q / SEG;
              let d = 0;
              for (let m = 1; m <= M; m++) d += coef[m] * SIN[m * (SEG + 1) + q];
              pts[q * 2] = x0 + ux * L * x + nx * d * unit;
              pts[q * 2 + 1] = y0 + uy * L * x + ny * d * unit;
            }
            const a = (0.25 + e * 0.75) / Math.sqrt(K);
            const path = new Path2D();
            path.moveTo(pts[0], pts[1]);
            for (let q = 1; q <= SEG; q++) path.lineTo(pts[q * 2], pts[q * 2 + 1]);
            if (p.glow > 0 && k === 0) {
              ctx.strokeStyle = rgba(col, 0.08 * p.glow * (0.4 + e));
              ctx.lineWidth = p.width * S * (5 + p.glow * 5);
              ctx.stroke(path);
            }
            ctx.strokeStyle = rgba(col, a);
            ctx.lineWidth = p.width * S;
            ctx.stroke(path);
          }
          // a faint resting line keeps quiet strings visible
          ctx.strokeStyle = rgba(col, 0.12);
          ctx.lineWidth = Math.max(0.5, p.width * S * 0.5);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          if (p.pegs) {
            ctx.fillStyle = rgba(mixRgb(col, [255, 255, 255], 0.4), 0.7);
            const r = Math.max(1.2, p.width * S * 1.6);
            ctx.beginPath(); ctx.arc(x0, y0, r, 0, TAU); ctx.moveTo(x1 + r, y1); ctx.arc(x1, y1, r, 0, TAU); ctx.fill();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      },
      resize() {},
      dispose() {}
    };
  }
};
