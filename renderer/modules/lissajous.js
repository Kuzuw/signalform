import { hexToRgb, mixRgb, rgba, fade, glowStroke, TAU } from './util.js';

const RATIOS = [[1, 1], [1, 2], [2, 3], [3, 4], [3, 5], [4, 5], [5, 6], [5, 8], [2, 5], [3, 7]];

export default {
  id: 'lissajous',
  name: 'Lissajous',
  tagline: 'Flowing harmonic line structures.',
  params: [
    { key: 'mode', label: 'Curve source', type: 'select', default: 'harmonic', options: [['harmonic', 'Harmonic (follows pitch)'], ['stereo', 'Stereo X/Y signal'], ['both', 'Both layered']] },
    { key: 'ratio', label: 'Frequency ratio', type: 'select', default: 'auto', options: [['auto', 'Auto from sound'], ...RATIOS.map((r) => [r.join(':'), r.join(' : ')])] },
    { key: 'layers', label: 'Layers', type: 'range', min: 1, max: 12, step: 1, default: 5 },
    { key: 'spread', label: 'Layer phase spread', type: 'range', min: 0, max: 1, step: 0.01, default: 0.18 },
    { key: 'phaseSpeed', label: 'Phase drift', type: 'range', min: 0, max: 3, step: 0.05, default: 0.6 },
    { key: 'size', label: 'Size', type: 'range', min: 0.2, max: 1.2, step: 0.01, default: 0.8 },
    { key: 'wobble', label: 'Signal interference', type: 'range', min: 0, max: 2, step: 0.05, default: 0.7 },
    { key: 'width', label: 'Line width', type: 'range', min: 0.5, max: 5, step: 0.1, default: 1.4 },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'trail', label: 'Persistence', type: 'range', min: 0, max: 0.97, step: 0.01, default: 0.75 },
    { key: 'colorA', label: 'Color A', type: 'color', default: '#7fe3d6' },
    { key: 'colorB', label: 'Color B', type: 'color', default: '#ff6fae' }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let phase = 0, ra = 1, rb = 2, ratioIdx = 1, hold = 0;
    return {
      render(F, { dt, W, H, S, params: p }) {
        fade(ctx, W, H, p.trail);
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineJoin = 'round';
        const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.45 * p.size;
        const A = hexToRgb(p.colorA), B = hexToRgb(p.colorB);
        phase += dt * p.phaseSpeed * (0.4 + F.mid * 1.6);
        // pick a ratio: manual, or follow the dominant pitch class and jump on strong hits
        let ta, tb;
        if (p.ratio !== 'auto') [ta, tb] = p.ratio.split(':').map(Number);
        else {
          hold -= dt;
          if (F.pitch > 0 && hold <= 0 && (F.hit > 0.75 || F.drop > 0.9)) {
            const pc = Math.round(12 * Math.log2(F.pitch / 55)) % 12;
            ratioIdx = (pc + (F.drop > 0.9 ? 3 : 0)) % RATIOS.length; hold = 1.2;
          }
          [ta, tb] = RATIOS[ratioIdx];
        }
        ra += (ta - ra) * (1 - Math.exp(-dt * 2.5));
        rb += (tb - rb) * (1 - Math.exp(-dt * 2.5));
        const N = 700, wob = p.wobble;
        if (p.mode !== 'stereo') {
          for (let l = 0; l < p.layers; l++) {
            const lt = p.layers > 1 ? l / (p.layers - 1) : 0;
            const ph = phase + lt * p.spread * TAU;
            const rr = R * (1 - lt * 0.12) * (0.85 + F.bass * 0.25);
            const col = mixRgb(A, B, lt);
            glowStroke(ctx, (c) => {
              for (let i = 0; i <= N; i++) {
                const u = i / N * TAU;
                const w = F.wave[(i * 2) % 2048] * wob * 0.22;
                const x = cx + Math.sin(ra * u + ph) * rr * (1 + w);
                const y = cy + Math.sin(rb * u) * rr * (1 - w);
                if (i) c.lineTo(x, y); else c.moveTo(x, y);
              }
            }, scaleA(col, (0.4 + F.level * 0.4) / Math.sqrt(Math.max(1, p.layers / 3))), p.width * S, p.glow);
          }
        }
        if (p.mode !== 'harmonic') {
          let peak = 0.05; for (let i = 0; i < 2048; i += 4) peak = Math.max(peak, Math.abs(F.waveL[i]), Math.abs(F.waveR[i]));
          const g = R / Math.min(1, peak * 1.3);
          glowStroke(ctx, (c) => {
            for (let i = 0; i < 2048; i += 2) {
              const l = F.waveL[i], r = F.waveR[i];
              const x = cx + (l - r) * 0.7071 * g, y = cy - (l + r) * 0.7071 * g;
              if (i) c.lineTo(x, y); else c.moveTo(x, y);
            }
          }, mixRgb(A, B, 0.5), p.width * S, p.glow);
        }
        ctx.globalCompositeOperation = 'source-over';
      },
      resize() {},
      dispose() {}
    };
  }
};
function scaleA(c, k) { return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)]; }
