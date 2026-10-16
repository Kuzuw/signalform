import { noise3, hexToRgb, mixRgb, rgba, fade, clear, TAU } from './util.js';

export default {
  id: 'flowfield',
  name: 'Flow Field',
  tagline: 'Sound flows through motion fields.',
  params: [
    { key: 'count', label: 'Particles', type: 'range', min: 500, max: 12000, step: 100, default: 4000 },
    { key: 'speed', label: 'Flow speed', type: 'range', min: 0.1, max: 4, step: 0.05, default: 1 },
    { key: 'scale', label: 'Field scale', type: 'range', min: 0.2, max: 4, step: 0.05, default: 1 },
    { key: 'turb', label: 'Turbulence', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'evolve', label: 'Field evolution', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'burst', label: 'Burst on hits', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'trail', label: 'Trail length', type: 'range', min: 0.5, max: 0.99, step: 0.01, default: 0.9 },
    { key: 'width', label: 'Line width', type: 'range', min: 0.5, max: 4, step: 0.1, default: 1 },
    { key: 'colorMode', label: 'Coloring', type: 'select', default: 'direction', options: [['direction', 'By direction'], ['speed', 'By speed'], ['mono', 'Single color']] },
    { key: 'colorA', label: 'Color A', type: 'color', default: '#ff8a3d' },
    { key: 'colorB', label: 'Color B', type: 'color', default: '#38c6c0' },
    { key: 'pattern', label: 'Stream pattern', type: 'select', default: 'curl', options: [['curl', 'Curl noise'], ['vortex', 'Vortex'], ['waves', 'Waves']] }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let X = new Float32Array(0), Y = new Float32Array(0), L = new Float32Array(0), z = 0;
    const GROUPS = 8;
    function seed(n, W, H) {
      X = new Float32Array(n); Y = new Float32Array(n); L = new Float32Array(n);
      for (let i = 0; i < n; i++) { X[i] = Math.random() * W; Y[i] = Math.random() * H; L[i] = Math.random() * 200; }
    }
    return {
      render(F, { dt, W, H, S, params: p }) {
        const n = Math.round(p.count);
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
          if (p.pattern === 'vortex') a = Math.atan2(y - cy, x - cx) + Math.PI / 2 + noise3(x * sc, y * sc, z) * turb;
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
          paths[g].moveTo(x, y); paths[g].lineTo(nx2, ny2);
          L[i] -= 1;
          if (nx2 < 0 || nx2 > W || ny2 < 0 || ny2 > H || L[i] < 0) { X[i] = Math.random() * W; Y[i] = Math.random() * H; L[i] = 60 + Math.random() * 240; }
          else { X[i] = nx2; Y[i] = ny2; }
        }
        for (let g = 0; g < GROUPS; g++) {
          const t = p.colorMode === 'mono' ? 0 : g / (GROUPS - 1);
          const c = p.colorMode === 'direction' ? mixRgb(A, B, 0.5 - 0.5 * Math.cos(t * TAU)) : mixRgb(A, B, t);
          ctx.strokeStyle = rgba(c, (0.3 + F.level * 0.35) * density);
          ctx.stroke(paths[g]);
        }
        ctx.globalCompositeOperation = 'source-over';
      },
      resize(W, H) { X = new Float32Array(0); },
      dispose() {}
    };
  }
};
