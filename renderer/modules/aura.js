import { createShader } from './gl.js';
import { hexToVec, hexToRgb, Accum, noise3, TAU } from './util.js';

const FRAG = `
uniform vec3 uColA, uColB;
uniform float uMotion, uSpread;
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
    vec2 c;
    if (uMotion < 0.5) c = vec2(sin(uT * sp + ph) * 0.42 * (uRes.x / uRes.y) * 0.8, cos(uT * sp * 1.31 + ph * 1.7) * 0.28);
    else if (uMotion < 1.5) c = vec2(cos(uT * sp * 0.8 + ph), sin(uT * sp * 0.8 + ph)) * 0.3;
    else if (uMotion < 2.5) c = vec2((fract(i * 0.618 + uT * sp * 0.05) - 0.5) * 1.6 * (uRes.x / uRes.y), sin(uT * 0.3 + ph) * 0.15);
    else c = vec2((i - (N - 1.0) * 0.5) * 0.28, 0.0);
    c *= uSpread;
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

// Two looks share this module:
//   specks: a breathing ring of thousands of shimmering points of light (the default)
//   blooms: soft lens blooms with streaks and diffraction spikes, drawn by a shader on an offscreen canvas
export default {
  id: 'aura',
  name: 'Aura',
  tagline: 'Light bends into cinematic motion.',
  params: [
    { key: 'style', label: 'Look', type: 'select', default: 'specks', options: [['specks', 'A ring of specks'], ['blooms', 'Light blooms']] },
    // ---- specks
    { key: 'shape', label: 'Shape', type: 'select', default: 'ring', section: 'Specks', showIf: { style: 'specks' }, options: [['ring', 'Ring'], ['double', 'Two rings'], ['disc', 'Disc'], ['sphere', 'Turning sphere']] },
    { key: 'count', label: 'Specks', type: 'range', min: 2000, max: 60000, step: 1000, default: 11000, showIf: { style: 'specks' } },
    { key: 'size', label: 'Size', type: 'range', min: 0.3, max: 1.6, step: 0.01, default: 1, showIf: { style: 'specks' } },
    { key: 'thick', label: 'Thickness', type: 'range', min: 0.1, max: 2, step: 0.01, default: 1, showIf: { style: 'specks' } },
    { key: 'aspect', label: 'Width', type: 'range', min: 0.6, max: 1.6, step: 0.01, default: 1.12, showIf: { style: 'specks' } },
    { key: 'scatter', label: 'Scattered specks', type: 'range', min: 0, max: 0.5, step: 0.01, default: 0.22, showIf: { style: 'specks' } },
    { key: 'wobble', label: 'Wobble', type: 'range', min: 0, max: 2, step: 0.05, default: 0.8, showIf: { style: 'specks' } },
    { key: 'shimmer', label: 'Shimmer', type: 'range', min: 0, max: 2, step: 0.05, default: 1, showIf: { style: 'specks' } },
    { key: 'grainSize', label: 'Speck size', type: 'range', min: 0.5, max: 3, step: 0.05, default: 1.1, showIf: { style: 'specks' } },
    { key: 'haze', label: 'Haze', type: 'range', min: 0, max: 2, step: 0.05, default: 0.45, showIf: { style: 'specks' } },
    { key: 'speckColor', label: 'Speck color', type: 'color', default: '#ffffff', showIf: { style: 'specks' } },
    { key: 'hazeColor', label: 'Haze color', type: 'color', default: '#55555c', showIf: { style: 'specks' } },
    // ---- blooms
    { key: 'colorA', label: 'Color A', type: 'color', default: '#ff8a3d', section: 'Blooms', showIf: { style: 'blooms' } },
    { key: 'colorB', label: 'Color B', type: 'color', default: '#5ab8ff', showIf: { style: 'blooms' } },
    { key: 'soft', label: 'Softness', type: 'range', min: 0.3, max: 3, step: 0.05, default: 1.2, showIf: { style: 'blooms' } },
    { key: 'intensity', label: 'Intensity', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1, showIf: { style: 'blooms' } },
    { key: 'motion', label: 'Motion', type: 'select', default: '0', showIf: { style: 'blooms' }, options: [['0', 'Drifting'], ['1', 'Orbiting'], ['2', 'Passing by'], ['3', 'Still in a row']] },
    { key: 'spread', label: 'Spread', type: 'range', min: 0.2, max: 2, step: 0.01, default: 1, showIf: { style: 'blooms' } },
    { key: 'blobs', label: 'Light sources', type: 'range', min: 1, max: 7, step: 1, default: 4, showIf: { style: 'blooms' } },
    { key: 'streak', label: 'Optical streaks', type: 'range', min: 0, max: 1.5, step: 0.05, default: 0.6, showIf: { style: 'blooms' } },
    { key: 'spikes', label: 'Diffraction spikes', type: 'select', default: '6', showIf: { style: 'blooms' }, options: [['0', 'None'], ['4', '4 points'], ['6', '6 points'], ['8', '8 points']] },
    { key: 'chroma', label: 'Diffraction color split', type: 'range', min: 0, max: 2, step: 0.05, default: 0.8, showIf: { style: 'blooms' } },
    { key: 'grain', label: 'Film grain', type: 'range', min: 0, max: 0.12, step: 0.005, default: 0.03, showIf: { style: 'blooms' } },
    { key: 'speed', label: 'Motion speed', type: 'range', min: 0, max: 3, step: 0.05, default: 1, section: 'Motion' }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    // ---- blooms: shader on an offscreen canvas, copied in
    let off = null, s = null, glFailed = false;
    function bloomShader() {
      if (s || glFailed) return s;
      try { off = document.createElement('canvas'); s = createShader(off, FRAG); } catch (e) { s = null; }
      if (!s) glFailed = true;
      return s;
    }
    // ---- specks
    const acc = new Accum();
    let N = 0, TH, RHO, OM, PH, TW, time = 0, burst = 0, kickE = 0, swellA = new Float32Array(32), yaw = 0;
    function seed(n, scatter) {
      N = n; TH = new Float32Array(n); RHO = new Float32Array(n); OM = new Float32Array(n); PH = new Float32Array(n); TW = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        TH[i] = Math.random() * TAU;
        // a gaussian band, plus a share of specks thrown far out
        const g = (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
        RHO[i] = Math.random() < scatter ? -2 + Math.random() * 5.2 : g;   // the scatter reaches far out but stays out of the middle
        OM[i] = (Math.random() - 0.5) * 0.12;
        PH[i] = Math.random() * TAU;
        TW[i] = 2 + Math.random() * 7;
      }
    }
    let lastScatter = -1;
    return {
      render(F, { dt, t, W, H, S, params: p }) {
        dt = Math.max(0, Math.min(0.1, dt));
        time += dt * p.speed * (0.6 + F.mid * 0.8 + F.drop * 2);
        if (p.style === 'blooms') {
          const sh = bloomShader();
          if (!sh) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
          if (off.width !== W || off.height !== H) { off.width = W; off.height = H; }
          sh.audio(F);
          sh.set('uT', time);
          sh.set('uColA', hexToVec(p.colorA)); sh.set('uColB', hexToVec(p.colorB));
          sh.set('uSoft', p.soft); sh.set('uIntensity', p.intensity); sh.set('uStreak', p.streak);
          sh.set('uSpikes', Number(p.spikes)); sh.set('uChroma', p.chroma); sh.set('uBlobs', p.blobs); sh.set('uMotion', Number(p.motion)); sh.set('uSpread', p.spread); sh.set('uGrain', p.grain);
          sh.set('uBass', F.bass); sh.set('uMid', F.mid); sh.set('uHigh', F.high); sh.set('uKick', F.kick); sh.set('uDrop', F.drop);
          sh.draw();
          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(off, 0, 0, W, H);
          return;
        }

        const n = Math.round(p.count);
        if (n !== N || p.scatter !== lastScatter) { seed(n, p.scatter); lastScatter = p.scatter; }
        const scale = Math.max(1, S * 0.8);
        acc.ensure(W, H, scale);
        acc.decay(0);
        kickE = Math.max(kickE * Math.exp(-dt / 0.12), F.kick);
        burst = Math.max(burst * Math.exp(-dt / 0.45), F.drop);
        // the rim swells where its slice of the spectrum is loud (low at the bottom, high at the top)
        const nb = F.bands.length;
        for (let k = 0; k < 32; k++) {
          const v = F.bands[Math.min(nb - 1, Math.floor(k / 32 * nb * 0.85))];
          swellA[k] += (v - swellA[k]) * (1 - Math.exp(-dt / 0.08));
        }
        const bw = acc.w, bh = acc.h, cx = bw / 2, cy = bh / 2;
        const R = Math.min(bw, bh) * 0.27 * p.size * (1 + kickE * 0.06 + burst * 0.25 - F.build * 0.15);
        const T = R * 0.36 * p.thick * (1 + kickE * 0.35 + burst * 1.4 - F.build * 0.5);
        const ax = p.aspect, wob = p.wobble * (0.05 + F.mid * 0.06);
        const e = 1.6 * p.shimmer, base = 1 - Math.min(0.9, 0.45 * p.shimmer);
        const rad = p.grainSize * 1.5 * S / scale;
        const energy = 0.85 * (1 + F.level * 0.5) * Math.max(1, rad * rad * 1.6);   // a speck's core reaches full white whatever its size
        const tt = time * 0.35;
        yaw += dt * p.speed * 0.3;
        const cyw = Math.cos(yaw), syw = Math.sin(yaw);
        const sparkle = F.hat * 0.8 + F.high * 0.4;
        for (let i = 0; i < n; i++) {
          TH[i] += OM[i] * dt * p.speed * (1 + F.mid);
          const th = TH[i];
          const c = Math.cos(th), sn = Math.sin(th);
          let x, y, z = 0;
          if (p.shape === 'disc') {
            const rr = Math.sqrt(Math.abs(RHO[i]) / 3.2) * (R + T);
            x = c * rr; y = sn * rr;
          } else if (p.shape === 'sphere') {
            // RHO picks the latitude: a shell whose edges pile up into a ring
            const v = PH[i] / Math.PI - 1, q = Math.sqrt(Math.max(0, 1 - v * v));   // uniform over the sphere
            const x0 = c * q * (R + T * 0.3), z0 = sn * q * (R + T * 0.3);
            x = x0 * cyw - z0 * syw; z = x0 * syw + z0 * cyw; y = v * (R + T * 0.3);
          } else {
            const k = ((th / TAU) % 1 + 1) % 1, fold = Math.abs(k * 2 - 1);  // mirrored left/right
            const sw = swellA[Math.min(31, Math.floor((1 - fold) * 31))];
            const nz = noise3(c * 1.3, sn * 1.3, tt) * wob + noise3(c * 3.1 + 7, sn * 3.1, tt * 1.7) * wob * 0.4;
            let rr = R * (1 + nz + sw * 0.08) + RHO[i] * T * (1 + sw * 0.4);
            if (rr < R * 0.12) continue;                 // the ring's hollow middle stays empty
            if (p.shape === 'double' && i % 2) rr = rr * 0.62;
            x = c * rr; y = sn * rr;
          }
          // shimmer: every speck flickers on its own clock, hats add sparkle
          const tw = base + e * 0.5 * (0.5 + 0.5 * Math.sin(time * TW[i] + PH[i])) + (Math.random() < sparkle * 0.04 ? 1.5 : 0);
          const persp = p.shape === 'sphere' ? 0.75 + 0.25 * (1 - z / (R * 2)) : 1;
          const lum = 0.3 + 0.7 * ((PH[i] * 7.31) % 1);   // some specks bright, most dimmer
          acc.splatSoft(cx + x * ax + (Math.random() - 0.5) * 0.8, cy + y + (Math.random() - 0.5) * 0.8, energy * tw * persp * lum, rad);
        }
        acc.ramp(['#000000', p.hazeColor, p.speckColor, '#ffffff']);
        acc.blit(ctx, W, H, 1.1, p.haze);
      },
      resize() {},
      dispose() { if (s) s.dispose(); }
    };
  }
};
