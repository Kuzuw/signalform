import { hexToRgb, mixRgb, rgba, clear, fade, TAU, clamp } from './util.js';

// Rings of light thrown out by the hits, like ripples on water. Each ring keeps the shape of the
// spectrum (or waveform) at the instant it was born, so a busy passage leaves a trail of different rings.
const SNAP = 64;

export default {
  id: 'halo',
  name: 'Halo',
  tagline: 'Every hit throws a ring of light.',
  params: [
    { key: 'emit', label: 'Rings come from', type: 'select', default: 'hits', options: [['hits', 'Every hit'], ['kicks', 'Kicks only'], ['beat', 'A steady pulse'], ['flow', 'A continuous stream']] },
    { key: 'rate', label: 'Rings per second', type: 'range', min: 0.5, max: 16, step: 0.5, default: 4, showIf: { emit: ['beat', 'flow'] } },
    { key: 'echoes', label: 'Rings per hit', type: 'range', min: 1, max: 4, step: 1, default: 1, showIf: { emit: ['hits', 'kicks'] } },
    { key: 'shape', label: 'Shape', type: 'select', default: 'circle', section: 'Shape', options: [['circle', 'Circle'], ['polygon', 'Polygon'], ['star', 'Star'], ['flower', 'Flower']] },
    { key: 'sides', label: 'Points', type: 'range', min: 3, max: 12, step: 1, default: 6, showIf: { shape: ['polygon', 'star', 'flower'] } },
    { key: 'rim', label: 'Rim follows', type: 'select', default: 'spectrum', options: [['spectrum', 'The spectrum'], ['wave', 'The waveform'], ['none', 'Nothing']] },
    { key: 'deform', label: 'Rim depth', type: 'range', min: 0, max: 2, step: 0.05, default: 0.7, showIf: { rim: ['spectrum', 'wave'] } },
    { key: 'twist', label: 'Twist per ring', type: 'range', min: -45, max: 45, step: 1, default: 6, unit: '°' },
    { key: 'speed', label: 'Expansion speed', type: 'range', min: 0.1, max: 3, step: 0.05, default: 1, section: 'Motion' },
    { key: 'life', label: 'Ring life', type: 'range', min: 0.3, max: 5, step: 0.05, default: 1.8, unit: 's' },
    { key: 'reach', label: 'Reach', type: 'range', min: 0.3, max: 1.6, step: 0.01, default: 0.95 },
    { key: 'core', label: 'Pulsing core', type: 'range', min: 0, max: 0.4, step: 0.01, default: 0.1 },
    { key: 'width', label: 'Line width', type: 'range', min: 0.3, max: 6, step: 0.05, default: 1.4, section: 'Light' },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'trails', label: 'Afterglow', type: 'range', min: 0, max: 0.95, step: 0.01, default: 0.25 },
    { key: 'coloring', label: 'Coloring', type: 'select', default: 'hit', section: 'Color', options: [['hit', 'By hit (kick, snare, hat)'], ['age', 'By age'], ['mono', 'Single color']] },
    { key: 'colorA', label: 'Kick / young', type: 'color', default: '#ff6a3d' },
    { key: 'colorB', label: 'Snare / old', type: 'color', default: '#ffd36b' },
    { key: 'colorC', label: 'Hi-hat', type: 'color', default: '#7ad7ff', showIf: { coloring: 'hit' } }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    const rings = [];
    let acc = 0, rot = 0, beatT = 0, coreV = 0;
    function spawn(F, p, kind, strength, delay = 0) {
      const snap = new Float32Array(SNAP);
      if (p.rim === 'wave') { const w = F.wave, n = w.length; for (let i = 0; i < SNAP; i++) snap[i] = w[Math.floor(i / SNAP * n * 0.5)]; }
      else if (p.rim === 'spectrum') {
        const b = F.bands, n = b.length;
        for (let i = 0; i < SNAP; i++) { const f = Math.abs(i / SNAP * 2 - 1); snap[i] = Math.pow(b[Math.min(n - 1, Math.floor((1 - f) * n * 0.85))], 1.3); }
      }
      rot += p.twist * Math.PI / 180;
      rings.push({ age: -delay, kind, s: clamp(strength, 0.15, 1.3), snap, rot });
      beatT = 0;
      if (rings.length > 90) rings.shift();
    }
    function radiusAt(p, a, ring) {
      const k = Math.round(p.sides);
      let r = 1;
      if (p.shape === 'polygon') { const seg = TAU / k, x = ((a % seg) + seg) % seg - seg / 2; r = Math.cos(seg / 2) / Math.cos(x); }
      else if (p.shape === 'star') { const x = ((a / TAU * k) % 1 + 1) % 1; r = 0.62 + 0.38 * Math.abs(x * 2 - 1); }
      else if (p.shape === 'flower') r = 1 + 0.16 * Math.cos(k * a);
      if (p.rim !== 'none') {
        const u = (((a - ring.rot) / TAU) % 1 + 1) % 1, i = u * SNAP, i0 = Math.floor(i) % SNAP, fr = i - Math.floor(i);
        const v = ring.snap[i0] * (1 - fr) + ring.snap[(i0 + 1) % SNAP] * fr;
        r += (p.rim === 'wave' ? v * 0.35 : v * 0.3) * p.deform;
      }
      return r;
    }
    return {
      render(F, { dt, W, H, S, params: p }) {
        dt = Math.max(0, dt);
        // emit
        if (p.emit === 'hits' || p.emit === 'kicks') {
          for (const o of F.onsets) {
            if (p.emit === 'kicks' && o.band !== 'kick') continue;
            const n = Math.round(p.echoes);
            for (let e = 0; e < n; e++) spawn(F, p, o.band, o.strength * (o.band === 'hat' ? 0.55 : 1) * (1 - e * 0.18), e * 0.09);
          }
          if (F.drop > 0.95) for (let e = 0; e < 3; e++) spawn(F, p, 'kick', 1.3, e * 0.06);
        } else {
          const rate = p.rate * (p.emit === 'beat' ? 1 : 1 + F.level * 1.5);
          acc += dt * rate;
          while (acc >= 1) { acc -= 1; spawn(F, p, F.kick > 0.4 ? 'kick' : F.snare > 0.4 ? 'snare' : 'hat', p.emit === 'beat' ? 0.5 + F.level * 0.8 : 0.25 + F.level); }
        }
        // quiet or beatless passages still breathe: a soft ring whenever nothing has fired for a while
        beatT += dt;
        if (beatT > 1.1) spawn(F, p, 'kick', 0.3 + F.level * 0.6);

        if (p.trails > 0) fade(ctx, W, H, p.trails); else clear(ctx, W, H);
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineJoin = 'round';
        const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.5 * p.reach;
        const A = hexToRgb(p.colorA), B = hexToRgb(p.colorB), C = hexToRgb(p.colorC);
        const STEPS = 160;
        for (let i = rings.length - 1; i >= 0; i--) {
          const g = rings[i];
          g.age += dt;
          if (g.age < 0) continue;
          const life = g.age / p.life;
          if (life >= 1) { rings.splice(i, 1); continue; }
          // ripples race out and slow down
          const rr = R * (p.core * 0.8 + (1 - p.core * 0.8) * (1 - Math.exp(-g.age * p.speed * 2.2))) * (0.75 + g.s * 0.25);
          const alpha = g.s * Math.pow(1 - life, 1.6);
          const col = p.coloring === 'mono' ? A : p.coloring === 'age' ? mixRgb(A, B, life) : g.kind === 'kick' ? A : g.kind === 'snare' ? B : C;
          const path = new Path2D();
          for (let q = 0; q <= STEPS; q++) {
            const a = q / STEPS * TAU;
            const r = rr * radiusAt(p, a, g);
            const x = cx + Math.cos(a + g.rot) * r, y = cy + Math.sin(a + g.rot) * r;
            q ? path.lineTo(x, y) : path.moveTo(x, y);
          }
          path.closePath();
          const w = p.width * S * (1 + (1 - life) * g.s);
          if (p.glow > 0) {
            ctx.strokeStyle = rgba(col, alpha * 0.1 * p.glow);
            ctx.lineWidth = w * (4 + p.glow * 5);
            ctx.stroke(path);
            ctx.strokeStyle = rgba(col, alpha * 0.25);
            ctx.lineWidth = w * 2.4;
            ctx.stroke(path);
          }
          ctx.strokeStyle = rgba(mixRgb(col, [255, 255, 255], 0.25 * (1 - life)), alpha);
          ctx.lineWidth = w;
          ctx.stroke(path);
        }
        // the core breathes with the low end
        if (p.core > 0) {
          coreV += ((F.bass * 0.7 + F.kick * 0.5 + F.drop * 0.5) - coreV) * (1 - Math.exp(-dt / 0.06));
          const cr = Math.max(0.5, R * p.core * (0.8 + Math.max(0, coreV) * 0.7));
          const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 2.2);
          gr.addColorStop(0, rgba(mixRgb(A, [255, 255, 255], 0.55), 0.9 * (0.4 + coreV)));
          gr.addColorStop(0.4, rgba(A, 0.35 * (0.4 + coreV)));
          gr.addColorStop(1, rgba(A, 0));
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(cx, cy, cr * 2.2, 0, TAU); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      },
      resize() {},
      dispose() {}
    };
  }
};
