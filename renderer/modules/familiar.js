import { Accum, TAU } from './util.js';

// The creature's spine: a curling neck over a heavy body. Catmull-Rom through these points.
const SPINE = [[0.02, 0.86, 0.0], [0.1, 0.7, 0.05], [0.08, 0.5, 0.0], [0.0, 0.28, -0.04], [-0.12, 0.0, 0.0], [-0.1, -0.3, 0.05], [0.06, -0.46, 0.0], [0.22, -0.36, -0.04]];
const RADIUS = [0.07, 0.08, 0.1, 0.16, 0.3, 0.36, 0.32, 0.2];

function cr(P, t) {
  const n = P.length - 1, f = Math.min(n - 1e-6, Math.max(0, t * n)), i = Math.floor(f), u = f - i;
  const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[Math.min(n, i + 1)], p3 = P[Math.min(n, i + 2)];
  const r = [];
  for (let k = 0; k < p1.length; k++) {
    r.push(0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u));
  }
  return r;
}
function lerpR(t) {
  const n = RADIUS.length - 1, f = Math.min(n, Math.max(0, t * n)), i = Math.min(n - 1, Math.floor(f)), u = f - i;
  return RADIUS[i] * (1 - u) + RADIUS[i + 1] * u;
}
function randBall() {
  let x, y, z; do { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; } while (x * x + y * y + z * z > 1);
  return [x, y, z];
}

