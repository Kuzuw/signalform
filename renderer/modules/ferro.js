import { createShader, glUnavailable } from './gl.js';
import { hexToVec } from './util.js';

const FRAG = `
uniform vec3 uTint, uGlowCol;
uniform float uDensity, uSpike, uTurb, uSize, uLightA, uDrops, uGloss, uGlow;
uniform float uBass, uMid, uHigh, uKick, uDrop, uBuild;
uniform vec4 uDrop0, uDrop1, uDrop2, uDrop3, uDrop4, uDrop5;

vec2 hexOffset(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5;
  vec2 b = mod(p - s * 0.5, s) - s * 0.5;
  return dot(a, a) < dot(b, b) ? a : b;
}

float field(vec2 w) {
  float f = (uSize * uSize) / (dot(w, w) + 1e-3);
  vec4 D[6] = vec4[6](uDrop0, uDrop1, uDrop2, uDrop3, uDrop4, uDrop5);
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uDrops) break;
    vec2 d = w - D[i].xy;
    f += D[i].z * D[i].z / (dot(d, d) + 1e-3);
  }
  return f;
}

vec2 warp(vec2 p) {
  float tb = uTurb * (0.6 + uMid * 1.2);
  return p + tb * 0.06 * vec2(vnoise(p * 3.0 + uT * 0.35), vnoise(p * 3.0 - uT * 0.31 + 7.0))
           + tb * 0.025 * vec2(vnoise(p * 7.0 - uT * 0.6), vnoise(p * 7.0 + uT * 0.5 + 3.0));
}

// surface height: a soft-body dome plus the hexagonal spike lattice of a magnetized fluid
float height(vec2 p, out float mask) {
  vec2 w = warp(p);
  float f = field(w);
  mask = smoothstep(0.9, 1.25, f);
  float dome = mask * (0.18 + 0.22 * (1.0 - 1.0 / (f * 0.6 + 1.0)));
  vec2 rp = rot(uT * 0.05) * w;
  vec2 o = hexOffset(rp * uDensity);
  float d = length(o) * 2.0;
  float spikeZone = smoothstep(1.3, 2.6, f);
  float s = pow(max(0.0, 1.0 - d), 1.8) * uSpike * spikeZone;
  return dome + s * 0.32;
}

vec3 env(vec3 r) {
  // a studio: dark room, a wide softbox above, a warm strip light at the side
  float sky = smoothstep(-0.4, 1.0, r.y * 0.8 + r.z * 0.25);
  vec3 c = mix(vec3(0.01, 0.012, 0.016), vec3(0.2, 0.22, 0.26), sky);
  vec3 L1 = normalize(vec3(cos(uLightA) * 0.7, sin(uLightA) * 0.7, 0.55));
  c += vec3(1.0) * pow(max(dot(r, L1), 0.0), 60.0) * 2.5 * uGloss;
  c += vec3(0.9) * pow(max(dot(r, normalize(vec3(-0.5, 0.75, 0.45))), 0.0), 14.0) * 0.35 * uGloss;
  vec3 L2 = normalize(vec3(-cos(uLightA + 1.4) * 0.8, -0.35, 0.5));
  c += uGlowCol * pow(max(dot(r, L2), 0.0), 18.0) * (0.6 + uHigh * 1.4) * uGlow;
  return c;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float m;
  float h = height(p, m);
  float e = 1.5 / uRes.y;
  float m1;
  float hx = height(p + vec2(e, 0.0), m1) - height(p - vec2(e, 0.0), m1);
  float hy = height(p + vec2(0.0, e), m1) - height(p - vec2(0.0, e), m1);
  vec3 n = normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1.0) * vec3(0.06, 0.06, 1.0));
  vec3 v = normalize(vec3(p * 0.4, -1.0));
  vec3 r = reflect(v, n);
  float fres = pow(1.0 - max(dot(-v, n), 0.0), 3.0);
  vec3 metal = env(r) * uTint * (0.7 + 0.6 * fres) + fres * 0.08;
  // background: dark floor with a soft reflection pool under the fluid
  float pool = exp(-dot(p, p) * 3.0);
  vec3 bg = vec3(0.012, 0.013, 0.017) + uGlowCol * 0.04 * pool * (0.5 + uBass) * uGlow;
  vec3 col = mix(bg, metal, m);
  // rim light where the surface meets the floor
  col += uGlowCol * smoothstep(0.0, 0.5, m) * smoothstep(1.0, 0.4, m) * 0.25 * (0.4 + uKick + uDrop) * uGlow;
  col = pow(col, vec3(0.92));
  fragColor = vec4(col, 1.0);
}`;

