import { createShader, glUnavailable } from './gl.js';
import { hexToVec, TAU } from './util.js';

// Magnetic fluid seen from above: a chain of merging black spheres (raymarched metaballs) with
// small spikes, surrounded by a spray of droplets that the hits throw off and the magnet pulls back.
const NB = 13, NS = 12, ND = 48, MAIN = 6;   // up to 6 main beads + 7 small buds
const FRAG = `
uniform vec3 uBack, uBody;
uniform float uMerge, uRim, uGloss, uZoom, uSpikeK, uDropMix;
uniform vec4 uB[${NB}];      // sphere centers (xyz) and radii
uniform vec4 uS[${NS}];      // spike base (xyz) and length
uniform vec4 uSd[${NS}];     // spike direction (xyz) and base radius
uniform vec4 uD[${ND}];      // droplets: x, y, radius, alive

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// round cone from a (radius r1) to b (radius r2), Inigo Quilez
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a; float l2 = dot(ba, ba); float rr = r1 - r2; float a2 = l2 - rr * rr; float il2 = 1.0 / l2;
  vec3 pa = p - a; float y = dot(pa, ba); float z = y - l2; vec3 xv = pa * l2 - ba * y; float x2 = dot(xv, xv);
  float y2 = y * y * l2; float z2 = z * z * l2; float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

float map(vec3 p) {
  float d = 1e3;
  for (int i = 0; i < ${NB}; i++) {
    if (uB[i].w <= 0.0) continue;
    d = smin(d, length(p - uB[i].xyz) - uB[i].w, uMerge);
  }
  for (int j = 0; j < ${NS}; j++) {
    if (uS[j].w <= 0.002) continue;
    vec3 a = uS[j].xyz, b = a + uSd[j].xyz * uS[j].w;
    d = smin(d, sdRoundCone(p, a, b, uSd[j].w, 0.0015), uSpikeK);
  }
  return d;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0008, -0.0008);
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

vec3 shade(vec3 n, vec3 back, vec3 body) {
  // a dark glossy body in a bright room: almost black facing us, the room creeping in at the rim
  float fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.2);
  float side = 0.55 + 0.45 * dot(normalize(n.xy + 1e-4), normalize(vec2(0.7, -0.7)));
  float lam = clamp(dot(n, normalize(vec3(-0.4, 0.5, 0.75))), 0.0, 1.0);
  vec3 col = body * (0.55 + 0.45 * lam);
  col = mix(col, back, fres * uRim * side * 0.75);
  col += back * pow(clamp(dot(reflect(vec3(0.0, 0.0, -1.0), n), normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0), 24.0) * 0.08 * uGloss;
  return col;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y / uZoom;
  float px = 1.0 / uRes.y / uZoom;
  vec3 back = uBack, body = uBody;
  vec3 col = back;

  // droplets: flat discs that melt into each other when they touch
  float dd = 1e3;
  for (int i = 0; i < ${ND}; i++) {
    if (uD[i].w <= 0.0) continue;
    dd = smin(dd, length(uv - uD[i].xy) - uD[i].z, 0.012 * uDropMix);
  }
  float dc = 1.0 - smoothstep(-px, px, dd);
  if (dc > 0.0) {
    float rim = smoothstep(-0.012, 0.0, dd);
    vec3 dcol = mix(body, back, rim * 0.35 * uRim);
    col = mix(col, dcol, dc);
  }

  // the body: orthographic raymarch from above, with a soft silhouette
  vec3 ro = vec3(uv, 2.0), rd = vec3(0.0, 0.0, -1.0);
  float t = 0.0, md = 1e3;
  bool hit = false;
  for (int i = 0; i < 90; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    md = min(md, d);
    if (d < 0.0004) { hit = true; break; }
    t += d;
    if (t > 4.0) break;
  }
  if (hit) {
    vec3 p = ro + rd * t;
    col = shade(calcNormal(p), back, body);
  } else {
    // antialiased edge: blend by how close the ray came to the surface
    float a = 1.0 - smoothstep(0.0, px * 1.5, md);
    col = mix(col, mix(body, back, 0.55 * uRim), a);
  }
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}`;

