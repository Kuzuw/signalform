import { createShader, glUnavailable } from './gl.js';

const FRAG = `
uniform float uMode, uIter, uZoom, uSym, uHue, uSat, uGlow, uWarp, uRotA, uAA;
uniform float uBass, uMid, uHigh, uKick, uDrop, uBuild;

vec3 palette(float t) {
  vec3 c = 0.5 + 0.5 * cos(6.28318 * (t + uHue + vec3(0.0, 0.33, 0.67)));
  return mix(vec3(dot(c, vec3(0.333))), c, uSat);
}

vec2 kaleido(vec2 p, float n) {
  if (n < 1.5) return p;
  float a = atan(p.y, p.x), r = length(p);
  float seg = 6.28318 / n;
  a = mod(a, seg); a = abs(a - seg * 0.5);
  return vec2(cos(a), sin(a)) * r;
}

// Julia set: c walks the edge of the Mandelbrot cardioid, pushed by the low end
vec3 julia(vec2 z) {
  float a = uT * 0.09 + uMid * 0.5;
  // just inside the main cardioid of the Mandelbrot set: always connected, always intricate
  vec2 w = (0.985 - 0.02 * uBass * uWarp) * vec2(cos(a), sin(a));
  vec2 c = w * 0.5 - vec2(w.x * w.x - w.y * w.y, 2.0 * w.x * w.y) * 0.25 + 0.004 * uKick * uWarp;
  float trap = 1e9, it = 0.0;
  for (float i = 0.0; i < 160.0; i++) {
    if (i >= uIter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    trap = min(trap, abs(z.y) + 0.5 * abs(z.x - 0.2));
    if (dot(z, z) > 256.0) break;
    it++;
  }
  if (it >= uIter) return palette(0.55 + trap * 0.6) * (0.02 + exp(-trap * 14.0) * 0.4) * uGlow;
  float sm = it - log2(log2(dot(z, z))) + 4.0;
  float k = sm / uIter;
  return palette(sm * 0.035 + uT * 0.01) * smoothstep(0.08, 0.7, k) * 1.3;
}

// Kali set: abs-inversion fold, coloured by how close the orbit passes the unit circle
vec3 kali(vec2 p) {
  vec2 c = vec2(0.52 + 0.06 * sin(uT * 0.07), 0.47 + 0.05 * cos(uT * 0.05)) + uWarp * 0.03 * vec2(uBass, uMid);
  float acc = 0.0, minD = 1e9, last = 0.0;
  for (float i = 0.0; i < 40.0; i++) {
    if (i >= min(uIter, 40.0)) break;
    p = abs(p) / dot(p, p) - c;
    float d = length(p);
    acc += exp(-abs(d - last) * 3.0);
    last = d;
    minD = min(minD, abs(d - 0.8));
  }
  float k = acc / min(uIter, 40.0);
  return palette(k * 1.5 + uT * 0.01) * pow(k, 1.6) * 1.4 + palette(0.4 + k) * exp(-minD * 25.0) * 0.5 * uGlow;
}

// Folded geometry: kaleidoscopic IFS. Points that stay bounded under the folds form the shape.
vec3 ifs(vec2 p) {
  vec2 q = p;
  float s = 1.0, trap = 1e9;
  vec2 off = vec2(1.0 + 0.08 * sin(uT * 0.11) + 0.06 * uBass * uWarp, 1.0 + 0.1 * cos(uT * 0.07));
  float ang = 0.55 + 0.35 * sin(uRotA * 0.4) + uMid * 0.12 * uWarp;
  float n = clamp(floor(uIter * 0.3), 3.0, 10.0);
  for (float i = 0.0; i < 10.0; i++) {
    if (i >= n) break;
    q = abs(q) - off;
    q *= rot(ang);
    q *= 2.2; s *= 2.2;
    trap = min(trap, length(q) / s);
  }
  float d = (length(q) - 0.5) / s;
  float px = 2.0 / uRes.y / uZoom;
  float edge = exp(-abs(d) / (px * (1.2 + uHigh)));
  float halo = exp(-max(d, 0.0) * 12.0);
  vec3 base = palette(trap * 3.0 + uT * 0.015);
  return base * edge * 1.1 + base * halo * 0.22 * uGlow;
}

vec3 scene(vec2 frag) {
  vec2 p = (frag - 0.5 * uRes) / uRes.y;
  float zoom = uZoom * (1.0 + 0.06 * uKick + 0.2 * uDrop - 0.15 * uBuild);
  p /= zoom;
  p *= rot(uT * 0.03 + uRotA * 0.2);
  p = kaleido(p, uSym);
  if (uMode < 0.5) return julia(p * 1.7);
  if (uMode < 1.5) return kali(p * 1.3);
  return ifs(p * 2.4);
}

void main() {
  vec3 col = vec3(0.0);
  if (uAA > 0.5) {
    for (int i = 0; i < 4; i++) col += scene(gl_FragCoord.xy + vec2(float(i & 1), float(i >> 1)) * 0.5 - 0.25);
    col *= 0.25;
  } else col = scene(gl_FragCoord.xy);
  col *= 0.85 + 0.35 * uBass;
  col = 1.0 - exp(-col * 1.5);
  fragColor = vec4(col, 1.0);
}`;

export default {
  id: 'fractal',
  name: 'Fractal',
  tagline: 'Sound transformed into recursive form.',
  params: [
    { key: 'mode', label: 'Structure', type: 'select', default: '2', options: [['0', 'Julia set'], ['1', 'Kali set'], ['2', 'Folded geometry']] },
    { key: 'iter', label: 'Detail (iterations)', type: 'range', min: 6, max: 160, step: 1, default: 24 },
    { key: 'zoom', label: 'Zoom', type: 'range', min: 0.3, max: 4, step: 0.01, default: 1 },
    { key: 'sym', label: 'Kaleidoscope segments', type: 'range', min: 1, max: 16, step: 1, default: 1 },
    { key: 'rotate', label: 'Rotation speed', type: 'range', min: 0, max: 2, step: 0.01, default: 0.3 },
    { key: 'warp', label: 'Harmonic deformation', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'hue', label: 'Palette shift', type: 'range', min: 0, max: 1, step: 0.005, default: 0.05 },
    { key: 'sat', label: 'Saturation', type: 'range', min: 0, max: 1.4, step: 0.01, default: 0.9 },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'speed', label: 'Evolution speed', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'aa', label: 'Smooth edges (uses more GPU)', type: 'toggle', default: true }
  ],
  create(canvas) {
    let s;
    try { s = createShader(canvas, FRAG); } catch (e) { s = null; }
    if (!s) return glUnavailable(canvas);
    let time = 0, rotA = 0;
    return {
      render(F, { dt, params: p }) {
        time += dt * p.speed * (0.7 + F.mid + F.drop * 3);
        rotA += dt * p.rotate * (0.5 + F.bass * 1.5);
        s.audio(F);
        s.set('uT', time); s.set('uRotA', rotA);
        s.set('uMode', Number(p.mode)); s.set('uIter', p.iter); s.set('uZoom', p.zoom); s.set('uSym', p.sym);
        s.set('uHue', p.hue + F.centroid * 0.15); s.set('uSat', p.sat); s.set('uGlow', p.glow); s.set('uWarp', p.warp); s.set('uAA', p.aa ? 1 : 0);
        s.set('uBass', F.bass); s.set('uMid', F.mid); s.set('uHigh', F.high); s.set('uKick', F.kick); s.set('uDrop', F.drop); s.set('uBuild', F.build);
        s.draw();
      },
      resize() {},
      dispose() { s.dispose(); }
    };
  }
};
