// CRT screen: a physically based cathode-ray tube for the effect rack.
//
// The picture goes through the same stages as on a real set, each at the resolution it really has:
//   1. crtEncode (signal resolution: one texel per signal sample, one row per scan line)
//      box-filters the input into scan lines, adds sync wobble, ghosting, hum and snow, and encodes
//      it as RGB, S-Video (Y + IQ) or a composite NTSC signal (Y + chroma on a 4×fsc subcarrier
//      whose phase flips every line and every frame).
//   2. crtDecode (signal resolution) decodes it with real filters: a notch + low-pass for luma and a
//      product detector + low-pass for chroma (so fine detail turns into rainbows and colour edges
//      crawl), the set's sharpness peaking (edge ringing), the TV's brightness / contrast / colour /
//      tint knobs, the tube's 2.4 transfer curve and white point, and phosphor persistence.
//   3. A small glow pyramid (1/6 resolution) for halation and the light diffused in the faceplate.
//   4. crtScreen (output resolution): curved glass, the electron beam drawn as a gaussian spot per
//      scan line whose width grows with its brightness (box-filtered to the pixel, so it never
//      aliases), convergence errors, the phosphor mask (aperture grille, slot or shadow mask, also
//      box-filtered), halation, edge falloff, glass reflections, and a bezel that reflects the picture.
// Only the last pass runs per output pixel; everything else touches a few hundred thousand texels.

const hexv = (h) => { const s = String(h || '#ffffff').replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255); };

/* ------------------------------------------------------------------ presets */
export const CRT_PRESETS = {
  tv: { frame: 'bezel', signal: 'composite', lines: 240, interlace: false, sharp: 0.5, ring: 0.35, noise: 0.03, ghost: 0.06, jitter: 0.12, hum: 0, bright: 0, contrast: 1, sat: 1.05, tint: 0, temp: 7800, scan: 0.55, bloom: 0.7, converge: 0.35, persist: 0.25, flicker: 0.015, degauss: true, maskType: 'slot', mask: 0.6, pitch: 3, curve: 0.14, shape: 'sphere', corner: 0.07, vig: 0.45, halation: 0.45, diffusion: 0.25, reflect: 0.2 },
  arcade: { frame: 'bezel', signal: 'rgb', lines: 240, interlace: false, sharp: 0.7, ring: 0.08, noise: 0, ghost: 0, jitter: 0.03, hum: 0, bright: 0, contrast: 1, sat: 1.1, tint: 0, temp: 7000, scan: 0.8, bloom: 0.75, converge: 0.25, persist: 0.2, flicker: 0.01, degauss: true, maskType: 'dots', mask: 0.6, pitch: 4.5, curve: 0.11, shape: 'sphere', corner: 0.04, vig: 0.35, halation: 0.4, diffusion: 0.2, reflect: 0.12 },
  pvm: { frame: 'bezel', signal: 'rgb', lines: 240, interlace: false, sharp: 0.95, ring: 0, noise: 0, ghost: 0, jitter: 0, hum: 0, bright: 0, contrast: 1, sat: 1, tint: 0, temp: 6500, scan: 0.95, bloom: 0.5, converge: 0.06, persist: 0.15, flicker: 0, degauss: false, maskType: 'grille', mask: 0.7, pitch: 3, curve: 0.04, shape: 'cyl', corner: 0.02, vig: 0.15, halation: 0.18, diffusion: 0.1, reflect: 0.08 },
  pc: { frame: 'bezel', signal: 'rgb', lines: 480, interlace: false, sharp: 1, ring: 0, noise: 0, ghost: 0, jitter: 0, hum: 0, bright: 0, contrast: 1, sat: 1, tint: 0, temp: 9300, scan: 0.35, bloom: 0.3, converge: 0.12, persist: 0.1, flicker: 0, degauss: false, maskType: 'dots', mask: 0.45, pitch: 3, curve: 0.06, shape: 'sphere', corner: 0.02, vig: 0.2, halation: 0.12, diffusion: 0.08, reflect: 0.1 },
  bw: { frame: 'bezel', signal: 'composite', lines: 480, interlace: true, sharp: 0.45, ring: 0.45, noise: 0.08, ghost: 0.15, jitter: 0.2, hum: 0.3, bright: 0.02, contrast: 1.05, sat: 0, tint: 0, temp: 9000, scan: 0.5, bloom: 0.85, converge: 0, persist: 0.35, flicker: 0.03, degauss: false, maskType: 'none', mask: 0, pitch: 3, curve: 0.22, shape: 'sphere', corner: 0.13, vig: 0.6, halation: 0.6, diffusion: 0.35, reflect: 0.25 },
  rf: { frame: 'bezel', signal: 'rf', lines: 240, interlace: false, sharp: 0.3, ring: 0.4, noise: 0.28, ghost: 0.3, jitter: 0.3, hum: 0.15, bright: 0.02, contrast: 1, sat: 0.95, tint: 0, temp: 7800, scan: 0.5, bloom: 0.75, converge: 0.45, persist: 0.3, flicker: 0.04, degauss: true, maskType: 'slot', mask: 0.55, pitch: 3, curve: 0.16, shape: 'sphere', corner: 0.08, vig: 0.5, halation: 0.5, diffusion: 0.3, reflect: 0.2 }
};
const D = CRT_PRESETS.tv;

