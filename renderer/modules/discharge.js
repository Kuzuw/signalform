import { hexToRgb, rgba, TAU } from './util.js';

// Midpoint-displacement lightning with recursive branches.
function bolt(x0, y0, x1, y1, rough, branchP, width, depth, out, rnd) {
  let pts = [[x0, y0], [x1, y1]];
  let disp = Math.hypot(x1 - x0, y1 - y0) * 0.22 * rough;
  for (let it = 0; it < (depth ? 5 : 6); it++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const o = (rnd() * 2 - 1) * disp;
      next.push([mx - (dy / l) * o, my + (dx / l) * o], b);
    }
    pts = next; disp *= 0.52;
  }
  out.push({ pts, w: width, depth });
  if (depth >= 3) return;
  const total = Math.hypot(x1 - x0, y1 - y0);
  for (let i = 4; i < pts.length - 4; i += 3) {
    if (rnd() > branchP * (depth === 0 ? 0.55 : 0.35)) continue;
    const [bx, by] = pts[i];
    const base = Math.atan2(y1 - y0, x1 - x0) + (rnd() < 0.5 ? -1 : 1) * (0.35 + rnd() * 0.75);
    const len = total * (0.12 + rnd() * 0.3) * (1 - i / pts.length) * (depth ? 0.7 : 1);
    bolt(bx, by, bx + Math.cos(base) * len, by + Math.sin(base) * len, rough * 1.1, branchP, width * 0.42, depth + 1, out, rnd);
  }
}

