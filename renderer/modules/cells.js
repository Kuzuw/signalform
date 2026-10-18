import { createShader, glUnavailable } from './gl.js';
import { hexToVec } from './util.js';

// A living Voronoi tissue. Every cell listens to its own slice of the spectrum.
const FRAG = `
uniform vec3 uColA, uColB, uEdgeCol;
uniform float uScale, uJit, uEdge, uFill, uBevel, uStyle, uColorMode, uMap, uPulse, uEdgeGlow, uBright, uAspect, uHigh, uHat, uDrop;

vec2 hash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }

vec2 site(vec2 n) {
  vec2 h = hash2(n);
  vec2 o = 0.5 + 0.5 * sin(uT + 6.2831853 * h) * uJit;
  // hits push every site away from its cell center for a moment: the tissue flinches
  o += (h - 0.5) * uPulse * 0.5;
  return o;
}

// iq's two-pass Voronoi: nearest site, its cell id, and the exact distance to the cell border
vec3 voronoi(vec2 x, out vec2 cellId, out vec2 toSite) {
  vec2 n = floor(x), f = fract(x);
  vec2 mg, mr;
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + site(n + g) - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  float bd = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 r = g + site(n + g) - f;
    if (dot(mr - r, mr - r) > 1e-5) bd = min(bd, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  cellId = n + mg;
  toSite = mr;
  return vec3(sqrt(md), bd, 0.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 x = uv * uScale;
  vec2 id, ts;
  vec3 v = voronoi(x, id, ts);
  float border = v.y;                                   // 0 on the wall, ~0.5 in the middle
  vec2 center = (x + ts) / uScale;                       // the cell's site in screen units
  float hsh = hash(id + 0.37);
  // which slice of the spectrum this cell listens to
  float f = uMap < 0.5 ? hsh : uMap < 1.5 ? clamp(length(center) / (0.5 * uAspect + 0.2), 0.0, 1.0) : clamp(center.x / uAspect + 0.5, 0.0, 1.0);
  float e = spec(0.03 + f * 0.85);
  e = e * e * 2.2 + e * 0.4;
  vec3 tint = uColorMode < 0.5 ? mix(uColA, uColB, f) : uColorMode < 1.5 ? mix(uColA, uColB, step(0.5, hash(id + 9.1))) : uColA;
  float aa = fwidth(border) * 1.5;
  float wall = 1.0 - smoothstep(uEdge * 0.04, uEdge * 0.04 + aa, border);
  float lit = uFill * (0.06 + e);
  vec3 col;
  if (uStyle < 0.5) {                     // glass: frosted panes lit from the upper left, hair-thin bright walls
    float rim = exp(-border * 9.0);
    vec3 nn = normalize(vec3(-ts * (1.2 + uBevel * 2.0) * smoothstep(0.0, 0.35, border), 1.0));
    float sheen = pow(max(dot(nn, normalize(vec3(-0.5, 0.6, 0.62))), 0.0), 7.0);
    float depth = 0.55 + 0.45 * hash(id + 5.7);           // panes sit at slightly different depths
    col = tint * lit * (0.22 + 0.85 * rim) * depth;
    col += mix(tint, vec3(1.0), 0.6) * sheen * (0.05 + e * 0.25) * uBevel;
    float halo = exp(-border * 34.0);
    col += uEdgeCol * (wall * 0.85 + halo * 0.22) * (0.3 + uEdgeGlow * (0.45 + e * 1.4 + uHat * 0.6));
  } else if (uStyle < 1.5) {              // organic: soft bodies, dark gaps, a nucleus
    float body = smoothstep(0.0, 0.25 + 0.15 * uBevel, border);
    float nucleus = exp(-dot(ts, ts) * 60.0) * (0.4 + e);
    col = tint * (lit * 1.5 + 0.04) * body * (0.55 + 0.45 * (1.0 - length(ts))) + tint * nucleus * 0.8 * uFill;
    col += uEdgeCol * (1.0 - smoothstep(0.0, 0.06 + aa, border)) * 0.08 * uEdgeGlow * (0.3 + e);
  } else if (uStyle < 2.5) {              // crystal: every cell a cut facet, lit from the upper left
    vec3 n = normalize(vec3(-ts * (1.0 + uBevel * 3.0) * smoothstep(0.0, 0.3, border), 1.0));
    float l = max(dot(n, normalize(vec3(-0.5, 0.6, 0.65))), 0.0);
    float sp = pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), n), normalize(vec3(-0.4, 0.5, 0.8))), 0.0), 24.0);
    col = tint * lit * (0.25 + 1.1 * l) + vec3(1.0) * sp * (0.2 + e) * uBevel;
    col += uEdgeCol * wall * 0.5 * uEdgeGlow;
  } else {                                // mosaic: stained glass with dark leading
    float lead = 1.0 - smoothstep(uEdge * 0.05, uEdge * 0.05 + aa, border);
    col = tint * (0.18 + e * 1.4) * uFill * (0.75 + 0.25 * hash(id + 3.3));
    col *= 1.0 - lead * 0.95;
    col += uEdgeCol * lead * 0.04 * uEdgeGlow;
  }
  col *= uBright * (1.0 + uDrop * 0.6);
  col = 1.0 - exp(-col * 1.4);
  fragColor = vec4(col, 1.0);
}`;

