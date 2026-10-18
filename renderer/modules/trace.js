import { noise3, hexToRgb, mixRgb, rgba, fade, TAU } from './util.js';

export default {
  id: 'trace',
  name: 'Trace',
  tagline: 'A living line driven by sound.',
  params: [
    { key: 'form', label: 'Form', type: 'select', default: 'signal', options: [['signal', 'Live signal'], ['line', 'Open line'], ['loop', 'Closed loop'], ['spiral', 'Spiral']] },
    { key: 'gain', label: 'Signal gain', type: 'range', min: 0.5, max: 8, step: 0.05, default: 2.6, showIf: { form: 'signal' } },
    { key: 'window', label: 'Time window', type: 'range', min: 0.1, max: 1, step: 0.01, default: 1, showIf: { form: 'signal' } },
    { key: 'clip', label: 'Clip at the edges', type: 'toggle', default: true, showIf: { form: 'signal' } },
    { key: 'auto', label: 'Automatic gain', type: 'toggle', default: true, showIf: { form: 'signal' } },
    { key: 'grid', label: 'Measurement grid', type: 'toggle', default: true, showIf: { form: 'signal' } },
    { key: 'area', label: 'Fill under the line', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, showIf: { form: 'signal' } },
    { key: 'lines', label: 'Lines', type: 'range', min: 1, max: 12, step: 1, default: 1 },
    { key: 'spread', label: 'Line spacing', type: 'range', min: 0, max: 1, step: 0.01, default: 0.25, showIf: { lines: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] } },
    { key: 'lag', label: 'Line delay', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3, showIf: { lines: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] } },
    { key: 'points', label: 'Control points', section: 'Motion', type: 'range', min: 8, max: 96, step: 1, default: 40 },
    { key: 'tension', label: 'Tension', type: 'range', min: 0.2, max: 4, step: 0.05, default: 1.2 },
    { key: 'damping', label: 'Damping', type: 'range', min: 0.5, max: 0.99, step: 0.01, default: 0.86 },
    { key: 'amp', label: 'Deformation', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'drift', label: 'Shape drift', type: 'range', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'ripple', label: 'Ripple on hits', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'width', label: 'Thickness', section: 'Light', type: 'range', min: 0.5, max: 8, step: 0.1, default: 2.2 },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'trail', label: 'Afterimage', type: 'range', min: 0, max: 0.97, step: 0.01, default: 0.7 },
    { key: 'colorA', label: 'Color A', type: 'color', default: '#f4f1ff' },
    { key: 'colorB', label: 'Color B', type: 'color', default: '#ff5c8a' }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let n = 0, D = null, V = null, waves = [], tm = 0;
    // the raw signal at high gain, like a pen recorder pushed into the rails
    let agc = 0.3;
    function signal(F, W, H, S, p) {
      // earlier sweeps linger as an afterimage; everything drawn below is scaled so its steady brightness stays the same
      const k = Math.min(0.8, p.trail * 0.55), keep = 1 - k;
      fade(ctx, W, H, k);
      const w = F.wave, n = Math.max(32, Math.floor(w.length * p.window));
      const step = Math.max(1, Math.floor(n / Math.min(n, W / (0.9 * S))));
      // automatic gain: follow the recent peak so quiet passages still fill the frame
      let pk = 0; for (let i = 0; i < n; i += 4) pk = Math.max(pk, Math.abs(w[i]));
      agc = Math.max(pk, agc * 0.985, 0.02);
      const gain = p.gain * (1 + F.drop * 0.5) * (p.auto ? 0.35 / agc : 1);
      const half = H * 0.5, lim = p.clip ? 1 : 1.6;
      const path = new Path2D();
      let first = true;
      for (let i = 0; i < n; i += step) {
        const v = Math.max(-lim, Math.min(lim, w[i] * gain));
        const x = i / (n - 1) * W, y = half - v * half * 0.985;
        if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y);
      }
      const c = hexToRgb(p.colorA), cb = hexToRgb(p.colorB);
      ctx.globalCompositeOperation = 'lighter';
      if (p.grid !== false) {
        // a faint measurement grid: the centre line, quarter lines and ticks
        ctx.fillStyle = rgba(c, 0.13 * keep); ctx.fillRect(0, half - 0.5 * S, W, S);
        ctx.fillStyle = rgba(c, 0.05 * keep);
        for (const f of [0.25, 0.75]) ctx.fillRect(0, H * f - 0.5 * S, W, S);
        for (let i = 1; i < 16; i++) ctx.fillRect(i * W / 16 - 0.5 * S, half - 5 * S, S, 10 * S);
      }
      if (p.area > 0) {
        // a soft body between the line and the centre
        const fill = new Path2D(path); fill.lineTo(W, half); fill.lineTo(0, half); fill.closePath();
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, rgba(cb, 0.16 * p.area * keep)); g.addColorStop(0.5, rgba(cb, 0)); g.addColorStop(1, rgba(cb, 0.16 * p.area * keep));
        ctx.fillStyle = g; ctx.fill(fill);
      }
      ctx.lineJoin = 'round';
      const lw = p.width * S * (1 + F.kick * 0.35);
      if (p.glow > 0) {
        ctx.strokeStyle = rgba(cb, 0.07 * p.glow * keep * 2); ctx.lineWidth = lw * 6; ctx.stroke(path);
        ctx.strokeStyle = rgba(c, 0.16 * p.glow * keep * 2); ctx.lineWidth = lw * 2.2; ctx.stroke(path);
      }
      ctx.strokeStyle = rgba(c, Math.min(1, 0.95 * keep * 2.2)); ctx.lineWidth = Math.max(0.8, lw * 0.55); ctx.stroke(path);
      ctx.globalCompositeOperation = 'source-over';
    }
    return {
      render(F, { dt, W, H, S, params: p }) {
        if (p.form === 'signal') return signal(F, W, H, S, p);
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
        const A = hexToRgb(p.colorA), B = hexToRgb(p.colorB);
        const L = Math.max(1, Math.round(p.lines));
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let k = 0; k < L; k++) {
          const off = L > 1 ? (k / (L - 1) - 0.5) : 0;      // -0.5 .. 0.5
          const lag = Math.round(k * p.lag * n * 0.25);      // later lines echo the first one
          const pts = [];
          for (let i = 0; i < n; i++) {
            const u = i / (n - 1), d = D[Math.max(0, i - lag)] * (1 - Math.abs(off) * 0.5);
            if (p.form === 'loop') {
              const a = u * TAU, rr = R * (1 + d * 0.9) * (1 + off * p.spread * 1.4);
              pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
            } else if (p.form === 'spiral') {
              const a = u * TAU * 2.5 + tm * 0.3 + off * p.spread * 3, rr = R * (0.15 + u * 0.95) * (1 + d * 0.6);
              pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
            } else {
              pts.push([W * 0.06 + u * W * 0.88, cy + off * p.spread * H * 1.6 + d * H * 0.55]);
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
          const t = L > 1 ? k / (L - 1) : Math.min(1, F.level * 1.2 + F.drop * 0.5);
          const col = mixRgb(A, B, t), fadeK = L > 1 ? 1 - Math.abs(off) * 0.8 : 1;
          const w = p.width * S * (1 + F.kick * 0.6) * (L > 1 ? 0.6 + 0.4 * fadeK : 1);
          if (p.glow > 0) {
            ctx.strokeStyle = rgba(B, 0.06 * p.glow * fadeK); ctx.lineWidth = w * 9; ctx.stroke(path);
            ctx.strokeStyle = rgba(B, 0.16 * p.glow * fadeK); ctx.lineWidth = w * 3.5; ctx.stroke(path);
          }
          ctx.strokeStyle = rgba(col, fadeK); ctx.lineWidth = w; ctx.stroke(path);
        }
        ctx.globalCompositeOperation = 'source-over';
      },
      resize() {},
      dispose() {}
    };
  }
};
