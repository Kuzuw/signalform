import { Accum, TAU } from './util.js';

// Surfaces the beam can trace. Each maps (u in 0..2π, v in 0..π) to a point on a closed shell.
const FORMS = {
  sphere: (u, v) => [Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)],
  spindle: (u, v) => { const r = Math.pow(Math.sin(v), 1.4) * 0.72; return [r * Math.cos(u), Math.cos(v) * 1.15, r * Math.sin(u)]; },
  torus: (u, v) => { const a = v * 2, R = 0.78, r = 0.36; return [(R + r * Math.cos(a)) * Math.cos(u), r * Math.sin(a) * 1.2, (R + r * Math.cos(a)) * Math.sin(u)]; },
  shell: (u, v) => {
    const t = v / Math.PI, s = Math.exp(1.1 * (t - 0.6)), a = t * TAU * 1.3;
    const r = 0.22 * s + 0.12;
    return [(s * 0.55 + r * Math.cos(u)) * Math.cos(a), (t - 0.5) * 1.5 + r * Math.sin(u) * 0.6, (s * 0.55 + r * Math.cos(u)) * Math.sin(a)];
  },
  bell: (u, v) => { const t = v / Math.PI, r = 0.25 + 0.6 * Math.pow(Math.sin(t * Math.PI * 0.5), 2) * (1 - 0.35 * Math.cos(t * 6)); return [r * Math.cos(u), 1 - t * 2, r * Math.sin(u)]; },
  knot: (u, v) => {
    const a = u * 1, p = [Math.sin(a) + 2 * Math.sin(2 * a), Math.cos(a) - 2 * Math.cos(2 * a), -Math.sin(3 * a)].map((x) => x * 0.27);
    const r = 0.16, b = v * 2;
    return [p[0] + r * Math.cos(b) * Math.cos(a), p[1] + r * Math.sin(b), p[2] + r * Math.cos(b) * Math.sin(a)];
  }
};
const NAMES = Object.keys(FORMS);