export default {
  id: 'cells',
  name: 'Cells',
  tagline: 'A living tissue that listens cell by cell.',
  params: [
    { key: 'style', label: 'Style', type: 'select', default: 'glass', options: [['glass', 'Glass'], ['organic', 'Organic'], ['crystal', 'Crystal'], ['mosaic', 'Stained glass']] },
    { key: 'map', label: 'Cells follow', type: 'select', default: 'random', options: [['random', 'A random slice each'], ['radial', 'Center lows, edge highs'], ['across', 'Lows left, highs right']] },
    { key: 'scale', label: 'Cell count', type: 'range', min: 2, max: 30, step: 0.5, default: 7, section: 'Motion' },
    { key: 'jitter', label: 'Movement range', type: 'range', min: 0, max: 1, step: 0.01, default: 0.8 },
    { key: 'speed', label: 'Movement speed', type: 'range', min: 0, max: 3, step: 0.05, default: 0.6 },
    { key: 'flinch', label: 'Flinch on hits', type: 'range', min: 0, max: 2, step: 0.05, default: 0.8 },
    { key: 'breathe', label: 'Shrink on builds', type: 'toggle', default: true },
    { key: 'edge', label: 'Wall width', type: 'range', min: 0.1, max: 4, step: 0.05, default: 0.45, section: 'Look' },
    { key: 'edgeGlow', label: 'Wall glow', type: 'range', min: 0, max: 2, step: 0.05, default: 0.85 },
    { key: 'fill', label: 'Cell light', type: 'range', min: 0, max: 2, step: 0.05, default: 0.85 },
    { key: 'bevel', label: 'Depth', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'bright', label: 'Brightness', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'coloring', label: 'Coloring', type: 'select', default: 'freq', section: 'Color', options: [['freq', 'By frequency'], ['two', 'Two colors'], ['mono', 'Single color']] },
    { key: 'colorA', label: 'Color A', type: 'color', default: '#3f6bff' },
    { key: 'colorB', label: 'Color B', type: 'color', default: '#20d3c2' },
    { key: 'edgeColor', label: 'Wall color', type: 'color', default: '#e4eaff' }
  ],
  create(canvas) {
    let s;
    try { s = createShader(canvas, FRAG); } catch (e) { s = null; }
    if (!s) return glUnavailable(canvas);
    let time = 0, pulse = 0, shrink = 0;
    return {
      render(F, { dt, W, H, params: p }) {
        time += dt * p.speed * (0.5 + F.mid * 1.2 + F.drop * 2);
        let hit = 0;
        for (const o of F.onsets) hit = Math.max(hit, o.band === 'hat' ? o.strength * 0.3 : o.strength);
        pulse = Math.max(pulse * Math.exp(-dt / 0.14), hit * p.flinch * 0.35 + F.drop * p.flinch * 0.6);
        shrink += ((p.breathe ? F.build * 0.7 - F.drop * 0.25 : 0) - shrink) * (1 - Math.exp(-dt / 0.4));
        s.audio(F);
        s.set('uT', time);
        s.set('uScale', p.scale * (1 + shrink)); s.set('uJit', p.jitter); s.set('uPulse', pulse);
        s.set('uEdge', p.edge); s.set('uEdgeGlow', p.edgeGlow); s.set('uFill', p.fill); s.set('uBevel', p.bevel); s.set('uBright', p.bright);
        s.set('uStyle', ['glass', 'organic', 'crystal', 'mosaic'].indexOf(p.style));
        s.set('uMap', ['random', 'radial', 'across'].indexOf(p.map));
        s.set('uColorMode', ['freq', 'two', 'mono'].indexOf(p.coloring));
        s.set('uColA', hexToVec(p.colorA)); s.set('uColB', hexToVec(p.colorB)); s.set('uEdgeCol', hexToVec(p.edgeColor));
        s.set('uAspect', W / Math.max(1, H)); s.set('uHigh', F.high); s.set('uHat', F.hat); s.set('uDrop', F.drop);
        s.draw();
      },
      resize() {},
      dispose() { s.dispose(); }
    };
  }
};
