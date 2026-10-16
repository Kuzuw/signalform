import { noise3, hexToRgb, mixRgb, rgba, fade, TAU } from './util.js';

export default {
  id: 'trace',
  name: 'Trace',
  tagline: 'A living line driven by sound.',
  params: [
    { key: 'form', label: 'Form', type: 'select', default: 'line', options: [['line', 'Open line'], ['loop', 'Closed loop'], ['spiral', 'Spiral']] },
    { key: 'points', label: 'Control points', type: 'range', min: 8, max: 96, step: 1, default: 40 },
    { key: 'tension', label: 'Tension', type: 'range', min: 0.2, max: 4, step: 0.05, default: 1.2 },
    { key: 'damping', label: 'Damping', type: 'range', min: 0.5, max: 0.99, step: 0.01, default: 0.86 },
    { key: 'amp', label: 'Deformation', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'drift', label: 'Shape drift', type: 'range', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'ripple', label: 'Ripple on hits', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'width', label: 'Thickness', type: 'range', min: 0.5, max: 8, step: 0.1, default: 2.2 },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'trail', label: 'Afterimage', type: 'range', min: 0, max: 0.97, step: 0.01, default: 0.7 },
    { key: 'colorA', label: 'Color A', type: 'color', default: '#f4f1ff' },
    { key: 'colorB', label: 'Color B', type: 'color', default: '#ff5c8a' }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let n = 0, D = null, V = null, waves = [], tm = 0;
    return {
      render(F, { dt, W, H, S, params: p }) {
        const N = Math.round(p.points);
        if (N !== n) { n = N; D = new Float32Array(n); V = new Float32Array(n); }
        tm += dt * (0.3 + F.mid * 0.8) * p.drift;
        for (const o of F.onsets) if (o.band !== 'hat') waves.push({ pos: o.band === 'kick' ? 0.5 : Math.random(), r: 0, s: o.strength * (o.band === 'kick' ? 1 : 0.6) });
        waves = waves.filter((w) => (w.r += dt * 0.9) < 1.2);
        // spring each point toward an audio-driven target; neighbours pull on each other (tension)
        const k = p.tension * 60, damp = Math.pow(p.damping, dt * 60);
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          const band = F.bands[Math.min(F.bands.length - 1, Math.floor(u * F.bands.length * 0.8))];
          let target = (band - 0.25) * 0.5 * p.amp + noise3(u * 2.5, tm, 3) * 0.25 * p.drift;
          for (const w of waves) target += Math.exp(-Math.pow((Math.abs(u - w.pos) - w.r) / 0.05, 2)) * w.s * 0.35 * p.ripple * (1 - w.r);
          const l = D[Math.max(0, i - 1)], r = D[Math.min(n - 1, i + 1)];
          const a = (target - D[i]) * k + ((l + r) / 2 - D[i]) * k * 0.6;
          V[i] = (V[i] + a * dt) * damp;
          D[i] += V[i] * dt;
        }
        fade(ctx, W, H, p.trail);
        const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.32;
        const pts = [];
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1), d = D[i];
          if (p.form === 'loop') {
            const a = u * TAU, rr = R * (1 + d * 0.9);
            pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
          } else if (p.form === 'spiral') {
            const a = u * TAU * 2.5 + tm * 0.3, rr = R * (0.15 + u * 0.95) * (1 + d * 0.6);
            pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
          } else {
            pts.push([W * 0.06 + u * W * 0.88, cy + d * H * 0.55]);
          }
        }
        if (p.form === 'loop') pts.pop();
        const closed = p.form === 'loop';
        const path = new Path2D();
        const P = (i) => closed ? pts[(i + pts.length) % pts.length] : pts[Math.max(0, Math.min(pts.length - 1, i))];
        path.moveTo(P(0)[0], P(0)[1]);
        const last = closed ? pts.length : pts.length - 1;
        for (let i = 0; i < last; i++) {
          // Catmull-Rom to Bezier
          const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
          path.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
        }
        const A = hexToRgb(p.colorA), B = hexToRgb(p.colorB);
        const tensionCol = mixRgb(A, B, Math.min(1, F.level * 1.2 + F.drop * 0.5));
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const w = p.width * S * (1 + F.kick * 0.6);
        if (p.glow > 0) {
          ctx.strokeStyle = rgba(B, 0.06 * p.glow); ctx.lineWidth = w * 9; ctx.stroke(path);
          ctx.strokeStyle = rgba(B, 0.16 * p.glow); ctx.lineWidth = w * 3.5; ctx.stroke(path);
        }
        ctx.strokeStyle = rgba(tensionCol, 1); ctx.lineWidth = w; ctx.stroke(path);
        ctx.globalCompositeOperation = 'source-over';
      },
      resize() {},
      dispose() {}
    };
  }
};