export default {
  id: 'ferro',
  name: 'Ferro',
  tagline: 'Reactive magnetic fluid simulation.',
  params: [
    { key: 'blobs', label: 'Body segments', type: 'range', min: 1, max: MAIN, step: 1, default: 4, section: 'Body' },
    { key: 'buds', label: 'Buds', type: 'range', min: 0, max: NB - MAIN, step: 1, default: 5 },
    { key: 'size', label: 'Body size', type: 'range', min: 0.4, max: 1.6, step: 0.01, default: 1 },
    { key: 'merge', label: 'Merging', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'beads', label: 'Uneven beads', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
    { key: 'turb', label: 'Turbulence', type: 'range', min: 0, max: 2, step: 0.05, default: 0.8 },
    { key: 'drift', label: 'Drift and turn', type: 'range', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'snap', label: 'Snap into a sphere', type: 'select', default: 'hits', options: [['hits', 'On heavy hits and drops'], ['drops', 'Only on drops'], ['never', 'Never']] },
    { key: 'spikes', label: 'Spikes', type: 'range', min: 0, max: 2, step: 0.05, default: 1, section: 'Spikes and spray' },
    { key: 'spray', label: 'Droplets', type: 'range', min: 0, max: ND, step: 1, default: 40 },
    { key: 'fling', label: 'Fling on hits', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'pull', label: 'Magnetic pull', type: 'range', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'back', label: 'Background', type: 'color', default: '#eeeef3', section: 'Light' },
    { key: 'body', label: 'Fluid', type: 'color', default: '#050506' },
    { key: 'rim', label: 'Rim light', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'gloss', label: 'Gloss', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'zoom', label: 'Zoom', type: 'range', min: 0.5, max: 2, step: 0.01, default: 1 },
    { key: 'speed', label: 'Motion speed', type: 'range', min: 0, max: 3, step: 0.05, default: 1 }
  ],
  create(canvas) {
    let s;
    try { s = createShader(canvas, FRAG); } catch (e) { s = null; }
    if (!s) return glUnavailable(canvas);
    let time = 0, axis = -0.85, merged = 0.3, sphere = 0, lastSnap = -9, kick = 0;
    const seg = Array.from({ length: MAIN }, (_, i) => ({ ph: i * 1.7, k: [1.15, 0.85, 1.05, 0.78, 0.95, 0.88][i] }));
    const buds = Array.from({ length: NB - MAIN }, (_, i) => ({ seg: i % MAIN, a: i * 2.1, z: 0.3 + (i % 3) * 0.2, s: 0, ph: i * 0.9 }));
    const spikes = Array.from({ length: NS }, (_, i) => ({ seg: i % NB, a: (i * 2.399) % TAU, len: 0, el: ((i * 7) % 5) / 20 - 0.1 }));
    const drops = Array.from({ length: ND }, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 0, alive: 0 }));
    const B = new Float32Array(NB * 4), SP = new Float32Array(NS * 4), SD = new Float32Array(NS * 4), D = new Float32Array(ND * 4);
    let seeded = false;
    function seedDrops(cx, cy, n) {
      for (let i = 0; i < ND; i++) {
        const d = drops[i];
        const a = Math.random() * TAU, rr = 0.2 + Math.random() * 0.3;
        d.x = cx + Math.cos(a) * rr; d.y = cy + Math.sin(a) * rr * 0.9; d.vx = d.vy = 0;
        d.r = 0.0018 + Math.pow(Math.random(), 4) * 0.02; d.alive = i < n ? 1 : 0;
      }
    }
    function fling(centers, strength, count) {
      for (let c = 0; c < count; c++) {
        // recycle the smallest or farthest droplet
        let best = 0, score = -1;
        for (let i = 0; i < ND; i++) { const d = drops[i]; const sc = !d.alive ? 9 : Math.hypot(d.x, d.y) - d.r * 20; if (sc > score) { score = sc; best = i; } }
        const d = drops[best], src = centers[(Math.random() * centers.length) | 0];
        const a = Math.random() * TAU;
        d.x = src[0] + Math.cos(a) * src[2] * 0.95; d.y = src[1] + Math.sin(a) * src[2] * 0.95;
        const v = (0.25 + Math.random() * 0.55) * strength;
        d.vx = Math.cos(a) * v; d.vy = Math.sin(a) * v;
        d.r = 0.0018 + Math.pow(Math.random(), 3.5) * 0.02; d.alive = 1;
      }
    }
    return {
      render(F, { dt, params: p }) {
        dt = Math.max(0, Math.min(0.1, dt));
        const sp = p.speed;
        time += dt * sp;
        kick = Math.max(kick * Math.exp(-dt / 0.15), F.kick);
        // the beads swell and fuse on the beat, then part again
        merged += ((p.merge * 0.6 + kick * 0.7 + F.bass * 0.3) - merged) * (1 - Math.exp(-dt / (kick > merged ? 0.05 : 0.35)));
        // heavy hits and drops pull everything into one round drop for a moment
        const heavy = p.snap === 'hits' && F.onsets.some((o) => o.band === 'kick' && o.strength > 0.97);
        if ((heavy || (p.snap !== 'never' && F.drop > 0.95)) && time - lastSnap > 4) { lastSnap = time; sphere = 1; }
        sphere *= Math.exp(-dt / 0.4);
        const sph = sphere * sphere * (3 - 2 * sphere);
        axis += dt * p.drift * 0.08 * Math.sin(time * 0.13);

        const n = Math.round(p.blobs), size = p.size * (1 - F.build * 0.25);
        const ax = Math.cos(axis), ay = Math.sin(axis), nx = -ay, ny = ax;
        const len = 0.25 * size * (1 - merged * 0.12);
        const cx0 = Math.sin(time * 0.11) * 0.03 * p.drift, cy0 = Math.cos(time * 0.09) * 0.03 * p.drift;
        const centers = [];
        for (let i = 0; i < MAIN; i++) {
          if (i >= n) { B[i * 4 + 3] = 0; continue; }
          const g = seg[i], t = n === 1 ? 0 : i / (n - 1) - 0.5;
          const wob = p.turb * 0.03 * Math.sin(time * 1.3 + g.ph) * (1 + F.mid);
          let x = cx0 + ax * t * len * 2 + nx * (wob + Math.sin(time * 0.7 + g.ph) * 0.03 * p.turb);
          let y = cy0 + ay * t * len * 2 + ny * (wob + Math.cos(time * 0.6 + g.ph) * 0.03 * p.turb);
          const band = F.bands[Math.min(F.bands.length - 1, 4 + i * 9)] || 0;
          const bead = 1 + p.beads * (g.k - 1) * 1.6 + band * 0.15 * p.beads;
          let r = size * (0.12 + merged * 0.03) * bead * (n === 1 ? 2 : 1);
          // collapse into one sphere
          x += (cx0 - x) * sph; y += (cy0 - y) * sph; r += (size * 0.3 - r) * sph;
          B[i * 4] = x; B[i * 4 + 1] = y; B[i * 4 + 2] = 0; B[i * 4 + 3] = r;
          centers.push([x, y, r]);
        }
        // buds: small spheres budding from the beads, swelling with the mids and snares
        for (let j = 0; j < NB - MAIN; j++) {
          const b = buds[j], idx = (MAIN + j) * 4;
          if (j >= p.buds || !centers.length) { B[idx + 3] = 0; continue; }
          const c = centers[b.seg % centers.length];
          b.a += dt * 0.15 * Math.sin(time * 0.3 + b.ph);
          b.s += ((0.35 + F.mid * 0.4 + F.snare * 0.4) - b.s) * (1 - Math.exp(-dt / 0.2));
          const rb = c[2] * (0.32 + 0.12 * Math.sin(time * 1.1 + b.ph)) * b.s * 1.6 * (1 - sph);
          const ca = Math.cos(b.a), sa = Math.sin(b.a), zz = b.z;
          const off = c[2] * 0.92;
          B[idx] = c[0] + ca * off * Math.sqrt(1 - zz * zz); B[idx + 1] = c[1] + sa * off * Math.sqrt(1 - zz * zz); B[idx + 2] = zz * off; B[idx + 3] = rb;
        }
        // spikes stand up on hits, mostly hats and snares; a build sucks them in
        const hit = F.onsets.reduce((m, o) => Math.max(m, o.band === 'kick' ? o.strength * 0.5 : o.strength), 0);
        for (let j = 0; j < NS; j++) {
          const k = spikes[j];
          if (hit > 0.3 && Math.random() < 0.35) { k.len = Math.max(k.len, (0.02 + Math.random() * 0.035) * hit); k.a = Math.random() * TAU; k.seg = (Math.random() * n) | 0; }
          k.len *= Math.exp(-dt / 0.35);
          const base = Math.max(k.len, 0.014 + 0.008 * Math.sin(time * 2 + j)) * p.spikes * (1 - F.build * 0.8);
          const c = centers[Math.min(k.seg, centers.length - 1)];
          const dx = Math.cos(k.a), dy = Math.sin(k.a), dz = k.el, l = Math.hypot(dx, dy, dz);
          const ux = dx / l, uy = dy / l, uz = dz / l;
          SP[j * 4] = c[0] + ux * c[2] * 0.9; SP[j * 4 + 1] = c[1] + uy * c[2] * 0.9; SP[j * 4 + 2] = uz * c[2] * 0.9; SP[j * 4 + 3] = p.spikes > 0 ? base * size : 0;
          SD[j * 4] = ux; SD[j * 4 + 1] = uy; SD[j * 4 + 2] = uz; SD[j * 4 + 3] = 0.009 * size;
        }
        // droplets: thrown off by hits, slowed by drag, pulled back by the magnet, absorbed on contact
        if (!seeded) { seedDrops(cx0, cy0, Math.round(p.spray)); seeded = true; }
        const nd = Math.round(p.spray);
        let throwN = 0;
        for (const o of F.onsets) throwN += o.band === 'kick' ? 3 : o.band === 'snare' ? 2 : 0;
        if (F.drop > 0.95) throwN += 14;
        if (throwN && p.fling > 0 && nd > 0) fling(centers, p.fling * (1 + F.drop), Math.min(throwN, 16));
        for (let i = 0; i < ND; i++) {
          const d = drops[i];
          if (i >= nd) { d.alive = 0; }
          if (!d.alive) { D[i * 4 + 3] = 0; continue; }
          const dx = cx0 - d.x, dy = cy0 - d.y, dist = Math.hypot(dx, dy) + 1e-4;
          const pull = p.pull * 0.08 * (1 + F.build * 2) / (0.15 + dist);
          d.vx = (d.vx + dx / dist * pull * dt) * Math.exp(-dt * 2.5);
          d.vy = (d.vy + dy / dist * pull * dt) * Math.exp(-dt * 2.5);
          d.x += d.vx * dt * sp + Math.sin(time * 0.8 + i) * 0.0004 * p.turb;
          d.y += d.vy * dt * sp + Math.cos(time * 0.7 + i * 1.3) * 0.0004 * p.turb;
          // touched the body: absorbed, reborn later by a fling
          for (const c of centers) if (Math.hypot(d.x - c[0], d.y - c[1]) < c[2] * 0.85) { d.alive = 0; break; }
          if (Math.abs(d.x) > 1.2 || Math.abs(d.y) > 0.7) d.alive = 0;
          D[i * 4] = d.x; D[i * 4 + 1] = d.y; D[i * 4 + 2] = d.r * (1 + F.hat * 0.2); D[i * 4 + 3] = d.alive;
        }
        // keep the spray topped up so the stage never looks empty
        const alive = drops.slice(0, nd).filter((d) => d.alive).length;
        if (alive < nd * 0.6 && centers.length) fling(centers, 0.5, 1);

        s.audio(F);
        s.set('uT', time);
        s.set('uBack', hexToVec(p.back)); s.set('uBody', hexToVec(p.body));
        s.set('uMerge', 0.012 + merged * 0.045 + sph * 0.05); s.set('uSpikeK', 0.012);
        s.set('uRim', p.rim); s.set('uGloss', p.gloss); s.set('uZoom', p.zoom); s.set('uDropMix', 1);
        s.setv4('uB', B); s.setv4('uS', SP); s.setv4('uSd', SD); s.setv4('uD', D);
        s.draw();
      },
      resize() {},
      dispose() { s.dispose(); }
    };
  }
};
