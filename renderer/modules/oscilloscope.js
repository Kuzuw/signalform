import { hexToRgb, hexToVec, rgba, TAU } from './util.js';
import { tracePicture, loadPicture, pictureGray } from './picture-trace.js';

// An analog oscilloscope simulated from the electron beam up.
//
// Every audio sample is used (the audio thread streams the signal into F.scope). The beam moves
// continuously from sample to sample (Catmull-Rom upsampling), and each short move is drawn on the GPU
// as a gaussian spot smeared along the segment: the exact integral of the spot over the path, so a
// slow beam burns bright and a fast one leaves a faint line, like a real CRT. The light lands in a
// floating-point phosphor buffer with two components (a fast flash and a slow afterglow, P7-style),
// each fading with its own time constant. Segments drawn within one frame are pre-faded by their age,
// so persistence is exact at any frame rate. Halation (bloom), an etched graticule and the glass are
// added when the buffer is shown.
//
// Modes: X/Y (left → X, right → Y), Y/T with a triggered time base (timebase, trigger source, slope,
// level, auto/normal, holdoff, dual trace / add), and the beam drawing a shape or a picture
// (oscilloscope art), which the sound pushes around.

const PHOSPHORS = {
  //        fast colour          slow colour          τ fast  τ slow  fast mix  slow mix
  p31: { f: [0.24, 1.0, 0.48], s: [0.16, 0.8, 0.34], tf: 0.025, ts: 0.14, mf: 1, ms: 0.3 },
  p1: { f: [0.38, 1.0, 0.16], s: [0.3, 0.85, 0.1], tf: 0.03, ts: 0.3, mf: 0.8, ms: 0.6 },
  p7: { f: [0.55, 0.68, 1.0], s: [0.86, 1.0, 0.24], tf: 0.02, ts: 1.4, mf: 1, ms: 0.55 },
  p4: { f: [0.9, 0.94, 1.0], s: [0.92, 0.9, 0.84], tf: 0.02, ts: 0.12, mf: 1, ms: 0.25 },
  p11: { f: [0.3, 0.52, 1.0], s: [0.3, 0.45, 0.95], tf: 0.02, ts: 0.07, mf: 1, ms: 0.2 },
  p3: { f: [1.0, 0.68, 0.18], s: [1.0, 0.6, 0.12], tf: 0.03, ts: 0.25, mf: 1, ms: 0.4 }
};
const VDIV = [[0.01, '10 mV'], [0.02, '20 mV'], [0.05, '50 mV'], [0.1, '0.1 V'], [0.2, '0.2 V'], [0.5, '0.5 V'], [1, '1 V'], [2, '2 V']];
const TDIV = [[0.0001, '0.1 ms'], [0.0002, '0.2 ms'], [0.0005, '0.5 ms'], [0.001, '1 ms'], [0.002, '2 ms'], [0.005, '5 ms'], [0.01, '10 ms'], [0.02, '20 ms'], [0.05, '50 ms']];
const MAX_SAMPLES = 8192;          // a stalled frame draws at most the latest ~170 ms
const PIC_SPAN = 3.7;              // a picture or shape spans ±3.7 divisions at size 1

function presetShape(name) {
  const pts = [], M = 240;
  for (let i = 0; i < M; i++) {
    const u = i / M * TAU;
    let x, y;
    if (name === 'square') { const s = (i / M) * 4, k = Math.floor(s), f = s - k; [x, y] = [[-1 + 2 * f, -1], [1, -1 + 2 * f], [1 - 2 * f, 1], [-1, 1 - 2 * f]][k]; x *= 0.8; y *= 0.8; }
    else if (name === 'triangle') { const s = (i / M) * 3, k = Math.floor(s), f = s - k, v = [[0, -0.95], [0.85, 0.6], [-0.85, 0.6]], a = v[k], b = v[(k + 1) % 3]; x = a[0] + (b[0] - a[0]) * f; y = a[1] + (b[1] - a[1]) * f; }
    else if (name === 'star') { const s = (i / M) * 10, k = Math.floor(s), f = s - k, pt = (j) => { const r = j % 2 ? 0.4 : 1, a = j / 10 * TAU - Math.PI / 2; return [Math.cos(a) * r, Math.sin(a) * r]; }, a = pt(k), b = pt(k + 1); x = a[0] + (b[0] - a[0]) * f; y = a[1] + (b[1] - a[1]) * f; }
    else if (name === 'heart') { x = 16 * Math.pow(Math.sin(u), 3) / 17; y = -(13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u)) / 17; }
    else if (name === 'infinity') { x = Math.cos(u) / (1 + Math.sin(u) ** 2); y = Math.sin(u) * Math.cos(u) / (1 + Math.sin(u) ** 2) * 1.3; }
    else { x = Math.cos(u) * 0.9; y = Math.sin(u) * 0.9; }
    pts.push([x, y]);
  }
  return pts;
}
// even spacing by arc length so the beam speed stays constant around the shape
function resample(pts, M, closed) {
  if (pts.length < 2) return presetShape('circle');
  const P = closed ? [...pts, pts[0]] : pts, L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = L[L.length - 1] || 1, out = [];
  let j = 1;
  for (let i = 0; i < M; i++) {
    const d = i / M * total;
    while (j < L.length - 1 && L[j] < d) j++;
    const f = (d - L[j - 1]) / ((L[j] - L[j - 1]) || 1);
    out.push([P[j - 1][0] + (P[j][0] - P[j - 1][0]) * f, P[j - 1][1] + (P[j][1] - P[j - 1][1]) * f]);
  }
  return out;
}