/* ------------------------------------------------------------------ shaders */
const YIQ = `const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
`;

export const CRT_PASSES = {
  crtEncode: YIQ + `uniform vec2 uSrc; uniform float uSig, uNoise, uGhost, uJitter, uHum, uPhase, uSeed, uField, uIl, uLines;
// box filter over the part of the input one signal sample covers
vec3 grab(vec2 uv) {
  vec2 fp = uSrc / uRes;
  int nx = int(clamp(ceil(fp.x * 0.5), 1.0, 4.0)), ny = int(clamp(ceil(fp.y * 0.5), 1.0, 6.0));
  vec2 st = fp / vec2(float(nx), float(ny)) / uSrc, c0 = vec2(float(nx - 1), float(ny - 1)) * 0.5;
  vec3 s = vec3(0.0);
  for (int j = 0; j < 6; j++) { if (j >= ny) break;
    for (int i = 0; i < 4; i++) { if (i >= nx) break; s += texture(uIn, uv + (vec2(float(i), float(j)) - c0) * st).rgb; } }
  return s / float(nx * ny);
}
void main() {
  float x = floor(gl_FragCoord.x), row = floor(gl_FragCoord.y);
  float line = uIl > 0.5 ? row * 2.0 + uField : row;
  float y = (line + 0.5) / uLines;
  // horizontal sync is never perfect: a per-line tremble plus a slow bend
  float jit = uJitter * ((hash(vec2(line, uSeed)) - 0.5) * 0.8 + 0.6 * sin(line * 0.09 + uT * 5.0) * sin(uT * 1.7));
  vec2 uv = vec2((gl_FragCoord.x + jit) / uRes.x, y);
  vec3 c = grab(uv);
  if (uGhost > 0.0) c += (grab(uv - vec2(0.03, 0.0)) - 0.2) * uGhost * 0.35;
  if (uHum > 0.0) c *= 1.0 - uHum * 0.3 * pow(0.5 + 0.5 * sin(6.2831853 * (y + uT * 0.15)), 3.0);
  float n = hash(vec2(x, row) + uSeed) - 0.5;
  if (uSig < 0.5) { o = vec4(c + n * uNoise * 0.25, 1.0); return; }
  vec3 yiq = toYIQ * c;
  if (uSig < 1.5) { yiq.x += n * uNoise * 0.25; o = vec4(yiq, 1.0); return; }
  // composite: chroma rides on the subcarrier, 4 samples a cycle, phase flipping each line and frame
  float ph = 1.5707963 * mod(x + 2.0 * (line + uPhase), 4.0);
  float s = yiq.x + yiq.y * cos(ph) + yiq.z * sin(ph);
  s += n * uNoise * (uSig > 2.5 ? 0.55 : 0.18);
  if (uSig > 2.5) s += uNoise * 0.035 * sin(x * 0.83 + line * 2.3 + uT * 40.0);
  o = vec4(s, 0.0, 0.0, 1.0);
}`,

  crtDecode: YIQ + `uniform sampler2D uPrev; uniform float uSig, uPhase, uField, uIl, uBright, uContrast, uSat, uTint;
uniform float uKl[17], uKc[17], uKs[17]; uniform vec3 uDecay, uWB;
void main() {
  vec2 px = gl_FragCoord.xy; vec3 yiq;
  if (uSig > 1.5) {
    float x = floor(px.x), row = floor(px.y), line = uIl > 0.5 ? row * 2.0 + uField : row;
    float ph = 1.5707963 * mod(x + 2.0 * (line + uPhase), 4.0);
    float Y = 0.0, A = 0.0, B = 0.0;
    for (int i = 0; i < 17; i++) { float s = texture(uIn, vec2(px.x + float(i - 8), px.y) / uRes).x; Y += uKl[i] * s; A += uKc[i] * s; B += uKs[i] * s; }
    float ca = cos(ph), sa = sin(ph);
    yiq = vec3(Y, 2.0 * (ca * A - sa * B), 2.0 * (sa * A + ca * B));
  } else if (uSig > 0.5) {
    yiq = vec3(0.0);
    for (int i = 0; i < 17; i++) { vec3 t = texture(uIn, vec2(px.x + float(i - 8), px.y) / uRes).xyz; yiq.x += uKl[i] * t.x; yiq.yz += uKc[i] * t.yz; }
  } else {
    vec3 c = vec3(0.0);
    for (int i = 0; i < 17; i++) c += uKl[i] * texture(uIn, vec2(px.x + float(i - 8), px.y) / uRes).rgb;
    yiq = toYIQ * c;
  }
  float ct = cos(uTint), st = sin(uTint);
  yiq.yz = mat2(ct, st, -st, ct) * yiq.yz * uSat;
  vec3 v = (toRGB * yiq) * uContrast + uBright;
  vec3 lin = pow(clamp(v, 0.0, 1.4), vec3(2.4)) * uWB;
  o = vec4(max(lin, texture(uPrev, UV).rgb * uDecay), 1.0);
}`,

  // 4 bilinear taps spread over the destination pixel's footprint
  crtDown: `void main() { vec2 f = 0.25 / uRes; o = (tx(UV + f) + tx(UV + vec2(-f.x, f.y)) + tx(UV + vec2(f.x, -f.y)) + tx(UV - f)) * 0.25; }`,

  crtScreen: `uniform sampler2D uNear, uWide;
uniform vec2 uSig, uInner, uHalf;
uniform float uLines, uIl, uField, uSmin, uSmax, uConv, uMT, uMask, uPitch, uHal, uDif, uCurve, uShape, uCorner, uVig, uBz, uBzPx, uRefl, uFl, uDeg, uDegT;
uniform vec3 uBezel;
float sdRBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
// coverage of a periodic box (period 1, centred on c, width w) over [u - e, u + e]
float pF(float x, float w) { return floor(x) * w + min(fract(x), w); }
float pbox(float u, float e, float c, float w) { float s = c - 0.5 * w; return (pF(u + e - s, w) - pF(u - e - s, w)) / (2.0 * e); }
// phosphor mask: how much of each pixel each colour's phosphor covers (0–1)
vec3 mask(vec2 fc) {
  float P = uPitch, u = fc.x / P, e = 0.5 / P;
  if (uMT < 1.5) {
    const float W = 0.28;
    vec3 t = vec3(pbox(u, e, 1.0 / 6.0, W), pbox(u, e, 0.5, W), pbox(u, e, 5.0 / 6.0, W)) / W;
    if (uMT > 0.5) { float hc = P * 1.8; t *= pbox(fc.y / hc + 0.5 * mod(floor(u), 2.0), 0.5 / hc, 0.5, 0.8) / 0.8; }
    return min(t, 1.0);
  }
  // delta-gun shadow mask: staggered rows of round R, G, B dots
  float a = P / 3.0, hh = a * 0.8660254, r = max(a * 0.46, 0.5);
  float j0 = floor(fc.y / hh + 0.5);
  vec3 dm = vec3(1e9);
  for (int dj = -1; dj <= 1; dj++) {
    float j = j0 + float(dj), dy = fc.y - j * hh;
    vec3 dx = fc.x - (vec3(0.0, 1.0, 2.0) + 1.5 * mod(j, 2.0)) * a;
    dx -= 3.0 * a * floor(dx / (3.0 * a) + 0.5);
    dm = min(dm, dx * dx + dy * dy);
  }
  return clamp(r - sqrt(dm) + 0.5, 0.0, 1.0);
}
void main() {
  vec2 fc = gl_FragCoord.xy, uv = fc / uRes;
  vec2 q = (uv - 0.5) / uInner, d2 = q * q;
  // the picture as it lands on the curved faceplate
  // (aspect-corrected, so the edges bow by the same number of pixels on every side)
  float aw = sqrt(uRes.x * uInner.x / (uRes.y * uInner.y));
  vec2 pc = uShape < 0.5 ? q * (1.0 + uCurve * 0.5 * d2.yx * vec2(1.0 / aw, aw)) : uShape < 1.5 ? vec2(q.x * (1.0 + uCurve * 0.12 * d2.x), q.y * (1.0 + uCurve * 0.5 * d2.x * aw)) : q;
  // the glass edge stays put; only the picture swims while degaussing
  float dpx = sdRBox(pc * uHalf, uHalf, uCorner);
  if (uDeg > 0.0005) pc += uDeg * 0.018 * vec2(sin(pc.y * 7.0 + uDegT * 37.0), sin(pc.x * 6.0 + uDegT * 29.0));
  vec2 tuv = pc * 0.5 + 0.5;
  float inside = clamp(0.5 - dpx, 0.0, 1.0);
  // scan-line coordinate, and how many lines one pixel spans (for the box filter)
  float yl = tuv.y * uLines - 0.5, rc = uIl > 0.5 ? (yl - uField) * 0.5 : yl;
  float hw = 0.5 * fwidth(rc);
  vec3 col = vec3(0.0);
  if (inside > 0.0) {
    // electron beams: R and B land a little off the green, more towards the edges
    float ex = q.x * abs(q.x) * 1.5, ey = q.y * abs(q.y) * 1.5;
    float crx = uConv * (0.5 + ex) / (2.0 * uHalf.x), cbx = -uConv * (0.35 + ex) / (2.0 * uHalf.x);
    vec3 dv = uConv * vec3(0.08, 0.0, -0.06) * (0.5 + ey);
    // the three nearest lines (a fourth would add < 2 % even at full bloom)
    float r0 = floor(rc + 0.5); vec3 acc = vec3(0.0);
    for (int k = -1; k <= 1; k++) {
      float row = r0 + float(k);
      if (row < 0.0 || row > uSig.y - 1.0) continue;
      float vy = (row + 0.5) / uSig.y;
      vec3 c = uConv > 0.0 ? vec3(texture(uIn, vec2(tuv.x + crx, vy)).r, texture(uIn, vec2(tuv.x, vy)).g, texture(uIn, vec2(tuv.x + cbx, vy)).b) : texture(uIn, vec2(tuv.x, vy)).rgb;
      // brighter beams carry more current and spread wider
      vec3 sg = mix(vec3(uSmin), vec3(uSmax), sqrt(clamp(c, 0.0, 1.0)));
      vec3 s2 = sg * sg + hw * hw * 0.33333, d = rc - row + dv;
      acc += c * exp(-d * d / (2.0 * s2)) * inversesqrt(s2);
    }
    acc *= 0.39894228;
    if (uDeg > 0.0005) acc *= 1.0 + uDeg * 0.7 * vec3(sin(q.x * 3.1 + q.y * 2.3 + uDegT * 4.0), sin(-q.x * 2.7 + q.y * 3.3 + uDegT * 3.1 + 2.0), sin(q.x * 3.7 - q.y * 1.9 + uDegT * 5.3 + 4.0));
    vec3 v = acc;
    // the mask: lit phosphor glows brighter, the black matrix between them stays dark
    if (uMT < 2.5 && uMask > 0.0) v *= mix(vec3(1.0 - 0.75 * uMask), vec3(1.0 + 0.6 * uMask), mask(fc));
    // light scattered in the phosphor layer (halation) and in the thick faceplate (diffusion)
    v += texture(uNear, tuv).rgb * uHal * 0.3 + texture(uWide, tuv).rgb * uDif * 0.1;
    v *= mix(1.0, pow(clamp(16.0 * tuv.x * tuv.y * (1.0 - tuv.x) * (1.0 - tuv.y), 0.0, 1.0), 0.5), uVig);
    // the grey-green glass itself, and a soft window reflection
    vec2 w = (q - vec2(-0.5, 0.55)) * vec2(1.4, 2.2);
    v += uRefl * (vec3(0.0011, 0.0013, 0.0012) + 0.03 * exp(-4.0 * dot(w, w)));
    // phosphors driven past white saturate softly instead of clipping
    vec3 k = vec3(0.72); v = mix(v, k + (1.0 - k) * (1.0 - exp(-(v - k) / (1.0 - k))), step(k, v));
    col = v * uFl;
  }
  vec3 outc = vec3(0.0);
  if (inside < 1.0 && uBz > 0.5) {
    vec3 base = uBezel * uBezel;
    float t = clamp(dpx / (uBzPx * 0.5), 0.0, 1.0), ch = 1.0 - t;
    vec2 m = 1.0 - abs(1.0 - abs(tuv));
    vec3 rf = mix(texture(uNear, m).rgb, texture(uWide, m).rgb, t);
    outc = base * (0.5 + 0.5 * smoothstep(-1.3, 1.3, q.y)) + rf * (0.03 + 0.3 * ch * ch) + uRefl * 0.01;
    outc *= 0.35 + 0.65 * smoothstep(0.0, 3.0, dpx);
  }
  vec3 v = mix(outc, col, inside);
  o = vec4(pow(clamp(v, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`
};

