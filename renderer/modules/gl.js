// Minimal WebGL2 full-screen shader host used by the GPU modules.
const VERT = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const HEADER = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uT;
uniform sampler2D uSpec;   // 256 log-spaced spectrum bins, .r in 0..1
uniform sampler2D uWave;   // 512 waveform samples, .r = left, .g = right, in -1..1
out vec4 fragColor;
float spec(float x){ return texture(uSpec, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
vec2 wave(float x){ return texture(uWave, vec2(fract(x), 0.5)).rg; }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y) * 2.0 - 1.0; }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

export function createShader(canvas, fragBody) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error(log, src); throw new Error(log); }
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, HEADER + fragBody));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const locs = new Map();
  const loc = (n) => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(prog, n)); return locs.get(n); };

  const mkTex = (unit, w) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, 1, 0, gl.RG, gl.FLOAT, new Float32Array(w * 2));
    return t;
  };
  const specTex = mkTex(0, 256), waveTex = mkTex(1, 512);
  gl.uniform1i(loc('uSpec'), 0); gl.uniform1i(loc('uWave'), 1);
  const specBuf = new Float32Array(512), waveBuf = new Float32Array(1024);

  return {
    gl,
    set(name, v) {
      const l = loc(name); if (!l) return;
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
      else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]);
    },
    seti(name, v) { const l = loc(name); if (l) gl.uniform1i(l, v); },
    // float array uniform, e.g. `uniform float uRing[64];` → setv('uRing', Float32Array)
    setv(name, arr) { const l = loc(name + '[0]') || loc(name); if (l) gl.uniform1fv(l, arr); },
    // vec4 array uniform: `uniform vec4 uB[6];` → setv4('uB', Float32Array(24))
    setv4(name, arr) { const l = loc(name + '[0]') || loc(name); if (l) gl.uniform4fv(l, arr); },
    audio(F) {
      // log-resample the spectrum into 256 bins
      const n = F.spectrum.length, hz = F.sampleRate / (n * 2);
      for (let i = 0; i < 256; i++) {
        const f = 30 * Math.pow(16000 / 30, i / 255);
        const b = Math.min(n - 1, f / hz);
        const i0 = Math.floor(b), fr = b - i0;
        specBuf[i * 2] = F.spectrum[i0] * (1 - fr) + F.spectrum[Math.min(n - 1, i0 + 1)] * fr;
      }
      for (let i = 0; i < 512; i++) { waveBuf[i * 2] = F.waveL[i * 2]; waveBuf[i * 2 + 1] = F.waveR[i * 2]; }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, specTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RG, gl.FLOAT, specBuf);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, waveTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 1, gl.RG, gl.FLOAT, waveBuf);
    },
    draw() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(loc('uRes'), canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(prog); gl.deleteTexture(specTex); gl.deleteTexture(waveTex);
      const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
    }
  };
}

// Draw a readable notice on a canvas whose GPU context failed.
export function glUnavailable(canvas) {
  const ctx = canvas.getContext('2d');
  return {
    render() {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#8a93a6'; ctx.font = `${Math.max(12, canvas.width / 40)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.fillText('This module needs WebGL 2, which this GPU did not provide.', canvas.width / 2, canvas.height / 2);
    },
    resize() {}, dispose() {}
  };
}
