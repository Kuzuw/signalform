// Effect rack: an ordered chain of GPU effects for a widget (or the whole stage).
// One shared WebGL 2 context runs every rack, so adding effects to many widgets doesn't use up
// GPU contexts. A rack item is { id, type, on, p: { ...params }, mod: { src, amt } }; the module-style
// parameter list of each effect builds its panel. `mod` lets the music drive the effect's main setting.

const VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const HEAD = `#version 300 es
precision highp float;
uniform sampler2D uIn;
uniform vec2 uRes;
uniform float uT, uKick, uBass, uLevel, uHat;
out vec4 o;
#define UV (gl_FragCoord.xy / uRes)
vec4 tx(vec2 uv) { return texture(uIn, uv); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 hue(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
`;
const hexv = (h) => { const s = String(h || '#ffffff').replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255); };

// separable gaussian used by blur, glow and streaks: 9 taps with linear-filtered spacing
const BLUR = `uniform vec2 uDir; uniform float uRad;
void main() {
  vec2 uv = UV, st = uDir * uRad / uRes / 4.0;
  vec4 s = tx(uv) * 0.2270270;
  s += (tx(uv + st * 1.3846153) + tx(uv - st * 1.3846153)) * 0.3162162;
  s += (tx(uv + st * 3.2307692) + tx(uv - st * 3.2307692)) * 0.0702702;
  o = s;
}`;