/* ------------------------------------------------------------------ helpers */
const K = 8;
const gk = (s) => { const a = []; for (let k = -K; k <= K; k++) a.push(Math.exp(-k * k / (2 * s * s))); return a; };
const norm = (a) => { const s = a.reduce((x, y) => x + y, 0); return a.map((v) => v / s); };
const BOX = [0.125, 0.25, 0.25, 0.25, 0.125]; // averages exactly one subcarrier cycle: a notch at fsc
const convBox = (a) => a.map((_, i) => BOX.reduce((s, b, j) => s + b * (a[i + j - 2] || 0), 0));

// horizontal filters of the decoder: luma (with notch, peaking and a little subcarrier leak) and chroma
function kernels(sig, sharp, ring) {
  const comp = sig >= 2;
  const sy = comp ? 1.25 - 0.95 * sharp : 1.4 - 1.15 * sharp, sw = Math.min(3.2, sy * 2 + 1.2);
  let ky = norm(gk(sy)), kw = norm(gk(sw));
  if (comp) { ky = norm(convBox(ky)); kw = norm(convBox(kw)); }
  const r = ring * 1.4, kl = ky.map((v, i) => (1 + r) * v - r * kw[i]);
  if (comp) { const leak = sig === 3 ? 0.22 : 0.12; kl[K] += leak; BOX.forEach((b, j) => { kl[K + j - 2] -= leak * b; }); }
  const kc = norm(gk(sig === 3 ? 2.8 : sig === 2 ? 2.3 : 1.5));
  const kcc = comp ? kc.map((v, i) => v * Math.round(Math.cos((i - K) * Math.PI / 2))) : kc;
  const kcs = comp ? kc.map((v, i) => v * Math.round(Math.sin((i - K) * Math.PI / 2))) : kc;
  return { kl: new Float32Array(kl), kc: new Float32Array(kcc), ks: new Float32Array(kcs) };
}

