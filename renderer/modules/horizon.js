import { hexToRgb, mixRgb, rgba, clear, TAU, clamp } from './util.js';

// A landscape made of the music: every row of terrain is the spectrum at the moment it was born
// on the horizon, rolling towards the viewer.
export default {
  id: 'horizon',
  name: 'Horizon',
  tagline: 'A landscape grown from the spectrum.',
  params: [
    { key: 'shape', label: 'Landscape', type: 'select', default: 'valley', options: [['valley', 'Valley (lows on the sides)'], ['ridge', 'Ridge (lows in the middle)'], ['plain', 'Lows left, highs right']] },
    { key: 'lines', label: 'Drawing', type: 'select', default: 'grid', options: [['rows', 'Rows'], ['grid', 'Wire grid'], ['dots', 'Points']] },
    { key: 'solid', label: 'Hide what is behind', type: 'toggle', default: true },
    { key: 'rows', label: 'Rows', type: 'range', min: 12, max: 90, step: 1, default: 44, section: 'Terrain' },
    { key: 'cols', label: 'Detail', type: 'range', min: 16, max: 128, step: 1, default: 64 },
    { key: 'height', label: 'Mountain height', type: 'range', min: 0.1, max: 2.5, step: 0.05, default: 1 },
    { key: 'road', label: 'Flat road', type: 'range', min: 0, max: 0.6, step: 0.01, default: 0.12, showIf: { shape: 'valley' } },
    { key: 'smooth', label: 'Smoothing', type: 'range', min: 0, max: 0.95, step: 0.01, default: 0.45 },
    { key: 'speed', label: 'Travel speed', type: 'range', min: 0.1, max: 4, step: 0.05, default: 1 },
    { key: 'camera', label: 'Camera height', type: 'range', min: 0.1, max: 1.5, step: 0.01, default: 0.55, section: 'View' },
    { key: 'horizon', label: 'Horizon line', type: 'range', min: 0.15, max: 0.75, step: 0.01, default: 0.42 },
    { key: 'sky', label: 'Sky', type: 'select', default: 'sun', options: [['none', 'Nothing'], ['glow', 'Glow'], ['sun', 'Setting sun'], ['moon', 'Moon']] },
    { key: 'stars', label: 'Stars', type: 'toggle', default: true },
    { key: 'width', label: 'Line width', type: 'range', min: 0.3, max: 4, step: 0.05, default: 1.2, section: 'Color' },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 2, step: 0.05, default: 0.8 },
    { key: 'colorLow', label: 'Valleys', type: 'color', default: '#3d7bff' },
    { key: 'colorHigh', label: 'Peaks', type: 'color', default: '#ff4fc3' },
    { key: 'skyColor', label: 'Sun and glow', type: 'color', default: '#ff8a3d' }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let hist = null, nR = 0, nC = 0, head = 0, acc = 0, prev = null;
    const stars = Array.from({ length: 140 }, () => [Math.random(), Math.random(), Math.random()]);
    let flash = 0, sunPulse = 0;
    function ensure(r, c) {
      if (r === nR && c === nC && hist) return;
      nR = r; nC = c; hist = new Float32Array(r * c); prev = new Float32Array(c); head = 0;
    }
    function sample(F, p) {
      const n = F.bands.length, row = new Float32Array(nC);
      for (let j = 0; j < nC; j++) {
        const x = j / (nC - 1) * 2 - 1;                     // -1..1 across the landscape
        let f, env = 1;
        if (p.shape === 'valley') { f = 1 - Math.abs(x); env = clamp((Math.abs(x) - p.road) / 0.25); env = env * env * (3 - 2 * env); }
        else if (p.shape === 'ridge') { f = Math.abs(x); env = 1 - Math.abs(x) * 0.35; }
        else f = (x + 1) / 2;
        const b = Math.min(n - 1, Math.max(0, f * (n - 1) * 0.92));
        const i0 = Math.floor(b), fr = b - i0;
        let v = F.bands[i0] * (1 - fr) + F.bands[Math.min(n - 1, i0 + 1)] * fr;
        v = Math.pow(v, 1.35) * (1 + f * 0.6);
        row[j] = v * env;
      }
      // soften across the row, then against the previous row
      for (let pass = 0; pass < 2; pass++) for (let j = 1; j < nC - 1; j++) row[j] = (row[j - 1] + row[j] * 2 + row[j + 1]) / 4;
      for (let j = 0; j < nC; j++) { row[j] = prev[j] * p.smooth + row[j] * (1 - p.smooth); prev[j] = row[j]; }
      return row;
    }
    return {
      render(F, { dt, t, W, H, S, params: p }) {
        ensure(Math.round(p.rows), Math.round(p.cols));
        const rate = 10 * p.speed * (0.7 + F.bass * 0.8 + F.drop * 1.5);
        acc = Math.max(0, acc + Math.max(0, dt) * rate);
        let guard = 0;
        while (acc >= 1 && guard++ < 8) {
          acc -= 1;
          head = (head + 1) % nR;
          const row = sample(F, p);
          // a kick lifts the newest row a little: hits show as ridges rolling in
          const k = F.kick * 0.25;
          for (let j = 0; j < nC; j++) hist[head * nC + j] = row[j] + k * row[j];
        }
        if (acc > 1) acc = 1;
        flash = Math.max(flash * Math.exp(-dt / 0.35), F.drop);
        sunPulse += ((F.bass * 0.6 + F.kick * 0.4) - sunPulse) * (1 - Math.exp(-dt / 0.08));

        clear(ctx, W, H);
        const hy = H * p.horizon, cx = W / 2;
        const low = hexToRgb(p.colorLow), high = hexToRgb(p.colorHigh), skyC = hexToRgb(p.skyColor);

        // ---- sky
        if (p.stars) {
          ctx.fillStyle = '#fff';
          for (const [sx, sy, sb] of stars) {
            const y = sy * hy * 0.95;
            const tw = 0.35 + 0.65 * Math.abs(Math.sin(sb * 50 + t * 0.7 * (0.5 + sb))) + F.hat * sb;
            ctx.globalAlpha = clamp(tw * 0.55 * (y / hy + 0.2));
            const r = (0.5 + sb * 1.1) * S;
            ctx.fillRect(sx * W, y, r, r);
          }
          ctx.globalAlpha = 1;
        }
        if (p.sky !== 'none') {
          const g = ctx.createLinearGradient(0, hy - H * 0.45, 0, hy);
          g.addColorStop(0, rgba(skyC, 0));
          g.addColorStop(1, rgba(skyC, 0.22 + flash * 0.4 + sunPulse * 0.15));
          ctx.fillStyle = g; ctx.fillRect(0, hy - H * 0.45, W, H * 0.45);
        }
        if (p.sky === 'sun' || p.sky === 'moon') {
          const R = Math.min(W, H) * 0.2 * (1 + sunPulse * 0.08);
          const sy = hy - R * 0.25;
          ctx.save();
          ctx.beginPath(); ctx.arc(cx, sy, R, 0, TAU); ctx.clip();
          if (p.sky === 'sun') {
            const g = ctx.createLinearGradient(0, sy - R, 0, sy + R);
            g.addColorStop(0, rgba(mixRgb(skyC, [255, 240, 200], 0.6), 1));
            g.addColorStop(1, rgba(mixRgb(skyC, high, 0.45), 1));
            ctx.fillStyle = g; ctx.fillRect(cx - R, sy - R, R * 2, R * 2);
            // horizontal cut-outs that widen towards the bottom
            ctx.globalCompositeOperation = 'destination-out';
            for (let i = 0; i < 7; i++) {
              const t = i / 7, yy = sy + R * (0.05 + t * 0.95), hh = R * (0.015 + t * 0.07);
              ctx.fillRect(cx - R, yy, R * 2, hh);
            }
            ctx.globalCompositeOperation = 'source-over';
          } else {
            ctx.fillStyle = rgba(mixRgb(skyC, [235, 240, 255], 0.75), 0.95);
            ctx.fillRect(cx - R, sy - R, R * 2, R * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(cx + Math.cos(i * 2.4) * R * 0.5, sy + Math.sin(i * 1.7) * R * 0.45, R * (0.08 + (i % 3) * 0.05), 0, TAU); ctx.fill(); }
          }
          ctx.restore();
          // halo
          const hg = ctx.createRadialGradient(cx, sy, R * 0.8, cx, sy, R * 2.4);
          hg.addColorStop(0, rgba(skyC, 0.18 + sunPulse * 0.15)); hg.addColorStop(1, rgba(skyC, 0));
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = hg; ctx.fillRect(cx - R * 2.4, sy - R * 2.4, R * 4.8, R * 4.8);
          ctx.globalCompositeOperation = 'source-over';
        }
        // the sky ends at the horizon: everything below is the ground
        ctx.fillStyle = '#000'; ctx.fillRect(0, hy, W, H - hy);

        // ---- terrain, far rows first
        const camH = p.camera, near = 0.9, dz = 0.42, far = near + nR * dz;
        const fx = H * 0.95, fy = (H - hy) * near / camH * 1.3;    // the nearest rows run off the bottom edge
        const halfW = 3.2 * (W / H);
        const amp = p.height * 1.15;
        const lw = p.width * S;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        const X = new Float32Array(nC), Y = new Float32Array(nC), PX = new Float32Array(nC), PY = new Float32Array(nC);
        let hasPrev = false;
        for (let a = 0; a < nR; a++) {
          const idx = ((head - a) % nR + nR) % nR;
          const z = far - (a + acc) * dz;                     // a = age in rows: the newest row is born on the horizon
          if (z <= 0.3) continue;
          const dist = z / far;
          const fadeIn = clamp((1 - dist) * 6);               // rows appear softly at the horizon
          const fadeNear = clamp((z - near * 0.6) / (dz * 2)); // and leave softly at the bottom
          const alpha = Math.pow(clamp(1 - dist), 0.6) * fadeIn * fadeNear;
          let maxH = 0;
          for (let j = 0; j < nC; j++) {
            const x = (j / (nC - 1) * 2 - 1) * halfW;
            const hgt = hist[idx * nC + j] * amp;
            if (hgt > maxH) maxH = hgt;
            X[j] = cx + x * fx / z;
            Y[j] = hy + (camH - hgt) * fy / z;
          }
          if (p.solid && p.lines !== 'dots') {
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.moveTo(X[0], H); for (let j = 0; j < nC; j++) ctx.lineTo(X[j], Y[j]); ctx.lineTo(X[nC - 1], H); ctx.closePath(); ctx.fill();
          }
          const c = mixRgb(low, high, clamp(maxH / (amp * 0.7)));
          // vertical gradient from valley color at the base to peak color at the top of this row
          const yBase = hy + camH * fy / z, yTop = hy + (camH - Math.max(0.05, maxH)) * fy / z;
          const g = ctx.createLinearGradient(0, yBase, 0, Math.min(yTop, yBase - 1));
          g.addColorStop(0, rgba(low, alpha)); g.addColorStop(1, rgba(c, alpha));
          if (p.lines === 'dots') {
            ctx.fillStyle = g;
            const r = Math.max(0.6, lw * 1.2 * (1.2 - dist));
            for (let j = 0; j < nC; j++) ctx.fillRect(X[j] - r / 2, Y[j] - r / 2, r, r);
          } else {
            ctx.globalCompositeOperation = 'lighter';
            if (p.glow > 0) {
              ctx.strokeStyle = g; ctx.globalAlpha = 0.12 * p.glow; ctx.lineWidth = lw * (3 + p.glow * 3) * (1.1 - dist);
              ctx.beginPath(); for (let j = 0; j < nC; j++) j ? ctx.lineTo(X[j], Y[j]) : ctx.moveTo(X[j], Y[j]); ctx.stroke();
              ctx.globalAlpha = 1;
            }
            ctx.strokeStyle = g; ctx.lineWidth = Math.max(0.5, lw * (1.15 - dist * 0.7));
            ctx.beginPath();
            for (let j = 0; j < nC; j++) j ? ctx.lineTo(X[j], Y[j]) : ctx.moveTo(X[j], Y[j]);
            if (p.lines === 'grid' && hasPrev) {
              const step = Math.max(1, Math.round(nC / 32));
              for (let j = 0; j < nC; j += step) { ctx.moveTo(PX[j], PY[j]); ctx.lineTo(X[j], Y[j]); }
            }
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
          }
          PX.set(X); PY.set(Y); hasPrev = true;
        }
        if (flash > 0.02) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rgba(skyC, flash * 0.18); ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
      },
      resize() {},
      dispose() {}
    };
  }
};