/* ------------------------------------------------------------------ effects */
// Each effect: name, cat, main (the parameter the music can drive), params, and either `frag`
// (one pass; params arrive as uniforms u_<key>) or `run(E, src, dst, item, st)` for several passes.
export const EFFECTS = {
  glow: {
    name: 'Glow', cat: 'Light', main: 'intensity',
    params: [
      { key: 'intensity', label: 'Intensity', type: 'range', min: 0, max: 4, step: 0.01, default: 1.2 },
      { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'radius', label: 'Radius', type: 'range', min: 1, max: 80, step: 1, default: 24 },
      { key: 'tint', label: 'Tint', type: 'color', default: '#ffffff' }
    ],
    run(E, src, dst, it) {
      const p = it.v, w = Math.max(1, dst.w >> 1), h = Math.max(1, dst.h >> 1);
      const a = E.tmp('ga', w, h), b = E.tmp('gb', w, h);
      E.pass('glowPick', src, a, { u_threshold: p.threshold });
      let r = p.radius * (w / 960 + 0.5) / 2;
      for (let i = 0; i < 3; i++) { E.pass('blur', a, b, { uDir: [1, 0], uRad: r }); E.pass('blur', b, a, { uDir: [0, 1], uRad: r }); r *= 1.8; }
      E.pass('glowAdd', src, dst, { uB: a, u_intensity: p.intensity, u_tint: hexv(p.tint) });
    }
  },
  blur: {
    name: 'Blur', cat: 'Blur', main: 'radius',
    params: [{ key: 'radius', label: 'Radius', type: 'range', min: 0, max: 60, step: 0.5, default: 12, unit: 'px' }],
    run(E, src, dst, it) {
      const r = it.v.radius * dst.w / 1280;
      if (r < 0.3) return E.pass('copy', src, dst, {});
      const a = E.tmp('ba', dst.w, dst.h), b = E.tmp('bb', dst.w, dst.h);
      E.pass('blur', src, a, { uDir: [1, 0], uRad: r }); E.pass('blur', a, b, { uDir: [0, 1], uRad: r });
      if (r > 6) { E.pass('blur', b, a, { uDir: [1, 0], uRad: r * 0.6 }); E.pass('blur', a, dst, { uDir: [0, 1], uRad: r * 0.6 }); }
      else E.pass('copy', b, dst, {});
    }
  },
  motion: {
    name: 'Motion blur', cat: 'Blur', main: 'length',
    params: [
      { key: 'length', label: 'Length', type: 'range', min: 0, max: 0.2, step: 0.001, default: 0.04 },
      { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 180, step: 1, default: 0, unit: '°' }
    ],
    frag: `uniform float u_length, u_angle;
void main() { vec2 d = vec2(cos(radians(u_angle)), sin(radians(u_angle))) * u_length * vec2(uRes.y / uRes.x, 1.0);
  vec4 s = vec4(0.0); for (int i = 0; i < 16; i++) { float k = float(i) / 15.0 - 0.5; s += tx(UV + d * k); } o = s / 16.0; }`
  },
  zoom: {
    name: 'Zoom blur', cat: 'Blur', main: 'amount',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 0.5, step: 0.005, default: 0.12 },
      { key: 'cx', label: 'Centre X', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'cy', label: 'Centre Y', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 }
    ],
    frag: `uniform float u_amount, u_cx, u_cy;
void main() { vec2 c = vec2(u_cx, 1.0 - u_cy), d = (UV - c); vec4 s = vec4(0.0);
  for (int i = 0; i < 20; i++) { float k = 1.0 - u_amount * float(i) / 19.0; s += tx(c + d * k); } o = s / 20.0; }`
  },
  streaks: {
    name: 'Light streaks', cat: 'Light', main: 'intensity',
    params: [
      { key: 'intensity', label: 'Intensity', type: 'range', min: 0, max: 4, step: 0.01, default: 1 },
      { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
      { key: 'length', label: 'Length', type: 'range', min: 4, max: 200, step: 1, default: 70 },
      { key: 'angle', label: 'Direction', type: 'select', default: 'h', options: [['h', 'Horizontal (anamorphic)'], ['v', 'Vertical'], ['x', 'Cross']] },
      { key: 'tint', label: 'Tint', type: 'color', default: '#7fb8ff' }
    ],
    run(E, src, dst, it) {
      const p = it.v, w = Math.max(1, dst.w >> 1), h = Math.max(1, dst.h >> 1);
      const pick = E.tmp('spick', w, h);
      E.pass('glowPick', src, pick, { u_threshold: p.threshold });
      const dirs = p.angle === 'v' ? [[0, 1]] : p.angle === 'x' ? [[1, 0], [0, 1]] : [[1, 0]];
      const outs = dirs.map((d, k) => {
        // a long one-directional blur, doubling the reach each pass
        const A = E.tmp('s' + k + 'a', w, h), B = E.tmp('s' + k + 'b', w, h);
        let from = pick, to = A, r = p.length * (w / 960 + 0.4) / 4;
        for (let i = 0; i < 4; i++) { E.pass('blur', from, to, { uDir: d, uRad: r }); from = to; to = to === A ? B : A; r *= 2; }
        return from;
      });
      let streak = outs[0];
      if (outs.length > 1) { const C = E.tmp('scomb', w, h); E.pass('addTex', outs[0], C, { uB: outs[1], uK: 1 }); streak = C; }
      E.pass('glowAdd', src, dst, { uB: streak, u_intensity: p.intensity * 1.6, u_tint: hexv(p.tint) });
    }
  },
  chroma: {
    name: 'RGB split', cat: 'Lens', main: 'amount',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 0.05, step: 0.0005, default: 0.006 },
      { key: 'mode', label: 'Direction', type: 'select', default: 'radial', options: [['radial', 'From the centre (lens)'], ['linear', 'Sideways']] },
      { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 360, step: 1, default: 0, unit: '°', showIf: { mode: 'linear' } }
    ],
    frag: `uniform float u_amount, u_angle, u_mode;
void main() { vec2 uv = UV, d = u_mode > 0.5 ? (uv - 0.5) * 2.0 * u_amount : vec2(cos(radians(u_angle)), sin(radians(u_angle))) * u_amount;
  o = vec4(tx(uv + d).r, tx(uv).g, tx(uv - d).b, 1.0); }`,
    uniforms: (p) => ({ u_mode: p.mode === 'radial' ? 1 : 0 })
  },
  feedback: {
    name: 'Feedback echo', cat: 'Time', main: 'decay',
    params: [
      { key: 'decay', label: 'Echo length', type: 'range', min: 0, max: 0.98, step: 0.01, default: 0.82 },
      { key: 'zoom', label: 'Zoom per echo', type: 'range', min: 0.9, max: 1.1, step: 0.001, default: 1.012 },
      { key: 'rotate', label: 'Turn per echo', type: 'range', min: -6, max: 6, step: 0.05, default: 0.4, unit: '°' },
      { key: 'shiftX', label: 'Drift X', type: 'range', min: -0.02, max: 0.02, step: 0.0005, default: 0 },
      { key: 'shiftY', label: 'Drift Y', type: 'range', min: -0.02, max: 0.02, step: 0.0005, default: 0 },
      { key: 'hue', label: 'Colour shift per echo', type: 'range', min: -30, max: 30, step: 0.5, default: 0, unit: '°' },
      { key: 'blend', label: 'Blend', type: 'select', default: 'max', options: [['max', 'Lighten'], ['add', 'Add'], ['over', 'Behind']] }
    ],
    run(E, src, dst, it, st) {
      const p = it.v;
      if (!st.prev || st.prev.w !== dst.w || st.prev.h !== dst.h) { if (st.prev) E.free(st.prev); st.prev = E.make(dst.w, dst.h); E.pass('clear', null, st.prev, {}); }
      E.pass('feedback', src, dst, { uB: st.prev, u_decay: p.decay, u_zoom: p.zoom, u_rotate: p.rotate, u_shift: [p.shiftX, -p.shiftY], u_hue: p.hue, u_blend: p.blend === 'add' ? 1 : p.blend === 'over' ? 2 : 0 });
      E.pass('copy', dst, st.prev, {});
    }
  },
  kaleido: {
    name: 'Kaleidoscope', cat: 'Space', main: 'angle',
    params: [
      { key: 'segments', label: 'Segments', type: 'range', min: 2, max: 24, step: 1, default: 6 },
      { key: 'angle', label: 'Turn', type: 'range', min: 0, max: 360, step: 1, default: 0, unit: '°' },
      { key: 'spin', label: 'Spin', type: 'range', min: -90, max: 90, step: 1, default: 0, unit: '°/s' },
      { key: 'zoom', label: 'Zoom', type: 'range', min: 0.3, max: 3, step: 0.01, default: 1 }
    ],
    frag: `uniform float u_segments, u_angle, u_spin, u_zoom;
void main() { vec2 a = uRes / min(uRes.x, uRes.y); vec2 q = (UV - 0.5) * a / u_zoom;
  float r = length(q), th = atan(q.y, q.x) + radians(u_angle + u_spin * uT), s = 6.2831853 / u_segments;
  th = mod(th, s); th = abs(th - s * 0.5);
  o = tx(vec2(cos(th), sin(th)) * r / a + 0.5); }`
  },
  mirror: {
    name: 'Mirror', cat: 'Space', main: 'none',
    params: [{ key: 'mode', label: 'Mirror', type: 'select', default: 'h', options: [['h', 'Left ↔ right'], ['v', 'Top ↕ bottom'], ['quad', 'Four quadrants'], ['hflip', 'Flip right side']] }],
    frag: `uniform float u_mode;
void main() { vec2 uv = UV;
  if (u_mode < 0.5) uv.x = 0.5 - abs(uv.x - 0.5); else if (u_mode < 1.5) uv.y = 0.5 + abs(uv.y - 0.5);
  else if (u_mode < 2.5) uv = vec2(0.5 - abs(uv.x - 0.5), 0.5 + abs(uv.y - 0.5)); else uv.x = 0.5 + abs(uv.x - 0.5);
  o = tx(uv); }`,
    uniforms: (p) => ({ u_mode: ['h', 'v', 'quad', 'hflip'].indexOf(p.mode) })
  },
  warp: {
    name: 'Warp', cat: 'Space', main: 'amount',
    params: [
      { key: 'kind', label: 'Shape', type: 'select', default: 'wave', options: [['wave', 'Waves'], ['ripple', 'Ripples'], ['swirl', 'Swirl'], ['bulge', 'Bulge']] },
      { key: 'amount', label: 'Amount', type: 'range', min: -1, max: 1, step: 0.01, default: 0.25 },
      { key: 'freq', label: 'Frequency', type: 'range', min: 0.5, max: 30, step: 0.1, default: 6 },
      { key: 'speed', label: 'Speed', type: 'range', min: -4, max: 4, step: 0.05, default: 1 }
    ],
    frag: `uniform float u_kind, u_amount, u_freq, u_speed;
void main() { vec2 a = uRes / min(uRes.x, uRes.y); vec2 uv = UV, q = (uv - 0.5) * a; float r = length(q), t = uT * u_speed;
  if (u_kind < 0.5) uv += vec2(sin(uv.y * u_freq * 6.28 + t), cos(uv.x * u_freq * 6.28 + t * 1.3)) * u_amount * 0.03;
  else if (u_kind < 1.5) uv += normalize(q + 1e-5) / a * sin(r * u_freq * 12.0 - t * 3.0) * u_amount * 0.02;
  else if (u_kind < 2.5) { float th = u_amount * 3.0 * smoothstep(0.7, 0.0, r); float c = cos(th), s = sin(th); uv = vec2(c * q.x - s * q.y, s * q.x + c * q.y) / a + 0.5; }
  else uv = q * (1.0 - u_amount * 0.6 * smoothstep(0.7, 0.0, r)) / a + 0.5;
  o = tx(uv); }`,
    uniforms: (p) => ({ u_kind: ['wave', 'ripple', 'swirl', 'bulge'].indexOf(p.kind) })
  },
  pixelate: {
    name: 'Pixelate', cat: 'Stylize', main: 'size',
    params: [
      { key: 'size', label: 'Pixel size', type: 'range', min: 1, max: 80, step: 1, default: 10, unit: 'px' },
      { key: 'shape', label: 'Shape', type: 'select', default: 'square', options: [['square', 'Squares'], ['round', 'LED dots']] }
    ],
    frag: `uniform float u_size, u_shape;
void main() { float s = max(1.0, u_size * uRes.x / 1280.0); vec2 c = (floor(gl_FragCoord.xy / s) + 0.5) * s; vec4 v = texture(uIn, c / uRes);
  if (u_shape > 0.5) v *= smoothstep(0.5, 0.38, length(gl_FragCoord.xy - c) / s); o = v; }`,
    uniforms: (p) => ({ u_shape: p.shape === 'round' ? 1 : 0 })
  },
  halftone: {
    name: 'Halftone', cat: 'Stylize', main: 'size',
    params: [
      { key: 'size', label: 'Dot size', type: 'range', min: 3, max: 40, step: 0.5, default: 9, unit: 'px' },
      { key: 'angle', label: 'Screen angle', type: 'range', min: 0, max: 90, step: 1, default: 45, unit: '°' },
      { key: 'color', label: 'Colour', type: 'select', default: 'source', options: [['source', 'Picture colours'], ['mono', 'Single colour']] },
      { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', showIf: { color: 'mono' } }
    ],
    frag: `uniform float u_size, u_angle, u_color; uniform vec3 u_ink;
void main() { float s = max(2.0, u_size * uRes.x / 1280.0), a = radians(u_angle); mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 p = R * gl_FragCoord.xy, c = (floor(p / s) + 0.5) * s; vec2 cs = transpose(R) * c; vec4 v = texture(uIn, cs / uRes);
  float d = length(p - c) / s, rr = sqrt(clamp(luma(v.rgb), 0.0, 1.0)) * 0.62, m = smoothstep(rr, rr - 0.08, d);
  o = vec4((u_color > 0.5 ? u_ink : v.rgb / max(0.001, max(v.r, max(v.g, v.b)))) * m, 1.0); }`,
    uniforms: (p) => ({ u_color: p.color === 'mono' ? 1 : 0, u_ink: hexv(p.ink) })
  },
  posterize: {
    name: 'Posterize', cat: 'Stylize', main: 'levels',
    params: [
      { key: 'levels', label: 'Levels', type: 'range', min: 2, max: 16, step: 1, default: 4 },
      { key: 'dither', label: 'Dither', type: 'toggle', default: true }
    ],
    frag: `uniform float u_levels, u_dither;
float bayer(vec2 p) { p = floor(mod(p, 4.0)); int i = int(p.x + p.y * 4.0);
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.); return m[i] / 16.0 - 0.47; }
void main() { vec4 v = tx(UV); float n = u_levels - 1.0; vec3 c = v.rgb * n + (u_dither > 0.5 ? bayer(gl_FragCoord.xy) : 0.0); o = vec4(floor(c + 0.5) / n, 1.0); }`
  },
  edges: {
    name: 'Edge glow', cat: 'Stylize', main: 'strength',
    params: [
      { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 6, step: 0.05, default: 2 },
      { key: 'keep', label: 'Keep the picture', type: 'range', min: 0, max: 1, step: 0.01, default: 0.2 },
      { key: 'color', label: 'Edge colour', type: 'select', default: 'source', options: [['source', 'Picture colours'], ['mono', 'Single colour']] },
      { key: 'ink', label: 'Colour', type: 'color', default: '#5ad1ff', showIf: { color: 'mono' } }
    ],
    frag: `uniform float u_strength, u_keep, u_color; uniform vec3 u_ink;
void main() { vec2 e = 1.0 / uRes; vec3 c = tx(UV).rgb;
  vec3 gx = -tx(UV + vec2(-e.x, e.y)).rgb - 2.0 * tx(UV + vec2(-e.x, 0)).rgb - tx(UV - e).rgb + tx(UV + e).rgb + 2.0 * tx(UV + vec2(e.x, 0)).rgb + tx(UV + vec2(e.x, -e.y)).rgb;
  vec3 gy = -tx(UV - e).rgb - 2.0 * tx(UV - vec2(0, e.y)).rgb - tx(UV + vec2(e.x, -e.y)).rgb + tx(UV + vec2(-e.x, e.y)).rgb + 2.0 * tx(UV + vec2(0, e.y)).rgb + tx(UV + e).rgb;
  float g = length(vec2(luma(gx), luma(gy))) * u_strength;
  vec3 col = u_color > 0.5 ? u_ink : normalize(c + 0.05) * 1.6;
  o = vec4(c * u_keep + col * g, 1.0); }`,
    uniforms: (p) => ({ u_color: p.color === 'mono' ? 1 : 0, u_ink: hexv(p.ink) })
  },
  grade: {
    name: 'Colour grade', cat: 'Colour', main: 'exposure',
    params: [
      { key: 'exposure', label: 'Exposure', type: 'range', min: -3, max: 3, step: 0.01, default: 0, unit: ' EV' },
      { key: 'contrast', label: 'Contrast', type: 'range', min: 0, max: 3, step: 0.01, default: 1 },
      { key: 'saturation', label: 'Saturation', type: 'range', min: 0, max: 3, step: 0.01, default: 1 },
      { key: 'hue', label: 'Hue shift', type: 'range', min: -180, max: 180, step: 1, default: 0, unit: '°' },
      { key: 'gamma', label: 'Gamma', type: 'range', min: 0.3, max: 3, step: 0.01, default: 1 },
      { key: 'tint', label: 'Tint', type: 'color', default: '#ff9a3d' },
      { key: 'tintAmt', label: 'Tint amount', type: 'range', min: 0, max: 1, step: 0.01, default: 0 },
      { key: 'invert', label: 'Invert', type: 'toggle', default: false }
    ],
    frag: `uniform float u_exposure, u_contrast, u_saturation, u_hue, u_gamma, u_tintAmt, u_invert; uniform vec3 u_tint;
void main() { vec3 c = tx(UV).rgb * exp2(u_exposure);
  c = hue(c, radians(u_hue)); float l = luma(c); c = mix(vec3(l), c, u_saturation);
  c = (c - 0.5) * u_contrast + 0.5; c = pow(max(c, 0.0), vec3(1.0 / u_gamma));
  c = mix(c, c * u_tint * 1.6 + u_tint * l * 0.2, u_tintAmt); if (u_invert > 0.5) c = 1.0 - c; o = vec4(c, 1.0); }`,
    uniforms: (p) => ({ u_tint: hexv(p.tint), u_invert: p.invert ? 1 : 0 })
  },
  gradmap: {
    name: 'Gradient map', cat: 'Colour', main: 'amount',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 'c1', label: 'Shadows', type: 'color', default: '#10061f' },
      { key: 'c2', label: 'Mid-tones', type: 'color', default: '#d6336c' },
      { key: 'c3', label: 'Highlights', type: 'color', default: '#ffe8a3' }
    ],
    frag: `uniform float u_amount; uniform vec3 u_c1, u_c2, u_c3;
void main() { vec3 c = tx(UV).rgb; float l = clamp(luma(c), 0.0, 1.0);
  vec3 g = l < 0.5 ? mix(u_c1, u_c2, l * 2.0) : mix(u_c2, u_c3, l * 2.0 - 1.0); o = vec4(mix(c, g, u_amount), 1.0); }`,
    uniforms: (p) => ({ u_c1: hexv(p.c1), u_c2: hexv(p.c2), u_c3: hexv(p.c3) })
  },
  threshold: {
    name: 'Ink threshold', cat: 'Colour', main: 'level',
    params: [
      { key: 'level', label: 'Level', type: 'range', min: 0, max: 1, step: 0.01, default: 0.35 },
      { key: 'soft', label: 'Softness', type: 'range', min: 0, max: 0.5, step: 0.01, default: 0.04 },
      { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff' },
      { key: 'paper', label: 'Paper', type: 'color', default: '#000000' }
    ],
    frag: `uniform float u_level, u_soft; uniform vec3 u_ink, u_paper;
void main() { float l = luma(tx(UV).rgb); o = vec4(mix(u_paper, u_ink, smoothstep(u_level - u_soft, u_level + u_soft + 1e-4, l)), 1.0); }`,
    uniforms: (p) => ({ u_ink: hexv(p.ink), u_paper: hexv(p.paper) })
  },
  grain: {
    name: 'Film grain', cat: 'Texture', main: 'amount',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 0.6, step: 0.005, default: 0.12 },
      { key: 'size', label: 'Grain size', type: 'range', min: 1, max: 4, step: 0.1, default: 1.4 },
      { key: 'colour', label: 'Colour grain', type: 'toggle', default: false }
    ],
    frag: `uniform float u_amount, u_size, u_colour;
void main() { vec4 v = tx(UV); vec2 p = floor(gl_FragCoord.xy / u_size) + floor(uT * 24.0) * 17.0;
  vec3 n = u_colour > 0.5 ? vec3(hash(p), hash(p + 3.1), hash(p + 7.7)) - 0.5 : vec3(hash(p) - 0.5);
  float l = luma(v.rgb); o = vec4(v.rgb + n * u_amount * (0.35 + 0.65 * (1.0 - abs(l - 0.5) * 2.0)), 1.0); }`,
    uniforms: (p) => ({ u_colour: p.colour ? 1 : 0 })
  },
  crt: {
    name: 'CRT screen', cat: 'Texture', main: 'scan',
    params: [
      { key: 'scan', label: 'Scanlines', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
      { key: 'lines', label: 'Line count', type: 'range', min: 120, max: 1080, step: 10, default: 360 },
      { key: 'mask', label: 'RGB mask', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: 'curve', label: 'Curvature', type: 'range', min: 0, max: 0.4, step: 0.005, default: 0.12 },
      { key: 'vig', label: 'Vignette', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'flicker', label: 'Flicker', type: 'range', min: 0, max: 0.3, step: 0.005, default: 0.03 }
    ],
    frag: `uniform float u_scan, u_lines, u_mask, u_curve, u_vig, u_flicker;
void main() { vec2 q = UV * 2.0 - 1.0; q *= 1.0 + u_curve * dot(q, q) * 0.5; vec2 uv = q * 0.5 + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { o = vec4(0, 0, 0, 1); return; }
  vec3 c = tx(uv).rgb;
  float s = 0.5 + 0.5 * cos(uv.y * u_lines * 6.2831853); c *= 1.0 - u_scan * (1.0 - s) * 0.85;
  float m = mod(gl_FragCoord.x, 3.0); vec3 mk = m < 1.0 ? vec3(1.0, 0.35, 0.35) : m < 2.0 ? vec3(0.35, 1.0, 0.35) : vec3(0.35, 0.35, 1.0);
  c *= mix(vec3(1.0), mk * 1.35, u_mask);
  c *= 1.0 - u_vig * dot(q, q) * 0.45; c *= 1.0 - u_flicker * hash(vec2(floor(uT * 60.0), 1.0));
  o = vec4(c, 1.0); }`
  },
  glitch: {
    name: 'Glitch', cat: 'Texture', main: 'amount',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: 'blocks', label: 'Block size', type: 'range', min: 4, max: 80, step: 1, default: 24, unit: 'px' },
      { key: 'split', label: 'Colour tear', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'rate', label: 'Change rate', type: 'range', min: 1, max: 60, step: 1, default: 12, unit: '/s' }
    ],
    frag: `uniform float u_amount, u_blocks, u_split, u_rate;
void main() { vec2 uv = UV; float tt = floor(uT * u_rate); float bs = u_blocks * uRes.x / 1280.0;
  vec2 b = floor(gl_FragCoord.xy / vec2(bs * 4.0, bs)); float r = hash(b + tt);
  float on = step(1.0 - u_amount * 0.6, r);
  uv.x += on * (hash(b * 1.7 + tt) - 0.5) * 0.2 * u_amount;
  float line = step(1.0 - u_amount * 0.15, hash(vec2(floor(gl_FragCoord.y / 3.0), tt)));
  uv.x += line * (hash(vec2(tt, gl_FragCoord.y)) - 0.5) * 0.05;
  float sp = (on + line) * u_split * 0.02;
  vec3 c = vec3(tx(uv + vec2(sp, 0)).r, tx(uv).g, tx(uv - vec2(sp, 0)).b);
  if (on > 0.5 && hash(b + tt + 5.0) > 0.9) c = 1.0 - c;
  o = vec4(c, 1.0); }`
  },
  vignette: {
    name: 'Vignette', cat: 'Lens', main: 'amount',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'soft', label: 'Softness', type: 'range', min: 0.05, max: 1, step: 0.01, default: 0.45 },
      { key: 'color', label: 'Colour', type: 'color', default: '#000000' }
    ],
    frag: `uniform float u_amount, u_soft; uniform vec3 u_color;
void main() { vec2 a = uRes / max(uRes.x, uRes.y); float d = length((UV - 0.5) * a) * 1.414;
  vec3 c = tx(UV).rgb; o = vec4(mix(c, u_color, smoothstep(1.0 - u_soft, 1.0 + 0.0001, d + (1.0 - u_amount) * 0.6) * u_amount), 1.0); }`,
    uniforms: (p) => ({ u_color: hexv(p.color) })
  },
  sharpen: {
    name: 'Sharpen', cat: 'Lens', main: 'amount',
    params: [{ key: 'amount', label: 'Amount', type: 'range', min: 0, max: 3, step: 0.01, default: 0.8 }],
    frag: `uniform float u_amount;
void main() { vec2 e = 1.0 / uRes; vec3 c = tx(UV).rgb, b = (tx(UV + vec2(e.x, 0)).rgb + tx(UV - vec2(e.x, 0)).rgb + tx(UV + vec2(0, e.y)).rgb + tx(UV - vec2(0, e.y)).rgb) * 0.25;
  o = vec4(c + (c - b) * u_amount * 2.0, 1.0); }`
  },
  strobe: {
    name: 'Strobe', cat: 'Time', main: 'amount', defaultMod: { src: 'kick', amt: 1 },
    params: [
      { key: 'amount', label: 'Flash', type: 'range', min: 0, max: 1, step: 0.01, default: 0 },
      { key: 'mode', label: 'Flash with', type: 'select', default: 'white', options: [['white', 'White'], ['invert', 'Inverted picture'], ['black', 'Blackout'], ['color', 'A colour']] },
      { key: 'color', label: 'Colour', type: 'color', default: '#ff3d6e', showIf: { mode: 'color' } }
    ],
    frag: `uniform float u_amount, u_mode; uniform vec3 u_color;
void main() { vec3 c = tx(UV).rgb, f = u_mode < 0.5 ? vec3(1.0) : u_mode < 1.5 ? 1.0 - c : u_mode < 2.5 ? vec3(0.0) : u_color;
  o = vec4(mix(c, f, clamp(u_amount, 0.0, 1.0) * (u_mode < 0.5 || u_mode > 2.5 ? 0.85 : 1.0)), 1.0); }`,
    uniforms: (p) => ({ u_mode: ['white', 'invert', 'black', 'color'].indexOf(p.mode), u_color: hexv(p.color) })
  }
};

