import { noise3, hexToRgb, rgba, TAU } from './util.js';

export default {
  id: 'grain',
  name: 'Grain',
  tagline: 'Dynamic grain structures and flow.',
  params: [
    { key: 'look', label: 'Look', type: 'select', default: 'dust', options: [['dust', 'Drifting dust bands'], ['sand', 'Grain texture']] },
    { key: 'bands', label: 'Bands', type: 'range', min: 1, max: 9, step: 1, default: 5, showIf: { look: 'dust' } },
    { key: 'specks', label: 'Specks', type: 'range', min: 1000, max: 30000, step: 500, default: 12000, showIf: { look: 'dust' } },
    { key: 'depth', label: 'Depth of field', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6, showIf: { look: 'dust' } },
    { key: 'wave', label: 'Waviness', type: 'range', min: 0, max: 2, step: 0.05, default: 1, showIf: { look: 'dust' } },
    { key: 'spreadY', label: 'Band thickness', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1, showIf: { look: 'dust' } },
    { key: 'dustColor', label: 'Dust color', type: 'color', default: '#ffffff', showIf: { look: 'dust' } },
    { key: 'count', label: 'Grains', type: 'range', min: 5000, max: 120000, step: 1000, default: 50000, showIf: { look: 'sand' } },
    { key: 'size', label: 'Grain size', type: 'range', min: 1, max: 6, step: 1, default: 2 },
    { key: 'flow', label: 'Flow speed', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'turb', label: 'Turbulence', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'scale', label: 'Pattern scale', type: 'range', min: 0.3, max: 3, step: 0.05, default: 1 },
    { key: 'persist', label: 'Surface memory', type: 'range', min: 0.5, max: 0.99, step: 0.01, default: 0.9 },
    { key: 'drift', label: 'Drift', type: 'select', default: 'none', options: [['none', 'Wander'], ['rise', 'Rise'], ['fall', 'Fall like sand'], ['wind', 'Wind'], ['swirl', 'Swirl']] },
    { key: 'shake', label: 'Bass shake', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'scatter', label: 'Scatter on hits', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'colorA', label: 'Shadow color', type: 'color', default: '#3a2a1f', showIf: { look: 'sand' } },
    { key: 'colorB', label: 'Highlight color', type: 'color', default: '#ffd9a8', showIf: { look: 'sand' } },
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
    // ---- dust: specks strung along slow wavy bands, thick in places and thinning out in others
    let DN = 0, DX, DO, DB, DL, DD, dz = 0, kickE = 0;
    function dust(F, dt, W, H, S, p) {
      const n = Math.round(p.specks);
      if (n !== DN) {
        DN = n; DX = new Float32Array(n); DO = new Float32Array(n); DB = new Uint8Array(n); DL = new Float32Array(n); DD = new Uint8Array(n);
        for (let i = 0; i < n; i++) { DX[i] = Math.random(); DO[i] = (Math.random() + Math.random() + Math.random() - 1.5); DB[i] = (Math.random() * 9) | 0; DL[i] = Math.random(); const q = Math.random(); DD[i] = q < 0.6 ? 0 : q < 0.988 ? 1 : 2; }
      }
      dt = Math.max(0, dt);
      dz += dt * 0.12 * p.flow * (0.6 + F.mid * 1.2 + F.drop * 2);
      kickE = Math.max(kickE * Math.exp(-dt / 0.2), F.kick * p.scatter);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const K = Math.round(p.bands), sc = 1 / p.scale;
      const amp = H * 0.06 * p.wave * (1 + F.bass * p.shake * 1.2);
      const r = Math.max(1, p.size * S * 0.55);
      const c = hexToRgb(p.dustColor);
      const paths = [new Path2D(), new Path2D(), new Path2D()], far = new Path2D(), near = new Path2D(), bloom = new Path2D();
      const vx = dt * 0.02 * p.flow * (1 + F.mid), dof = p.depth ?? 0.6;
      const rFar = Math.max(0.7, r * 0.65), rNear = r * (2 + 4 * dof);
      for (let i = 0; i < n; i++) {
        const b = DB[i] % K, dd = DD[i];
        // nearer specks drift faster (parallax)
        let x = DX[i] + vx * (0.6 + (b % 3) * 0.25) * (0.6 + dd * 0.6);
        if (x > 1.05) x -= 1.1;
        DX[i] = x;
        const xs = x * 2.2 * sc;
        // where along its band a speck sits decides whether that stretch is dense, sparse or empty
        const dens = noise3(xs * 1.3, b * 3.7, dz * 0.7);
        if (dens < -0.15 + DL[i] * 0.5) continue;
        const base = H * (0.15 + 0.72 * (b + 0.5) / K) + noise3(b * 1.1, 0.5, dz * 0.3) * H * 0.08;
        const yc = base + Math.sin(xs * 3 + dz * 2 + b * 1.7) * amp + noise3(xs * 2, b * 2.3, dz) * amp * 1.4;
        const thick = H * 0.018 * p.spreadY * (0.6 + 1.4 * (0.5 + 0.5 * noise3(xs * 2.5, b * 5.1, dz * 0.5))) * (1 + F.level * 0.6 + kickE * 2.5);
        const y = yc + DO[i] * thick;
        const lum = DL[i] * (0.6 + 0.4 * dens) + F.hat * 0.3 * (DL[i] > 0.85 ? 1 : 0);
        const px = x * W, py = y + (dd - 1) * thick * 0.6;
        if (dd === 0 && dof > 0) far.rect(px, py, rFar, rFar);
        else if (dd === 2 && dof > 0) { near.moveTo(px + rNear, py); near.arc(px, py, rNear, 0, TAU); }
        else {
          paths[lum > 0.66 ? 2 : lum > 0.33 ? 1 : 0].rect(px, py, r, r);
          if (lum > 0.8) { bloom.moveTo(px + r * 2.2, py + r / 2); bloom.arc(px + r / 2, py + r / 2, r * 2.2, 0, TAU); }
        }
      }
      const al = [0.35, 0.65, 1], ct = Math.min(1, p.contrast);
      ctx.fillStyle = rgba(c, 0.32 * ct); ctx.fill(far);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(c, 0.07 * ct); ctx.fill(bloom);
      ctx.globalCompositeOperation = 'source-over';
      for (let k = 0; k < 3; k++) { ctx.fillStyle = rgba(c, al[k] * ct); ctx.fill(paths[k]); }
      // out-of-focus specks in front: large, faint discs
      ctx.globalCompositeOperation = 'lighter';
      // bokeh: a faint disc with a slightly brighter rim
      ctx.fillStyle = rgba(c, (0.025 + 0.04 * (1 - dof)) * ct * (1 + F.level * 0.5)); ctx.fill(near);
      ctx.strokeStyle = rgba(c, 0.05 * ct); ctx.lineWidth = Math.max(0.6, S * 0.6); ctx.stroke(near);
      ctx.globalCompositeOperation = 'source-over';
    }
    return {
      render(F, { dt, W, H, S, params: p }) {
        if (p.look === 'dust') return dust(F, dt, W, H, S, p);
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
        const dep = Math.min(4, dt * 60);
        const dr = ['none', 'rise', 'fall', 'wind', 'swirl'].indexOf(p.drift); // same brightness at any frame rate
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
          if (dr === 1) VY[i] -= 0.08 * sp; else if (dr === 2) VY[i] += 0.1 * sp; else if (dr === 3) VX[i] += 0.1 * sp;
          else if (dr === 4) { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) + 1; VX[i] += -dy / d * 0.12 * sp; VY[i] += dx / d * 0.12 * sp; }
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
