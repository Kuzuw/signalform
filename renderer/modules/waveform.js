import { hexToRgb, rgba, gradient, clear, TAU } from './util.js';

const PALETTES = {
  ember: ['#2b0f3a', '#a3204a', '#ff6b35', '#ffd29d'],
  glacier: ['#06283d', '#1363df', '#47b5ff', '#dff6ff'],
  acid: ['#10221b', '#2e8b57', '#c6f432', '#fffbd6'],
  dusk: ['#1d1a39', '#7b337d', '#f45b69', '#ffd9a0'],
  mono: ['#0e0f12', '#4a4f5c', '#a6adbb', '#f2f4f8']
};

export default {
  id: 'waveform',
  name: 'Waveform',
  tagline: 'Layered waveform shapes from audio.',
  params: [
    { key: 'mode', label: 'Arrangement', type: 'select', default: 'envelope', options: [['envelope', 'Scrolling mass'], ['radial', 'Radial rings'], ['stacked', 'Stacked contours'], ['mirror', 'Mirrored layers']] },
    { key: 'body', label: 'Body thickness', type: 'range', min: 0, max: 0.4, step: 0.01, default: 0.12, showIf: { mode: 'envelope' } },
    { key: 'spiky', label: 'Spikiness', type: 'range', min: 0, max: 2, step: 0.05, default: 1, showIf: { mode: 'envelope' } },
    { key: 'layers', label: 'Layers', type: 'range', min: 3, max: 60, step: 1, default: 24 },
    { key: 'spacing', label: 'Layer spacing', type: 'range', min: 0.2, max: 2, step: 0.05, default: 1 },
    { key: 'amp', label: 'Amplitude', type: 'range', min: 0.1, max: 3, step: 0.05, default: 1 },
    { key: 'detail', label: 'Detail', type: 'range', min: 32, max: 400, step: 1, default: 160 },
    { key: 'fill', label: 'Filled shapes', type: 'toggle', default: true },
    { key: 'colorMode', label: 'Color', type: 'select', default: 'single', options: [['multi', 'Multi-color palette'], ['single', 'Single color']] },
    { key: 'palette', label: 'Palette', type: 'select', default: 'ember', showIf: { colorMode: 'multi' }, options: Object.keys(PALETTES).map((k) => [k, k[0].toUpperCase() + k.slice(1)]) },
    { key: 'color', label: 'Single color', type: 'color', default: '#ffffff', showIf: { colorMode: 'single' } },
    { key: 'width', label: 'Line width', type: 'range', min: 0.5, max: 4, step: 0.1, default: 1.2 },
    { key: 'speed', label: 'Flow speed', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'turn', label: 'Ring rotation', type: 'range', min: -2, max: 2, step: 0.05, default: 0.25, showIf: { mode: 'radial' } },
    { key: 'twist', label: 'Layer twist', type: 'range', min: -1, max: 1, step: 0.01, default: 0, showIf: { mode: 'radial' } },
    { key: 'beatWidth', label: 'Thicken on kicks', type: 'range', min: 0, max: 3, step: 0.05, default: 0.8 }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let hist = [], acc = 0;
    function snapshot(F, M) {
      // downsampled envelope of the waveform, blended with the spectrum for body
      const out = new Float32Array(M);
      const step = Math.floor(2048 / M);
      for (let i = 0; i < M; i++) {
        let m = 0; for (let j = 0; j < step; j++) m += F.wave[i * step + j];
        out[i] = (m / step) * 2.4 + F.bands[Math.floor((i / M) * 48)] * 0.25 * (i % 2 ? 1 : -1);
      }
      return out;
    }
    // ---- the envelope of the music scrolling past: each column is the peak of a short slice
    let envT = [], envB = [], envAcc = 0, sm = 0;
    function envelope(F, dt, W, H, S, p) {
      const cols = Math.round(p.detail);
      envAcc += dt * p.speed * 70;
      const amp = p.amp;
      let guard = 0;
      while (envAcc >= 1 && guard++ < 12) {
        envAcc -= 1;
        // peaks of a random slice of the buffer keep the edge jagged like a real recording
        const w = F.wave, len = 256, o = Math.floor(Math.random() * (w.length - len));
        let hi = 0, lo = 0;
        for (let i = o; i < o + len; i++) { if (w[i] > hi) hi = w[i]; if (w[i] < lo) lo = w[i]; }
        sm += (F.level - sm) * 0.2;
        const spike = p.spiky * (Math.random() < 0.35 ? Math.random() * 0.6 : 0) * (0.4 + F.hat + F.snare);
        envT.unshift(Math.min(0.48, p.body * (0.6 + sm) + hi * 0.2 * amp + spike * 0.16 + F.kick * 0.03));
        envB.unshift(Math.min(0.48, p.body * (0.6 + sm) - lo * 0.2 * amp + spike * 0.12 + F.kick * 0.03));
      }
      if (envT.length > cols) { envT.length = cols; envB.length = cols; }
      clear(ctx, W, H);
      const n = envT.length;
      if (n < 2) return;
      const cy = H / 2, c = p.colorMode === 'single' ? hexToRgb(p.color) : gradient((PALETTES[p.palette] || PALETTES.ember).map(hexToRgb), 0.9);
      const x = (i) => W - (i / (cols - 1)) * W;     // newest on the right, scrolling left
      ctx.beginPath();
      for (let i = 0; i < n; i++) ctx.lineTo(x(i), cy - envT[i] * H);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(x(i), cy + envB[i] * H);
      ctx.closePath();
      ctx.fillStyle = rgba(c, 1);
      if (p.fill) ctx.fill();
      ctx.strokeStyle = rgba(c, 0.6);
      ctx.lineWidth = p.width * S * (1 + F.kick * p.beatWidth);
      ctx.lineJoin = 'miter';
      ctx.stroke();
    }
    return {
      render(F, { dt, W, H, S, params: p }) {
        if (p.mode === 'envelope') return envelope(F, Math.max(0, dt), W, H, S, p);
        const M = Math.round(p.detail), L = Math.round(p.layers);
        acc += dt * p.speed * 30;
        while (acc >= 1) { acc -= 1; hist.unshift(snapshot(F, M)); }
        if (hist.length > L) hist.length = L;
        if (!hist.length || hist[0].length !== M) { hist = [snapshot(F, M)]; }
        clear(ctx, W, H);
        const stops = (PALETTES[p.palette] || PALETTES.ember).map(hexToRgb);
        const single = hexToRgb(p.color);
        const colAt = (t, k) => p.colorMode === 'single' ? single.map((c) => c * (0.25 + 0.75 * k)) : gradient(stops, t);
        const amp = p.amp * (0.8 + F.bass * 0.6 + F.drop * 0.5);
        ctx.lineJoin = 'round';
        const cx = W / 2, cy = H / 2;
        // back to front so near layers occlude far ones
        for (let l = hist.length - 1; l >= 0; l--) {
          const v = hist[l];
          const t = 1 - l / Math.max(1, L - 1);
          const c = colAt(0.2 + 0.8 * t, 0.35 + 0.65 * t);
          ctx.beginPath();
          if (p.mode === 'radial') {
            const R = Math.min(W, H) * (0.08 + (l / L) * 0.42 * p.spacing);
            const a0 = F.time * 0.2 * p.turn + l * p.twist * 0.15;
            for (let i = 0; i <= M; i++) {
              const j = i % M, a = a0 + (i / M) * TAU;
              const r = R + v[j] * Math.min(W, H) * 0.06 * amp * (0.5 + t);
              const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
              i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.closePath();
          } else if (p.mode === 'stacked') {
            const gap = (H * 0.7 * p.spacing) / L;
            const base = H * 0.15 + (L - l) * gap;
            const env = (i) => Math.sin((i / (M - 1)) * Math.PI) ** 1.5;
            ctx.moveTo(0, base);
            for (let i = 0; i < M; i++) ctx.lineTo((i / (M - 1)) * W, base - Math.abs(v[i]) * env(i) * H * 0.25 * amp);
            ctx.lineTo(W, base); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
          } else {
            const span = (l / L) * 0.9 * p.spacing + 0.1;
            for (let i = 0; i < M; i++) ctx.lineTo((i / (M - 1)) * W, cy - (Math.abs(v[i]) * amp * 0.35 + span * 0.25) * H * (0.4 + t * 0.6));
            for (let i = M - 1; i >= 0; i--) ctx.lineTo((i / (M - 1)) * W, cy + (Math.abs(v[i]) * amp * 0.35 + span * 0.25) * H * (0.4 + t * 0.6));
            ctx.closePath();
          }
          if (p.fill) { ctx.fillStyle = rgba(c.map((x) => x * (p.mode === 'radial' ? 0.12 + 0.4 * t : 0.06 + 0.1 * t)), 1); ctx.fill(); }
          ctx.strokeStyle = rgba(c, 0.55 + 0.45 * t);
          ctx.lineWidth = p.width * S * (l === 0 ? 1.5 : 1) * (1 + F.kick * p.beatWidth);
          ctx.stroke();
        }
      },
      resize() {},
      dispose() {}
    };
  }
};