// passes used by the multi-pass effects
const INTERNAL = {
  copy: `void main() { o = tx(UV); }`,
  clear: `void main() { o = vec4(0.0); }`,
  blur: BLUR,
  glowPick: `uniform float u_threshold;
void main() { vec3 c = tx(UV).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c * smoothstep(u_threshold, u_threshold + 0.25, l), 1.0); }`,
  glowAdd: `uniform sampler2D uB; uniform float u_intensity; uniform vec3 u_tint;
void main() { vec3 c = tx(UV).rgb, g = texture(uB, UV).rgb * u_tint * u_intensity; o = vec4(c + g - c * g * 0.25, 1.0); }`,
  addTex: `uniform sampler2D uB; uniform float uK; void main() { o = tx(UV) + texture(uB, UV) * uK; }`,
  feedback: `uniform sampler2D uB; uniform float u_decay, u_zoom, u_rotate, u_hue, u_blend; uniform vec2 u_shift;
void main() { vec2 a = uRes / min(uRes.x, uRes.y); vec2 q = (UV - 0.5) * a; float r = radians(u_rotate);
  q = mat2(cos(r), sin(r), -sin(r), cos(r)) * q / u_zoom; vec2 uv = q / a + 0.5 - u_shift;
  vec3 prev = (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) ? hue(texture(uB, uv).rgb, radians(u_hue)) * u_decay : vec3(0.0);
  vec3 c = tx(UV).rgb;
  o = vec4(u_blend < 0.5 ? max(c, prev) : u_blend < 1.5 ? c + prev * (1.0 - luma(c)) : mix(prev, c, clamp(luma(c) * 3.0, 0.0, 1.0)), 1.0); }`
};

