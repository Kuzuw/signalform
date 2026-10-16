import { createShader, glUnavailable } from './gl.js';
import { hexToVec } from './util.js';

// A flight through an endless tunnel. Rings are born at the far end carrying the energy of the
// moment they appeared, so every hit travels down the tunnel towards the viewer.
const RINGS = 64;
const FRAG = `
uniform vec3 uColA, uColB;
uniform float uSides, uTwist, uBend, uDens, uStyle, uFog, uGlow, uWidth, uZ, uCore, uSpecMap, uColorMode, uRot, uFlash, uSegs, uBright;
uniform float uBass, uKick, uHigh;
uniform float uRing[${RINGS}];

float polyR(vec2 p, float n) {
  if (n < 2.5) return length(p);
  float seg = 6.2831853 / n;
  float a = mod(atan(p.y, p.x) + seg * 0.5, seg) - seg * 0.5;
  return length(p) * cos(a) / cos(seg * 0.5);
}

float ring(float k) { return uRing[int(mod(k, ${RINGS}.0))]; }

// center line of the tube relative to the camera, which rides along it facing forward
vec2 center(float w) { return vec2(sin(w * 0.13) * 1.6, cos(w * 0.09) * 0.9); }
vec2 path(float z) {
  vec2 c0 = center(uZ), d0 = (center(uZ + 0.01) - c0) / 0.01;
  return uBend * (center(uZ + z) - c0 - d0 * z);
}

float lineAA(float x, float w) {          // x: coordinate in cell units, a line at every integer
  float d = abs(fract(x + 0.5) - 0.5);
  float aa = fwidth(x) * 1.2;
  return 1.0 - smoothstep(w, w + aa, d);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  p = rot(uRot) * p;
  // march the view ray to the first wall of a tube whose center line curves ahead of the camera
  float z = 0.2, zPrev = 0.2;
  float lp = max(length(p), 0.004);
  for (int i = 0; i < 40; i++) {
    float g = polyR(p * z - path(z), uSides) - 0.5;
    if (g > 0.0) break;
    zPrev = z;
    z += max(0.01, -g / lp * 0.8);
    if (z > 60.0) break;
  }
  for (int i = 0; i < 12; i++) {                     // refine between the last two samples
    float zm = 0.5 * (zPrev + z);
    if (polyR(p * zm - path(zm), uSides) - 0.5 > 0.0) z = zm; else zPrev = zm;
  }
  vec2 q = p * z - path(z);
  vec2 vp = path(16.0) / 16.0;                      // roughly where the far end sits on screen
  float r = length(p - vp);
  float ang = atan(q.y, q.x) / 6.2831853 + 0.5;
  float u = ang + uTwist * z * 0.03;
  float v = z + uZ;

  float kv = v * uDens;
  float k = floor(kv);
  float e = ring(k);                       // energy carried by this ring
  float fpos = abs(fract(u) * 2.0 - 1.0);  // around the tunnel: mirrored frequency position
  float sp = uSpecMap > 0.5 ? 0.25 + 1.6 * spec(0.03 + fpos * 0.8) : 1.0;
  float w = uWidth * 0.06;

  float b = 0.0;
  if (uStyle < 0.5) {                       // rings
    b = lineAA(kv, w) * (0.3 + e * 2.4) * sp;
  } else if (uStyle < 1.5) {                // grid
    float lr = lineAA(kv, w), ll = lineAA(u * uSegs, w * 0.8);
    b = max(lr * (0.3 + e * 2.4), ll * (0.18 + e * 0.8)) * sp;
  } else if (uStyle < 2.5) {                // panels
    vec2 cell = vec2(floor(u * uSegs), k);
    float hs = hash(cell + 0.5);
    float on = step(0.55 - e * 0.45, hs);
    float edge = min(lineAA(kv, w * 0.6), 1.0) + lineAA(u * uSegs, w * 0.6);
    b = on * (0.25 + e * 1.5) * sp * (0.6 + 0.4 * hs) + edge * 0.12 * (0.3 + e);
  } else {                                  // warp streaks
    float col = floor(u * uSegs * 3.0);
    float hs = hash(vec2(col, 7.0));
    float s = fract(v * 0.6 + hs * 13.0);
    float len = 0.08 + 0.25 * uBass + 0.3 * e;
    float streak = smoothstep(len, 0.0, s) * smoothstep(0.0, 0.01, s) * step(0.3, hash(vec2(col, floor(v * 0.6 + hs * 13.0))));
    float thin = 1.0 - smoothstep(0.0, 0.5 + fwidth(u * uSegs * 3.0), abs(fract(u * uSegs * 3.0) - 0.5) * 2.0 / max(uWidth * 0.5, 0.05));
    b = streak * thin * (0.9 + e * 1.8) * sp;
  }

  // lines finer than a pixel turn to mush near the vanishing point: fade them out instead
  b *= clamp(1.4 - fwidth(kv) * 2.5, 0.0, 1.0) * smoothstep(40.0, 14.0, z);
  // color: by depth, by frequency around the tunnel, or by energy
  float t = uColorMode < 0.5 ? clamp(z / 10.0, 0.0, 1.0) : uColorMode < 1.5 ? fpos : clamp(e * 1.2, 0.0, 1.0);
  vec3 col = mix(uColA, uColB, t) * (b + 0.03 * (1.0 + uBass) * smoothstep(30.0, 2.0, z));   // faint walls keep the shape readable
  // depth fade and the light at the end of the tunnel
  float fog = exp(-z * uFog * 0.12);
  col *= fog;
  col += mix(uColB, vec3(1.0), 0.35) * uCore * exp(-r * 16.0) * (0.25 + uBass * 0.9 + uKick * 0.6);
  col += uColA * uFlash * 0.35 * fog;
  col *= uBright;
  col = 1.0 - exp(-col * (1.0 + uGlow));
  fragColor = vec4(col, 1.0);
}`;