// white point of a colour temperature, relative to D65, keeping the luminance
const wbCache = new Map();
function whiteBalance(T) {
  const key = Math.round(T / 50); if (wbCache.has(key)) return wbCache.get(key);
  const k = (T) => { const t = T / 100;
    const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    return [r, g, b].map((v) => Math.pow(Math.min(255, Math.max(0, v)) / 255, 2.2)); };
  const a = k(T), b = k(6500), w = a.map((v, i) => v / b[i]);
  const l = w[0] * 0.2126 + w[1] * 0.7152 + w[2] * 0.0722, out = w.map((v) => v / l);
  wbCache.set(key, out); return out;
}

/* ------------------------------------------------------------------ the effect */
const SIG = { rgb: 0, svideo: 1, composite: 2, rf: 3 };
const MASK = { grille: 0, slot: 1, dots: 2, none: 3 };

export const CRT = {
  name: 'CRT screen', cat: 'Texture', main: 'scan',
  params: [
    { key: 'preset', label: 'Model', type: 'select', default: 'tv', section: 'Monitor', apply: (T, v) => Object.assign(T, CRT_PRESETS[v] || {}),
      options: [['tv', 'Living-room TV (composite)'], ['arcade', 'Arcade monitor (RGB)'], ['pvm', 'Studio monitor (PVM)'], ['pc', 'Computer monitor (VGA)'], ['bw', 'Black-and-white TV'], ['rf', 'Old TV on an aerial']] },
    { key: 'frame', label: 'Bezel', type: 'select', default: D.frame, options: [['bezel', 'Plastic bezel'], ['none', 'Screen fills the layer']] },
    { key: 'bezelColor', label: 'Bezel colour', type: 'color', default: '#1a1a1c', showIf: { frame: 'bezel' } },

    { key: 'signal', label: 'Signal', type: 'select', default: D.signal, section: 'Signal', options: [['rgb', 'RGB (sharpest)'], ['svideo', 'S-Video'], ['composite', 'Composite'], ['rf', 'Aerial (RF)']] },
    { key: 'lines', label: 'Scan lines', type: 'range', min: 120, max: 1080, step: 10, default: D.lines },
    { key: 'interlace', label: 'Interlaced', type: 'toggle', default: D.interlace },
    { key: 'sharp', label: 'Sharpness', type: 'range', min: 0, max: 1, step: 0.01, default: D.sharp },
    { key: 'ring', label: 'Edge ringing', type: 'range', min: 0, max: 1, step: 0.01, default: D.ring },
    { key: 'noise', label: 'Snow', type: 'range', min: 0, max: 1, step: 0.01, default: D.noise },
    { key: 'ghost', label: 'Ghosting', type: 'range', min: 0, max: 1, step: 0.01, default: D.ghost },
    { key: 'jitter', label: 'Line wobble', type: 'range', min: 0, max: 1, step: 0.01, default: D.jitter },
    { key: 'hum', label: 'Hum bar', type: 'range', min: 0, max: 1, step: 0.01, default: D.hum },

    { key: 'bright', label: 'Brightness', type: 'range', min: -0.3, max: 0.3, step: 0.005, default: D.bright, section: 'Picture' },
    { key: 'contrast', label: 'Contrast', type: 'range', min: 0.5, max: 1.6, step: 0.01, default: D.contrast },
    { key: 'sat', label: 'Colour', type: 'range', min: 0, max: 2, step: 0.01, default: D.sat },
    { key: 'tint', label: 'Tint', type: 'range', min: -30, max: 30, step: 0.5, default: D.tint, unit: '°' },
    { key: 'temp', label: 'Colour temperature', type: 'range', min: 5000, max: 11000, step: 100, default: D.temp, unit: ' K' },

    { key: 'scan', label: 'Scanlines', type: 'range', min: 0, max: 1, step: 0.01, default: D.scan, section: 'Beam' },
    { key: 'bloom', label: 'Beam bloom', type: 'range', min: 0, max: 1, step: 0.01, default: D.bloom },
    { key: 'converge', label: 'Misconvergence', type: 'range', min: 0, max: 1, step: 0.01, default: D.converge },
    { key: 'persist', label: 'Phosphor persistence', type: 'range', min: 0, max: 1, step: 0.01, default: D.persist },
    { key: 'flicker', label: 'Flicker', type: 'range', min: 0, max: 0.3, step: 0.005, default: D.flicker },
    { key: 'degauss', label: 'Degauss wobble on drops', type: 'toggle', default: D.degauss },

    { key: 'maskType', label: 'Phosphor mask', type: 'select', default: D.maskType, section: 'Phosphor mask', options: [['grille', 'Aperture grille (Trinitron)'], ['slot', 'Slot mask'], ['dots', 'Shadow mask (dots)'], ['none', 'None']] },
    { key: 'mask', label: 'Mask strength', type: 'range', min: 0, max: 1, step: 0.01, default: D.mask },
    { key: 'pitch', label: 'Mask pitch', type: 'range', min: 2, max: 12, step: 0.1, default: D.pitch, unit: ' px' },

    { key: 'curve', label: 'Curvature', type: 'range', min: 0, max: 0.4, step: 0.005, default: D.curve, section: 'Glass' },
    { key: 'shape', label: 'Tube shape', type: 'select', default: D.shape, options: [['sphere', 'Spherical'], ['cyl', 'Cylindrical (flat vertically)'], ['flat', 'Flat']] },
    { key: 'corner', label: 'Corner rounding', type: 'range', min: 0, max: 0.25, step: 0.005, default: D.corner },
    { key: 'vig', label: 'Edge falloff', type: 'range', min: 0, max: 1, step: 0.01, default: D.vig },
    { key: 'halation', label: 'Halation', type: 'range', min: 0, max: 1, step: 0.01, default: D.halation },
    { key: 'diffusion', label: 'Glass diffusion', type: 'range', min: 0, max: 1, step: 0.01, default: D.diffusion },
    { key: 'reflect', label: 'Room reflections', type: 'range', min: 0, max: 1, step: 0.01, default: D.reflect }
  ],
  run(E, src, dst, it, st) {
    const p = it.v, W = dst.w, H = dst.h, A = W / H;
    const sig = SIG[p.signal] ?? 2, il = !!p.interlace;
    const lines = Math.round(Math.max(60, Math.min(p.lines, H)));
    const rows = il ? Math.max(30, Math.round(lines / 2)) : lines;
    const Ws = Math.max(64, Math.min(W, Math.round(564 * A)));
    st.n = (st.n || 0) + 1;
    const field = il ? st.n & 1 : 0, phase = st.n & 1, seed = (st.n % 997) * 1.37;
    const dt = st.lt === undefined ? 1 / 60 : Math.min(0.1, Math.max(0, E.t - st.lt)); st.lt = E.t;

    // 1. the signal
    const enc = E.tmp('crtE', Ws, rows);
    E.pass('crtEncode', src, enc, { uSrc: [src.w, src.h], uSig: sig, uNoise: p.noise, uGhost: p.ghost, uJitter: p.jitter * 3, uHum: p.hum, uPhase: phase, uSeed: seed, uField: field, uIl: il ? 1 : 0, uLines: lines });

    // 2. the decoder, into this frame's phosphor buffer (ping-pong, so persistence needs no copy)
    if (!st.ph || st.ph[0].w !== Ws || st.ph[0].h !== rows) {
      if (st.ph) st.ph.forEach((x) => E.free(x));
      st.ph = [E.make(Ws, rows), E.make(Ws, rows)]; st.ph.forEach((x) => E.pass('clear', null, x, {}));
    }
    const prev = st.ph[st.n & 1], cur = st.ph[(st.n + 1) & 1];
    const kk = sig + ':' + p.sharp + ':' + p.ring;
    if (st.kk !== kk) { st.kk = kk; st.k = kernels(sig, p.sharp, p.ring); }
    // P22 colour phosphors: green fades slowest, blue fastest; a monochrome tube has one phosphor
    const tau = p.persist * 0.09, mono = p.maskType === 'none', dec = (m) => (tau > 0 ? Math.exp(-dt / (tau * (mono ? 1 : m))) : 0);
    E.pass('crtDecode', enc, cur, { uPrev: prev, uSig: sig, uPhase: phase, uField: field, uIl: il ? 1 : 0, uBright: p.bright, uContrast: p.contrast, uSat: p.sat, uTint: p.tint * Math.PI / 180,
      uKl: st.k.kl, uKc: st.k.kc, uKs: st.k.ks, uDecay: [dec(1), dec(1.15), dec(0.75)], uWB: whiteBalance(p.temp) });

    // 3. halation and diffusion, from a tiny copy of the screen
    const bezel = p.frame === 'bezel';
    const gw = Math.max(16, Math.round(W / 6)), gh = Math.max(16, Math.round(H / 6));
    const g0 = E.tmp('crtG0', gw, gh), g1 = E.tmp('crtG1', gw, gh), g2 = E.tmp('crtG2', gw, gh);
    if (p.halation > 0 || p.diffusion > 0 || bezel) {
      E.pass('crtDown', cur, g0, {});
      E.pass('blur', g0, g1, { uDir: [1, 0], uRad: gh * 0.05 }); E.pass('blur', g1, g0, { uDir: [0, 1], uRad: gh * 0.05 });
      E.pass('blur', g0, g1, { uDir: [1, 0], uRad: gh * 0.16 }); E.pass('blur', g1, g2, { uDir: [0, 1], uRad: gh * 0.16 });
      E.pass('blur', g2, g1, { uDir: [1, 0], uRad: gh * 0.32 }); E.pass('blur', g1, g2, { uDir: [0, 1], uRad: gh * 0.32 });
    }

    // degauss: the colour purity swims and the picture wobbles for a second after a drop
    const drop = E.audio.drop || 0;
    if (p.degauss && drop > 0.6 && !st.dropHi) st.dg = E.t;
    st.dropHi = drop > 0.4;
    const dgT = st.dg === undefined ? 99 : E.t - st.dg;
    const deg = dgT < 3 ? Math.exp(-dgT * 2.2) * Math.min(1, dgT * 25) : 0;

    // 4. the tube
    const bz = bezel ? Math.round(0.07 * Math.min(W, H)) : 0;
    const inner = [0.5 - bz / W, 0.5 - bz / H], half = [W * inner[0], H * inner[1]];
    // beam spot (gaussian sigma, in line spacings): thin on dark lines, wider on bright ones
    const smin = 0.45 - 0.33 * p.scan, smax = smin + p.bloom * (0.55 - 0.33 * p.scan - smin);
    E.pass('crtScreen', cur, dst, { uNear: g0, uWide: g2, uSig: [Ws, rows], uInner: inner, uHalf: half,
      uLines: lines, uIl: il ? 1 : 0, uField: field, uSmin: smin, uSmax: Math.max(smin, smax), uConv: p.converge * 1.6,
      uMT: MASK[p.maskType] ?? 1, uMask: p.mask, uPitch: p.pitch, uHal: p.halation, uDif: p.diffusion, uCurve: p.curve,
      uShape: p.shape === 'cyl' ? 1 : p.shape === 'flat' ? 2 : 0, uCorner: p.corner * Math.min(half[0], half[1]), uVig: p.vig,
      uBz: bezel ? 1 : 0, uBzPx: Math.max(1, bz), uBezel: hexv(p.bezelColor), uRefl: p.reflect,
      uFl: 1 - p.flicker * Math.random(), uDeg: deg, uDegT: dgT });
  }
};
