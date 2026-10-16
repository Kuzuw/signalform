import { createShader, glUnavailable } from './gl.js';
import { hexToVec } from './util.js';

// A pool of ferrofluid on a studio floor, raymarched in 3D.
// The body is a height field (dome + floor) smoothly joined with a lattice of cones (the spikes)
// and a few satellite droplets. Black glossy material lit only by reflections of softboxes.
const FRAG = `
uniform vec3 uTint, uRimCol, uBack;
uniform float uBody, uDomeH, uSpikeH, uCell, uSharp, uWobble, uArr, uPattern, uIrreg, uTwist;
uniform float uCamEl, uCamAz, uZoom, uGloss, uRim, uLightA, uFloor, uExpo;
uniform float uBass, uMid, uHigh, uKick, uDrop, uBuild;
uniform float uRipT, uRipA, uDrops;
uniform int uSteps;
uniform vec2 uMag;
uniform vec4 uDrop0, uDrop1, uDrop2, uDrop3, uDrop4, uDrop5;

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

float domeH(vec2 q) {
  float w = uWobble * 0.16 * (vnoise(q * 1.1 + uT * 0.23) + 0.5 * vnoise(q * 2.3 - uT * 0.37 + 4.0));
  float r = length(q) / uBody * (1.0 + w);
  float k = max(0.0, 1.0 - r * r);
  return uDomeH * uBody * pow(k, 0.75);
}

// nearest spike cell: returns center (in the lattice frame) and its local offset
vec2 cellCenter(vec2 q) {
  if (uArr < 0.5) {
    vec2 s = vec2(1.0, 1.7320508) * uCell;
    vec2 a = mod(q, s) - s * 0.5;
    vec2 b = mod(q - s * 0.5, s) - s * 0.5;
    vec2 o = dot(a, a) < dot(b, b) ? a : b;
    return q - o;
  }
  // concentric rings, about six more spikes per ring
  float r = length(q);
  float k = floor(r / uCell + 0.5);
  if (k < 0.5) return vec2(0.0);
  float n = floor(6.2831853 * k + 0.5);
  float a = atan(q.y, q.x) + k * 0.37;
  float ai = floor(a / 6.2831853 * n + 0.5) / n * 6.2831853 - k * 0.37;
  return vec2(cos(ai), sin(ai)) * k * uCell;
}

float spikes(vec3 p) {
  vec2 q = rot(uTwist) * p.xz;
  vec2 c = cellCenter(q);
  vec2 cw = rot(-uTwist) * c;                       // cell center in world space
  float rn = hash(floor(c / uCell * 2.0 + 0.5) + 3.1);
  float rr = length(cw) / uBody;
  float env = 1.0 - smoothstep(0.0, 0.95, length(cw - uMag) / uBody);
  env = env * env * (3.0 - 2.0 * env);
  float drive = 1.0;
  if (uPattern > 0.5 && uPattern < 1.5) drive = 0.3 + 2.4 * spec(0.04 + rr * 0.7);
  else if (uPattern > 1.5) drive = 0.45 + uRipA * 1.6 * exp(-pow((rr - uRipT * 0.9) / 0.22, 2.0));
  float h = uSpikeH * uBody * env * drive * (1.0 - uIrreg * 0.75 * rn);
  if (h < 0.004) return 1e3;
  float base = domeH(cw);
  float rb = uCell * mix(0.47, 0.3, uSharp) * (0.9 + 0.1 * env);
  float tip = uCell * mix(0.07, 0.006, uSharp);
  vec2 v = vec2(length(q - c), p.y - (base + h));
  vec2 sl = normalize(vec2(rb, -h)), nn = normalize(vec2(h, rb));
  float d = dot(v, sl) < 0.0 ? length(v) : dot(v, nn);
  d = max(d, -(v.y + h + uCell * 0.6));
  return d - tip;
}

float droplets(vec3 p) {
  float d = 1e3;
  vec4 D[6] = vec4[6](uDrop0, uDrop1, uDrop2, uDrop3, uDrop4, uDrop5);
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uDrops) break;
    vec3 c = vec3(D[i].x, D[i].z * 0.7, D[i].y);
    vec3 e = (p - c) / vec3(1.0, 0.85, 1.0);
    d = smin(d, (length(e) - D[i].z) * 0.75, 0.05);
  }
  return d;
}

float topY() { return uDomeH * uBody + uSpikeH * uBody * 2.2 + 0.05; }
float reach() { return uBody * 1.75; }

float map(vec3 p) {
  float far = length(p.xz) - reach();
  if (far > 0.45) return min(p.y, far);           // empty floor: cheap (margin keeps the AO probes exact)
  float h = domeH(p.xz);
  float ground = (p.y - h) * mix(1.0, 0.62, smoothstep(0.0, 0.04, h));   // dome blended into the floor
  float d = smin(ground, spikes(p), uCell * 0.32);
  if (uDrops > 0.5) d = smin(d, droplets(p), 0.12 * uBody);
  return d;
}

vec3 calcNormal(vec3 p, float e) {
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

float march(vec3 ro, vec3 rd, int steps, out bool hit) {
  hit = false;
  if (rd.y >= -1e-4 && ro.y > topY()) return 1e4;
  float t = 0.0;
  float ty = topY();
  if (ro.y > ty) t = (ro.y - ty) / -rd.y;         // nothing above the tallest spike
  for (int i = 0; i < 200; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.0006 * (1.0 + t)) { hit = true; break; }
    if (p.y < ty && length(p.xz) < reach() + 0.05) d = min(d, uCell * 0.42);
    t += d;
    if (t > 60.0 || p.y < -0.05 || (rd.y > 0.0 && p.y > ty)) break;
  }
  return t;
}

float softbox(vec3 r, vec3 L, float w, float h) {
  float c = dot(r, L);
  if (c <= 0.0) return 0.0;
  vec3 T = normalize(cross(L, abs(L.y) > 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0)));
  vec3 B = cross(T, L);
  float a = dot(r, T) / c, b = dot(r, B) / c;
  return smoothstep(w, w * 0.8, abs(a)) * smoothstep(h, h * 0.8, abs(b));
}

vec3 backLin() { return pow(uBack, vec3(2.2)); }

vec3 env(vec3 r) {
  vec3 c = backLin() * 1.2 + vec3(0.035) * smoothstep(-0.1, 0.9, r.y);
  // the studio walls: a faint bright band around the horizon outlines every spike
  c += vec3(0.22, 0.23, 0.26) * exp(-abs(r.y - 0.08) * 14.0) * (0.6 + 0.4 * sin(atan(r.z, r.x) * 3.0 + uLightA));
  float la = uLightA;
  vec3 key = normalize(vec3(0.45 * cos(la), 1.0, 0.45 * sin(la)));
  c += vec3(1.0) * softbox(r, key, 0.34, 0.2) * 4.0;
  vec3 s1 = normalize(vec3(cos(la + 2.3), 0.32, sin(la + 2.3)));
  c += vec3(0.95, 0.97, 1.0) * softbox(r, s1, 0.09, 0.7) * 4.0;
  vec3 s2 = normalize(vec3(cos(la - 2.1), 0.22, sin(la - 2.1)));
  c += pow(uRimCol, vec3(2.2)) * softbox(r, s2, 0.12, 0.7) * 4.5 * uRim * (0.55 + uHigh * 0.8 + uKick * 0.9 + uDrop);
  c += pow(uRimCol, vec3(2.2)) * 0.12 * uRim * smoothstep(0.05, -0.5, r.y) * (0.4 + uBass);
  return c;
}

float calcAO(vec3 p, vec3 n) {
  float o = 0.0, s = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 0.015 + 0.055 * float(i) * uBody;
    o += (h - map(p + n * h)) * s;
    s *= 0.65;
  }
  return clamp(1.0 - o * 2.6 / uBody, 0.0, 1.0);
}

vec3 shadeFluid(vec3 p, vec3 n, vec3 rd, float ao) {
  vec3 r = reflect(rd, n);
  float fr = 0.05 + 0.95 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
  vec3 tint = pow(uTint, vec3(2.2));
  vec3 refl = env(r) * mix(vec3(1.0), tint, 0.75) * mix(0.16, 1.0, fr) * uGloss;
  // the floor reflected in the low flanks: dark, with the rim glow
  if (r.y < 0.0) refl *= 0.35;
  return tint * 0.006 + refl * mix(0.25, 1.0, ao);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float dist = 4.7 * uBody / uZoom;
  vec3 ta = vec3(0.0, 0.18 * uBody, 0.0);
  vec3 ro = ta + dist * vec3(cos(uCamEl) * cos(uCamAz), sin(uCamEl), cos(uCamEl) * sin(uCamAz));
  vec3 cw = normalize(ta - ro), cu = normalize(cross(cw, vec3(0.0, 1.0, 0.0))), cv = cross(cu, cw);
  vec3 rd = normalize(uv.x * cu + uv.y * cv + 2.0 * cw);

  // a studio sweep: the backdrop is lit softly behind the subject
  vec3 bg = backLin() * (0.7 + 0.5 * smoothstep(-0.4, 0.6, uv.y)) + vec3(0.016, 0.017, 0.02) * exp(-dot(uv - vec2(0.0, 0.12), uv - vec2(0.0, 0.12)) * 3.0);
  vec3 col = bg;
  bool hit;
  float t = march(ro, rd, uSteps, hit);
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p, 0.0008 * (1.0 + t));
    float fluid = smoothstep(0.004, 0.03, p.y);
    float ao = calcAO(p, n);
    vec3 fl = shadeFluid(p, n, rd, ao);
    // floor: backdrop color, contact shadow, rim-colored glow pool, optional mirror reflection
    float r = length(p.xz) / uBody;
    vec3 floorCol = (backLin() * 0.9 + vec3(0.03, 0.031, 0.034) * exp(-r * r * 0.18)) * mix(0.2, 1.0, ao);
    floorCol += pow(uRimCol, vec3(2.2)) * uRim * 0.1 * exp(-max(r - 0.85, 0.0) * 4.5) * (0.25 + uBass * 0.7 + uKick * 0.6 + uDrop) * ao;
    if (uFloor > 0.5) {
      vec3 rr = reflect(rd, vec3(0.0, 1.0, 0.0));
      bool h2;
      vec3 ro2 = p + vec3(0.0, 0.002, 0.0);
      float t2 = march(ro2, rr, uSteps / 2, h2);
      vec3 rc = backLin();
      if (h2) {
        vec3 p2 = ro2 + rr * t2;
        vec3 n2 = calcNormal(p2, 0.002);
        rc = shadeFluid(p2, n2, rr, 1.0);
      }
      float ff = 0.04 + 0.96 * pow(1.0 - max(-rd.y, 0.0), 5.0);
      floorCol += rc * mix(0.1, 0.7, ff) * ao;
    }
    col = mix(floorCol, fl, fluid);
    float fog = 1.0 - exp(-0.004 * t * t / (uBody * uBody));
    col = mix(col, bg, clamp(fog, 0.0, 1.0));
  }
  col *= uExpo;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);   // ACES fit
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  col += (hash(gl_FragCoord.xy + uT) - 0.5) / 255.0;                     // dither the dark gradients
  fragColor = vec4(col, 1.0);
}`;