export default {
  id: 'tunnel',
  name: 'Tunnel',
  tagline: 'An endless flight carried by the beat.',
  params: [
    { key: 'style', label: 'Walls', type: 'select', default: 'rings', options: [['rings', 'Light rings'], ['grid', 'Wire grid'], ['panels', 'Light panels'], ['warp', 'Warp streaks']] },
    { key: 'sides', label: 'Shape', type: 'select', default: '0', options: [['0', 'Round'], ['3', 'Triangle'], ['4', 'Square'], ['5', 'Pentagon'], ['6', 'Hexagon'], ['8', 'Octagon']] },
    { key: 'speed', label: 'Flight speed', type: 'range', min: 0, max: 4, step: 0.05, default: 1, section: 'Motion' },
    { key: 'surge', label: 'Surge on kicks', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'twist', label: 'Twist', type: 'range', min: -3, max: 3, step: 0.05, default: 0.6 },
    { key: 'roll', label: 'Roll', type: 'range', min: -1, max: 1, step: 0.01, default: 0.08 },
    { key: 'bend', label: 'Curves', type: 'range', min: 0, max: 2, step: 0.05, default: 0.8 },
    { key: 'density', label: 'Ring density', type: 'range', min: 0.5, max: 8, step: 0.05, default: 3.2, section: 'Walls' },
    { key: 'segments', label: 'Segments around', type: 'range', min: 4, max: 48, step: 1, default: 16, showIf: { style: ['grid', 'panels', 'warp'] } },
    { key: 'width', label: 'Line width', type: 'range', min: 0.2, max: 4, step: 0.05, default: 1.3 },
    { key: 'specMap', label: 'Walls follow the spectrum', type: 'toggle', default: true },
    { key: 'fog', label: 'Depth fade', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'core', label: 'Light at the end', type: 'range', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'coloring', label: 'Coloring', type: 'select', default: 'depth', section: 'Color', options: [['depth', 'By depth'], ['freq', 'By frequency'], ['energy', 'By energy']] },
    { key: 'colorA', label: 'Color A', type: 'color', default: '#ff7a3d' },
    { key: 'colorB', label: 'Color B', type: 'color', default: '#6a5cff' },
    { key: 'bright', label: 'Brightness', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 2, step: 0.05, default: 0.6 }
  ],
  create(canvas) {
    let s;
    try { s = createShader(canvas, FRAG); } catch (e) { s = null; }
    if (!s) return glUnavailable(canvas);
    const rings = new Float32Array(RINGS);
    let z = 0, lastK = null, rollA = 0, flash = 0, surge = 0, energy = 0;
    const FAR = 14;
    return {
      render(F, { dt, params: p }) {
        // forward speed: the low end pushes, kicks surge, drops hit hyperspeed
        surge = Math.max(surge * Math.exp(-dt / 0.25), F.kick * p.surge);
        const v = p.speed * (0.5 + F.bass * 1.2 + surge * 1.6 + F.drop * 3) * (1 + F.build * 0.8);
        z += dt * v;
        rollA += dt * p.roll * (1 + F.mid);
        flash = Math.max(flash * Math.exp(-dt / 0.3), F.drop);
        // energy of new rings: smoothed level with a jump on every hit
        let hit = 0;
        for (const o of F.onsets) hit = Math.max(hit, o.band === 'hat' ? o.strength * 0.35 : o.strength);
        energy = Math.max(energy * Math.exp(-dt / 0.12), F.level * 0.55 + hit * 0.9 + F.drop * 0.6);
        const dens = p.density;
        const kFar = Math.floor((z + Math.min(FAR, (RINGS - 4) / dens)) * dens);
        if (lastK === null || kFar - lastK > RINGS) lastK = kFar - RINGS;
        while (lastK < kFar) { lastK++; rings[((lastK % RINGS) + RINGS) % RINGS] = energy; }
        s.audio(F);
        s.set('uT', z);
        s.set('uZ', z); s.set('uDens', dens); s.set('uSides', Number(p.sides)); s.set('uTwist', p.twist); s.set('uBend', p.bend);
        s.set('uStyle', ['rings', 'grid', 'panels', 'warp'].indexOf(p.style)); s.set('uSegs', p.segments); s.set('uWidth', p.width);
        s.set('uFog', p.fog); s.set('uCore', p.core); s.set('uSpecMap', p.specMap ? 1 : 0);
        s.set('uColorMode', ['depth', 'freq', 'energy'].indexOf(p.coloring)); s.set('uColA', hexToVec(p.colorA)); s.set('uColB', hexToVec(p.colorB));
        s.set('uRot', rollA); s.set('uFlash', flash); s.set('uBright', p.bright); s.set('uGlow', p.glow);
        s.set('uBass', F.bass); s.set('uKick', F.kick); s.set('uHigh', F.high);
        s.setv('uRing', rings);
        s.draw();
      },
      resize() {},
      dispose() { s.dispose(); }
    };
  }
};
