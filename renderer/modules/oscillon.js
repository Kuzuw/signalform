import { Accum, TAU } from './util.js';
import { tracePicture, loadPicture, pictureGray } from './picture-trace.js';

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
    { key: 'form', label: 'Form', type: 'select', default: 'auto', section: 'Shape', options: [['auto', 'Changes with the music'], ...NAMES.map((n) => [n, LABEL[n]]), ['picture', 'Your picture']] },
    { key: 'loadPicture', label: 'Choose a picture…', type: 'action', showIf: { form: 'picture' } },
    { key: 'picture', type: 'hidden', default: null },
    { key: 'picEdges', label: 'Edge detail', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45, showIf: { form: 'picture' } },
    { key: 'picShade', label: 'Shade dark areas', type: 'range', min: 0, max: 1, step: 0.01, default: 0, showIf: { form: 'picture' } },
    { key: 'picInvert', label: 'Light subject on dark', type: 'toggle', default: false, showIf: { form: 'picture' } },
    { key: 'picTilt', label: 'Sway in 3D', type: 'range', min: 0, max: 1.5, step: 0.01, default: 0.5, showIf: { form: 'picture' } },
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
    // picture form: the traced path, rebuilt only when the picture or its settings change
    const pic = { key: '', path: null, busy: false, error: '', gray: null, src: '', pos: 0 };
    function picturePath(p) {
      if (!p.picture) return null;
      if (pic.src !== p.picture) {
        if (!pic.busy) {
          pic.busy = true;
          const src = p.picture;
          pictureGray(src).then((g) => { pic.gray = g; pic.error = ''; }).catch((e) => { pic.gray = null; pic.error = e.message; }).finally(() => { pic.src = src; pic.key = ''; pic.busy = false; });
        }
        return pic.path;
      }
      const key = [p.picEdges, p.picShade, p.picInvert].join('|');
      if (key === pic.key) return pic.path;
      pic.key = key; pic.path = null;
      if (!pic.gray) return null;
      const { gray, w, h } = pic.gray;
      const t = tracePicture(p.picInvert ? gray.map((v) => 1 - v) : gray, w, h, { detail: 6000, edges: p.picEdges, shade: p.picShade });
      if (!t.count) { pic.error = 'No lines found in this picture. Try more edge detail.'; return null; }
      pic.path = t;
      return t;
    }
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
        const usePic = p.form === 'picture';
        const form = usePic ? 'cushion' : FORMS[p.form] ? p.form : LEGACY[p.form] || 'auto';
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
        // bump centres as unit vectors on both angles, so the inner loop needs no trig per bump:
        // 2 - 2cos(du) + 2 - 2cos(da) stands in for du² + da²
        const bcu = new Float32Array(nb), bsu = new Float32Array(nb), bca = new Float32Array(nb), bsa = new Float32Array(nb), bk = new Float32Array(nb), bi = new Float32Array(nb);
        for (let j = 0; j < nb; j++) { const B = bumps[j]; bcu[j] = Math.cos(B.u); bsu[j] = Math.sin(B.u); bca[j] = Math.cos(B.a); bsa[j] = Math.sin(B.a); bk[j] = B.amp * B.grow * B.life; bi[j] = 2 / (B.w * B.w); }
        if (usePic) {
          const P = picturePath(p);
          if (P) {
            // the beam runs along the traced picture; the picture sways in 3D and every sound swells it outwards
            const pts = P.pts, n = P.count;
            const tl = p.picTilt, tilt = Math.sin(time * 0.37) * 0.5 * tl, tipY = Math.sin(time * 0.23) * 0.35 * tl;
            const ct = Math.cos(tilt + yaw * 0.15 * tl), st = Math.sin(tilt + yaw * 0.15 * tl), cq = Math.cos(tipY), sq = Math.sin(tipY);
            const adv = n * dt * 2.2 * p.beam * (0.6 + F.level);
            const per = n / N;
            const grow = 1 + open * 0.35 - squeeze * 0.25;
            for (let i = 0; i < N; i++) {
              const f = (pic.pos + i * per) % n, j = f | 0, j2 = (j + 1) % n, fr = f - j;
              const o = j * 3, o2 = j2 * 3;
              let x, y;
              if (pts[o2 + 2]) { x = pts[o]; y = pts[o + 1]; }   // blanked jump: stay on the stroke's last point
              else { x = pts[o] + (pts[o2] - pts[o]) * fr; y = pts[o + 1] + (pts[o2 + 1] - pts[o + 1]) * fr; }
              let z = 0;
              if (nb && sw > 0) {
                for (let q = 0; q < nb; q++) {
                  const dx = x - bcu[q] * 0.7, dy = y - bsa[q] * 0.7, d2 = (dx * dx + dy * dy) * bi[q] * 2;
                  if (d2 < 9) z += bk[q] * Math.exp(-d2);
                }
                z *= sw;
              }
              if (wob > 0) z += wob * Math.sin(x * 4 + time * 1.7) * Math.cos(y * 3 - time * 1.3);
              const sx2 = x * grow * (1 + z * 0.6), sy2 = y * grow * (1 + z * 0.6);
              // sway: turn around the vertical axis, then tip around the horizontal one
              const x1 = sx2 * ct + z * st, z1 = -sx2 * st + z * ct;
              const y2 = sy2 * cq - z1 * sq, z2 = sy2 * sq + z1 * cq;
              const persp = 3.4 / (3.4 + z2);
              acc.splat(cx + x1 * R0 * 1.25 * persp + (Math.random() - 0.5) * 1.2, cyy + y2 * R0 * 1.25 * persp + (Math.random() - 0.5) * 1.2, energy * (1 + fuzz * (Math.random() - 0.5)));
            }
            pic.pos = (pic.pos + adv) % n;
          } else {
            ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = p.color; ctx.font = `${13 * S}px system-ui, sans-serif`; ctx.textAlign = 'center';
            ctx.fillText(pic.busy ? 'Tracing the picture…' : pic.error || 'Choose a picture in the panel on the right.', W / 2, H / 2);
            return;
          }
        }
        // the beam angles advance by a fixed step, so their sines and cosines are rotated forward
        // instead of recomputed (re-anchored every 256 samples to keep the error tiny)
        const cdu = Math.cos(step * fu), sdu = Math.sin(step * fu), cda = Math.cos(step * fa), sda = Math.sin(step * fa);
        const cP = Math.cos(time * 1.7), sP = Math.sin(time * 1.7), cQ = Math.cos(time * 1.3), sQ = Math.sin(time * 1.3);
        let cu = 1, su = 0, ca = 1, sa = 0;
        for (let i = 0; i < (usePic ? 0 : N); i++) {
          beamT += step;
          const u = beamT * fu, a = beamT * fa;
          if ((i & 255) === 0) { cu = Math.cos(u); su = Math.sin(u); ca = Math.cos(a); sa = Math.sin(a); }
          else { const c1 = cu * cdu - su * sdu; su = su * cdu + cu * sdu; cu = c1; const c2 = ca * cda - sa * sda; sa = sa * cda + ca * sda; ca = c2; }
          let Rm = R * (lobe > 0.002 ? 1 + lobe * Math.cos(k * u) : 1) * sqA;
          let rt = r * tubeOpen;
          if (wob > 0) {
            // sin(3u + 1.7t) · cos(2a − 1.3t) from the multiple-angle formulas
            const s3 = su * (3 - 4 * su * su), c3 = cu * (4 * cu * cu - 3), c2a = 2 * ca * ca - 1, s2a = 2 * sa * ca;
            rt *= 1 + wob * (s3 * cP + c3 * sP) * (c2a * cQ + s2a * sQ);
          }
          if (nb && sw > 0) {
            // swellings: gaussian bumps on the (u, a) surface that grow in fast and sink slowly
            let d = 0;
            for (let j = 0; j < nb; j++) {
              const q = (4 - 2 * (cu * bcu[j] + su * bsu[j]) - 2 * (ca * bca[j] + sa * bsa[j])) * bi[j] * 0.5;
              if (q < 9) d += bk[j] * Math.exp(-q);
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
      action(key, p, done) {
        if (key !== 'loadPicture') return;
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml';
        input.onchange = async () => {
          const f = input.files && input.files[0];
          if (!f) return;
          try { p.picture = await loadPicture(f); p.form = 'picture'; pic.error = ''; } catch (e) { pic.error = e.message; }
          if (done) done();
        };
        input.click();
      },
      resize() {},
      dispose() {}
    };
  }
};