const STEPS = { draft: 64, balanced: 100, high: 150 };

export default {
  id: 'ferro',
  name: 'Ferro',
  tagline: 'Reactive magnetic fluid simulation.',
  params: [
    { key: 'magnet', label: 'Magnetic strength', type: 'range', min: 0, max: 2, step: 0.05, default: 1, section: 'Fluid' },
    { key: 'pattern', label: 'Spikes follow', type: 'select', default: 'mix', options: [['mix', 'The whole mix'], ['spectrum', 'Spectrum (center lows, edge highs)'], ['ripple', 'Ripples on kicks']] },
    { key: 'layout', label: 'Spike layout', type: 'select', default: 'hex', options: [['hex', 'Hexagonal'], ['rings', 'Concentric rings']] },
    { key: 'density', label: 'Spike count', type: 'range', min: 5, max: 24, step: 1, default: 11 },
    { key: 'spikeHeight', label: 'Spike height', type: 'range', min: 0.2, max: 2, step: 0.05, default: 1 },
    { key: 'sharpness', label: 'Sharpness', type: 'range', min: 0, max: 1, step: 0.01, default: 0.65 },
    { key: 'irregular', label: 'Irregularity', type: 'range', min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: 'body', label: 'Body size', type: 'range', min: 0.5, max: 1.4, step: 0.01, default: 1 },
    { key: 'dome', label: 'Body height', type: 'range', min: 0.1, max: 0.8, step: 0.01, default: 0.32 },
    { key: 'wobble', label: 'Wobble', type: 'range', min: 0, max: 2, step: 0.05, default: 0.7 },
    { key: 'wander', label: 'Magnet wander', type: 'range', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'spin', label: 'Lattice spin', type: 'range', min: -1, max: 1, step: 0.01, default: 0.1 },
    { key: 'drops', label: 'Satellite droplets', type: 'range', min: 0, max: 6, step: 1, default: 3 },
    { key: 'speed', label: 'Motion speed', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'view', label: 'Camera height', type: 'range', min: 0.05, max: 1.4, step: 0.01, default: 0.5, section: 'Camera' },
    { key: 'angle', label: 'Camera angle', type: 'range', min: 0, max: 360, step: 1, default: 35, unit: '°' },
    { key: 'orbit', label: 'Orbit speed', type: 'range', min: -1, max: 1, step: 0.01, default: 0.15 },
    { key: 'zoom', label: 'Zoom', type: 'range', min: 0.6, max: 2.2, step: 0.01, default: 1.05 },
    { key: 'tint', label: 'Metal tint', type: 'color', default: '#d6dceb', section: 'Light' },
    { key: 'gloss', label: 'Reflections', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'glowColor', label: 'Rim light', type: 'color', default: '#ff6a2b' },
    { key: 'glow', label: 'Rim light amount', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'light', label: 'Light angle', type: 'range', min: 0, max: 6.28, step: 0.01, default: 0.8 },
    { key: 'floor', label: 'Floor', type: 'select', default: 'mirror', options: [['mirror', 'Glossy (reflects)'], ['matte', 'Matte']] },
    { key: 'back', label: 'Backdrop', type: 'color', default: '#0c0d11' },
    { key: 'exposure', label: 'Exposure', type: 'range', min: 0.3, max: 2.5, step: 0.05, default: 1 },
    { key: 'quality', label: 'Quality', type: 'select', default: 'balanced', options: [['draft', 'Fast'], ['balanced', 'Balanced'], ['high', 'Best (uses more GPU)']] }
  ],
  create(canvas) {
    let s;
    try { s = createShader(canvas, FRAG); } catch (e) { s = null; }
    if (!s) return glUnavailable(canvas);
    let time = 0, spike = 0, squeeze = 0, az = 0, twist = 0, ripT = 9, ripA = 0;
    const drops = Array.from({ length: 6 }, (_, i) => ({ a: i * 2.1, r: 1.22 + 0.1 * (i % 3), sp: 0.12 + 0.05 * i, z: 0.055 + 0.02 * ((i * 7) % 3) }));
    return {
      render(F, { dt, params: p }) {
        const sp = p.speed;
        time += dt * sp;
        // spikes stand up with the low end and kicks, sink through a build, leap on the drop
        const target = p.magnet * (0.28 + F.bass * 0.85 + F.kick * 0.55 + F.drop * 0.7) * (1 - F.build * 0.55);
        spike += (target - spike) * (1 - Math.exp(-dt / (target > spike ? 0.035 : 0.22)));
        squeeze += ((F.build * 0.14 - F.drop * 0.1) - squeeze) * (1 - Math.exp(-dt / 0.35));
        if (F.onsets.some((o) => o.band === 'kick')) { ripT = 0; ripA = 1; }
        ripT += dt * sp; ripA *= Math.exp(-dt / 0.9);
        az += dt * p.orbit * 0.25 * sp;
        twist += dt * p.spin * 0.12 * sp;
        const R = p.body * (1 - squeeze);
        s.audio(F);
        s.set('uT', time);
        s.set('uTint', hexToVec(p.tint)); s.set('uRimCol', hexToVec(p.glowColor)); s.set('uBack', hexToVec(p.back));
        s.set('uBody', R); s.set('uDomeH', p.dome * (1 + F.kick * 0.08));
        s.set('uSpikeH', spike * 0.42 * p.spikeHeight);
        s.set('uCell', 2 / p.density);
        s.set('uSharp', p.sharpness); s.set('uIrreg', p.irregular);
        s.set('uWobble', p.wobble * (0.7 + F.mid * 0.9));
        s.set('uArr', p.layout === 'rings' ? 1 : 0);
        s.set('uPattern', p.pattern === 'spectrum' ? 1 : p.pattern === 'ripple' ? 2 : 0);
        s.set('uTwist', twist);
        const w = p.wander * R * 0.45;
        s.set('uMag', [Math.cos(time * 0.21) * w + F.mid * 0.05, Math.sin(time * 0.29) * w]);
        s.set('uRipT', ripT); s.set('uRipA', ripA);
        s.set('uCamEl', p.view); s.set('uCamAz', p.angle * Math.PI / 180 + az); s.set('uZoom', p.zoom);
        s.set('uGloss', p.gloss); s.set('uRim', p.glow); s.set('uLightA', p.light); s.set('uFloor', p.floor === 'mirror' ? 1 : 0);
        s.set('uExpo', p.exposure * (1 + F.drop * 0.25));
        s.seti('uSteps', STEPS[p.quality] || 100);
        s.set('uBass', F.bass); s.set('uMid', F.mid); s.set('uHigh', F.high); s.set('uKick', F.kick); s.set('uDrop', F.drop); s.set('uBuild', F.build);
        s.set('uDrops', p.drops);
        drops.forEach((d, i) => {
          d.a += dt * sp * d.sp * (1 + F.mid * 0.8);
          // droplets drift in, merge with the body, and are flung out again on drops
          const rr = R * (d.r + 0.22 * Math.sin(time * 0.37 + i * 1.7) + F.drop * 0.35 - F.build * 0.2);
          s.set('uDrop' + i, [Math.cos(d.a) * rr, Math.sin(d.a) * rr, d.z * R * (1 + F.bands[6 + i * 7] * 0.5), 0]);
        });
        s.draw();
      },
      resize() {},
      dispose() { s.dispose(); }
    };
  }
};