export const EFFECT_CATS = ['Light', 'Blur', 'Colour', 'Stylize', 'Space', 'Lens', 'Texture', 'Time'];
export const MOD_SOURCES = [['none', 'Nothing'], ['level', 'Loudness'], ['bass', 'Bass'], ['mid', 'Mids'], ['high', 'Highs'], ['kick', 'Kicks'], ['snare', 'Snares'], ['hat', 'Hi-hats'], ['build', 'Build-ups'], ['drop', 'Drops']];

let nextId = 1;
export function newItem(type) {
  const E = EFFECTS[type], p = {};
  for (const q of E.params) p[q.key] = q.default;
  return { id: 'fx' + Date.now().toString(36) + (nextId++), type, on: true, p, mod: { ...(E.defaultMod || { src: 'none', amt: 0.5 }) } };
}
export function normalizeRack(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((it) => it && EFFECTS[it.type]).map((it) => {
    const E = EFFECTS[it.type], p = {};
    for (const q of E.params) p[q.key] = it.p && q.key in it.p ? it.p[q.key] : q.default;
    return { id: it.id || 'fx' + (nextId++), type: it.type, on: it.on !== false, p, mod: { src: (it.mod && it.mod.src) || 'none', amt: it.mod && typeof it.mod.amt === 'number' ? it.mod.amt : 0.5 } };
  });
}
export const rackActive = (list) => !!list && list.some((it) => it.on && EFFECTS[it.type]);

