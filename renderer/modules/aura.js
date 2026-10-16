import { createShader, glUnavailable } from './gl.js';
import { hexToVec } from './util.js';

const FRAG = `
uniform vec3 uColA, uColB;
uniform float uSoft, uIntensity, uStreak, uSpikes, uChroma, uBass, uMid, uHigh, uKick, uDrop, uBlobs, uGrain;

// one light source: bloom core + diffraction rings + anamorphic streak + star spikes
float light(vec2 q, float r, float k) {
  float d = length(q);
  float bloom = exp(-d * d / (r * r * k * k)) + 0.18 * exp(-d / (r * k * 1.2));
  float rings = 0.5 + 0.5 * cos(d / (r * k) * 9.0 - uT * 1.5);
  rings *= exp(-d / (r * 2.2)) * 0.18 * uChroma;
  float streak = exp(-abs(q.y) / (0.004 + r * 0.03)) * exp(-abs(q.x) / (r * (0.6 + uStreak * 5.0))) * uStreak;
  float a = atan(q.y, q.x);
  float spikes = uSpikes > 0.5 ? pow(abs(cos(a * uSpikes * 0.5)), 80.0) * exp(-d / (r * 1.8)) * 0.6 : 0.0;
  return bloom + rings + streak + spikes;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = vec3(0.0);
  float N = uBlobs;
  for (float i = 0.0; i < 7.0; i++) {
    if (i >= N) break;
    float ph = i * 2.399;
    float sp = 0.13 + 0.05 * i;
    vec2 c = vec2(sin(uT * sp + ph) * 0.42 * (uRes.x / uRes.y) * 0.8, cos(uT * sp * 1.31 + ph * 1.7) * 0.28);
    c *= 0.55 + 0.6 * uMid;
    float band = spec(0.1 + i / max(N, 1.0) * 0.7);
    float r = uSoft * (0.06 + 0.1 * band + 0.08 * uBass + 0.05 * uKick + 0.06 * uDrop);
    vec3 tint = mix(uColA, uColB, fract(i * 0.37 + uT * 0.02));
    vec2 q = p - c;
    // chromatic split: each channel sees a slightly different radius
    vec3 L = vec3(light(q, r, 1.0 + uChroma * 0.08), light(q, r, 1.0), light(q, r, 1.0 - uChroma * 0.08));
    col += tint * L * (0.25 + band * 0.55);
  }
  // soft light leak across the frame, breathing with the highs
  col += mix(uColA, uColB, p.x * 0.5 + 0.5) * 0.04 * (0.5 + uHigh) * smoothstep(1.2, 0.0, length(p - vec2(0.3, 0.2)));
  col *= uIntensity;
  col = 1.0 - exp(-col * 1.25);
  col += (hash(gl_FragCoord.xy + fract(uT) * 100.0) - 0.5) * uGrain;
  fragColor = vec4(col, 1.0);
}`;

export default {
  id: 'aura',
  name: 'Aura',
  tagline: 'Light bends into cinematic motion.',
  params: [
    { key: 'colorA', label: 'Color A', type: 'color', default: '#ff8a3d' },
    { key: 'colorB', label: 'Color B', type: 'color', default: '#5ab8ff' },
    { key: 'soft', label: 'Softness', type: 'range', min: 0.3, max: 3, step: 0.05, default: 1.2 },
    { key: 'intensity', label: 'Intensity', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'blobs', label: 'Light sources', type: 'range', min: 1, max: 7, step: 1, default: 4 },
    { key: 'streak', label: 'Optical streaks', type: 'range', min: 0, max: 1.5, step: 0.05, default: 0.6 },
    { key: 'spikes', label: 'Diffraction spikes', type: 'select', default: '6', options: [['0', 'None'], ['4', '4 points'], ['6', '6 points'], ['8', '8 points']] },
    { key: 'chroma', label: 'Diffraction color split', type: 'range', min: 0, max: 2, step: 0.05, default: 0.8 },
    { key: 'speed', label: 'Drift speed', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'grain', label: 'Film grain', type: 'range', min: 0, max: 0.12, step: 0.005, default: 0.03 }
  ],
  create(canvas) {
    let s;
    try { s = createShader(canvas, FRAG); } catch (e) { s = null; }
    if (!s) return glUnavailable(canvas);
    let time = 0;
    return {
      render(F, { dt, params: p }) {
        time += dt * p.speed * (0.6 + F.mid * 0.8 + F.drop * 2);
        s.audio(F);
        s.set('uT', time);
        s.set('uColA', hexToVec(p.colorA)); s.set('uColB', hexToVec(p.colorB));
        s.set('uSoft', p.soft); s.set('uIntensity', p.intensity); s.set('uStreak', p.streak);
        s.set('uSpikes', Number(p.spikes)); s.set('uChroma', p.chroma); s.set('uBlobs', p.blobs); s.set('uGrain', p.grain);
        s.set('uBass', F.bass); s.set('uMid', F.mid); s.set('uHigh', F.high); s.set('uKick', F.kick); s.set('uDrop', F.drop);
        s.draw();
      },
      resize() {},
      dispose() { s.dispose(); }
    };
  }
};
