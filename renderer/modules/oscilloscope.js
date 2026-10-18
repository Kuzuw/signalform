import { hexToRgb, hexToVec, rgba, TAU } from './util.js';
import { tracePicture, loadPicture, pictureGray } from './picture-trace.js';
import { layoutInstrument, drawPanel } from './scope-panel.js';

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
uniform vec2 uRes, uCenter; uniform float uSig, uDiv, uEdge;
out vec2 vP; flat out vec2 vA; flat out vec2 vDir; flat out float vL; flat out vec2 vE; flat out float vSig;
void main() {
  vec2 a = aSeg.xy, b = aSeg.zw, d = b - a;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
  vec2 m = ((a + b) * 0.5 - uCenter) / (uDiv * 5.0);
  float sig = uSig * (1.0 + uEdge * dot(m, m));       // the spot defocuses away from the centre of the tube
  float r = sig * 3.5;
  vec2 c = vec2[6](vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(1, 0), vec2(1, 1), vec2(0, 1))[gl_VertexID];
  vec2 p = a + dir * (-r + c.x * (L + 2.0 * r)) + nrm * (-r + c.y * 2.0 * r);
  vP = p; vA = a; vDir = dir; vL = L; vE = aE; vSig = sig;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;
const SEG_FRAG = `#version 300 es
precision highp float;
in vec2 vP; flat in vec2 vA; flat in vec2 vDir; flat in float vL; flat in vec2 vE; flat in float vSig;
out vec4 o;
float erf_(float x) { float s = sign(x), a = abs(x); float t = 1.0 / (1.0 + 0.3275911 * a);
  return s * (1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a)); }
void main() {
  vec2 q = vP - vA;
  float u = dot(q, vDir), v = dot(q, vec2(-vDir.y, vDir.x));
  float uSig = vSig, s2 = uSig * 1.41421356, norm = 1.0 / (6.2831853 * uSig * uSig);
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
uniform sampler2D uPhos, uNear, uWide, uOver, uPanel;
uniform vec2 uRes, uCenter, uScreen;
uniform vec4 uLed[3]; uniform float uLedR;
uniform float uDiv, uBloomAmt, uGrid, uGlass, uT, uGrain, uFrame, uRad, uOverOn, uDim;
uniform vec3 uColF, uColS, uGridCol, uBack;
out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float line(float d, float w) { return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, abs(d)); }
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
vec3 light(vec4 v) { return uColF * v.r + uColS * v.g; }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes, pc = gl_FragCoord.xy - uCenter;
  // the phosphor layer is grainy: a fixed fine texture modulates the light it gives off
  float grain = 1.0 + uGrain * (hash(floor(gl_FragCoord.xy)) - 0.5) * 0.9;
  vec3 beam = light(texture(uPhos, uv)) * grain;
  // light scattered in the phosphor (near glow) and reflected inside the faceplate (a wider halo ring)
  vec3 near = light(texture(uNear, uv)), wide = light(texture(uWide, uv));
  vec3 halo = (near * 0.7 + max(wide * 1.3 - near * 0.45, 0.0)) * uBloomAmt;
  vec3 c = 1.0 - exp(-beam);
  float pk = max(c.r, max(c.g, c.b));
  c = mix(c, vec3(1.0, 1.0, 0.97) * pk, smoothstep(0.6, 1.0, pk) * 0.55);   // an overdriven trace runs white-hot
  c += (1.0 - exp(-halo)) * 0.9;
  vec2 g = pc / uDiv;
  float px = 1.0 / uDiv;
  vec3 base = uBack;
  if (uGrid > 0.0 && abs(g.x) <= 5.0 + px && abs(g.y) <= 4.0 + px) {
    vec2 fd = (g - floor(g + 0.5)) * uDiv;
    float L = max(line(fd.x, 1.0) * step(abs(g.x), 5.0 + px), line(fd.y, 1.0));
    vec2 ft = (g * 5.0 - floor(g * 5.0 + 0.5)) * uDiv / 5.0;
    float T = max(line(ft.x, 1.0) * step(abs(g.y), 0.1), line(ft.y, 1.0) * step(abs(g.x), 0.1));
    float edge = max(line((abs(g.x) - 5.0) * uDiv, 1.6) * step(abs(g.y), 4.0), line((abs(g.y) - 4.0) * uDiv, 1.6) * step(abs(g.x), 5.0));
    // the scale is lit from the bottom edge of the faceplate and catches the trace's light
    float lit = uGrid * (0.65 + 0.35 * smoothstep(4.0, -4.0, g.y));
    base += uGridCol * (max(L, T) * 0.55 + edge * 0.8) * (lit + dot(c + near * 0.2, vec3(0.3)) * 0.5);
  }
  vec3 col = base + c;
  if (uGlass > 0.0) {
    vec2 q = uFrame > 0.5 ? pc / uScreen * 0.5 : uv - 0.5;
    col *= 1.0 - dot(q, q) * 0.55 * uGlass;
    col += vec3(0.012, 0.014, 0.016) * uGlass * smoothstep(0.75, 0.0, length(q - vec2(-0.25, 0.35)));
    col += (hash(gl_FragCoord.xy + fract(uT) * 91.0) - 0.5) * 0.012 * uGlass;
  }
  if (uOverOn > 0.0) { vec4 ov = texture(uOver, uv); col = col * (1.0 - uDim) + ov.rgb; }
  if (uFrame > 1.5) {
    // the whole instrument: the tube sits in a recess of the painted front panel
    float d = sdBox(pc, uScreen, uRad);
    float inside = 1.0 - smoothstep(-1.0, 1.0, d);
    col *= 1.0 - 0.55 * exp(-max(-d, 0.0) / (uDiv * 0.18));                       // the recess shades the edge of the glass
    col = mix(texture(uPanel, uv).rgb, col, inside);
    // panel lamps: POWER (green), TRIG'D (green), READY (amber)
    for (int i = 0; i < 3; i++) {
      vec2 q = gl_FragCoord.xy - uLed[i].xy; float r = length(q), on = uLed[i].w;
      vec3 lc = i == 2 ? vec3(1.0, 0.62, 0.12) : vec3(0.3, 1.0, 0.38);
      float disc = 1.0 - smoothstep(uLedR - 1.0, uLedR + 0.5, r);
      vec3 lens = lc * (0.12 + 0.9 * on) + vec3(1.0) * on * 0.55 * exp(-r * r / (uLedR * uLedR * 0.25));
      col = mix(col, lens, disc);
      col += lc * on * 0.55 * exp(-r / (uLedR * 1.3)) * (1.0 - disc);
    }
  } else if (uFrame > 0.5) {
    // the tube face is a rounded rectangle set in a dark bezel
    float d = sdBox(pc, uScreen, uRad);
    float inside = 1.0 - smoothstep(-1.0, 1.0, d);
    vec3 bez = vec3(0.055, 0.057, 0.06) * (0.75 + 0.25 * smoothstep(uRes.y * 0.5, -uRes.y * 0.5, pc.y));
    bez *= 1.0 - 0.6 * exp(-max(d, 0.0) / (uDiv * 0.12));                       // shadow where the bezel meets the glass
    bez += vec3(0.08) * exp(-abs(d - uDiv * 0.05) / 1.5) * 0.6;                     // a thin highlight on the bezel lip
    col = mix(bez, col, inside);
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
    { key: 'frame', label: 'Look', type: 'select', default: 'bezel', options: [['bezel', 'Tube in its bezel'], ['instrument', 'Real-life oscilloscope'], ['none', 'Screen only']] },
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
    { key: 'edgeFocus', label: 'Corner defocus', type: 'range', min: 0, max: 2, step: 0.01, default: 0.35 },
    { key: 'grain', label: 'Phosphor grain', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: 'noise', label: 'Trace noise', type: 'range', min: 0, max: 0.05, step: 0.0005, default: 0.002, unit: ' div' },
    { key: 'grid', label: 'Graticule', type: 'toggle', default: true },
    { key: 'gridLight', label: 'Scale illumination', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3, showIf: { grid: true } },
    { key: 'readout', label: 'Readout', type: 'toggle', default: true },
    { key: 'glass', label: 'Tube glass', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 }
  ],
  create(canvas) {
    let G = null, err = '';
    try { G = makeGL(canvas); if (!G) err = 'This oscilloscope needs WebGL 2, which this GPU did not provide.'; } catch (e) { err = 'The oscilloscope could not start: ' + e.message; G = null; }
    if (!G) {
      const ctx = canvas.getContext('2d');
      return { render(F, { W, H, S }) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#8a93a6'; ctx.font = `${12 * S}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(err, W / 2, H / 2); }, resize() {}, dispose() {} };
    }
    const gl = G.gl;
    let phos = null, near = null, wide = null, tmpB = null, size = [0, 0];
    let inst = new Float32Array(6 * 4096), n = 0;
    let lastPos = -1, lastMode = '', time = 0, rot = 0;
    // overlay (readout, messages, drawing guide): a small 2D canvas, uploaded only when it changes
    const ov = document.createElement('canvas'), octx = ov.getContext('2d');
    const ovTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, ovTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let ovKey = '', ovOn = false;
    // front panel of the real-life look: painted only when a setting or the size changes
    const pn = document.createElement('canvas'), pctx = pn.getContext('2d');
    const pnTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, pnTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    let pnKey = '', lastTrig = -9;
    // beam history (x, y in divisions, z = beam on) for Catmull-Rom upsampling; one per trace
    const mkBeam = () => ({ x: new Float32Array(4), y: new Float32Array(4), z: new Uint8Array(4), n: 0 });
    const resetBeam = (b) => { b.n = 0; b.z.fill(0); };
    const B0 = mkBeam();
    // Y/T sweep state
    const sw = { state: 'wait', x: 0, wait: 0, hold: 0, armed: false, key: '', beams: [] };
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
      size = [W, H];
      for (const t of [phos, near, wide, tmpB]) if (t) { gl.deleteTexture(t.t); gl.deleteFramebuffer(t.fb); }
      phos = G.target(W, H);
      const bw = Math.max(1, Math.ceil(W / 4)), bh = Math.max(1, Math.ceil(H / 4));
      near = G.target(bw, bh); wide = G.target(bw, bh); tmpB = G.target(bw, bh);
      ov.width = W; ov.height = H; ovKey = '';
      resetBeam(B0); for (const b of sw.beams) resetBeam(b);
    }
    function push(x0, y0, x1, y1, eF, eS) {
      if (n * 6 + 6 > inst.length) { const b = new Float32Array(inst.length * 2); b.set(inst); inst = b; }
      const o = n * 6; inst[o] = x0; inst[o + 1] = y0; inst[o + 2] = x1; inst[o + 3] = y1; inst[o + 4] = eF; inst[o + 5] = eS; n++;
    }
    // redraw the overlay only when what it shows has changed
    function overlay(key, W, H, draw) {
      if (key === ovKey) return;
      ovKey = key;
      octx.clearRect(0, 0, W, H);
      ovOn = !!key;
      if (!ovOn) return;
      draw(octx);
      gl.bindTexture(gl.TEXTURE_2D, ovTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ov);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }

    const self = {
      capturing: false,
      render(F, { dt, W, H, S, params: p }) {
        dt = Math.max(0, Math.min(0.25, dt));
        time += dt;
        ensure(W, H);
        const sr = F.sampleRate || 48000;
        const ph = p.phosphor === 'custom' ? (() => { const c = hexToVec(p.color); return { f: c, s: c.map((v) => v * 0.8), tf: 0.025, ts: 0.15, mf: 1, ms: 0.3 }; })() : PHOSPHORS[p.phosphor] || PHOSPHORS.p31;
        const tauF = ph.tf, tauS = ph.ts * p.afterglow;
        const real = p.frame === 'instrument', bez = p.frame === 'bezel' || real;
        // screen placement: centred, or where the instrument's panel puts the tube (cy is in GL coordinates, cyC in canvas ones)
        const LI = real ? layoutInstrument(W, H) : null;
        const div = real ? LI.div : Math.min(W / 10, H / 8) * (bez ? 0.86 : 0.92), cx = real ? LI.cx : W / 2, cyC = real ? LI.cy : H / 2, cy = H - cyC;
        const vd = (+p.vdiv || 0.2) / p.gain;                    // volts per division
        const U = p.mode === 'picture' ? 1 : Math.max(1, +p.smooth || 4);
        if (p.mode !== lastMode) { lastMode = p.mode; resetBeam(B0); sw.state = 'wait'; sw.key = ''; gl.bindFramebuffer(gl.FRAMEBUFFER, phos.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }

        // ---- the samples that arrived since the last frame (straight from the ring, no per-sample closures)
        const SC = F.scope, live = SC && SC.live;
        let N, bufL, bufR, start, mask;
        if (live) {
          if (lastPos < 0 || SC.pos - lastPos > SC.mask || SC.pos < lastPos) lastPos = SC.pos - Math.min(SC.mask, Math.round(sr * dt));
          N = Math.min(MAX_SAMPLES, SC.pos - lastPos);
          bufL = SC.L; bufR = SC.R; start = SC.pos - N; mask = SC.mask;
          lastPos = SC.pos;
        } else {
          // no stream (no source yet, or a preview): the newest stretch of the analyser buffer
          lastPos = -1;
          N = Math.max(256, Math.min(F.waveL.length, Math.round(sr * Math.max(dt, 1 / 60))));
          bufL = F.waveL; bufR = F.waveR; start = F.waveL.length - N; mask = 0x7fffffff;
        }

        n = 0;
        // a brighter beam carries more current and its spot grows
        const sig = Math.max(0.6, p.width * 0.75 * S) * (1 + 0.3 * Math.max(0, p.intensity - 1));
        // energy per sample interval; light drawn earlier in this frame has already faded a little
        const E0 = p.intensity * 1.4 * div * (48000 / sr);
        const fadeF = Math.exp(-1 / (sr * tauF)), fadeS = Math.exp(-1 / (sr * tauS)), ifF = 1 / fadeF, ifS = 1 / fadeS;
        let wF = Math.pow(fadeF, N), wS = Math.pow(fadeS, N);
        // the afterglow's share is set as a steady brightness next to the flash; a longer afterglow then builds up more light, as on a real tube
        const slowMix = ph.ms * ph.tf / ph.ts;
        const noise = p.noise;
        // beam path in divisions; z = 0 blanks the beam (retrace, jumps), z = 2 draws a faint jump
        const beam = (b, x, y, z, dE) => {
          const X = b.x, Y = b.y, Z = b.z;
          if (noise > 0) { x += (Math.random() + Math.random() - 1) * noise; y += (Math.random() + Math.random() - 1) * noise; }
          X[0] = X[1]; Y[0] = Y[1]; Z[0] = Z[1];
          X[1] = X[2]; Y[1] = Y[2]; Z[1] = Z[2];
          X[2] = X[3]; Y[2] = Y[3]; Z[2] = Z[3];
          X[3] = x; Y[3] = y; Z[3] = z;
          if (b.n < 4) { b.n++; if (b.n < 3) return; }
          // segment from point 1 to point 2 (one sample late, so the curve can look ahead)
          if (Z[1] === 0 || Z[2] === 0) return;
          if (Z[2] === 2) { push(cx + X[1] * div, cy + Y[1] * div, cx + X[2] * div, cy + Y[2] * div, E0 * 0.03 * dE * wF, E0 * 0.03 * dE * wS); return; }
          const eF = E0 * dE / U * wF * ph.mf, eS = E0 * dE / U * wS * slowMix;
          if (U === 1) { push(cx + X[1] * div, cy + Y[1] * div, cx + X[2] * div, cy + Y[2] * div, eF, eS); return; }
          const ax = Z[0] ? X[0] : X[1], ay = Z[0] ? Y[0] : Y[1], dx = Z[3] ? X[3] : X[2], dy = Z[3] ? Y[3] : Y[2];
          // Catmull-Rom between points 1 and 2 as a cubic in t
          const c1x = -ax + X[2], c2x = 2 * ax - 5 * X[1] + 4 * X[2] - dx, c3x = -ax + 3 * X[1] - 3 * X[2] + dx;
          const c1y = -ay + Y[2], c2y = 2 * ay - 5 * Y[1] + 4 * Y[2] - dy, c3y = -ay + 3 * Y[1] - 3 * Y[2] + dy;
          let px0 = cx + X[1] * div, py0 = cy + Y[1] * div;
          for (let k = 1; k <= U; k++) {
            const t = k / U, t2 = t * t, t3 = t2 * t;
            const qx = cx + 0.5 * (2 * X[1] + c1x * t + c2x * t2 + c3x * t3) * div, qy = cy + 0.5 * (2 * Y[1] + c1y * t + c2y * t2 + c3y * t3) * div;
            push(px0, py0, qx, qy, eF, eS);
            px0 = qx; py0 = qy;
          }
        };

        // ---- what drives the beam
        let info = '';
        const vlab = VDIV.find((q) => q[0] === +p.vdiv)?.[1] || '';
        if (p.mode === 'xy') {
          const k = 1 / vd, c = 0.70710678, rotate = p.rotate, ox = p.posX, oy = p.posY;
          for (let i = 0; i < N; i++) {
            const j = (start + i) & mask, l = bufL[j], r = bufR[j];
            beam(B0, (rotate ? (l - r) * c : l) * k + ox, (rotate ? (l + r) * c : r) * k + oy, 1, 1);
            wF *= ifF; wS *= ifS;
          }
          info = `X ${vlab}  Y ${vlab}${p.gain !== 1 ? '  VAR' : ''}`;
        } else if (p.mode === 'yt') {
          // a real time base: wait for the trigger, sweep left to right at the chosen speed, blank the retrace, hold off
          const tdiv = +p.tdiv || 0.002, sweepN = tdiv * 10 * sr, k = 1 / vd;
          const src = p.trigSrc, lvl = p.level, rise = p.slope !== 'fall', hyst = 0.004 + vd * 0.02;
          const autoN = Math.max(sweepN * 1.5, sr * 0.05), holdN = p.holdoff / 1000 * sr;
          const showL = p.channels === 'both' || p.channels === 'l', showR = p.channels === 'both' || p.channels === 'r', add = p.channels === 'mix';
          // dual trace splits the screen: CH1 two divisions up, CH2 two down, plus each channel's position
          const dual = p.channels === 'both';
          const chans = [];
          if (showL) chans.push({ w: 0, pos: p.pos1 + (dual ? 2 : 0) });
          if (showR) chans.push({ w: 1, pos: p.pos2 - (dual ? 2 : 0) });
          if (add) chans.push({ w: 2, pos: p.pos1 });
          const key = p.channels;
          if (sw.key !== key) { sw.key = key; sw.beams = chans.map(mkBeam); }
          const nc = chans.length, beams = sw.beams;
          for (let i = 0; i < N; i++) {
            const j = (start + i) & mask, l = bufL[j], r = bufR[j];
            const v = src === 'r' ? r : src === 'mix' ? l + r : l;
            if (sw.state === 'hold') { if (--sw.hold <= 0) { sw.state = 'wait'; sw.wait = 0; } }
            else if (sw.state === 'wait') {
              sw.wait++;
              const crossed = sw.armed && (rise ? v >= lvl : v <= lvl);
              if (rise ? v < lvl - hyst : v > lvl + hyst) sw.armed = true;
              if (p.trigMode === 'free' || crossed || (p.trigMode === 'auto' && sw.wait > autoN)) { if (crossed) lastTrig = time; sw.state = 'sweep'; sw.x = 0; sw.armed = false; for (const b of beams) resetBeam(b); }
            }
            if (sw.state === 'sweep') {
              const x = -5 + 10 * (sw.x / sweepN);
              for (let c = 0; c < nc; c++) { const ch = chans[c], s = ch.w === 0 ? l : ch.w === 1 ? r : l + r; beam(beams[c], x, s * k + ch.pos, 1, 1); }
              if (++sw.x >= sweepN) {
                // retrace: blank the return and hold off before the next trigger
                for (let c = 0; c < nc; c++) { const ch = chans[c], s = ch.w === 0 ? l : ch.w === 1 ? r : l + r; beam(beams[c], 5, s * k + ch.pos, 0, 1); resetBeam(beams[c]); }
                sw.state = holdN > 0 ? 'hold' : 'wait'; sw.hold = holdN; sw.wait = 0; sw.armed = false;
              }
            }
            wF *= ifF; wS *= ifS;
          }
          const tl = TDIV.find((q) => q[0] === +p.tdiv)?.[1] || '';
          info = `${showL || add ? 'CH1 ' + vlab + '  ' : ''}${showR || add ? 'CH2 ' + vlab + '  ' : ''}M ${tl}  ${p.trigMode === 'free' ? 'FREE' : (p.trigSrc === 'r' ? 'CH2' : p.trigSrc === 'mix' ? 'ADD' : 'CH1') + (rise ? ' ↗ ' : ' ↘ ') + (p.level * 1000).toFixed(0) + ' mV'}${p.trigMode === 'normal' ? '  NORM' : ''}`;
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
                const j0 = (start + i) & mask, d = (bufL[j0] + bufR[j0]) * 0.5 * amp;
                for (let q = 0; q < sub; q++) {
                  const prev = phase | 0;
                  phase += st;
                  let wrapped = false;
                  if (phase >= cnt) { phase -= cnt; wrapped = true; }
                  const j = phase | 0, j2 = (j + 1) % cnt, f = phase - j, o = j * 3, o2 = j2 * 3;
                  const jumped = wrapped || jc[j] !== jc[prev];
                  const hold = pts[o2 + 2];
                  const x0 = hold ? pts[o] : pts[o] + (pts[o2] - pts[o]) * f, y0 = hold ? pts[o + 1] : pts[o + 1] + (pts[o2 + 1] - pts[o + 1]) * f;
                  const x = (x0 + nrm[j * 2] * d) * span, y = -(y0 + nrm[j * 2 + 1] * d) * span;
                  beam(B0, x * cr - y * sr2 + p.posX, x * sr2 + y * cr + p.posY, jumped ? (p.picJumps ? 2 : 0) : 1, 1 / sub);
                }
                wF *= ifF; wS *= ifS;
              }
            }
          } else {
            const sh2 = shapePath(p), M = sh2.length, adv = M * p.rate / sr;
            for (let i = 0; i < N; i++) {
              phase = (phase + adv) % M;
              const j = phase | 0, j2 = (j + 1) % M, f = phase - j, j0 = (start + i) & mask;
              const x0 = sh2[j][0] + (sh2[j2][0] - sh2[j][0]) * f, y0 = sh2[j][1] + (sh2[j2][1] - sh2[j][1]) * f;
              const d = (bufL[j0] + bufR[j0]) * 0.5 * amp * 3;
              const x = (x0 + normals[j][0] * d) * span, y = -(y0 + normals[j][1] * d) * span;
              beam(B0, x * cr - y * sr2 + p.posX, x * sr2 + y * cr + p.posY, 1, 1);
              wF *= ifF; wS *= ifS;
            }
          }
          info = `X-Y  ${Math.round(p.rate)} Hz`;
        }

        // ---- overlay: readout, picture messages, the drawing guide
        const txt = [0, 1, 2].map((i) => Math.round(255 * Math.min(1, ph.f[i] * 0.55 + 0.45)));
        const msg = p.mode === 'picture' && !pic.path ? (pic.busy ? 'Tracing the picture…' : pic.error || 'Choose a picture in the panel on the right.') : '';
        const capKey = self.capturing ? 'cap' + stroke.length + drawing : '';
        const fs = Math.max(5, Math.round(div * 0.22));
        const ovk = (p.readout ? info : '') + '|' + msg + '|' + capKey;
        overlay(ovk === '||' ? '' : ovk + '|' + txt + W + 'x' + H, W, H, (o) => {
          o.textBaseline = 'alphabetic';
          if (p.readout && info) {
            o.font = `600 ${fs}px ui-monospace, Consolas, monospace`; o.textAlign = 'left';
            o.shadowColor = rgba(txt, 0.8); o.shadowBlur = 6 * S; o.fillStyle = rgba(txt, 0.82);
            o.fillText(info, cx - 5 * div + div * 0.12, cyC + 4 * div - div * 0.14);
            o.shadowBlur = 0;
          }
          if (msg) { o.fillStyle = rgba(txt, 0.8); o.font = `${13 * S}px system-ui, sans-serif`; o.textAlign = 'center'; o.fillText(msg, cx, cyC); }
          if (self.capturing) {
            o.fillStyle = rgba(txt, 0.9); o.font = `${13 * S}px system-ui, sans-serif`; o.textAlign = 'center';
            o.fillText(drawing ? 'Release to finish' : 'Draw one continuous line. Press Esc to cancel.', cx, 24 * S);
            if (stroke.length > 1) { o.strokeStyle = rgba(txt, 1); o.lineWidth = 2 * S; o.beginPath(); stroke.forEach(([x, y], i) => (i ? o.lineTo(x * W, y * H) : o.moveTo(x * W, y * H))); o.stroke(); }
          }
        });
        if (self.capturing) { self._WH = [W, H]; self._div = div; }
        if (real) {
          const vi = Math.max(0, VDIV.findIndex((q) => q[0] === +p.vdiv)), ti = Math.max(0, TDIV.findIndex((q) => q[0] === +p.tdiv));
          const k = [W, H, vi, ti, p.mode, p.channels, p.trigMode, p.trigSrc, p.slope, p.intensity, p.width, p.grid, p.gridLight, p.gain, p.pos1, p.pos2, p.posX, p.level].join('|');
          if (k !== pnKey) {
            pnKey = k; pn.width = W; pn.height = H;
            drawPanel(pctx, LI, p, vi, ti);
            gl.bindTexture(gl.TEXTURE_2D, pnTex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pn);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          }
        }

        // ---- GPU: fade the phosphor, add this frame's beam, scatter, show
        gl.disable(gl.DEPTH_TEST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, phos.fb); gl.viewport(0, 0, W, H);
        gl.enable(gl.BLEND);
        gl.blendColor(Math.exp(-dt / tauF), Math.exp(-dt / tauS), 0, 0);
        gl.blendFunc(gl.ZERO, gl.CONSTANT_COLOR);
        gl.useProgram(G.P.decay.p); gl.bindVertexArray(G.empty); gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (n) {
          gl.blendFunc(gl.ONE, gl.ONE);
          const SP = G.P.seg;
          gl.useProgram(SP.p);
          gl.uniform2f(SP.u('uRes'), W, H); gl.uniform1f(SP.u('uSig'), sig);
          gl.uniform2f(SP.u('uCenter'), cx, cy); gl.uniform1f(SP.u('uDiv'), div); gl.uniform1f(SP.u('uEdge'), p.edgeFocus);
          gl.bindVertexArray(G.vao); gl.bindBuffer(gl.ARRAY_BUFFER, G.buf);
          if (inst.length > G.cap) { gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW); G.cap = inst.length; }
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, n * 6);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
        }
        gl.disable(gl.BLEND);
        gl.bindVertexArray(G.empty);
        if (p.glow > 0) {
          gl.useProgram(G.P.down.p); gl.bindFramebuffer(gl.FRAMEBUFFER, near.fb); gl.viewport(0, 0, near.w, near.h);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, phos.t); gl.uniform1i(G.P.down.u('uTex'), 0); gl.uniform2f(G.P.down.u('uTexel'), 1 / W, 1 / H);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const blur = (from, to, sx, sy) => {
            gl.useProgram(G.P.blur.p); gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb); gl.viewport(0, 0, to.w, to.h);
            gl.bindTexture(gl.TEXTURE_2D, from.t); gl.uniform1i(G.P.blur.u('uTex'), 0);
            gl.uniform2f(G.P.blur.u('uStep'), sx / from.w, sy / from.h); gl.uniform2f(G.P.blur.u('uSize'), to.w, to.h);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          };
          // near glow (light scattered in the phosphor), then a much wider halo (light bouncing inside the faceplate)
          blur(near, tmpB, 1, 0); blur(tmpB, near, 0, 1);
          blur(near, tmpB, 3, 0); blur(tmpB, wide, 0, 3);
        }
        const C = G.P.comp;
        gl.useProgram(C.p); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
        const tex = (unit, name, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(C.u(name), unit); };
        tex(0, 'uPhos', phos.t); tex(1, 'uNear', near.t); tex(2, 'uWide', wide.t); tex(3, 'uOver', ovTex); tex(4, 'uPanel', pnTex);
        if (real) {
          const yt = p.mode === 'yt', led = (k, on) => [LI.leds[k][0], H - LI.leds[k][1], 0, on];
          const trig = yt && time - lastTrig < 0.12 ? 1 : 0, ready = yt && p.trigMode === 'normal' && sw.state === 'wait' ? 1 : 0;
          gl.uniform4fv(C.u('uLed'), new Float32Array([...led('power', 1), ...led('trig', trig), ...led('ready', ready)]));
          gl.uniform1f(C.u('uLedR'), LI.ledR);
        }
        gl.uniform2f(C.u('uRes'), W, H); gl.uniform2f(C.u('uCenter'), cx, cy); gl.uniform1f(C.u('uDiv'), div);
        gl.uniform1f(C.u('uBloomAmt'), p.glow > 0 ? p.glow * 0.35 : 0);
        gl.uniform1f(C.u('uGrid'), p.grid ? 0.05 + p.gridLight * 0.35 : 0); gl.uniform1f(C.u('uGlass'), p.glass); gl.uniform1f(C.u('uT'), time);
        gl.uniform1f(C.u('uGrain'), p.grain); gl.uniform1f(C.u('uFrame'), real ? 2 : bez ? 1 : 0);
        gl.uniform2f(C.u('uScreen'), 5.35 * div, 4.35 * div); gl.uniform1f(C.u('uRad'), div * 0.55);
        gl.uniform1f(C.u('uOverOn'), ovOn ? 1 : 0); gl.uniform1f(C.u('uDim'), self.capturing ? 0.35 : 0);
        gl.uniform3fv(C.u('uColF'), ph.f); gl.uniform3fv(C.u('uColS'), ph.s);
        const gc = ph.f; gl.uniform3f(C.u('uGridCol'), 0.55 + gc[0] * 0.25, 0.6 + gc[1] * 0.25, 0.6 + gc[2] * 0.25);
        gl.uniform3f(C.u('uBack'), 0.018 + ph.s[0] * 0.006, 0.02 + ph.s[1] * 0.008, 0.02 + ph.s[2] * 0.006);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.activeTexture(gl.TEXTURE0);
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
        for (const t of [phos, near, wide, tmpB]) if (t) { gl.deleteTexture(t.t); gl.deleteFramebuffer(t.fb); }
        gl.deleteTexture(ovTex); gl.deleteTexture(pnTex);
        const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      }
    };
    return self;
  }
};
