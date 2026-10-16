import { noise3, hexToRgb, TAU } from './util.js';

export default {
  id: 'grain',
  name: 'Grain',
  tagline: 'Dynamic grain structures and flow.',
  params: [
    { key: 'count', label: 'Grains', type: 'range', min: 5000, max: 120000, step: 1000, default: 50000 },
    { key: 'size', label: 'Grain size', type: 'range', min: 1, max: 6, step: 1, default: 2 },
    { key: 'flow', label: 'Flow speed', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'turb', label: 'Turbulence', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'scale', label: 'Pattern scale', type: 'range', min: 0.3, max: 3, step: 0.05, default: 1 },
    { key: 'persist', label: 'Surface memory', type: 'range', min: 0.5, max: 0.99, step: 0.01, default: 0.9 },
    { key: 'shake', label: 'Bass shake', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'scatter', label: 'Scatter on hits', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'colorA', label: 'Shadow color', type: 'color', default: '#3a2a1f' },
    { key: 'colorB', label: 'Highlight color', type: 'color', default: '#ffd9a8' },
    { key: 'contrast', label: 'Contrast', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    let bw = 0, bh = 0, acc = null, img = null, GX = null, GY = null;
    let X, Y, VX, VY, n = 0, z = 0;
    function setup(W, H, size, count) {
      bw = Math.max(32, Math.floor(W / size)); bh = Math.max(32, Math.floor(H / size));
      off.width = bw; off.height = bh;
      acc = new Float32Array(bw * bh);
      img = octx.createImageData(bw, bh);
      n = count;
      X = new Float32Array(n); Y = new Float32Array(n); VX = new Float32Array(n); VY = new Float32Array(n);
      for (let i = 0; i < n; i++) { X[i] = Math.random() * bw; Y[i] = Math.random() * bh; }
    }
    let key = '';
    return {
      render(F, { dt, W, H, S, params: p }) {
        const size = Math.max(1, Math.round(p.size * S * 0.75));
        const k = [W, H, size, p.count].join('|');
        if (k !== key) { key = k; setup(W, H, size, Math.round(p.count)); }
        z += dt * 0.08 * p.flow * (0.5 + F.mid * 1.5);
        const decay = Math.pow(p.persist, dt * 60);
        for (let i = 0; i < acc.length; i++) acc[i] *= decay;
        const sc = 0.012 / p.scale * (size / 2);
        const turb = p.turb * (0.5 + F.high * 2);
        const sp = p.flow * 0.6 * (dt * 60);
        const shake = F.bass * p.shake * 1.4;
        const kick = F.kick > 0.5 ? F.kick * p.scatter * 2.2 : 0;
        const dep = Math.min(4, dt * 60); // same brightness at any frame rate
        const cx = bw / 2, cy = bh / 2;
        const wph = F.time * 9;
        // flow directions on a coarse grid, looked up per grain (much cheaper than noise per grain)
        const G = 6, gw = Math.ceil(bw / G) + 1, gh = Math.ceil(bh / G) + 1;
        if (!GX || GX.length !== gw * gh) { GX = new Float32Array(gw * gh); GY = new Float32Array(gw * gh); }
        for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
          const x = gx * G, y = gy * G;
          const a = noise3(x * sc, y * sc, z) * TAU * turb + noise3(x * sc * 0.3, y * sc * 0.3, z * 0.5) * 2.0;
          GX[gy * gw + gx] = Math.cos(a) * sp * 0.25; GY[gy * gw + gx] = Math.sin(a) * sp * 0.25;
        }
        for (let i = 0; i < n; i++) {
          let x = X[i], y = Y[i];
          const gi = ((y / G) | 0) * gw + ((x / G) | 0);
          VX[i] = VX[i] * 0.86 + GX[gi];
          VY[i] = VY[i] * 0.86 + GY[gi] + Math.sin(x * 0.05 + wph) * shake * 0.25;
          if (kick) { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) + 2; VX[i] += dx / d * kick * (0.5 + Math.random()); VY[i] += dy / d * kick * (0.5 + Math.random()); }
          x += VX[i]; y += VY[i];
          if (x < 0) x += bw; else if (x >= bw) x -= bw;
          if (y < 0) y += bh; else if (y >= bh) y -= bh;
          X[i] = x; Y[i] = y;
          acc[(y | 0) * bw + (x | 0)] += (0.05 + Math.min(1.5, Math.abs(VX[i]) + Math.abs(VY[i])) * 0.2) * dep;
        }
        const A = hexToRgb(p.colorA), B = hexToRgb(p.colorB), d = img.data;
        // normalise by how many grains land on an average cell so density changes keep the look
        const ct = p.contrast * (0.45 + F.level * 0.5 + F.hat * 0.3) * (acc.length / n) * 0.3;
        for (let i = 0, j = 0; i < acc.length; i++, j += 4) {
          const v = 1 - Math.exp(-acc[i] * ct);
          const g = v * v;
          d[j] = A[0] * v + (B[0] - A[0]) * g;
          d[j + 1] = A[1] * v + (B[1] - A[1]) * g;
          d[j + 2] = A[2] * v + (B[2] - A[2]) * g;
          d[j + 3] = 255;
        }
        octx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(off, 0, 0, bw, bh, 0, 0, W, H);
      },
      resize() { key = ''; },
      dispose() {}
    };
  }
};