export default {
  id: 'ferro',
  name: 'Ferro',
  tagline: 'Reactive magnetic fluid simulation.',
  params: [
    { key: 'magnet', label: 'Magnetic strength', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'density', label: 'Spike density', type: 'range', min: 6, max: 40, step: 1, default: 18 },
    { key: 'size', label: 'Body size', type: 'range', min: 0.08, max: 0.4, step: 0.01, default: 0.27 },
    { key: 'turb', label: 'Turbulence', type: 'range', min: 0, max: 2, step: 0.05, default: 0.8 },
    { key: 'drops', label: 'Orbiting droplets', type: 'range', min: 0, max: 6, step: 1, default: 4 },
    { key: 'tint', label: 'Metal tint', type: 'color', default: '#c9d2e3' },
    { key: 'glowColor', label: 'Rim light', type: 'color', default: '#ff6a2b' },
    { key: 'glow', label: 'Rim light amount', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'gloss', label: 'Gloss', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'light', label: 'Light angle', type: 'range', min: 0, max: 6.28, step: 0.01, default: 0.8 },
    { key: 'speed', label: 'Motion speed', type: 'range', min: 0, max: 3, step: 0.05, default: 1 }
  ],
  create(canvas) {
    let s;
    try { s = createShader(canvas, FRAG); } catch (e) { s = null; }
    if (!s) return glUnavailable(canvas);
    let time = 0, spike = 0, squeeze = 0;
    const drops = Array.from({ length: 6 }, (_, i) => ({ a: i * 1.047, r: 0.3 + 0.05 * (i % 3), sp: 0.25 + 0.08 * i, z: 0.04 + 0.012 * (i % 3) }));
    return {
      render(F, { dt, params: p }) {
        time += dt * p.speed;
        // spikes rise with the low end and stand tall on kicks, collapse on a build
        const target = p.magnet * (0.25 + F.bass * 1.1 + F.kick * 0.7 + F.drop * 0.8) * (1 - F.build * 0.6);
        spike += (target - spike) * (1 - Math.exp(-dt / (target > spike ? 0.04 : 0.25)));
        squeeze += ((F.build * 0.35 - F.drop * 0.25) - squeeze) * (1 - Math.exp(-dt / 0.3));
        s.audio(F);
        s.set('uT', time);
        s.set('uTint', hexToVec(p.tint)); s.set('uGlowCol', hexToVec(p.glowColor));
        s.set('uDensity', p.density); s.set('uSpike', spike); s.set('uTurb', p.turb);
        s.set('uSize', p.size * (1 - squeeze) * (1 + F.kick * 0.06)); s.set('uLightA', p.light + time * 0.05);
        s.set('uDrops', p.drops); s.set('uGloss', p.gloss); s.set('uGlow', p.glow);
        s.set('uBass', F.bass); s.set('uMid', F.mid); s.set('uHigh', F.high); s.set('uKick', F.kick); s.set('uDrop', F.drop); s.set('uBuild', F.build);
        drops.forEach((d, i) => {
          d.a += dt * p.speed * d.sp * (1 + F.mid);
          const rr = d.r * (1 + F.drop * 0.5 - F.build * 0.3) + Math.sin(time * 0.7 + i) * 0.04;
          s.set('uDrop' + i, [Math.cos(d.a) * rr * 1.2, Math.sin(d.a * 1.1) * rr * 0.8, d.z * (1 + F.bands[8 + i * 6] * 0.8), 0]);
        });
        s.draw();
      },
      resize() {},
      dispose() { s.dispose(); }
    };
  }
};
