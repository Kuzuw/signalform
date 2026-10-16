import { Accum, TAU } from './util.js';

// The beam traces a family of tori: ring, horn and spindle tori, some with lobed (trefoil) cores,
// each seen from its own angle. Where the translucent surface folds towards the viewer the samples
// pile up into bright caustic cusps, which is what gives the shell its glow.
//   R: center circle, r: tube, k/m: lobes and depth, sx/sy: stretch, pitch: view tilt (π/2 = from above)
const FORMS = {
  cushion: { R: 0.5, r: 0.5, k: 0, m: 0, sx: 1.18, sy: 0.9, pitch: 1.2 },
  pebble: { R: 0.33, r: 0.67, k: 0, m: 0, sx: 1.12, sy: 1, pitch: 1.05 },
  peanut: { R: 0.62, r: 0.38, k: 0, m: 0, sx: 1.3, sy: 1, pitch: 0.28 },
  trefoil: { R: 0.52, r: 0.48, k: 3, m: 0.16, sx: 1, sy: 1, pitch: 1.5 },
  apple: { R: 0.28, r: 0.72, k: 0, m: 0, sx: 1.08, sy: 0.92, pitch: 0.16 },
  ring: { R: 0.66, r: 0.34, k: 0, m: 0, sx: 1.1, sy: 1, pitch: 0.75 },
  clover: { R: 0.55, r: 0.45, k: 2, m: 0.2, sx: 1.05, sy: 1, pitch: 1.4 },
  orb: { R: 0.08, r: 0.92, k: 0, m: 0, sx: 1, sy: 1, pitch: 0.6 }
};
const NAMES = Object.keys(FORMS);
// forms from versions before 1.3, so old scenes and presets still open
const LEGACY = { sphere: 'orb', spindle: 'pebble', torus: 'ring', shell: 'apple', bell: 'cushion', knot: 'clover' };
const KEYS = ['R', 'r', 'k', 'm', 'sx', 'sy', 'pitch'];
const LABEL = { cushion: 'Cushion', pebble: 'Pebble', peanut: 'Peanut', trefoil: 'Trefoil', apple: 'Apple', ring: 'Ring', clover: 'Clover', orb: 'Orb' };

