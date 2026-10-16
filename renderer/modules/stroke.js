import { hexToRgb, rgba, noise3, TAU } from './util.js';

export default {
  id: 'stroke',
  name: 'Stroke',
  tagline: 'A pen of light on a long exposure.',
  params: [
    { key: 'speed', label: 'Pen speed', type: 'range', min: 0.1, max: 3, step: 0.05, default: 1, section: 'Motion' },
    { key: 'melody', label: 'Follow the melody', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'wander', label: 'Wander', type: 'range', min: 0, max: 2, step: 0.05, default: 0.55 },
    { key: 'corners', label: 'Corner on hits', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
    { key: 'figure', label: 'Race a laser figure on big drops', type: 'toggle', default: true },
    { key: 'exposure', label: 'Exposure length', type: 'range', min: 0.5, max: 0.998, step: 0.001, default: 0.992, section: 'Light' },
    { key: 'thick', label: 'Slow stroke width', type: 'range', min: 1, max: 24, step: 0.5, default: 9 },
    { key: 'thin', label: 'Fast stroke width', type: 'range', min: 0.3, max: 4, step: 0.1, default: 0.8 },
    { key: 'flare', label: 'Flare size', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'color', label: 'Light', type: 'color', default: '#ffffff' },
    { key: 'glowColor', label: 'Halo', type: 'color', default: '#c4c8d0' }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    const trail = document.createElement('canvas');
    const tctx = trail.getContext('2d');
    let x = 0, y = 0, dir = 0.4, spd = 0.5, flares = [], fig = null, time = 0, pitchY = 0, ready = false;
    function strokePath(path, w, col, glow, S) {
      tctx.lineCap = 'round'; tctx.lineJoin = 'round';
      tctx.strokeStyle = rgba(glow, 0.05); tctx.lineWidth = w * 4 + 6 * S; tctx.stroke(path);
      tctx.strokeStyle = rgba(glow, 0.2); tctx.lineWidth = w * 1.8 + S; tctx.stroke(path);
      tctx.strokeStyle = rgba(col, 0.9); tctx.lineWidth = w; tctx.stroke(path);
    }
    function line(x0, y0, x1, y1, w, col, glow, S) {
      tctx.lineCap = 'round';
      tctx.strokeStyle = rgba(glow, 0.07); tctx.lineWidth = w * 4 + 6 * S;
      tctx.beginPath(); tctx.moveTo(x0, y0); tctx.lineTo(x1, y1); tctx.stroke();
      tctx.strokeStyle = rgba(glow, 0.25); tctx.lineWidth = w * 1.8 + S;
      tctx.stroke();
      tctx.strokeStyle = rgba(col, 0.95); tctx.lineWidth = w;
      tctx.stroke();
    }
    return {
      render(F, { dt, W, H, S, params: p }) {
        time += dt;
        if (trail.width !== W || trail.height !== H) {
          trail.width = W; trail.height = H; tctx.fillStyle = '#000'; tctx.fillRect(0, 0, W, H);
          if (!ready) { x = W * 0.5; y = H * 0.5; ready = true; }
        }
        // long exposure: the plate darkens very slowly
        tctx.globalCompositeOperation = 'source-over';
        tctx.fillStyle = `rgba(0,0,0,${(1 - Math.pow(p.exposure, dt * 60)).toFixed(4)})`;
        tctx.fillRect(0, 0, W, H);
        tctx.globalCompositeOperation = 'lighter';
        const col = hexToRgb(p.color), glow = hexToRgb(p.glowColor);
        const m = Math.min(W, H) * 0.08;
        // keep the drawing in a centered square, like a sheet of paper, so it stays composed on wide stages
        const side = Math.min(W, H) * 0.86, bx0 = (W - side) / 2, by0 = (H - side) / 2;

        // the biggest drops: race a laser figure (a star polygon) around the frame
        if (p.figure && F.drop > 0.95 && !fig) fig = { t: 0, n: [5, 7, 9][(Math.random() * 3) | 0], k: 2 + ((Math.random() * 2) | 0), rot: Math.random() * TAU };
        if (fig) {
          fig.t += dt / 2.4;
          const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.38;
          const sub = 12;
          for (let i = 0; i < sub; i++) {
            const tt = Math.min(1, fig.t) * fig.n;
            const seg = Math.floor(tt), f = tt - seg;
            const P = (j) => { const a = fig.rot + (j * fig.k / fig.n) * TAU; return [cx + Math.cos(a) * R, cy + Math.sin(a) * R]; };
            const a = P(seg), b = P(seg + 1);
            const nx = a[0] + (b[0] - a[0]) * f, ny = a[1] + (b[1] - a[1]) * f;
            line(x, y, nx, ny, p.thin * S * 1.2, col, glow, S);
            if (seg !== fig.lastSeg && seg < fig.n) { fig.lastSeg = seg; flares.push({ x: a[0], y: a[1], life: 1, s: 1.1 }); }
            x = nx; y = ny;
          }
          if (fig.t >= 1) { fig = null; dir = Math.random() * TAU; }
        } else {
          // melody: higher pitch → higher on the plate
          if (F.pitch > 60) { const tgt = 1 - Math.min(1, Math.max(0, Math.log2(F.pitch / 80) / 4)); pitchY += (tgt - pitchY) * (1 - Math.exp(-dt * 3)); }
          const targetSpd = p.speed * (0.15 + F.level * 1.3 + F.mid * 0.4);
          spd += (targetSpd - spd) * (1 - Math.exp(-dt * 4));
          for (const o of F.onsets) {
            if (o.band === 'hat' || Math.random() > p.corners || o.strength < 0.45) continue;
            dir += (Math.random() < 0.5 ? -1 : 1) * (1.7 + Math.random() * 0.9); // a sharp corner
            flares.push({ x, y, life: 1, s: o.strength * (o.band === 'kick' ? 1.2 : 0.8) });
          }
          const steps = 8;
          const path = new Path2D(); path.moveTo(x, y);
          let wSum = 0;
          for (let i = 0; i < steps; i++) {
            const turn = noise3(time * 0.4, 7, 0) * p.wander * 2.2 * (dt / steps) * 3;
            const wantY = by0 + pitchY * side;
            const toward = Math.atan2(wantY - y, W * 0.35) * p.melody;
            dir += turn + (toward - Math.sin(dir) * 0.6) * p.melody * (dt / steps) * 2.5;
            const v = spd * Math.min(W, H) * 0.9 * (dt / steps);
            let nx = x + Math.cos(dir) * v, ny = y + Math.sin(dir) * v;
            // soft pull back towards the middle before the walls, then a bounce at the walls
            const cxs = W / 2, cys = H / 2, dxs = (x - cxs) / (side / 2), dys = (y - cys) / (side / 2);
            if (dxs * dxs + dys * dys > 0.55) { const want = Math.atan2(cys - y, cxs - x); dir += Math.atan2(Math.sin(want - dir), Math.cos(want - dir)) * 0.06; }
            if (nx < bx0 || nx > bx0 + side) { dir = Math.PI - dir; nx = Math.min(bx0 + side, Math.max(bx0, nx)); }
            if (ny < by0 || ny > by0 + side) { dir = -dir; ny = Math.min(by0 + side, Math.max(by0, ny)); }
            // slow strokes burn thick, fast ones thin to a wire
            const speedPx = v / (dt / steps) / Math.min(W, H);
            wSum += (p.thin + (p.thick - p.thin) * Math.exp(-speedPx * 2.2)) * S;
            path.lineTo(nx, ny);
            x = nx; y = ny;
          }
          strokePath(path, wSum / steps, col, glow, S);
        }
        // compose: plate + flares on top (flares are not burned in)
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(trail, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        const fs = Math.min(W, H) * 0.06 * p.flare;
        flares = flares.filter((f) => (f.life -= dt * 1.6) > 0);
        for (const f of flares) {
          const a = f.life * f.life, r = fs * f.s * (0.6 + 0.4 * f.life);
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
          g.addColorStop(0, rgba(col, 0.9 * a)); g.addColorStop(0.2, rgba(glow, 0.35 * a)); g.addColorStop(1, rgba(glow, 0));
          ctx.fillStyle = g; ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
          ctx.strokeStyle = rgba(col, 0.5 * a); ctx.lineWidth = Math.max(1, S * 0.8);
          const L = r * 3.2;
          ctx.beginPath(); ctx.moveTo(f.x - L, f.y); ctx.lineTo(f.x + L, f.y); ctx.moveTo(f.x, f.y - L * 0.6); ctx.lineTo(f.x, f.y + L * 0.6); ctx.stroke();
        }
        // the pen tip itself
        const g = ctx.createRadialGradient(x, y, 0, x, y, 10 * S);
        g.addColorStop(0, rgba(col, 1)); g.addColorStop(1, rgba(glow, 0));
        ctx.fillStyle = g; ctx.fillRect(x - 10 * S, y - 10 * S, 20 * S, 20 * S);
        ctx.globalCompositeOperation = 'source-over';
      },
      resize() {},
      dispose() {}
    };
  }
};