/* ------------------------------------------------------------------ engine */
class Engine {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 16; this.canvas.height = 16;
    const gl = this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL 2 is not available');
    this.half = !!gl.getExtension('EXT_color_buffer_float');
    this.progs = new Map(); this.tmps = new Map();
    this.vao = gl.createVertexArray();
    this.input = this.make(16, 16);
    this.frame = 0;
  }
  make(w, h) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.half ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, this.half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, fb, w, h };
  }
  free(x) { const gl = this.gl; gl.deleteTexture(x.t); gl.deleteFramebuffer(x.fb); }
  tmp(name, w, h) {
    const k = name + w + 'x' + h; let x = this.tmps.get(k);
    if (!x) { x = this.make(w, h); this.tmps.set(k, x); }
    x.used = this.frame;
    return x;
  }
  prog(name, src) {
    let p = this.progs.get(name);
    if (p) return p;
    const gl = this.gl;
    const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, HEAD + src)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    const locs = new Map();
    p = { pr, u: (n) => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(pr, n)); return locs.get(n); } };
    this.progs.set(name, p);
    return p;
  }
  // one full-screen pass from `src` (or nothing) into `dst` (a target, or null for the canvas)
  pass(name, src, dst, uniforms, _sameOk) {
    const gl = this.gl, P = this.prog(name, INTERNAL[name] || (EFFECTS[name] && EFFECTS[name].frag));
    gl.useProgram(P.pr);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    const w = dst ? dst.w : this.outW, h = dst ? dst.h : this.outH;
    gl.viewport(0, 0, w, h);
    let unit = 0;
    if (src) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform1i(P.u('uIn'), 0); unit = 1; }
    gl.uniform2f(P.u('uRes'), w, h);
    const A = this.audio;
    gl.uniform1f(P.u('uT'), this.t); gl.uniform1f(P.u('uKick'), A.kick); gl.uniform1f(P.u('uBass'), A.bass); gl.uniform1f(P.u('uLevel'), A.level); gl.uniform1f(P.u('uHat'), A.hat);
    for (const k in uniforms) {
      const v = uniforms[k], l = P.u(k);
      if (l === null || v === undefined) continue;
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (typeof v === 'boolean') gl.uniform1f(l, v ? 1 : 0);
      else if (v.t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.t); gl.uniform1i(l, unit); unit++; }
      else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // Run `items` over `input` (a canvas) and draw the result into `outCtx` (W × H).
  run(input, outCtx, W, H, items, state, F, t) {
    const gl = this.gl;
    this.frame++;
    this.t = t;
    this.audio = { kick: F.kick || 0, bass: F.bass || 0, level: F.level || 0, hat: F.hat || 0 };
    if (this.canvas.width < W || this.canvas.height < H) { this.canvas.width = Math.max(this.canvas.width, W); this.canvas.height = Math.max(this.canvas.height, H); }
    this.outW = W; this.outH = H;
    const inp = this.tmp('in', W, H);
    gl.bindTexture(gl.TEXTURE_2D, inp.t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.half ? gl.RGBA16F : gl.RGBA8, gl.RGBA, this.half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, input);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const P1 = this.tmp('pp1', W, H), P2 = this.tmp('pp2', W, H);
    let a = inp;
    const on = items.filter((it) => it.on && EFFECTS[it.type]);
    for (const it of on) {
      const E = EFFECTS[it.type];
      // the music drives the effect's main setting
      const v = { ...it.p };
      if (it.mod && it.mod.src !== 'none' && E.main !== 'none') {
        const q = E.params.find((x) => x.key === E.main), s = Math.min(1.5, F[it.mod.src] || 0);
        if (q) v[q.key] = Math.min(q.max, Math.max(q.min, v[q.key] + it.mod.amt * (q.max - q.min) * s));
      }
      const st = state[it.id] || (state[it.id] = {});
      st.used = this.frame;
      const dst = a === P1 ? P2 : P1;
      if (E.run) E.run(this, a, dst, { ...it, v }, st);
      else {
        const u = {};
        for (const q of E.params) if (q.type === 'range') u['u_' + q.key] = v[q.key]; else if (q.type === 'toggle') u['u_' + q.key] = v[q.key] ? 1 : 0;
        Object.assign(u, E.uniforms ? E.uniforms(v) : {});
        this.pass(it.type, a, dst, u);
      }
      a = dst;
    }
    this.pass('copy', a, null, {});
    outCtx.globalCompositeOperation = 'source-over'; outCtx.globalAlpha = 1; outCtx.filter = 'none';
    outCtx.drawImage(this.canvas, 0, this.canvas.height - H, W, H, 0, 0, W, H);
    // forget state of effects that were removed
    for (const k in state) if (state[k].used !== this.frame && this.frame - (state[k].used || 0) > 120) { if (state[k].prev) this.free(state[k].prev); delete state[k]; }
    if (this.frame % 600 === 0) for (const [k, x] of this.tmps) if (this.frame - (x.used || 0) > 600) { this.free(x); this.tmps.delete(k); }
  }
}

let engine = null, failed = '';
export function fxEngine() {
  if (engine || failed) return engine;
  try { engine = new Engine(); } catch (e) { failed = e.message; console.warn('effect rack unavailable:', e); }
  return engine;
}
export function engineError() { return failed; }