export default {
  id: 'oscillon',
  name: 'Oscillon',
  tagline: 'A shell drawn by a phosphor beam.',
  params: [
    { key: 'form', label: 'Form', type: 'select', default: 'auto', section: 'Shape', options: [['auto', 'Changes with the music'], ...NAMES.map((n) => [n, LABEL[n]])] },
    { key: 'snap', label: 'Snap to a new form', type: 'select', default: 'hits', showIf: { form: 'auto' }, options: [['hits', 'On heavy hits and drops'], ['drops', 'Only on drops'], ['never', 'Never']] },
    { key: 'snapSpeed', label: 'Snap speed', type: 'range', min: 0.5, max: 10, step: 0.1, default: 5, showIf: { form: 'auto' } },
    { key: 'scale', label: 'Scale', type: 'range', min: 0.3, max: 1.6, step: 0.01, default: 1 },
    { key: 'swell', label: 'Swelling from sounds', type: 'range', min: 0, max: 2.5, step: 0.05, default: 1 },
    { key: 'buildDrop', label: 'Squeeze on build, open on drop', type: 'toggle', default: true },
    { key: 'wobble', label: 'Wobble', type: 'range', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'fray', label: 'Frayed surface', type: 'range', min: 0, max: 2, step: 0.05, default: 0.5 },
    { key: 'points', label: 'Beam samples per frame', type: 'range', min: 8000, max: 120000, step: 1000, default: 32000, section: 'Beam' },
    { key: 'weave', label: 'Beam weave', type: 'range', min: 3, max: 160, step: 1, default: 23 },
    { key: 'ratio', label: 'Weave ratio', type: 'range', min: 0.2, max: 1.5, step: 0.001, default: 0.618 },
    { key: 'beam', label: 'Beam speed', type: 'range', min: 0.1, max: 3, step: 0.05, default: 1 },
    { key: 'persist', label: 'Phosphor persistence', type: 'range', min: 0, max: 0.97, step: 0.01, default: 0.7 },
    { key: 'spin', label: 'Rotation', type: 'range', min: -2, max: 2, step: 0.05, default: 0.25 },
    { key: 'color', label: 'Phosphor', type: 'color', default: '#f2f2f2', section: 'Light' },
    { key: 'tint', label: 'Shadow tint', type: 'color', default: '#3c3c40' },
    { key: 'exposure', label: 'Exposure', type: 'range', min: 0.2, max: 4, step: 0.05, default: 1.15 },
    { key: 'bloom', label: 'Bloom', type: 'range', min: 0, max: 2, step: 0.05, default: 0.9 }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    const acc = new Accum();
    const cur = { ...FORMS.cushion }, from = { ...FORMS.cushion };
    let to = { ...FORMS.cushion }, toName = 'cushion', fixed = null;
    let beamT = 0, yaw = 0.4, morph = 1, lastSnap = -9, open = 0, squeeze = 0, time = 0, kick = 0;
    const bumps = [];
    function snapTo(name, jitter) {
      Object.assign(from, cur);
      to = { ...FORMS[name] };
      if (jitter) {                                   // every snap is a fresh variant of the form
        to.pitch += (Math.random() - 0.5) * 0.5;
        to.sx *= 0.9 + Math.random() * 0.2;
        to.yawKick = (Math.random() - 0.5) * 2.4;
      }
      toName = name; morph = 0;
    }
    return {
      render(F, { dt, W, H, S, params: p }) {
        dt = Math.max(0, dt);
        time += dt;
        const scale = Math.max(1, S * 0.9);
        acc.ensure(W, H, scale);
        acc.decay(Math.pow(p.persist, dt * 60));

        // ---- form: fixed, or snapped by heavy hits and drops
        const form = FORMS[p.form] ? p.form : LEGACY[p.form] || 'auto';
        if (form !== 'auto') { if (fixed !== form) { fixed = form; snapTo(form, false); } }
        else {
          fixed = null;
          const heavy = p.snap === 'hits' && F.onsets.some((o) => o.band === 'kick' && o.strength > 0.8);
          const drop = p.snap !== 'never' && F.drop > 0.95;
          if ((heavy || drop) && time - lastSnap > (drop ? 0.4 : 1.2)) {
            lastSnap = time;
            let n; do { n = NAMES[(Math.random() * NAMES.length) | 0]; } while (n === toName);
            snapTo(n, true);
            if (to.yawKick) yaw += to.yawKick;
          }
        }
        morph = Math.min(1, morph + dt * (form === 'auto' ? p.snapSpeed : 2));
        const m = 1 - Math.pow(1 - morph, 3);                // snaps fast, settles softly
        for (const k of KEYS) cur[k] = from[k] + (to[k] - from[k]) * m;

        // ---- every sound leaves a swelling where it lands on the surface
        for (const o of F.onsets) {
          if (bumps.length > 14) bumps.shift();
          bumps.push({ u: Math.random() * TAU, a: Math.random() * TAU, amp: o.strength * (o.band === 'kick' ? 0.42 : o.band === 'snare' ? 0.3 : 0.14), w: o.band === 'kick' ? 0.9 : o.band === 'snare' ? 0.55 : 0.3, life: 1, grow: 0 });
        }
        for (let i = bumps.length - 1; i >= 0; i--) { const b = bumps[i]; b.grow = Math.min(1, b.grow + dt * 12); b.life -= dt * 0.9; if (b.life <= 0) bumps.splice(i, 1); }

        // ---- squeeze through a build, throw itself open on the drop
        squeeze += ((p.buildDrop ? F.build : 0) - squeeze) * (1 - Math.exp(-dt / 0.25));
        open = Math.max(open * Math.exp(-dt * 1.6), p.buildDrop ? F.drop : 0);
        kick = Math.max(kick * Math.exp(-dt / 0.12), F.kick);
        yaw += dt * p.spin * (0.6 + F.mid * 1.2 + open * 4);

        const cp = Math.cos(cur.pitch), sp = Math.sin(cur.pitch), cyw = Math.cos(yaw), syw = Math.sin(yaw);
        const R0 = Math.min(W, H) * 0.34 * p.scale * (1 + kick * 0.05 + open * 0.35 - squeeze * 0.22) / scale;
        const cx = acc.w / 2, cyy = acc.h / 2;
        const N = Math.round(p.points);
        const fu = p.weave, fa = p.weave * p.ratio * 1.003;
        const step = 0.0006 * p.beam * (0.7 + F.level);
        const energy = 0.42 / Math.sqrt(N / 20000) * (acc.w * acc.h) / 230000;
        const { R, r, k, m: lobe, sx, sy } = cur;
        const ext = 1 / (R + r);
        const sqA = 1 - squeeze * 0.4 + open * 0.15, sqB = 1 + squeeze * 0.3;   // squeeze: pinch the ring, stretch the axis
        const tubeOpen = 1 + open * 0.9;                                        // the drop blows the tube wide open
        const wob = p.wobble * (0.04 + F.mid * 0.08), sw = p.swell, nb = bumps.length, fuzz = p.fray * (0.05 + F.high * 0.1);
        for (let i = 0; i < N; i++) {
          beamT += step;
          const u = beamT * fu, a = beamT * fa;
          const cu = Math.cos(u), su = Math.sin(u), ca = Math.cos(a), sa = Math.sin(a);
          let Rm = R * (1 + lobe * Math.cos(k * u)) * sqA;
          let rt = r * tubeOpen;
          if (wob > 0) rt *= 1 + wob * Math.sin(u * 3 + time * 1.7) * Math.cos(a * 2 - time * 1.3);
          if (nb && sw > 0) {
            // swellings: gaussian bumps on the (u, a) surface that grow in fast and sink slowly
            let d = 0;
            for (let j = 0; j < nb; j++) {
              const B = bumps[j];
              const du = Math.atan2(Math.sin(u - B.u), Math.cos(u - B.u)), da = Math.atan2(Math.sin(a - B.a), Math.cos(a - B.a));
              const q = (du * du + da * da) / (B.w * B.w);
              if (q < 9) d += B.amp * B.grow * B.life * Math.exp(-q);
            }
            rt *= 1 + d * sw;
          }
          rt *= 1 + fuzz * (Math.random() - 0.5);                                  // a slightly frayed, living surface
          const rr = Rm + rt * ca;
          let x = rr * cu * sx * ext, z = rr * su * ext, y = rt * sa * sy * sqB * ext;
          // spin around the form's axis, then tilt towards the viewer
          const x1 = x * cyw - z * syw, z1 = x * syw + z * cyw;
          const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
          const persp = 3.4 / (3.4 + z2);
          acc.splat(cx + x1 * R0 * persp + (Math.random() - 0.5) * 1.2, cyy - y2 * R0 * persp + (Math.random() - 0.5) * 1.2, energy * (0.6 + 0.4 * persp));   // a little jitter melts the weave into a smooth glow
        }
        acc.ramp(['#000000', p.tint, p.color, '#ffffff']);
        acc.blit(ctx, W, H, p.exposure * 0.5 * (1 + open * 0.4), p.bloom);
      },
      resize() {},
      dispose() {}
    };
  }
};
