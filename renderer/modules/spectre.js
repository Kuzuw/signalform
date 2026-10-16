import { hexToRgb, mixRgb, rgba, fade, clear, scaleRgb, gradient } from './util.js';

// teal → red → amber → green → violet → lavender, like light through a prism
const SPECTRUM = ['#1c5a52', '#c8213a', '#e33b4a', '#b98a2a', '#8fd12a', '#20d23a', '#1a5a3a', '#2a1a3a', '#8a2ab4', '#5a2a6a', '#c9b2dc'].map(hexToRgb);
const LINE_TEX = Array.from({ length: 97 }, (_, i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); });

export default {
  id: 'spectre',
  name: 'Spectre',
  tagline: 'Harmonic frequencies visualized as light.',
  params: [
    { key: 'mode', label: 'Structure', type: 'select', default: 'lines', options: [['lines', 'Spectral lines'], ['bands', 'Luminous bands'], ['layers', 'Spectral layers'], ['flow', 'Flowing spectrogram'], ['ring', 'Radial spectrum']] },
    { key: 'coloring', label: 'Coloring', type: 'select', default: 'spectrum', options: [['spectrum', 'Light spectrum'], ['band', 'Per band'], ['mono', 'Monochrome']] },
    { key: 'bands', label: 'Bands', type: 'range', min: 8, max: 64, step: 1, default: 48 },
    { key: 'fromHz', label: 'Lowest frequency', type: 'range', min: 30, max: 2000, step: 10, default: 30, section: 'Frequencies' },
    { key: 'toHz', label: 'Highest frequency', type: 'range', min: 400, max: 16000, step: 100, default: 16000 },
    { key: 'equalize', label: 'Equalize bands', type: 'toggle', default: true, showIf: { mode: 'lines' } },
    { key: 'curve', label: 'Response curve', type: 'range', min: 0.5, max: 3, step: 0.05, default: 1.4 },
    { key: 'tilt', label: 'Treble boost', type: 'range', min: 0, max: 2, step: 0.05, default: 0.4 },
    { key: 'layers', label: 'Layers', type: 'range', min: 1, max: 24, step: 1, default: 10, showIf: { mode: ['layers', 'flow'] } },
    { key: 'height', label: 'Height', type: 'range', min: 0.2, max: 1.5, step: 0.05, default: 0.8, section: 'Shape' },
    { key: 'gap', label: 'Bar gap', type: 'range', min: 0, max: 0.9, step: 0.01, default: 0.36, showIf: { mode: ['bands', 'ring'] } },
    { key: 'round', label: 'Rounded bars', type: 'toggle', default: true, showIf: { mode: 'bands' } },
    { key: 'caps', label: 'Peak caps', type: 'toggle', default: true, showIf: { mode: ['bands', 'ring'] } },
    { key: 'mirror', label: 'Mirror', type: 'toggle', default: true },
    { key: 'smooth', label: 'Fall smoothing', type: 'range', min: 0, max: 0.98, step: 0.01, default: 0.82 },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'persist', label: 'Persistence', type: 'range', min: 0, max: 0.95, step: 0.01, default: 0.4 },
    { key: 'colorLow', label: 'Low frequencies', type: 'color', default: '#ff4d2e', section: 'Color' },
    { key: 'colorMid', label: 'Mid frequencies', type: 'color', default: '#ffd166' },
    { key: 'colorHigh', label: 'High frequencies', type: 'color', default: '#5ad1ff' },
    { key: 'colorMono', label: 'Monochrome color', type: 'color', default: '#e8eefc', showIf: { coloring: 'mono' } }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let vals = new Float32Array(64), caps = new Float32Array(64), hist = [], runMax = new Float32Array(0);
    return {
      render(F, { dt, W, H, S, params: p }) {
        const nb = Math.round(p.bands);
        if (vals.length !== nb) { vals = new Float32Array(nb); caps = new Float32Array(nb); }
        const k = Math.pow(p.smooth, dt * 60);
        for (let i = 0; i < nb; i++) {
          // map this bar onto the chosen frequency range (the analyser's 64 bands span 30 Hz..16 kHz, log spaced)
          const lo = Math.max(30, Math.min(p.fromHz, p.toHz - 100)), hi = Math.max(lo + 100, p.toHz);
          const toIdx = (f) => Math.log(f / 30) / Math.log(16000 / 30) * F.bands.length;
          const fa = lo * Math.pow(hi / lo, i / nb), fb = lo * Math.pow(hi / lo, (i + 1) / nb);
          const a = Math.max(0, Math.floor(toIdx(fa))), b = Math.min(F.bands.length, Math.max(a + 1, Math.ceil(toIdx(fb))));
          let v = 0; for (let j = a; j < b; j++) v = Math.max(v, F.bands[j]);
          v = Math.min(1.3, Math.pow(v, p.curve) * (1 + p.tilt * (i / nb)) * (1 + F.drop * 0.4));
          vals[i] = Math.max(v, vals[i] * k);
          caps[i] = Math.max(vals[i], caps[i] - dt * 0.35);
        }
        const lo = hexToRgb(p.colorLow), mi = hexToRgb(p.colorMid), hi = hexToRgb(p.colorHigh), mono = hexToRgb(p.colorMono);
        const colorAt = (t) => p.coloring === 'mono' ? mono : p.coloring === 'spectrum' ? gradient(SPECTRUM, t) : t < 0.5 ? mixRgb(lo, mi, t * 2) : mixRgb(mi, hi, (t - 0.5) * 2);
        if (p.persist > 0 && p.mode !== 'lines') fade(ctx, W, H, p.persist); else clear(ctx, W, H);
        ctx.globalCompositeOperation = 'lighter';
        const g = p.glow, HH = H * 0.45 * p.height;
        const cy = p.mirror ? H / 2 : H * 0.92;

        if (p.mode === 'lines') {
          // the spectrum as emission lines: full-height stripes whose light follows their band
          const cols = Math.max(nb * 3, Math.round(W / (2.5 * S)));
          let vmax = 0.35; for (let i = 0; i < nb; i++) vmax = Math.max(vmax, vals[i] * (0.8 + (i / nb) * 0.9));
          // equalize: every band is measured against its own recent peak, so quiet regions still light up
          if (runMax.length !== nb) runMax = new Float32Array(nb).fill(0.2);
          const kd = Math.exp(-dt / 2.5);
          for (let i = 0; i < nb; i++) runMax[i] = Math.max(vals[i], runMax[i] * kd, 0.06);
          const cw = W / cols;
          for (let pass = 0; pass < (g > 0 ? 2 : 1); pass++) {
            for (let c = 0; c < cols; c++) {
              const t = c / (cols - 1), b = t * (nb - 1), i0 = Math.floor(b), fr = b - i0;
              const v = vals[i0] * (1 - fr) + vals[Math.min(nb - 1, i0 + 1)] * fr;
              const tex = 0.55 + 0.45 * LINE_TEX[c % LINE_TEX.length];
              const col = colorAt(t);
              const rm = runMax[i0] * (1 - fr) + runMax[Math.min(nb - 1, i0 + 1)] * fr;
              const vv = p.equalize ? (0.12 + 0.88 * Math.pow(Math.min(1, v / rm), 2.2)) * Math.min(1, rm * 7) : Math.pow(Math.min(1, v * (0.8 + t * 0.9) / vmax), 1.8);
              if (pass === 0) { ctx.fillStyle = rgba(col, Math.min(1, (0.03 + vv * 1.15) * tex)); ctx.fillRect(c * cw, 0, cw + 0.6, H); }
              else if (c % 3 === 0) { ctx.fillStyle = rgba(col, Math.min(0.3, v * 0.12 * g)); ctx.fillRect(c * cw - cw * 3, 0, cw * 7, H); }
            }
          }
          // a little darker towards the top and bottom edges
          ctx.globalCompositeOperation = 'source-over';
          const vg = ctx.createLinearGradient(0, 0, 0, H);
          vg.addColorStop(0, 'rgba(0,0,0,0.35)'); vg.addColorStop(0.18, 'rgba(0,0,0,0)'); vg.addColorStop(0.82, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)');
          ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
        } else if (p.mode === 'bands') {
          const bw = W / nb, bwid = Math.max(1, bw * (1 - p.gap));
          for (let i = 0; i < nb; i++) {
            const h = vals[i] * HH * (p.mirror ? 1 : 1.9);
            const c = colorAt(i / (nb - 1));
            const x = i * bw + (bw - bwid) / 2;
            const top = cy - h, hh = p.mirror ? h * 2 : h;
            const grd = ctx.createLinearGradient(0, top, 0, top + hh);
            grd.addColorStop(0, rgba(c, 0.15)); grd.addColorStop(p.mirror ? 0.5 : 1, rgba(c, 0.95)); if (p.mirror) grd.addColorStop(1, rgba(c, 0.15));
            ctx.fillStyle = grd;
            ctx.beginPath();
            if (p.round && ctx.roundRect) ctx.roundRect(x, top, bwid, Math.max(1, hh), Math.min(bwid / 2, 8 * S)); else ctx.rect(x, top, bwid, Math.max(1, hh));
            ctx.fill();
            if (g > 0) { ctx.fillStyle = rgba(c, 0.05 * g); ctx.fillRect(x - bwid, top - h * 0.1, bwid * 3, hh * 1.2); }
            if (p.caps) {
              const ch = caps[i] * HH * (p.mirror ? 1 : 1.9);
              ctx.fillStyle = rgba(scaleRgb(c, 1.3), 0.95);
              ctx.fillRect(x, cy - ch - 3 * S, bwid, 2 * S);
              if (p.mirror) ctx.fillRect(x, cy + ch + S, bwid, 2 * S);
            }
          }
        } else if (p.mode === 'ring') {
          const cx = W / 2, cyy = H / 2, R0 = Math.min(W, H) * 0.18 * (1 + F.kick * 0.15), R1 = Math.min(W, H) * 0.3 * p.height;
          const N = p.mirror ? nb * 2 : nb;
          for (let i = 0; i < N; i++) {
            const bi = p.mirror ? (i < nb ? i : 2 * nb - 1 - i) : i;
            const a = (i / N) * Math.PI * 2 - Math.PI / 2, v = vals[bi];
            const c = colorAt(bi / (nb - 1));
            ctx.strokeStyle = rgba(c, 0.85); ctx.lineWidth = Math.max(1, (Math.PI * 2 * R0) / N * (1 - p.gap));
            ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R0, cyy + Math.sin(a) * R0); ctx.lineTo(cx + Math.cos(a) * (R0 + v * R1), cyy + Math.sin(a) * (R0 + v * R1)); ctx.stroke();
            if (g > 0) { ctx.strokeStyle = rgba(c, 0.07 * g); ctx.lineWidth *= 4; ctx.stroke(); }
          }
        } else {
          // layers: delayed copies of the spectral contour, nearest is brightest
          hist.unshift(Float32Array.from(vals));
          const L = Math.round(p.layers);
          const step = p.mode === 'flow' ? 2 : 3;
          if (hist.length > L * step + 1) hist.length = L * step + 1;
          for (let l = Math.min(L, Math.floor(hist.length / step)) - 1; l >= 0; l--) {
            const v = hist[l * step];
            const fadeL = 1 - l / L;
            const yOff = p.mode === 'flow' ? -l * (H * 0.5 / L) : 0;
            const sx = p.mode === 'flow' ? l * W * 0.012 : 0;
            const drawSide = (sgn) => {
              ctx.beginPath();
              for (let i = 0; i < nb; i++) {
                const x = sx + (i / (nb - 1)) * (W - sx * 2);
                const y = cy + yOff * (p.mirror ? 1 : 1) - sgn * v[i] * HH * (p.mirror ? 1 : 1.8) * (0.6 + 0.4 * fadeL);
                if (i === 0) ctx.moveTo(x, y);
                else { const px = sx + ((i - 0.5) / (nb - 1)) * (W - sx * 2); ctx.quadraticCurveTo(px, y, x, y); }
              }
            };
            const grad = ctx.createLinearGradient(0, 0, W, 0);
            for (let s = 0; s <= 4; s++) grad.addColorStop(s / 4, rgba(scaleRgb(colorAt(s / 4), 0.5 + fadeL * 0.7), 0.15 + fadeL * 0.75));
            ctx.strokeStyle = grad;
            for (const sgn of p.mirror && p.mode !== 'flow' ? [1, -1] : [1]) {
              drawSide(sgn);
              ctx.lineWidth = S * (l === 0 ? 2 : 1); ctx.stroke();
              if (g > 0 && l < 3) { ctx.lineWidth = S * 8 * g; ctx.globalAlpha = 0.08; ctx.stroke(); ctx.globalAlpha = 1; }
            }
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      },
      resize() {},
      dispose() {}
    };
  }
};
