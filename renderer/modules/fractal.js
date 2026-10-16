import { createShader } from './gl.js';
import { hexToRgb, rgba, noise3, TAU } from './util.js';

const FRAG = `
uniform float uMode, uIter, uZoom, uSym, uHue, uSat, uGlow, uWarp, uRotA, uAA;
uniform vec2 uPan;
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
  p = p / zoom + uPan;
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

// Two looks: a recursive network (clusters of clusters of linked points, drawn on a 2D canvas),
// or the classic escape-time fractals rendered by the shader above on an offscreen canvas.
const GL_MODES = ['0', '1', '2'];
export default {
  id: 'fractal',
  name: 'Fractal',
  tagline: 'Sound transformed into recursive form.',
  params: [
    { key: 'mode', label: 'Structure', type: 'select', default: 'net', options: [['net', 'Recursive network'], ['0', 'Julia set'], ['1', 'Kali set'], ['2', 'Folded geometry']] },
    // network
    { key: 'depth', label: 'Recursion depth', type: 'range', min: 2, max: 5, step: 1, default: 4, showIf: { mode: 'net' } },
    { key: 'branch', label: 'Branches per level', type: 'range', min: 2, max: 6, step: 1, default: 4, showIf: { mode: 'net' } },
    { key: 'links', label: 'Links per point', type: 'range', min: 1, max: 6, step: 1, default: 3, showIf: { mode: 'net' } },
    { key: 'reach', label: 'Long links', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45, showIf: { mode: 'net' } },
    { key: 'tight', label: 'Cluster tightness', type: 'range', min: 0.25, max: 0.7, step: 0.01, default: 0.6, showIf: { mode: 'net' } },
    { key: 'jitter', label: 'Motion', type: 'range', min: 0, max: 2, step: 0.05, default: 0.7, showIf: { mode: 'net' } },
    { key: 'rewire', label: 'Rewire on drops and heavy hits', type: 'toggle', default: true, showIf: { mode: 'net' } },
    { key: 'lineColor', label: 'Lines', type: 'color', default: '#d8d8de', section: 'Network look', showIf: { mode: 'net' } },
    { key: 'lineAlpha', label: 'Line brightness', type: 'range', min: 0.05, max: 1, step: 0.01, default: 0.34, showIf: { mode: 'net' } },
    { key: 'nodeSize', label: 'Point size', type: 'range', min: 0, max: 4, step: 0.05, default: 1.2, showIf: { mode: 'net' } },
    { key: 'backColor', label: 'Background', type: 'color', default: '#0f0f11', showIf: { mode: 'net' } },
    // shader fractals
    { key: 'iter', label: 'Detail (iterations)', type: 'range', min: 6, max: 160, step: 1, default: 24, showIf: { mode: GL_MODES } },
    { key: 'zoom', label: 'Zoom', type: 'range', min: 0.3, max: 4, step: 0.01, default: 1, showIf: { mode: GL_MODES } },
    { key: 'sym', label: 'Kaleidoscope segments', type: 'range', min: 1, max: 16, step: 1, default: 1, showIf: { mode: GL_MODES } },
    { key: 'rotate', label: 'Rotation speed', type: 'range', min: 0, max: 2, step: 0.01, default: 0.3, showIf: { mode: GL_MODES } },
    { key: 'warp', label: 'Harmonic deformation', type: 'range', min: 0, max: 3, step: 0.05, default: 1, showIf: { mode: GL_MODES } },
    { key: 'panX', label: 'Pan X', type: 'range', min: -1.5, max: 1.5, step: 0.005, default: 0, showIf: { mode: GL_MODES } },
    { key: 'panY', label: 'Pan Y', type: 'range', min: -1.5, max: 1.5, step: 0.005, default: 0, showIf: { mode: GL_MODES } },
    { key: 'cycle', label: 'Color cycling', type: 'range', min: 0, max: 1, step: 0.01, default: 0.1, section: 'Color', showIf: { mode: GL_MODES } },
    { key: 'hue', label: 'Palette shift', type: 'range', min: 0, max: 1, step: 0.005, default: 0.05, showIf: { mode: GL_MODES } },
    { key: 'sat', label: 'Saturation', type: 'range', min: 0, max: 1.4, step: 0.01, default: 0.9, showIf: { mode: GL_MODES } },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 2, step: 0.05, default: 1, showIf: { mode: GL_MODES } },
    { key: 'aa', label: 'Smooth edges (uses more GPU)', type: 'toggle', default: true, showIf: { mode: GL_MODES } },
    { key: 'speed', label: 'Evolution speed', type: 'range', min: 0, max: 3, step: 0.05, default: 1, section: 'Motion' }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let off = null, s = null, glFailed = false;
    function shader() {
      if (s || glFailed) return s;
      try { off = document.createElement('canvas'); s = createShader(off, FRAG); } catch (e) { s = null; }
      if (!s) glFailed = true;
      return s;
    }
    let time = 0, rotA = 0, hueT = 0;
    // ---- network state
    let nodes = [], edges = [], key = '', lastRewire = -9, kickE = 0, flash = null;
    function build(W, H, p) {
      nodes = [];
      const depth = Math.round(p.depth), br = Math.round(p.branch), tight = p.tight;
      const add = (x, y, r, lvl, parent) => {
        const id = nodes.length;
        nodes.push({ hx: x, hy: y, x, y, lvl, parent, ph: Math.random() * TAU, sp: 0.4 + Math.random() });
        if (lvl >= depth) return;
        for (let k = 0; k < br; k++) {
          const a = Math.random() * TAU, d = r * (0.35 + Math.random() * 0.65);
          add(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.9, r * tight, lvl + 1, id);
        }
      };
      // the top level tiles the whole frame so the web reaches every edge
      const cols = Math.max(3, Math.round(W / H * 3)), rows = 3;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        add((i + 0.5 + (Math.random() - 0.5) * 0.5) / cols * W, (j + 0.5 + (Math.random() - 0.5) * 0.5) / rows * H, Math.min(W / cols, H / rows) * 0.9, 1, -1);
      }
      wire(p);
    }
    function wire(p) {
      edges = [];
      const L = Math.round(p.links), n = nodes.length, seen = new Set();
      for (let i = 0; i < n; i++) {
        const a = nodes[i];
        if (a.parent >= 0) { const k = Math.min(i, a.parent) * 100000 + Math.max(i, a.parent); if (!seen.has(k)) { seen.add(k); edges.push([i, a.parent]); } }
        // nearest neighbours (brute force; a few hundred points)
        const best = [];
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const b = nodes[j], d = (a.hx - b.hx) ** 2 + (a.hy - b.hy) ** 2;
          if (best.length < L) { best.push([d, j]); best.sort((u, v) => u[0] - v[0]); }
          else if (d < best[L - 1][0]) { best[L - 1] = [d, j]; best.sort((u, v) => u[0] - v[0]); }
        }
        for (const [, j] of best) { const k = Math.min(i, j) * 100000 + Math.max(i, j); if (!seen.has(k)) { seen.add(k); edges.push([i, j]); } }
      }
      // a share of longer links stitches the clusters into one web
      const R2 = (Math.max(...nodes.map((q) => q.hx)) * 0.2) ** 2;
      for (let i = 0; i < n; i++) {
        if (Math.random() > p.reach * 0.6) continue;
        for (let tries = 0; tries < 8; tries++) {
          const j = (Math.random() * n) | 0, a = nodes[i], b = nodes[j];
          const d = (a.hx - b.hx) ** 2 + (a.hy - b.hy) ** 2;
          if (j !== i && d < R2 && d > R2 * 0.05) { edges.push([i, j]); break; }
        }
      }
      flash = new Float32Array(edges.length);
    }
    function network(F, dt, W, H, S, p) {
      const k = [W, H, p.depth, p.branch, p.tight, p.reach].join('|');
      if (k !== key) { key = k; build(W, H, p); }
      else if (edges.length && p.links !== edges.linksUsed) { wire(p); }
      edges.linksUsed = p.links;
      kickE = Math.max(kickE * Math.exp(-dt / 0.18), F.kick);
      const heavy = F.onsets.some((o) => o.band === 'kick' && o.strength > 0.95);
      if (p.rewire && (F.drop > 0.95 || heavy) && time - lastRewire > 3) { lastRewire = time; build(W, H, p); }
      // hats light up a few random links
      for (const o of F.onsets) if (o.band !== 'kick') for (let c = 0; c < 6; c++) flash[(Math.random() * edges.length) | 0] = 1;
      const jit = p.jitter * Math.min(W, H) * 0.012, tt = time * 0.6;
      const breathe = 1 + kickE * 0.04 - F.build * 0.08;
      const cx = W / 2, cy = H / 2;
      for (const n of nodes) {
        const amp = jit * (1 + (n.lvl - 1) * 0.5) * (1 + F.mid);
        n.x = cx + (n.hx - cx) * breathe + noise3(n.hx * 0.01, n.hy * 0.01, tt * n.sp) * amp;
        n.y = cy + (n.hy - cy) * breathe + noise3(n.hx * 0.01 + 31, n.hy * 0.01, tt * n.sp) * amp;
      }
      const bg = hexToRgb(p.backColor), lc = hexToRgb(p.lineColor);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(bg, 1); ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = Math.max(0.6, S * 0.5);
      const base = new Path2D(), hot = new Path2D();
      for (let e = 0; e < edges.length; e++) {
        const [i, j] = edges[e], a = nodes[i], b = nodes[j];
        flash[e] *= Math.exp(-dt / 0.25);
        (flash[e] > 0.2 ? hot : base).moveTo(a.x, a.y);
        (flash[e] > 0.2 ? hot : base).lineTo(b.x, b.y);
      }
      ctx.strokeStyle = rgba(lc, Math.min(1, p.lineAlpha * (0.8 + F.level * 0.5)));
      ctx.stroke(base);
      ctx.strokeStyle = rgba(lc, Math.min(1, p.lineAlpha * 2.2));
      ctx.stroke(hot);
      if (p.nodeSize > 0) {
        const dots = new Path2D();
        for (const n of nodes) { const r = p.nodeSize * S * (n.lvl <= 2 ? 1.5 : n.lvl === 3 ? 1 : 0.6); dots.moveTo(n.x + r, n.y); dots.arc(n.x, n.y, r, 0, TAU); }
        ctx.fillStyle = rgba(lc, 0.75);
        ctx.fill(dots);
      }
    }
    return {
      render(F, { dt, W, H, S, params: p }) {
        dt = Math.max(0, Math.min(0.1, dt));
        time += dt * p.speed * (0.7 + F.mid + F.drop * 3);
        if (p.mode === 'net') return network(F, dt, W, H, S, p);
        const sh = shader();
        if (!sh) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
        if (off.width !== W || off.height !== H) { off.width = W; off.height = H; }
        rotA += dt * p.rotate * (0.5 + F.bass * 1.5);
        sh.audio(F);
        sh.set('uT', time); sh.set('uRotA', rotA);
        sh.set('uMode', Number(p.mode)); sh.set('uIter', p.iter); sh.set('uZoom', p.zoom); sh.set('uSym', p.sym);
        hueT += dt * p.cycle * 0.1;
        sh.set('uPan', [p.panX, p.panY]);
        sh.set('uHue', p.hue + hueT + F.centroid * 0.15); sh.set('uSat', p.sat); sh.set('uGlow', p.glow); sh.set('uWarp', p.warp); sh.set('uAA', p.aa ? 1 : 0);
        sh.set('uBass', F.bass); sh.set('uMid', F.mid); sh.set('uHigh', F.high); sh.set('uKick', F.kick); sh.set('uDrop', F.drop); sh.set('uBuild', F.build);
        sh.draw();
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(off, 0, 0, W, H);
      },
      resize() { key = ''; },
      dispose() { if (s) s.dispose(); }
    };
  }
};