/* ------------------------------------------------------------------ GPU */
const FS_VERT = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const SEG_VERT = `#version 300 es
layout(location = 0) in vec4 aSeg;     // x0 y0 x1 y1 (pixels)
layout(location = 1) in vec2 aE;       // energy into the fast and slow phosphor
uniform vec2 uRes; uniform float uSig;
out vec2 vP; flat out vec2 vA; flat out vec2 vDir; flat out float vL; flat out vec2 vE;
void main() {
  vec2 a = aSeg.xy, b = aSeg.zw, d = b - a;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
  float r = uSig * 3.5;
  vec2 c = vec2[6](vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(1, 0), vec2(1, 1), vec2(0, 1))[gl_VertexID];
  vec2 p = a + dir * (-r + c.x * (L + 2.0 * r)) + nrm * (-r + c.y * 2.0 * r);
  vP = p; vA = a; vDir = dir; vL = L; vE = aE;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;
const SEG_FRAG = `#version 300 es
precision highp float;
in vec2 vP; flat in vec2 vA; flat in vec2 vDir; flat in float vL; flat in vec2 vE;
uniform float uSig;
out vec4 o;
float erf_(float x) { float s = sign(x), a = abs(x); float t = 1.0 / (1.0 + 0.3275911 * a);
  return s * (1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a)); }
void main() {
  vec2 q = vP - vA;
  float u = dot(q, vDir), v = dot(q, vec2(-vDir.y, vDir.x));
  float s2 = uSig * 1.41421356, norm = 1.0 / (6.2831853 * uSig * uSig);
  float I;
  // a gaussian spot integrated along the segment; a (near) standing beam is just the spot
  if (vL < uSig * 0.05) I = norm * exp(-(u * u + v * v) / (2.0 * uSig * uSig));
  else I = norm * exp(-v * v / (2.0 * uSig * uSig)) * uSig * 1.2533141 / vL * (erf_(u / s2) - erf_((u - vL) / s2));
  o = vec4(I * vE, 0.0, 0.0);
}`;
const DECAY_FRAG = `#version 300 es
precision mediump float; out vec4 o; void main() { o = vec4(0.0); }`;
const DOWN_FRAG = `#version 300 es
precision highp float; uniform sampler2D uTex; uniform vec2 uTexel; out vec4 o;
void main() { vec2 uv = gl_FragCoord.xy * uTexel * 4.0;
  vec2 t = uTexel; o = 0.25 * (texture(uTex, uv + vec2(-t.x, -t.y)) + texture(uTex, uv + vec2(t.x, -t.y)) + texture(uTex, uv + vec2(-t.x, t.y)) + texture(uTex, uv + vec2(t.x, t.y))); }`;
const BLUR_FRAG = `#version 300 es
precision highp float; uniform sampler2D uTex; uniform vec2 uStep; uniform vec2 uSize; out vec4 o;
void main() { vec2 uv = gl_FragCoord.xy / uSize;
  const float w[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec4 s = texture(uTex, uv) * w[0];
  for (int i = 1; i < 5; i++) { s += texture(uTex, uv + uStep * float(i) * 1.5) * w[i]; s += texture(uTex, uv - uStep * float(i) * 1.5) * w[i]; }
  o = s; }`;
const COMP_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uPhos, uBloom;
uniform vec2 uRes, uCenter;
uniform float uDiv, uExpo, uBloomAmt, uGrid, uGlass, uWhite, uT;
uniform vec3 uColF, uColS, uGridCol, uBack;
uniform vec2 uMix;
out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float line(float d, float w) { return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, abs(d)); }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 p = texture(uPhos, uv), b = texture(uBloom, uv);
  vec3 beam = (uColF * p.r * uMix.x + uColS * p.g * uMix.y) * uExpo;
  vec3 halo = (uColF * b.r * uMix.x + uColS * b.g * uMix.y) * uExpo * uBloomAmt;
  // phosphor glow saturates towards a white-hot core, like an overdriven trace
  vec3 c = 1.0 - exp(-beam);
  float pk = max(c.r, max(c.g, c.b));
  c = mix(c, vec3(1.0, 1.0, 0.97) * pk, smoothstep(0.6, 1.0, pk) * 0.55 * uWhite);
  c += (1.0 - exp(-halo)) * 0.9;
  // the unlit screen and the etched graticule (10 × 8 divisions, centre axes with minor ticks)
  vec2 g = (gl_FragCoord.xy - uCenter) / uDiv;
  float px = 1.0 / uDiv;
  vec3 base = uBack;
  if (uGrid > 0.0 && abs(g.x) <= 5.0 + px && abs(g.y) <= 4.0 + px) {
    vec2 fd = (g - floor(g + 0.5)) * uDiv;                       // distance to the nearest division line, in pixels
    float L = max(line(fd.x, 1.0) * step(abs(g.x), 5.0 + px), line(fd.y, 1.0));
    vec2 ft = (g * 5.0 - floor(g * 5.0 + 0.5)) * uDiv / 5.0;      // minor ticks on the centre axes
    float T = max(line(ft.x, 1.0) * step(abs(g.y), 0.1), line(ft.y, 1.0) * step(abs(g.x), 0.1));
    float edge = max(line((abs(g.x) - 5.0) * uDiv, 1.6) * step(abs(g.y), 4.0), line((abs(g.y) - 4.0) * uDiv, 1.6) * step(abs(g.x), 5.0));
    float dots = max(L, T) * 0.55 + edge * 0.8;
    // the scale is lit from its edge and catches the trace's light
    base += uGridCol * dots * (uGrid + dot(c, vec3(0.3)) * 0.5);
  }
  vec3 col = base + c;
  if (uGlass > 0.0) {
    vec2 q = uv - 0.5;
    col *= 1.0 - dot(q, q) * 0.55 * uGlass;                        // the tube is darker towards its corners
    col += vec3(0.012, 0.014, 0.016) * uGlass * smoothstep(0.75, 0.0, length(uv - vec2(0.25, 0.85)));   // a soft reflection on the glass
    col += (hash(gl_FragCoord.xy + fract(uT) * 91.0) - 0.5) * 0.012 * uGlass;
  }
  o = vec4(col, 1.0);
}`;

function makeGL(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  const floatOK = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = (vs, fs) => {
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const locs = new Map();
    return { p, u: (n) => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(p, n)); return locs.get(n); } };
  };
  const P = { seg: prog(SEG_VERT, SEG_FRAG), decay: prog(FS_VERT, DECAY_FRAG), down: prog(FS_VERT, DOWN_FRAG), blur: prog(FS_VERT, BLUR_FRAG), comp: prog(FS_VERT, COMP_FRAG) };
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(0, 1);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16); gl.vertexAttribDivisor(1, 1);
  const empty = gl.createVertexArray();
  const target = (w, h) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, floatOK ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, floatOK ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { t, fb, w, h };
  };
  return { gl, P, vao, empty, buf, target, floatOK, cap: 0 };
}