export default {
  id: 'oscillon',
  name: 'Oscillon',
  tagline: 'A shell drawn by a phosphor beam.',
  params: [
    { key: 'form', label: 'Form', type: 'select', default: 'auto', section: 'Shape', options: [['auto', 'Changes with the music'], ...NAMES.map((n) => [n, n[0].toUpperCase() + n.slice(1)])] },
    { key: 'snap', label: 'Snap to a new form', type: 'select', default: 'hits', showIf: { form: 'auto' }, options: [['hits', 'On heavy hits and drops'], ['drops', 'Only on drops'], ['never', 'Never']] },
    { key: 'scale', label: 'Scale', type: 'range', min: 0.3, max: 1.6, step: 0.01, default: 1 },
    { key: 'swell', label: 'Swelling from sounds', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'buildDrop', label: 'Squeeze on build, open on drop', type: 'toggle', default: true },
    { key: 'points', label: 'Beam samples per frame', type: 'range', min: 4000, max: 80000, step: 1000, default: 20000, section: 'Beam' },
    { key: 'weave', label: 'Beam weave', type: 'range', min: 3, max: 120, step: 1, default: 37 },
    { key: 'ratio', label: 'Weave ratio', type: 'range', min: 0.2, max: 1.5, step: 0.001, default: 0.618 },
    { key: 'beam', label: 'Beam speed', type: 'range', min: 0.1, max: 3, step: 0.05, default: 1 },
    { key: 'persist', label: 'Phosphor persistence', type: 'range', min: 0, max: 0.97, step: 0.01, default: 0.82 },
    { key: 'spin', label: 'Rotation', type: 'range', min: -2, max: 2, step: 0.05, default: 0.35 },
    { key: 'color', label: 'Phosphor', type: 'color', default: '#e8eeff', section: 'Light' },
    { key: 'tint', label: 'Shadow tint', type: 'color', default: '#2a3550' },
    { key: 'exposure', label: 'Exposure', type: 'range', min: 0.2, max: 4, step: 0.05, default: 1 },
    { key: 'bloom', label: 'Bloom', type: 'range', min: 0, max: 2, step: 0.05, default: 0.8 }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    const acc = new Accum();
    let beamT = 0, yaw = 0, pitch = 0.35, from = 'spindle', to = 'spindle', morph = 1, lastSnap = -9, open = 0, time = 0;
    const bumps = [];
    return {
      render(F, { dt, W, H, S, params: p }) {
        time += dt;
        const scale = Math.max(1, S * 1.1);
        acc.ensure(W, H, scale);
        acc.decay(Math.pow(p.persist, dt * 60));
        // form changes
        const target = p.form === 'auto' ? to : p.form;
        if (p.form !== 'auto' && to !== target) { from = to; to = target; morph = 0; }
        if (p.form === 'auto' && p.snap !== 'never') {
          const heavy = p.snap === 'hits' && F.onsets.some((o) => o.band === 'kick' && o.strength > 0.85);
          if ((heavy || F.drop > 0.95) && time - lastSnap > 1.6) {
            lastSnap = time; from = to;
            let n; do { n = NAMES[(Math.random() * NAMES.length) | 0]; } while (n === to);
            to = n; morph = 0;
          }
        }
        morph = Math.min(1, morph + dt * 2.2);
        const m = morph * morph * (3 - 2 * morph);
        // every sound leaves a swelling where it lands
        for (const o of F.onsets) {
          if (bumps.length > 10) bumps.shift();
          const th = Math.random() * TAU, ph = Math.acos(Math.random() * 2 - 1);
          bumps.push({ d: [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)], a: o.strength * (o.band === 'kick' ? 0.28 : o.band === 'snare' ? 0.18 : 0.08), sharp: o.band === 'kick' ? 4 : o.band === 'snare' ? 9 : 22, life: 1 });
        }
        for (let i = bumps.length - 1; i >= 0; i--) { bumps[i].life -= dt * 1.4; if (bumps[i].life <= 0) bumps.splice(i, 1); }
        open = Math.max(open * Math.exp(-dt * 1.8), p.buildDrop ? F.drop : 0);
        const squeeze = p.buildDrop ? F.build : 0;
        yaw += dt * p.spin * (0.5 + F.mid * 1.2 + open * 3);
        pitch = 0.35 + Math.sin(time * 0.21) * 0.25;
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const R = Math.min(W, H) * 0.36 * p.scale * (1 + F.kick * 0.05) / scale;
        const cx = acc.w / 2, cyy = acc.h / 2;
        const fA = FORMS[from], fB = FORMS[to];
        const N = Math.round(p.points);
        const fu = p.weave, fv = p.weave * p.ratio * 1.003;
        const step = 0.0009 * p.beam * (0.6 + F.level * 1.4);
        const energy = 0.55 / Math.sqrt(N / 20000) * (acc.w * acc.h) / 230000;
        const sw = p.swell, nb = bumps.length;
        const sqY = 1 + squeeze * 0.45 + open * 0.25, sqXZ = 1 - squeeze * 0.35 + open * 0.55;
        for (let i = 0; i < N; i++) {
          beamT += step;
          const u = beamT * fu, v = Math.PI * (0.5 - 0.5 * Math.cos(beamT * fv));
          const b = fB(u, v);
          let x = b[0], y = b[1], z = b[2];
          if (m < 1) { const a = fA(u, v); x = a[0] + (x - a[0]) * m; y = a[1] + (y - a[1]) * m; z = a[2] + (z - a[2]) * m; }
          if (nb && sw > 0) {
            const l = Math.hypot(x, y, z) || 1, nx = x / l, ny = y / l, nz = z / l;
            let d = 0;
            for (let k = 0; k < nb; k++) { const B = bumps[k]; const c = nx * B.d[0] + ny * B.d[1] + nz * B.d[2]; if (c > 0.3) d += B.a * B.life * Math.exp(-(1 - c) * B.sharp); }
            const f = 1 + d * sw; x *= f; y *= f; z *= f;
          }
          if (open > 0.05) { const j = open * 0.08 * Math.sin(u * 7 + time * 9); x += x * j; z += z * j; }
          x *= sqXZ; z *= sqXZ; y *= sqY;
          // rotate (yaw then pitch) and project
          const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
          const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
          const persp = 3.2 / (3.2 + z2);
          acc.splat(cx + x1 * R * persp, cyy - y2 * R * persp, energy * (0.55 + 0.45 * persp));
        }
        acc.ramp(['#000000', p.tint, p.color, '#ffffff']);
        acc.blit(ctx, W, H, p.exposure * 0.5, p.bloom);
      },
      resize() {},
      dispose() {}
    };
  }
};
