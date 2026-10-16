import { noise3, hexToRgb, mixRgb, rgba, fade, clear, TAU } from './util.js';

export default {
  id: 'flowfield',
  name: 'Flow Field',
  tagline: 'Sound flows through motion fields.',
  params: [
    { key: 'look', label: 'Look', type: 'select', default: 'lattice', options: [['lattice', 'A grid of points carried by the field'], ['streams', 'Particle streams']] },
    { key: 'gridSize', label: 'Grid spacing', type: 'range', min: 6, max: 40, step: 1, default: 15, showIf: { look: 'lattice' } },
    { key: 'warp', label: 'Displacement', type: 'range', min: 0, max: 4, step: 0.05, default: 1.6, showIf: { look: 'lattice' } },
    { key: 'dot', label: 'Point size', type: 'range', min: 0.5, max: 4, step: 0.05, default: 1.2, showIf: { look: 'lattice' } },
    { key: 'pattern', label: 'Stream pattern', type: 'select', default: 'curl', section: 'Field', options: [['curl', 'Curl noise'], ['vortex', 'Vortex'], ['waves', 'Waves'], ['radial', 'Radial burst'], ['grid', 'Crosshatch']] },
    { key: 'count', label: 'Particles', type: 'range', min: 500, max: 20000, step: 100, default: 4000 },
    { key: 'speed', label: 'Flow speed', type: 'range', min: 0.1, max: 4, step: 0.05, default: 1 },
    { key: 'scale', label: 'Field scale', type: 'range', min: 0.2, max: 4, step: 0.05, default: 1 },
    { key: 'turb', label: 'Turbulence', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'evolve', label: 'Field evolution', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'burst', label: 'Burst on hits', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'spawn', label: 'Particles start', type: 'select', default: 'all', options: [['all', 'Everywhere'], ['center', 'From the center'], ['edges', 'From the edges'], ['bottom', 'From the bottom']] },
    { key: 'life', label: 'Particle life', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'trail', label: 'Trail length', type: 'range', min: 0.5, max: 0.99, step: 0.01, default: 0.9, section: 'Drawing' },
    { key: 'shape', label: 'Particle shape', type: 'select', default: 'lines', options: [['lines', 'Streaks'], ['dots', 'Dots'], ['dashes', 'Dashes']] },
    { key: 'bright', label: 'Brightness', type: 'range', min: 0.1, max: 3, step: 0.05, default: 1 },
    { key: 'width', label: 'Line width', type: 'range', min: 0.5, max: 4, step: 0.1, default: 1 },
    { key: 'colorMode', label: 'Coloring', type: 'select', default: 'mono', section: 'Color', options: [['direction', 'By direction'], ['speed', 'By speed'], ['mono', 'Single color']] },
    { key: 'colorA', label: 'Color A', type: 'color', default: '#e6e6ea' },
    { key: 'colorB', label: 'Color B', type: 'color', default: '#38c6c0' }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let X = new Float32Array(0), Y = new Float32Array(0), L = new Float32Array(0), z = 0;
    const GROUPS = 8;
    let spawnMode = 'all';
    function place(i, W, H) {
      const m = spawnMode;
      if (m === 'center') { const a = Math.random() * TAU, r = Math.random() * Math.min(W, H) * 0.08; X[i] = W / 2 + Math.cos(a) * r; Y[i] = H / 2 + Math.sin(a) * r; }
      else if (m === 'edges') { const e = (Math.random() * 4) | 0; X[i] = e === 0 ? 1 : e === 1 ? W - 1 : Math.random() * W; Y[i] = e === 2 ? 1 : e === 3 ? H - 1 : Math.random() * H; }
      else if (m === 'bottom') { X[i] = Math.random() * W; Y[i] = H - 1 - Math.random() * H * 0.05; }
      else { X[i] = Math.random() * W; Y[i] = Math.random() * H; }
    }
    function seed(n, W, H) {
      X = new Float32Array(n); Y = new Float32Array(n); L = new Float32Array(n);
      for (let i = 0; i < n; i++) { X[i] = Math.random() * W; Y[i] = Math.random() * H; L[i] = Math.random() * 200; }
    }
    // ---- a regular grid of points, each carried away from its home by the flow and pulled back
    let lz = 0, kickE = 0;
    function lattice(F, dt, W, H, S, p) {
      dt = Math.max(0, dt);
      lz += dt * 0.25 * p.speed * p.evolve * (0.6 + F.mid * 1.4 + F.drop * 3);
      kickE = Math.max(kickE * Math.exp(-dt / 0.18), F.kick * p.burst);
      clear(ctx, W, H);
      const g = p.gridSize * S * 0.5, sc = 0.0021 / p.scale / S;
      const amp = g * p.warp * (0.8 + F.bass * 1.6 + F.drop * 2);
      const tb = p.turb * (0.5 + F.high * 1.5);
      const cx = W / 2, cy = H / 2;
      const r = Math.max(0.8, p.dot * S);
      const col = hexToRgb(p.colorA), colB = hexToRgb(p.colorB);
      const nx = Math.ceil(W / g) + 2, ny = Math.ceil(H / g) + 2;
      const ox = (W - (nx - 1) * g) / 2, oy = (H - (ny - 1) * g) / 2;
      const groups = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = ox + i * g, y = oy + j * g;
        // displacement: the curl of a slow noise field, so the grid shears in waves instead of clumping
        const xs = x * sc, ys = y * sc, e = 0.02;
        const dy = noise3(xs, ys + e, lz) - noise3(xs, ys - e, lz);
        const dx = noise3(xs + e, ys, lz) - noise3(xs - e, ys, lz);
        let vx = dy / (2 * e), vy = -dx / (2 * e);
        vx += noise3(xs * 3, ys * 3, lz * 1.6 + 5) * tb * 0.35; vy += noise3(xs * 3 + 9, ys * 3, lz * 1.6) * tb * 0.35;
        let px = x + vx * amp * 0.5, py = y + vy * amp * 0.5;
        if (kickE > 0.02) { const ddx = px - cx, ddy = py - cy, d = Math.hypot(ddx, ddy) + 1; const push = kickE * g * 1.2 * Math.exp(-d / (Math.min(W, H) * 0.6)); px += ddx / d * push; py += ddy / d * push; }
        const m = Math.min(3, Math.floor(Math.hypot(vx, vy) * 1.6));
        groups[m].rect(px - r / 2, py - r / 2, r, r);
      }
      for (let m = 0; m < 4; m++) {
        const c = p.colorMode === 'mono' ? col : mixRgb(col, colB, m / 3);
        ctx.fillStyle = rgba(c, Math.min(1, (0.55 + m * 0.15) * p.bright * (0.85 + F.level * 0.3)));
        ctx.fill(groups[m]);
      }
    }
    return {
      render(F, { dt, W, H, S, params: p }) {
        if (p.look === 'lattice') return lattice(F, dt, W, H, S, p);
        const n = Math.round(p.count);
        spawnMode = p.spawn;
        if (X.length !== n) { seed(n, W, H); clear(ctx, W, H); }
        fade(ctx, W, H, p.trail);
        z += dt * 0.15 * p.evolve * (0.6 + F.mid * 1.5);
        const sc = 0.0016 / p.scale / S;
        const step = S * p.speed * (0.8 + F.bass * 3.5 + F.drop * 4) * 60 * dt;
        const turb = p.turb * (0.4 + F.high * 2.2);
        const cx = W / 2, cy = H / 2;
        const A = hexToRgb(p.colorA), B = hexToRgb(p.colorB);
        const burst = F.kick * p.burst * 6 * S;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineWidth = p.width * S;
        // keep brightness constant whatever the widget size: fewer pixels per particle → fainter lines
        const density = Math.min(1, (W * H) / (S * S) / (n * 55));
        const paths = Array.from({ length: GROUPS }, () => new Path2D());
        for (let i = 0; i < n; i++) {
          const x = X[i], y = Y[i];
          let a;
          if (p.pattern === 'radial') a = Math.atan2(y - cy, x - cx) + noise3(x * sc, y * sc, z) * turb * 0.6;
          else if (p.pattern === 'grid') a = (Math.floor(noise3(x * sc * 0.7, y * sc * 0.7, z) * 4 + 4) % 4) * (Math.PI / 2) + Math.PI / 4 + noise3(x * sc * 3, y * sc * 3, z) * turb * 0.2;
          else if (p.pattern === 'vortex') a = Math.atan2(y - cy, x - cx) + Math.PI / 2 + noise3(x * sc, y * sc, z) * turb;
          else if (p.pattern === 'waves') a = Math.sin(y * sc * 3 + z * 2) * 1.2 + noise3(x * sc * 0.5, y * sc * 0.5, z) * turb;
          else {
            // curl of a scalar noise field: divergence-free, so streams never bunch up
            const xs = x * sc, ys = y * sc, e = 0.01;
            const dy = noise3(xs, ys + e, z) - noise3(xs, ys - e, z);
            const dx = noise3(xs + e, ys, z) - noise3(xs - e, ys, z);
            a = Math.atan2(-dx, dy) + noise3(xs * 2, ys * 2, z + 9) * turb;
          }
          let vx = Math.cos(a) * step, vy = Math.sin(a) * step;
          if (burst > 0.1) { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) + 1; vx += dx / d * burst; vy += dy / d * burst; }
          const nx2 = x + vx, ny2 = y + vy;
          let g;
          if (p.colorMode === 'direction') g = Math.floor(((a % TAU + TAU) % TAU) / TAU * GROUPS) % GROUPS;
          else if (p.colorMode === 'speed') g = Math.min(GROUPS - 1, Math.floor(Math.hypot(vx, vy) / (step * 1.6 + 0.01) * GROUPS));
          else g = i % GROUPS;
          if (p.shape === 'dots') { const r = p.width * S * 0.9; paths[g].moveTo(nx2 + r, ny2); paths[g].arc(nx2, ny2, r, 0, TAU); }
          else if (p.shape === 'dashes') { if ((L[i] | 0) % 6 < 3) { paths[g].moveTo(x, y); paths[g].lineTo(nx2, ny2); } }
          else { paths[g].moveTo(x, y); paths[g].lineTo(nx2, ny2); }
          L[i] -= 1;
          if (nx2 < 0 || nx2 > W || ny2 < 0 || ny2 > H || L[i] < 0) { place(i, W, H); L[i] = (60 + Math.random() * 240) * p.life; }
          else { X[i] = nx2; Y[i] = ny2; }
        }
        for (let g = 0; g < GROUPS; g++) {
          const t = p.colorMode === 'mono' ? 0 : g / (GROUPS - 1);
          const c = p.colorMode === 'direction' ? mixRgb(A, B, 0.5 - 0.5 * Math.cos(t * TAU)) : mixRgb(A, B, t);
          const al = Math.min(1, (0.3 + F.level * 0.35) * density * p.bright * (p.shape === 'dots' ? 2.2 : 1));
          if (p.shape === 'dots') { ctx.fillStyle = rgba(c, al); ctx.fill(paths[g]); } else { ctx.strokeStyle = rgba(c, al); ctx.stroke(paths[g]); }
        }
        ctx.globalCompositeOperation = 'source-over';
      },
      resize(W, H) { X = new Float32Array(0); },
      dispose() {}
    };
  }
};