export default {
  id: 'familiar',
  name: 'Familiar',
  tagline: 'A body made of light.',
  params: [
    { key: 'shape', label: 'Body', type: 'select', default: 'creature', section: 'Body', options: [['creature', 'Creature'], ['orb', 'Orb'], ['text', 'Your word']] },
    { key: 'text', label: 'Word', type: 'text', default: 'SIGNAL', showIf: { shape: 'text' } },
    { key: 'count', label: 'Points of light', type: 'range', min: 5000, max: 100000, step: 1000, default: 32000 },
    { key: 'size', label: 'Size', type: 'range', min: 0.3, max: 1.6, step: 0.01, default: 1.1 },
    { key: 'breath', label: 'Breathing', type: 'range', min: 0, max: 2, step: 0.05, default: 1, section: 'Behavior' },
    { key: 'scatter', label: 'Scatter on hits', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'gather', label: 'Gathers back', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'sway', label: 'Sway', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'turn', label: 'Turning', type: 'range', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'grain', label: 'Point size', type: 'range', min: 0.5, max: 4, step: 0.05, default: 1, section: 'Light' },
    { key: 'dof', label: 'Depth of field', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'shadow', label: 'Self-shadowing', type: 'range', min: 0, max: 1, step: 0.05, default: 0.7 },
    { key: 'color', label: 'Light', type: 'color', default: '#f4f4f4' },
    { key: 'tint', label: 'Shadow tint', type: 'color', default: '#3a3a3c' },
    { key: 'exposure', label: 'Exposure', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'trail', label: 'Trails', type: 'range', min: 0, max: 0.9, step: 0.01, default: 0.2 }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    const acc = new Accum();
    let n = 0, HX, HY, HZ, HL, HS, HC, PX, PY, PZ, VX, VY, VZ, key = '', time = 0, yaw = 0;
    function build(p) {
      n = Math.round(p.count);
      HX = new Float32Array(n); HY = new Float32Array(n); HZ = new Float32Array(n); HL = new Float32Array(n);
      HS = new Float32Array(n); HC = new Float32Array(n);   // sin/cos of each point's sway phase, so the frame loop needs no trig
      PX = new Float32Array(n); PY = new Float32Array(n); PZ = new Float32Array(n);
      VX = new Float32Array(n); VY = new Float32Array(n); VZ = new Float32Array(n);
      let pts = null;
      if (p.shape === 'text') {
        const c = document.createElement('canvas'); c.width = 600; c.height = 200;
        const g = c.getContext('2d');
        const txt = (p.text || ' ').slice(0, 16);
        let fs = 170; g.font = `900 ${fs}px system-ui, sans-serif`;
        const w = g.measureText(txt).width; if (w > 560) fs *= 560 / w;
        g.font = `900 ${fs}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
        g.fillText(txt, 300, 104);
        const d = g.getImageData(0, 0, 600, 200).data;
        pts = [];
        for (let y = 0; y < 200; y += 2) for (let x = 0; x < 600; x += 2) if (d[(y * 600 + x) * 4 + 3] > 128) pts.push([(x - 300) / 300, -(y - 100) / 300]);
        if (!pts.length) pts = [[0, 0]];
      }
      const light = [0.5, 0.7, 0.5];
      for (let i = 0; i < n; i++) {
        let x, y, z, lit;
        if (p.shape === 'orb') {
          const b = randBall(), r = 0.55 * Math.pow(Math.random(), 0.35);
          const l = Math.hypot(...b) || 1; x = b[0] / l * r; y = b[1] / l * r; z = b[2] / l * r;
          lit = (x * light[0] + y * light[1] + z * light[2]) / 0.55;
        } else if (p.shape === 'text') {
          const q = pts[(Math.random() * pts.length) | 0];
          x = q[0] + (Math.random() - 0.5) * 0.008; y = q[1] + (Math.random() - 0.5) * 0.008; z = (Math.random() - 0.5) * 0.04;
          lit = z * 6 + (x + y) * 0.4;
        } else {
          // sample the body by volume: thicker sections get more points
          let t; do { t = Math.random(); } while (Math.random() > Math.pow(lerpR(t) / 0.27, 1.6));
          const c = cr(SPINE, t), r = lerpR(t), b = randBall(), k = Math.pow(Math.random(), 0.5);
          x = c[0] + b[0] * r * k; y = c[1] + b[1] * r * k; z = c[2] + b[2] * r * k;
          lit = (b[0] * light[0] + b[1] * light[1] + b[2] * light[2]) * k;
        }
        HX[i] = x; HY[i] = y; HZ[i] = z; HL[i] = Math.max(-1, Math.min(1, lit)); HS[i] = Math.sin(y * 3.2); HC[i] = Math.cos(y * 3.2);
        PX[i] = x + (Math.random() - 0.5); PY[i] = y + (Math.random() - 0.5); PZ[i] = z;
      }
    }
    return {
      render(F, { dt, W, H, S, params: p }) {
        const k = [p.shape, p.text, Math.round(p.count)].join('|');
        if (k !== key) { key = k; build(p); }
        time += dt;
        const scale = Math.max(1, S * 1.1);
        acc.ensure(W, H, scale);
        acc.decay(p.trail * Math.pow(0.9, dt * 60));
        // breathes in silence; scatters on hits; always gathers back
        const quiet = Math.max(0, 1 - F.level * 2);
        const breathe = 1 + Math.sin(time * (1.1 + F.mid)) * 0.035 * p.breath * (0.4 + quiet);
        let kickPush = 0;
        for (const o of F.onsets) if (o.band !== 'hat') kickPush = Math.max(kickPush, o.strength * (o.band === 'kick' ? 1 : 0.6));
        if (F.drop > 0.95) kickPush = 2.2;
        const push = kickPush * p.scatter * 1.6;
        const spring = 9 * p.gather, damp = Math.exp(-dt * 3.2);
        const gatherTight = 1 - (F.build || 0) * 0.12;
        yaw = Math.sin(time * 0.23) * 0.7 * p.turn + Math.sin(time * 0.07) * 0.4 * p.turn;
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        const R = Math.min(W, H) * 0.46 * p.size / scale;
        const cx = acc.w / 2, cyy = acc.h / 2;
        const energy = 0.55 * (acc.w * acc.h) / 200000 * 45000 / n * 1.6;
        const dof = p.dof * 5, shadow = p.shadow;
        const sw = p.sway * 0.04;
        const swS = Math.sin(time * 0.9), swC = Math.cos(time * 0.9), swA = sw * (0.4 + quiet);
        for (let i = 0; i < n; i++) {
          const hy = HY[i];
          const tx = (HX[i] + (swS * HC[i] + swC * HS[i]) * swA) * breathe * gatherTight;
          const ty = hy * breathe * gatherTight;
          const tz = HZ[i] * breathe;
          let vx = VX[i] + (tx - PX[i]) * spring * dt, vy = VY[i] + (ty - PY[i]) * spring * dt, vz = VZ[i] + (tz - PZ[i]) * spring * dt;
          if (push > 0) {
            const r = (Math.random() * 0.6 + 0.4) * push;
            vx += (PX[i] + (Math.random() - 0.5) * 0.4) * r; vy += (PY[i] + (Math.random() - 0.5) * 0.4) * r; vz += (Math.random() - 0.5) * r;
          }
          vx *= damp; vy *= damp; vz *= damp;
          VX[i] = vx; VY[i] = vy; VZ[i] = vz;
          const x = (PX[i] += vx * dt), y = (PY[i] += vy * dt), z = (PZ[i] += vz * dt);
          const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
          const persp = 2.6 / (2.6 + z1);
          const lit = 1 - shadow * (0.5 - 0.5 * HL[i]);
          const blur = Math.abs(z1) * dof * R * 0.08 + (p.grain - 1) * 0.8;
          acc.splatSoft(cx + x1 * R * persp, cyy - y * R * persp, energy * lit, blur);
        }
        acc.ramp(['#000000', p.tint, p.color, '#ffffff']);
        acc.blit(ctx, W, H, p.exposure * 0.6, 0.35);
      },
      resize() {},
      dispose() {}
    };
  }
};
