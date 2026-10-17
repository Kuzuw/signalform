import { hexToRgb, mixRgb, rgba, fade, glowStroke, TAU } from './util.js';

const RATIOS = [[1, 1], [1, 2], [2, 3], [3, 4], [3, 5], [4, 5], [5, 6], [5, 8], [2, 5], [3, 7]];

export default {
  id: 'lissajous',
  name: 'Lissajous',
  tagline: 'Flowing harmonic line structures.',
  params: [
    { key: 'mode', label: 'Curve source', type: 'select', default: 'harmonic', options: [['harmonic', 'Harmonic (follows pitch)'], ['stereo', 'Stereo X/Y signal'], ['both', 'Both layered']] },
    { key: 'ratio', label: 'Frequency ratio', type: 'select', default: 'auto', options: [['auto', 'Auto from sound'], ...RATIOS.map((r) => [r.join(':'), r.join(' : ')])] },
    { key: 'complexity', label: 'Knot complexity', type: 'range', min: 0, max: 1.5, step: 0.01, default: 0.35 },
    { key: 'layers', label: 'Layers', type: 'range', min: 1, max: 40, step: 1, default: 22 },
    { key: 'spread', label: 'Layer phase spread', type: 'range', min: 0, max: 1, step: 0.01, default: 0.05 },
    { key: 'phaseSpeed', label: 'Phase drift', type: 'range', min: 0, max: 3, step: 0.05, default: 0.6 },
    { key: 'size', label: 'Size', type: 'range', min: 0.2, max: 1.2, step: 0.01, default: 0.62 },
    { key: 'tilt', label: '3D tilt', type: 'range', min: 0, max: 1.5, step: 0.01, default: 0.9 },
    { key: 'tumble', label: 'Tumble speed', type: 'range', min: 0, max: 2, step: 0.01, default: 0.5 },
    { key: 'wobble', label: 'Signal interference', type: 'range', min: 0, max: 2, step: 0.05, default: 0.7 },
    { key: 'width', label: 'Line width', type: 'range', min: 0.3, max: 5, step: 0.05, default: 0.35 },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 2, step: 0.05, default: 0.25 },
    { key: 'trail', label: 'Persistence', type: 'range', min: 0, max: 0.97, step: 0.01, default: 0.55 },
    { key: 'colorA', label: 'Color A', type: 'color', default: '#ffffff' },
    { key: 'colorB', label: 'Color B', type: 'color', default: '#b8b8c0' }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let tumbleA = 0, phase = 0, ra = 1, rb = 2, ratioIdx = 1, hold = 0;
    return {
      render(F, { dt, W, H, S, params: p }) {
        fade(ctx, W, H, p.trail);
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineJoin = 'round';
        const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.45 * p.size;
        const A = hexToRgb(p.colorA), B = hexToRgb(p.colorB);
        phase += dt * p.phaseSpeed * (0.4 + F.mid * 1.6);
        tumbleA += dt * p.tumble * (0.3 + F.mid);
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
        const N = 900, wob = p.wobble, cx3 = p.complexity * (0.8 + F.mid * 0.6);
        if (p.mode !== 'stereo') {
          // every layer's curve is built once; layers share a few colour groups, each stroked twice (glow + core)
          const L = Math.round(p.layers), G = Math.min(4, L), groups = Array.from({ length: G }, () => new Path2D());
          const ty = tumbleA, tx = p.tilt, cty = Math.cos(ty), sty = Math.sin(ty), ctx2 = Math.cos(tx), stx = Math.sin(tx);
          const wave = F.wave, w22 = wob * 0.22, du = TAU / N;
          for (let l = 0; l < L; l++) {
            const lt = L > 1 ? l / (L - 1) : 0;
            const ph = phase + lt * p.spread * TAU;
            const rr = R * (1 - lt * 0.05) * (0.85 + F.bass * 0.25);
            const path = groups[Math.min(G - 1, Math.floor(lt * G))];
            for (let i = 0; i <= N; i++) {
              const u = i * du;
              const w = wave[(i * 2) % 2048] * w22;
              // a third harmonic gives depth; tilt and tumble rotate the figure in 3D
              let X = Math.sin(ra * u + ph) * (1 + w), Y = Math.sin(rb * u) * (1 - w), Z = Math.sin((ra + rb) * 0.5 * u + ph * 0.7);
              if (cx3) { X = (X + cx3 * Math.sin(2 * u + ph * 1.3)) / (1 + cx3); Y = (Y + cx3 * Math.cos(u * 1.5 - ph)) / (1 + cx3); Z = (Z + cx3 * Math.sin(2 * u + ph * 0.5)) / (1 + cx3); }
              const X1 = X * cty + Z * sty, Z1 = -X * sty + Z * cty;
              const Y1 = Y * ctx2 - Z1 * stx, Z2 = Y * stx + Z1 * ctx2;
              const pr = 3 / (3 + Z2 * tx);
              const x = cx + X1 * rr * pr, y = cy + Y1 * rr * pr;
              if (i) path.lineTo(x, y); else path.moveTo(x, y);
            }
          }
          const a = (0.32 + F.level * 0.3) / Math.sqrt(Math.max(1, L / 4)) * Math.sqrt(L / G);
          for (let g = 0; g < G; g++) {
            const col = scaleA(mixRgb(A, B, G > 1 ? g / (G - 1) : 0), Math.min(1, a));
            if (p.glow > 0) { ctx.strokeStyle = rgba(col, 0.06 * p.glow); ctx.lineWidth = p.width * S * (4 + p.glow * 6); ctx.stroke(groups[g]); }
            ctx.strokeStyle = rgba(col, Math.min(1, a)); ctx.lineWidth = p.width * S; ctx.stroke(groups[g]);
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