export default {
  id: 'oscilloscope',
  name: 'Oscilloscope',
  tagline: 'Signal rendered through light.',
  params: [
    { key: 'mode', label: 'Mode', type: 'select', default: 'xy', options: [['xy', 'X/Y (left → X, right → Y)'], ['yt', 'Y/T (time base)'], ['shape', 'Beam draws a shape'], ['picture', 'Beam draws a picture']] },
    // ---- vertical
    { key: 'vdiv', label: 'Volts / div', type: 'select', default: '0.2', section: 'Vertical', options: VDIV.map(([v, l]) => [String(v), l]) },
    { key: 'gain', label: 'Variable gain', type: 'range', min: 0.25, max: 4, step: 0.05, default: 1 },
    { key: 'channels', label: 'Display', type: 'select', default: 'both', showIf: { mode: 'yt' }, options: [['both', 'Dual (CH1 + CH2)'], ['l', 'CH1 (left)'], ['r', 'CH2 (right)'], ['mix', 'Add (CH1 + CH2)']] },
    { key: 'pos1', label: 'CH1 position', type: 'range', min: -4, max: 4, step: 0.1, default: 0, unit: 'div', showIf: { mode: 'yt' } },
    { key: 'pos2', label: 'CH2 position', type: 'range', min: -4, max: 4, step: 0.1, default: 0, unit: 'div', showIf: { mode: 'yt' } },
    { key: 'rotate', label: 'Rotate 45° (mid / side)', type: 'toggle', default: false, showIf: { mode: 'xy' } },
    { key: 'posX', label: 'X position', type: 'range', min: -4, max: 4, step: 0.1, default: 0, unit: 'div', showIf: { mode: ['xy', 'shape', 'picture'] } },
    { key: 'posY', label: 'Y position', type: 'range', min: -3, max: 3, step: 0.1, default: 0, unit: 'div', showIf: { mode: ['xy', 'shape', 'picture'] } },
    // ---- time base and trigger
    { key: 'tdiv', label: 'Time / div', type: 'select', default: '0.002', section: 'Time base and trigger', showIf: { mode: 'yt' }, options: TDIV.map(([v, l]) => [String(v), l]) },
    { key: 'trigMode', label: 'Trigger mode', type: 'select', default: 'auto', showIf: { mode: 'yt' }, options: [['auto', 'Auto'], ['normal', 'Normal (waits for a trigger)'], ['free', 'Free run']] },
    { key: 'trigSrc', label: 'Trigger source', type: 'select', default: 'l', showIf: { mode: 'yt' }, options: [['l', 'CH1'], ['r', 'CH2'], ['mix', 'CH1 + CH2']] },
    { key: 'slope', label: 'Slope', type: 'select', default: 'rise', showIf: { mode: 'yt' }, options: [['rise', 'Rising ↗'], ['fall', 'Falling ↘']] },
    { key: 'level', label: 'Trigger level', type: 'range', min: -0.5, max: 0.5, step: 0.005, default: 0, unit: 'V', showIf: { mode: 'yt' } },
    { key: 'holdoff', label: 'Holdoff', type: 'range', min: 0, max: 100, step: 1, default: 0, unit: 'ms', showIf: { mode: 'yt' } },
    // ---- beam drawing
    { key: 'shape', label: 'Shape', type: 'select', default: 'circle', section: 'Beam drawing', showIf: { mode: 'shape' }, options: [['circle', 'Circle'], ['square', 'Square'], ['triangle', 'Triangle'], ['star', 'Star'], ['heart', 'Heart'], ['infinity', 'Infinity'], ['custom', 'My drawing']] },
    { key: 'draw', label: 'Draw a shape on the widget', type: 'action', showIf: { mode: 'shape' } },
    { key: 'customShape', type: 'hidden', default: null },
    { key: 'loadPicture', label: 'Choose a picture…', type: 'action', showIf: { mode: 'picture' } },
    { key: 'picture', type: 'hidden', default: null },
    { key: 'picDetail', label: 'Beam points', type: 'range', min: 500, max: 12000, step: 100, default: 4000, showIf: { mode: 'picture' } },
    { key: 'picEdges', label: 'Edge detail', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45, showIf: { mode: 'picture' } },
    { key: 'picShade', label: 'Shade dark areas', type: 'range', min: 0, max: 1, step: 0.01, default: 0, showIf: { mode: 'picture' } },
    { key: 'picInvert', label: 'Light subject on dark', type: 'toggle', default: false, showIf: { mode: 'picture' } },
    { key: 'picJumps', label: 'Show beam jumps', type: 'toggle', default: false, showIf: { mode: 'picture' } },
    { key: 'rate', label: 'Redraw rate', type: 'range', min: 5, max: 200, step: 1, default: 50, unit: 'Hz', showIf: { mode: ['shape', 'picture'] } },
    { key: 'size', label: 'Size', type: 'range', min: 0.2, max: 1.4, step: 0.01, default: 1, showIf: { mode: ['shape', 'picture'] } },
    { key: 'react', label: 'Signal on the beam', type: 'range', min: 0, max: 3, step: 0.05, default: 1, showIf: { mode: ['shape', 'picture'] } },
    { key: 'spin', label: 'Rotation', type: 'range', min: -2, max: 2, step: 0.05, default: 0, showIf: { mode: ['shape', 'picture'] } },
    // ---- the tube
    { key: 'phosphor', label: 'Phosphor', type: 'select', default: 'p31', section: 'Tube', options: [['p31', 'P31 green (short)'], ['p1', 'P1 green (medium)'], ['p7', 'P7 blue flash, yellow afterglow'], ['p4', 'P4 white'], ['p11', 'P11 blue'], ['p3', 'P3 amber'], ['custom', 'Custom colour']] },
    { key: 'color', label: 'Custom colour', type: 'color', default: '#2fe3a2', showIf: { phosphor: 'custom' } },
    { key: 'intensity', label: 'Intensity', type: 'range', min: 0.05, max: 4, step: 0.01, default: 1 },
    { key: 'width', label: 'Focus (spot size)', type: 'range', min: 0.4, max: 5, step: 0.05, default: 1.1 },
    { key: 'afterglow', label: 'Afterglow', type: 'range', min: 0.05, max: 10, step: 0.05, default: 1, unit: '×' },
    { key: 'glow', label: 'Halation', type: 'range', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'smooth', label: 'Beam interpolation', type: 'select', default: '4', options: [['1', 'Off (straight lines)'], ['2', '2×'], ['4', '4×'], ['8', '8× (smoothest)']] },
    { key: 'grid', label: 'Graticule', type: 'toggle', default: true },
    { key: 'gridLight', label: 'Scale illumination', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3, showIf: { grid: true } },
    { key: 'readout', label: 'Readout', type: 'toggle', default: true },
    { key: 'glass', label: 'Tube glass', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    const glc = document.createElement('canvas');
    let G = null, err = '';
    try { G = makeGL(glc); if (!G) err = 'This oscilloscope needs WebGL 2, which this GPU did not provide.'; } catch (e) { err = 'The oscilloscope could not start: ' + e.message; G = null; }
    let phos = null, bloomA = null, bloomB = null, size = [0, 0];
    let inst = new Float32Array(6 * 4096), n = 0;
    let lastPos = -1, lastMode = '', time = 0, rot = 0;
    // a short history of the beam's signal (x, y in divisions, z = beam on) for Catmull-Rom upsampling
    const hx = new Float32Array(4), hy = new Float32Array(4), hz = new Uint8Array(4);
    let hn = 0;
    // Y/T sweep state
    const sw = { state: 'wait', x: 0, wait: 0, hold: 0, prevTrig: 0, armed: false, prev: [null, null], last: '' };
    // shapes and pictures
    let shapeKey = '', shape = [], normals = [], phase = 0, drawing = false, stroke = [];
    const pic = { key: '', path: null, busy: false, error: '', gray: null, graySrc: '' };

    function picturePath(p) {
      if (!p.picture) return null;
      const key = [p.picture.length, p.picture.slice(-24), p.picDetail, p.picEdges, p.picShade, p.picInvert].join('|');
      if (key === pic.key || pic.busy) return pic.path;
      if (pic.graySrc !== p.picture) {
        pic.busy = true;
        pictureGray(p.picture).then((g) => { pic.gray = g; pic.graySrc = p.picture; pic.error = ''; })
          .catch((e) => { pic.error = e.message; pic.graySrc = p.picture; pic.gray = null; })
          .finally(() => { pic.busy = false; });
        return pic.path;
      }
      pic.key = key;
      if (!pic.gray) { pic.path = null; return null; }
      const { gray, w, h } = pic.gray;
      const t = tracePicture(p.picInvert ? gray.map((v) => 1 - v) : gray, w, h, { detail: p.picDetail, edges: p.picEdges, shade: p.picShade });
      if (!t.count) { pic.path = null; pic.error = 'No lines found in this picture. Try more edge detail.'; return null; }
      const cnt = t.count, nrm = new Float32Array(cnt * 2), P = t.pts;
      for (let i = 0; i < cnt; i++) {
        const a = i > 0 && !P[i * 3 + 2] ? i - 1 : i, b = i + 1 < cnt && !P[(i + 1) * 3 + 2] ? i + 1 : i;
        const tx = P[b * 3] - P[a * 3], ty = P[b * 3 + 1] - P[a * 3 + 1], l = Math.hypot(tx, ty) || 1;
        nrm[i * 2] = ty / l; nrm[i * 2 + 1] = -tx / l;
      }
      // running count of stroke starts, so a beam step can tell whether it crossed one
      const jc = new Uint32Array(cnt); let c = 0;
      for (let i = 0; i < cnt; i++) { if (P[i * 3 + 2]) c++; jc[i] = c; }
      pic.path = { pts: P, count: cnt, nrm, jc };
      return pic.path;
    }
    function shapePath(p) {
      const key = p.shape + (p.shape === 'custom' ? JSON.stringify(p.customShape || []).length : '');
      if (key !== shapeKey) {
        shapeKey = key;
        const src = p.shape === 'custom' && p.customShape && p.customShape.length > 2 ? p.customShape : presetShape(p.shape);
        shape = resample(src, 512, true);
        normals = shape.map((pt, i) => {
          const a = shape[(i + shape.length - 1) % shape.length], b = shape[(i + 1) % shape.length];
          const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
          return [ty / l, -tx / l];
        });
      }
      return shape;
    }

    function ensure(W, H) {
      if (size[0] === W && size[1] === H) return;
      size = [W, H]; glc.width = W; glc.height = H;
      const gl = G.gl;
      for (const t of [phos, bloomA, bloomB]) if (t) { gl.deleteTexture(t.t); gl.deleteFramebuffer(t.fb); }
      phos = G.target(W, H);
      const bw = Math.max(1, Math.ceil(W / 4)), bh = Math.max(1, Math.ceil(H / 4));
      bloomA = G.target(bw, bh); bloomB = G.target(bw, bh);
      hn = 0; hz.fill(0);
    }
    function push(x0, y0, x1, y1, eF, eS) {
      if (n * 6 + 6 > inst.length) { const b = new Float32Array(inst.length * 2); b.set(inst); inst = b; }
      const o = n * 6; inst[o] = x0; inst[o + 1] = y0; inst[o + 2] = x1; inst[o + 3] = y1; inst[o + 4] = eF; inst[o + 5] = eS; n++;
    }

    const self = {
      capturing: false,
      render(F, { dt, W, H, S, params: p }) {
        dt = Math.max(0, Math.min(0.25, dt));
        time += dt;
        if (!G) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#8a93a6'; ctx.font = `${12 * S}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(err, W / 2, H / 2); return; }
        ensure(W, H);
        const gl = G.gl, sr = F.sampleRate || 48000;
        const ph = p.phosphor === 'custom' ? (() => { const c = hexToVec(p.color); return { f: c, s: c.map((v) => v * 0.8), tf: 0.025, ts: 0.15, mf: 1, ms: 0.3 }; })() : PHOSPHORS[p.phosphor] || PHOSPHORS.p31;
        const tauF = ph.tf, tauS = ph.ts * p.afterglow;
        const div = Math.min(W / 10, H / 8) * 0.92, cx = W / 2, cy = H / 2;
        const vd = (+p.vdiv || 0.2) / p.gain;                    // volts per division
        const U = p.mode === 'picture' ? 1 : Math.max(1, +p.smooth || 4);
        if (p.mode !== lastMode) { lastMode = p.mode; hn = 0; hz.fill(0); sw.state = 'wait'; sw.prev = [null, null]; gl.bindFramebuffer(gl.FRAMEBUFFER, phos.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }

        // ---- the samples that arrived since the last frame
        const SC = F.scope, live = SC && SC.live;
        let N, getL, getR;
        if (live) {
          if (lastPos < 0 || SC.pos - lastPos > SC.mask || SC.pos < lastPos) lastPos = SC.pos - Math.min(SC.mask, Math.round(sr * dt));
          N = Math.min(MAX_SAMPLES, SC.pos - lastPos);
          const start = SC.pos - N, m = SC.mask;
          getL = (i) => SC.L[(start + i) & m]; getR = (i) => SC.R[(start + i) & m];
          lastPos = SC.pos;
        } else {
          // no stream (no source yet, or a preview): the newest stretch of the analyser buffer
          lastPos = -1;
          N = Math.max(256, Math.min(F.waveL.length, Math.round(sr * Math.max(dt, 1 / 60))));
          const off = F.waveL.length - N;
          getL = (i) => F.waveL[off + i]; getR = (i) => F.waveR[off + i];
        }

        n = 0;
        const sig = Math.max(0.6, p.width * 0.75 * S);
        // energy per sample interval; the newest light is fresh, earlier light in this frame has already faded a little
        const E0 = p.intensity * 1.4 * div * (48000 / sr);
        const fadeF = Math.exp(-1 / (sr * tauF)), fadeS = Math.exp(-1 / (sr * tauS));
        let wF = Math.pow(fadeF, N), wS = Math.pow(fadeS, N);
        // the afterglow's share is set as a steady brightness next to the flash; a longer afterglow then builds up more light, as on a real tube
        const slowMix = ph.ms * ph.tf / ph.ts;   // weight of the oldest sample, rises to 1 for the newest
        // divisions → GL pixels (y points up): cx + x * div, cy + y * div
        // beam path in divisions; z = 0 blanks the beam (retrace, jumps)
        const beam = (x, y, z, dE) => {
          hx[0] = hx[1]; hy[0] = hy[1]; hz[0] = hz[1];
          hx[1] = hx[2]; hy[1] = hy[2]; hz[1] = hz[2];
          hx[2] = hx[3]; hy[2] = hy[3]; hz[2] = hz[3];
          hx[3] = x; hy[3] = y; hz[3] = z;
          if (hn < 4) { hn++; if (hn < 3) return; }
          // segment from point 1 to point 2 (one sample late, so the curve can look ahead)
          if (hz[1] === 0 || hz[2] === 0) return;                                   // beam blanked
          if (hz[2] === 2) { push(cx + hx[1] * div, cy + hy[1] * div, cx + hx[2] * div, cy + hy[2] * div, E0 * 0.03 * dE * wF, E0 * 0.03 * dE * wS); return; }   // a visible jump
          let px0 = hx[1], py0 = hy[1];
          for (let k = 1; k <= U; k++) {
            const t = k / U, t2 = t * t, t3 = t2 * t;
            // Catmull-Rom through points 0..3, evaluated between 1 and 2
            const ax = hz[0] ? hx[0] : hx[1], ay = hz[0] ? hy[0] : hy[1], dx = hz[3] ? hx[3] : hx[2], dy = hz[3] ? hy[3] : hy[2];
            const qx = 0.5 * (2 * hx[1] + (-ax + hx[2]) * t + (2 * ax - 5 * hx[1] + 4 * hx[2] - dx) * t2 + (-ax + 3 * hx[1] - 3 * hx[2] + dx) * t3);
            const qy = 0.5 * (2 * hy[1] + (-ay + hy[2]) * t + (2 * ay - 5 * hy[1] + 4 * hy[2] - dy) * t2 + (-ay + 3 * hy[1] - 3 * hy[2] + dy) * t3);
            push(cx + px0 * div, cy + py0 * div, cx + qx * div, cy + qy * div, E0 * dE / U * wF * ph.mf, E0 * dE / U * wS * slowMix);
            px0 = qx; py0 = qy;
          }
        };

        // ---- what drives the beam
        let info = '';
        if (p.mode === 'xy') {
          const k = 1 / vd, c = 0.70710678;
          for (let i = 0; i < N; i++) {
            const l = getL(i), r = getR(i);
            const x = p.rotate ? (l - r) * c : l, y = p.rotate ? (l + r) * c : r;
            beam(x * k + p.posX, y * k + p.posY, 1, 1);
            wF /= fadeF; wS /= fadeS;
          }
          info = `X ${VDIV.find((v) => v[0] === +p.vdiv)?.[1] || ''}  Y ${VDIV.find((v) => v[0] === +p.vdiv)?.[1] || ''}${p.gain !== 1 ? '  VAR' : ''}`;
        } else if (p.mode === 'yt') {
          // a real time base: wait for the trigger, sweep left to right at the chosen speed, blank the retrace, hold off
          const tdiv = +p.tdiv || 0.002, sweepN = tdiv * 10 * sr, k = 1 / vd;
          const src = p.trigSrc, lvl = p.level, rise = p.slope !== 'fall', hyst = 0.004 + vd * 0.02;
          const autoN = Math.max(sweepN * 1.5, sr * 0.05), holdN = p.holdoff / 1000 * sr;
          const showL = p.channels === 'both' || p.channels === 'l', showR = p.channels === 'both' || p.channels === 'r', add = p.channels === 'mix';
          // each displayed channel keeps its own short beam history
          // dual trace splits the screen: CH1 two divisions up, CH2 two down, plus each channel's position
          const dual = p.channels === 'both', chans = [];
          if (showL) chans.push({ v: getL, pos: p.pos1 + (dual ? 2 : 0) });
          if (showR) chans.push({ v: getR, pos: p.pos2 - (dual ? 2 : 0) });
          if (add) chans.push({ v: (i) => getL(i) + getR(i), pos: p.pos1 });
          if (sw.last !== p.channels + chans.length) { sw.last = p.channels + chans.length; sw.hist = chans.map(() => ({ hx: new Float32Array(4), hy: new Float32Array(4), hz: new Uint8Array(4), hn: 0 })); }
          const H0 = sw.hist;
          const tv = src === 'r' ? getR : src === 'mix' ? (i) => getL(i) + getR(i) : getL;
          for (let i = 0; i < N; i++) {
            const v = tv(i);
            if (sw.state === 'hold') { if (--sw.hold <= 0) { sw.state = 'wait'; sw.wait = 0; } }
            else if (sw.state === 'wait') {
              sw.wait++;
              const crossed = rise ? (sw.armed && v >= lvl) : (sw.armed && v <= lvl);
              if (rise ? v < lvl - hyst : v > lvl + hyst) sw.armed = true;
              if (p.trigMode === 'free' || crossed || (p.trigMode === 'auto' && sw.wait > autoN)) { sw.state = 'sweep'; sw.x = 0; sw.armed = false; for (const h of H0) { h.hn = 0; h.hz.fill(0); } }
            }
            if (sw.state === 'sweep') {
              const x = -5 + 10 * (sw.x / sweepN);
              chans.forEach((c, j) => {
                const h = H0[j];
                hx.set(h.hx); hy.set(h.hy); hz.set(h.hz); hn = h.hn;
                beam(x, c.v(i) * k + c.pos, 1, 1);
                h.hx.set(hx); h.hy.set(hy); h.hz.set(hz); h.hn = hn;
              });
              if (++sw.x >= sweepN) {
                // retrace: finish each trace and blank the return
                chans.forEach((c, j) => { const h = H0[j]; hx.set(h.hx); hy.set(h.hy); hz.set(h.hz); hn = h.hn; beam(5, c.v(i) * k + c.pos, 0, 1); h.hn = 0; h.hz.fill(0); });
                sw.state = holdN > 0 ? 'hold' : 'wait'; sw.hold = holdN; sw.wait = 0; sw.armed = false;
              }
            }
            wF /= fadeF; wS /= fadeS;
          }
          const vl = VDIV.find((q) => q[0] === +p.vdiv)?.[1] || '', tl = TDIV.find((q) => q[0] === +p.tdiv)?.[1] || '';
          info = `${showL || add ? 'CH1 ' + vl + '  ' : ''}${showR || add ? 'CH2 ' + vl + '  ' : ''}M ${tl}  ${p.trigMode === 'free' ? 'FREE' : (p.trigSrc === 'r' ? 'CH2' : p.trigSrc === 'mix' ? 'ADD' : 'CH1') + (rise ? ' ↗ ' : ' ↘ ') + (p.level * 1000).toFixed(0) + ' mV'}${p.trigMode === 'normal' ? '  NORM' : ''}`;
        } else {
          // the beam draws a shape or a picture at the redraw rate; the signal pushes it sideways along its lines
          rot += dt * p.spin * (0.5 + F.mid);
          const cr = Math.cos(rot), sr2 = Math.sin(rot);
          const span = PIC_SPAN * p.size * (1 + F.kick * 0.04 * p.react), amp = 0.12 * p.react / vd * 0.2;
          if (p.mode === 'picture') {
            const P = picturePath(p);
            if (P) {
              // the beam is stepped faster than the audio when the picture needs it (like a faster DAC),
              // and is blanked whenever it passes a jump between strokes or wraps round to the start
              const cnt = P.count, pts = P.pts, nrm = P.nrm, jc = P.jc, adv = cnt * p.rate / sr;
              const sub = Math.max(1, Math.ceil(adv / 0.8)), st = adv / sub;
              for (let i = 0; i < N; i++) {
                const d = (getL(i) + getR(i)) * 0.5 * amp;
                for (let q = 0; q < sub; q++) {
                  const prev = phase | 0;
                  phase += st;
                  let wrapped = false;
                  if (phase >= cnt) { phase -= cnt; wrapped = true; }
                  const j = phase | 0, j2 = (j + 1) % cnt, f = phase - j, o = j * 3, o2 = j2 * 3;
                  const jumped = wrapped || jc[j] !== jc[prev];
                  const hold = pts[o2 + 2];                     // the next point starts a new stroke: stay at the end of this one
                  const x0 = hold ? pts[o] : pts[o] + (pts[o2] - pts[o]) * f, y0 = hold ? pts[o + 1] : pts[o + 1] + (pts[o2 + 1] - pts[o + 1]) * f;
                  const x = (x0 + nrm[j * 2] * d) * span, y = -(y0 + nrm[j * 2 + 1] * d) * span;
                  beam(x * cr - y * sr2 + p.posX, x * sr2 + y * cr + p.posY, jumped ? (p.picJumps ? 2 : 0) : 1, 1 / sub);
                }
                wF /= fadeF; wS /= fadeS;
              }
            }
          } else {
            const sh2 = shapePath(p), M = sh2.length, adv = M * p.rate / sr;
            for (let i = 0; i < N; i++) {
              phase = (phase + adv) % M;
              const j = phase | 0, j2 = (j + 1) % M, f = phase - j;
              const x0 = sh2[j][0] + (sh2[j2][0] - sh2[j][0]) * f, y0 = sh2[j][1] + (sh2[j2][1] - sh2[j][1]) * f;
              const d = (getL(i) + getR(i)) * 0.5 * amp * 3;
              const x = (x0 + normals[j][0] * d) * span, y = -(y0 + normals[j][1] * d) * span;
              beam(x * cr - y * sr2 + p.posX, x * sr2 + y * cr + p.posY, 1, 1);
              wF /= fadeF; wS /= fadeS;
            }
          }
          info = `X-Y  ${Math.round(p.rate)} Hz`;
        }

        // ---- GPU: fade the phosphor, add this frame's beam, bloom, show
        gl.disable(gl.DEPTH_TEST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, phos.fb); gl.viewport(0, 0, W, H);
        gl.enable(gl.BLEND);
        gl.blendColor(Math.exp(-dt / tauF), Math.exp(-dt / tauS), 0, 0);
        gl.blendFunc(gl.ZERO, gl.CONSTANT_COLOR);
        gl.useProgram(G.P.decay.p); gl.bindVertexArray(G.empty); gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (n) {
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(G.P.seg.p);
          gl.uniform2f(G.P.seg.u('uRes'), W, H); gl.uniform1f(G.P.seg.u('uSig'), sig);
          gl.bindVertexArray(G.vao); gl.bindBuffer(gl.ARRAY_BUFFER, G.buf);
          if (inst.length > G.cap) { gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW); G.cap = inst.length; }
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, n * 6);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
        }
        gl.disable(gl.BLEND);
        gl.bindVertexArray(G.empty);
        if (p.glow > 0) {
          gl.useProgram(G.P.down.p); gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb); gl.viewport(0, 0, bloomA.w, bloomA.h);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, phos.t); gl.uniform1i(G.P.down.u('uTex'), 0); gl.uniform2f(G.P.down.u('uTexel'), 1 / W, 1 / H);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const blur = (from, to, sx, sy) => {
            gl.useProgram(G.P.blur.p); gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb); gl.viewport(0, 0, to.w, to.h);
            gl.bindTexture(gl.TEXTURE_2D, from.t); gl.uniform1i(G.P.blur.u('uTex'), 0);
            gl.uniform2f(G.P.blur.u('uStep'), sx / from.w, sy / from.h); gl.uniform2f(G.P.blur.u('uSize'), to.w, to.h);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          };
          blur(bloomA, bloomB, 1, 0); blur(bloomB, bloomA, 0, 1); blur(bloomA, bloomB, 2, 0); blur(bloomB, bloomA, 0, 2);
        }
        const C = G.P.comp;
        gl.useProgram(C.p); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, phos.t); gl.uniform1i(C.u('uPhos'), 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomA.t); gl.uniform1i(C.u('uBloom'), 1);
        gl.uniform2f(C.u('uRes'), W, H); gl.uniform2f(C.u('uCenter'), cx, cy); gl.uniform1f(C.u('uDiv'), div);
        gl.uniform1f(C.u('uExpo'), 1); gl.uniform1f(C.u("uBloomAmt"), p.glow > 0 ? p.glow * 0.35 : 0);
        gl.uniform1f(C.u('uGrid'), p.grid ? 0.05 + p.gridLight * 0.35 : 0); gl.uniform1f(C.u('uGlass'), p.glass); gl.uniform1f(C.u('uWhite'), 1); gl.uniform1f(C.u('uT'), time);
        gl.uniform3fv(C.u('uColF'), ph.f); gl.uniform3fv(C.u('uColS'), ph.s); gl.uniform2f(C.u('uMix'), 1, 1);
        const gc = ph.f; gl.uniform3f(C.u('uGridCol'), 0.55 + gc[0] * 0.25, 0.6 + gc[1] * 0.25, 0.6 + gc[2] * 0.25);
        gl.uniform3f(C.u('uBack'), 0.018 + ph.s[0] * 0.006, 0.02 + ph.s[1] * 0.008, 0.02 + ph.s[2] * 0.006);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.activeTexture(gl.TEXTURE0);

        // ---- the picture on the 2D canvas, plus readout and drawing overlays
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(glc, 0, 0, W, H);
        const txt = hexToRgb('#ffffff').map((v, i) => Math.round(255 * Math.min(1, ph.f[i] * 0.55 + 0.45)));
        if (p.readout && info) {
          ctx.font = `600 ${Math.max(9, Math.round(div * 0.22))}px ui-monospace, Consolas, monospace`;
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          ctx.shadowColor = rgba(txt, 0.8); ctx.shadowBlur = 6 * S;
          ctx.fillStyle = rgba(txt, 0.82);
          ctx.fillText(info, cx - 5 * div + div * 0.12, cy + 4 * div - div * 0.14);
          ctx.shadowBlur = 0;
        }
        if (p.mode === 'picture' && !pic.path) {
          ctx.fillStyle = rgba(txt, 0.8); ctx.font = `${13 * S}px system-ui, sans-serif`; ctx.textAlign = 'center';
          ctx.fillText(pic.busy ? 'Tracing the picture…' : pic.error || 'Choose a picture in the panel on the right.', cx, cy);
        }
        if (self.capturing) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = rgba(txt, 0.9); ctx.font = `${13 * S}px system-ui, sans-serif`; ctx.textAlign = 'center';
          ctx.fillText(drawing ? 'Release to finish' : 'Draw one continuous line. Press Esc to cancel.', cx, 24 * S);
          if (stroke.length > 1) { ctx.strokeStyle = rgba(txt, 1); ctx.lineWidth = 2 * S; ctx.beginPath(); stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H))); ctx.stroke(); }
          self._WH = [W, H]; self._div = div;
        }
      },
      action(key, p, done) {
        if (key === 'draw') { self.capturing = true; stroke = []; p.mode = 'shape'; return 'Draw on the widget now. Press Esc to cancel.'; }
        if (key === 'loadPicture') {
          const input = document.createElement('input');
          input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml';
          input.onchange = async () => {
            const f = input.files && input.files[0];
            if (!f) return;
            try { p.picture = await loadPicture(f); p.mode = 'picture'; pic.error = ''; } catch (e) { pic.error = e.message; }
            if (done) done();
          };
          input.click();
        }
      },
      // x, y are 0..1 within the widget
      pointer(type, x, y, p) {
        if (!self.capturing) return false;
        if (type === 'cancel') { self.capturing = false; drawing = false; stroke = []; return true; }
        if (type === 'down') { drawing = true; stroke = [[x, y]]; }
        else if (type === 'move' && drawing) { const l = stroke[stroke.length - 1]; if (Math.hypot(x - l[0], y - l[1]) > 0.004) stroke.push([x, y]); }
        else if (type === 'up' && drawing) {
          drawing = false; self.capturing = false;
          if (stroke.length > 4) {
            const [W, H] = self._WH || [1, 1];
            const m = (self._div || Math.min(W, H) / 8) * PIC_SPAN * (p.size || 1);
            p.customShape = stroke.map(([sx, sy]) => [+(((sx - 0.5) * W) / m).toFixed(4), +(((sy - 0.5) * H) / m).toFixed(4)]);
            p.shape = 'custom'; shapeKey = '';
          }
          stroke = [];
        }
        return true;
      },
      resize() {},
      dispose() {
        if (!G) return;
        const gl = G.gl;
        for (const t of [phos, bloomA, bloomB]) if (t) { gl.deleteTexture(t.t); gl.deleteFramebuffer(t.fb); }
        const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      }
    };
    return self;
  }
};