export default {
  id: 'discharge',
  name: 'Discharge',
  tagline: 'Lightning on a photographic plate.',
  params: [
    { key: 'react', label: 'Strikes come from', type: 'select', default: 'all', section: 'Strikes', options: [['all', 'Every sound'], ['kick', 'Kicks only'], ['kicksnare', 'Kicks and snares']] },
    { key: 'sens', label: 'Sensitivity', type: 'range', min: 0.2, max: 2, step: 0.05, default: 1 },
    { key: 'length', label: 'Channel length', type: 'range', min: 0.3, max: 1.6, step: 0.05, default: 1 },
    { key: 'branch', label: 'Branching', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'rough', label: 'Roughness', type: 'range', min: 0.3, max: 2, step: 0.05, default: 1 },
    { key: 'buildDrop', label: 'Hold back on builds, break loose on drops', type: 'toggle', default: true },
    { key: 'width', label: 'Channel width', type: 'range', min: 0.3, max: 4, step: 0.05, default: 1.4, section: 'Plate' },
    { key: 'afterglow', label: 'Afterglow', type: 'range', min: 0, max: 0.95, step: 0.01, default: 0.55 },
    { key: 'sky', label: 'Sky flash', type: 'range', min: 0, max: 1.5, step: 0.05, default: 0.7 },
    { key: 'grain', label: 'Plate grain', type: 'range', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'core', label: 'Core', type: 'color', default: '#ffffff' },
    { key: 'glow', label: 'Glow', type: 'color', default: '#9db8ff' }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let strikes = [], sky = 0, charge = 0, lastSnare = null, time = 0, dropped = false;
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const noiseTile = document.createElement('canvas'); noiseTile.width = noiseTile.height = 128;
    { const g = noiseTile.getContext('2d'), d = g.createImageData(128, 128); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); }

    function strike(kind, s, W, H, p) {
      const segs = [];
      seed = (Math.random() * 2147483646 + 1) | 0;
      const L = Math.hypot(W, H) * p.length;
      let x0, y0, x1, y1, w, life;
      if (kind === 'kick') {
        // long channel from the top edge, tearing across the plate
        x0 = W * (0.1 + rnd() * 0.8); y0 = -H * 0.05;
        const a = Math.PI / 2 + (rnd() - 0.5) * 1.1;
        x1 = x0 + Math.cos(a) * L * (0.55 + 0.35 * s); y1 = y0 + Math.sin(a) * L * (0.55 + 0.35 * s);
        w = 2.4 * s; life = 0.55;
      } else if (kind === 'snare') {
        // an arc thrown between two points
        x0 = W * (0.15 + rnd() * 0.7); y0 = H * (0.2 + rnd() * 0.6);
        const a = rnd() * TAU, l = L * (0.18 + 0.2 * s);
        x1 = x0 + Math.cos(a) * l; y1 = y0 + Math.sin(a) * l;
        w = 1.4 * s; life = 0.32;
      } else {
        // hats crackle: tiny sparks
        x0 = W * rnd(); y0 = H * rnd();
        const a = rnd() * TAU, l = L * (0.02 + 0.04 * s);
        x1 = x0 + Math.cos(a) * l; y1 = y0 + Math.sin(a) * l;
        w = 0.6; life = 0.12;
      }
      bolt(x0, y0, x1, y1, p.rough, p.branch * (kind === 'hat' ? 0.3 : 1), w, kind === 'hat' ? 2 : 0, segs, rnd);
      // one Path2D per depth level, built once: channel, branches, roots
      const paths = [0, 1, 2, 3].map((d) => { const P = new Path2D(); let any = false, w = 0; for (const sg of segs) if (sg.depth === d) { any = true; w = Math.max(w, sg.w); sg.pts.forEach(([x, y], i) => (i ? P.lineTo(x, y) : P.moveTo(x, y))); } return any ? { P, w, d } : null; }).filter(Boolean);
      const st = { segs, paths, life, max: life, kind, s, flick: Math.random() * 100 };
      strikes.push(st);
      if (strikes.length > 40) strikes.shift();
      return st;
    }

    return {
      render(F, { dt, W, H, S, params: p }) {
        time += dt;
        const holding = p.buildDrop && F.build > 0.4;
        charge = holding ? Math.min(1, charge + dt * 0.25) : charge * Math.exp(-dt * 2);
        for (const o of F.onsets) {
          if (p.react === 'kick' && o.band !== 'kick') continue;
          if (p.react === 'kicksnare' && o.band === 'hat') continue;
          const s = Math.min(1.2, o.strength * p.sens);
          if (s < 0.3) continue;
          if (holding && o.band === 'kick' && Math.random() < 0.85) continue; // holds back
          if (o.band === 'snare' && lastSnare && time - lastSnare.at < 0.16 && lastSnare.st.life > 0) {
            lastSnare.st.life = lastSnare.st.max; lastSnare.at = time; continue; // a roll flickers one channel
          }
          const st = strike(o.band, s, W, H, p);
          if (o.band === 'snare') lastSnare = { st, at: time };
          if (o.band === 'kick' && s > 0.8) sky = Math.max(sky, s);
        }
        if (p.buildDrop && F.drop > 0.95 && !dropped) {
          dropped = true;
          for (let i = 0; i < 4; i++) strike('kick', 1.2, W, H, p);
          sky = 1.4;
        }
        if (F.drop < 0.5) dropped = false;
        // plate: afterglow instead of a clean wipe
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(0,0,0,${(1 - Math.pow(p.afterglow, dt * 60)).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
        const core = hexToRgb(p.core), glow = hexToRgb(p.glow);
        ctx.globalCompositeOperation = 'lighter';
        if (sky > 0.01 && p.sky > 0) { ctx.fillStyle = rgba(glow, Math.min(0.5, sky * 0.22 * p.sky)); ctx.fillRect(0, 0, W, H); }
        sky *= Math.exp(-dt * 9);
        // static charge gathering through a build
        if (charge > 0.05) {
          ctx.strokeStyle = rgba(glow, 0.25 * charge); ctx.lineWidth = S * 0.6;
          for (let i = 0; i < 6 * charge; i++) {
            const x = Math.random() * W, y = Math.random() < 0.5 ? Math.random() * H * 0.06 : H - Math.random() * H * 0.06;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (Math.random() - 0.5) * 20 * S, y + (Math.random() - 0.5) * 20 * S); ctx.stroke();
          }
        }
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        strikes = strikes.filter((st) => (st.life -= dt) > 0);
        for (const st of strikes) {
          const t = st.life / st.max;
          const flick = 0.55 + 0.45 * Math.sin(time * 70 + st.flick) * Math.sin(time * 23 + st.flick * 2);
          const a = Math.pow(t, 0.6) * (st.kind === 'hat' ? 1 : flick);
          for (const sg of st.paths) {
            const w = Math.max(0.35, sg.w * p.width * S);
            if (sg.d === 0 && st.kind !== 'hat') {
              ctx.strokeStyle = rgba(glow, 0.07 * a); ctx.lineWidth = w * 7; ctx.stroke(sg.P);
              ctx.strokeStyle = rgba(glow, 0.22 * a); ctx.lineWidth = w * 2.6; ctx.stroke(sg.P);
            } else if (sg.d === 1) {
              ctx.strokeStyle = rgba(glow, 0.18 * a); ctx.lineWidth = w * 2.5; ctx.stroke(sg.P);
            }
            ctx.strokeStyle = rgba(core, Math.min(1, a * (sg.d ? 0.75 : 1))); ctx.lineWidth = w; ctx.stroke(sg.P);
          }
        }
        if (p.grain > 0) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = p.grain * 0.06;
          const ox = (Math.random() * 128) | 0, oy = (Math.random() * 128) | 0;
          for (let y = -oy; y < H; y += 128) for (let x = -ox; x < W; x += 128) ctx.drawImage(noiseTile, x, y);
          ctx.globalAlpha = 1;
        }
        ctx.globalCompositeOperation = 'source-over';
      },
      resize() { strikes = []; },
      dispose() {}
    };
  }
};
