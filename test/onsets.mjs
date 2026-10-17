// Scores the onset detector on synthetic mixes with known hit times.
//   node test/onsets.mjs        (prints precision / recall / F1 per band and section)
import { OnsetCore } from '../renderer/onset-core.js';

const SR = 44100, BPM = 124, BEAT = 60 / BPM, S16 = BEAT / 4;
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

function render(sections) {
  const total = sections.reduce((a, s) => a + s.bars * 4 * BEAT, 0);
  const N = Math.ceil(total * SR) + SR;
  const buf = new Float32Array(N), truth = { kick: [], snare: [], hat: [] }, secT = [];
  const r = rng(7);
  const add = (t0, len, fn) => { const a = Math.floor(t0 * SR), b = Math.min(N, a + Math.floor(len * SR)); for (let i = a; i < b; i++) buf[i] += fn((i - a) / SR); };
  const kick = (t, amp, long = false) => {
    truth.kick.push(t); let ph = 0;
    add(t, long ? 0.9 : 0.35, (x) => { const f = 45 + 110 * Math.exp(-x * 28); ph += 2 * Math.PI * f / SR; const env = Math.exp(-x * (long ? 4 : 11)); return amp * (Math.sin(ph) * env + (x < 0.004 ? (r() * 2 - 1) * 0.35 * (1 - x / 0.004) : 0)); });
  };
  const snare = (t, amp) => { truth.snare.push(t); let ph = 0; add(t, 0.25, (x) => { ph += 2 * Math.PI * 190 / SR; return amp * (Math.sin(ph) * Math.exp(-x * 30) * 0.5 + (r() * 2 - 1) * Math.exp(-x * 18)); }); };
  let hp = 0;
  const hat = (t, amp) => { truth.hat.push(t); add(t, 0.06, (x) => { const n = r() * 2 - 1, y = n - hp; hp = n; return amp * y * Math.exp(-x * 70); }); };
  // bass: plucked saw through a one-pole lowpass, sharp attack (the classic false-positive source)
  const bass = (t, f, len, amp) => { let ph = 0, lp = 0; add(t, len, (x) => { ph = (ph + f / SR) % 1; lp += (ph * 2 - 1 - lp) * 0.06; return amp * lp * Math.min(1, x / 0.003) * Math.exp(-x * 2.5); }); };
  const pad = (t, len, amp) => { add(t, len, (x) => amp * (Math.sin(2 * Math.PI * 220 * x) + Math.sin(2 * Math.PI * 277 * x) + Math.sin(2 * Math.PI * 330 * x)) / 3 * Math.min(1, x / 0.5)); };
  let t0 = 0;
  for (const s of sections) {
    secT.push([s.name, t0, t0 + s.bars * 4 * BEAT]);
    for (let bar = 0; bar < s.bars; bar++) {
      const tb = t0 + bar * 4 * BEAT;
      if (s.pad) pad(tb, 4 * BEAT, s.pad);
      for (let i = 0; i < 16; i++) {
        const t = tb + i * S16 + (s.swing && i % 2 ? S16 * 0.18 : 0);
        if (s.kicks && s.kicks.includes(i)) kick(t, s.kickAmp * (0.85 + r() * 0.3), s.long);
        if (s.snares && s.snares.includes(i)) snare(t, s.snareAmp || 0.3);
        if (s.hats && s.hats.includes(i)) hat(t, (s.hatAmp || 0.12) * (i % 4 === 2 ? 1 : 0.6));
        if (s.bass && s.bass.includes(i)) bass(t, [55, 55, 65.4, 49][bar % 4] * (i % 3 === 0 ? 2 : 1), S16 * 2.5, s.bassAmp || 0.4);
      }
    }
    t0 += s.bars * 4 * BEAT;
  }
  for (let i = 0; i < N; i++) buf[i] += (r() * 2 - 1) * 0.003;   // noise floor
  // master bus: soft clip
  for (let i = 0; i < N; i++) buf[i] = Math.tanh(buf[i] * 1.2);
  return { buf, truth, secT };
}

const SECTIONS = [
  { name: 'four on the floor', bars: 8, kicks: [0, 4, 8, 12], kickAmp: 0.8, snares: [4, 12], hats: [2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15], bass: [2, 6, 10, 14], pad: 0.08 },
  { name: 'breakdown, bass only', bars: 4, bass: [0, 3, 6, 8, 11, 14], bassAmp: 0.55, pad: 0.12 },
  { name: 'quiet kick, loud bass', bars: 4, kicks: [0, 4, 8, 12], kickAmp: 0.32, bass: [1, 2, 5, 6, 9, 10, 13, 14], bassAmp: 0.6, hats: [2, 6, 10, 14] },
  { name: 'broken beat', bars: 4, kicks: [0, 3, 7, 10, 11], kickAmp: 0.75, snares: [4, 12], swing: true, hats: [0, 2, 4, 6, 8, 10, 12, 14] },
  { name: 'long 808', bars: 4, kicks: [0, 6, 10], kickAmp: 0.9, long: true, snares: [8], hats: [0, 2, 4, 6, 8, 10, 12, 14, 15] },
  { name: 'drop', bars: 8, kicks: [0, 4, 8, 12], kickAmp: 1, snares: [4, 12], snareAmp: 0.45, hats: [2, 6, 10, 14], bass: [2, 6, 10, 14], bassAmp: 0.5, pad: 0.1 }
];

export function renderTest() { return render(SECTIONS); }
export { render, SECTIONS };
if (process.argv[1] && !process.argv[1].endsWith('onsets.mjs')) { /* imported */ } 
if (process.env.NO_RUN) { globalThis.__onsetTest = { render, SECTIONS }; } else {
const { buf, truth, secT } = render(SECTIONS);
const core = new OnsetCore(SR);
if (process.env.DEBUG) core.debug = (k, P, ok, c) => { if (k === process.env.DEBUG && P.t < +(process.env.UNTIL || 4)) { const near = truth[k].some((t) => Math.abs(P.t - 0.012 - t) < 0.035); console.log(P.t.toFixed(3), near ? 'TRUE ' : 'false', ok ? 'ACCEPT' : 'reject', 'rise', P.rise.toFixed(1), 'thr', P.thr.toFixed(1), 'peak', P.peak.toFixed(1), 'ref', (c.b[k].ref ?? NaN).toFixed(1), 'pl', c.b[k].peakLevel.toFixed(1), 'm1', P.m1.toFixed(1), 'm2', P.m2.toFixed(1), 'm3', P.m3.toFixed(1), 'm2pk', P.m2pk.toFixed(1), 'low', P.lowpk.toFixed(1), 'sweep', (P.sweep ?? NaN).toFixed(1)); } };
const found = { kick: [], snare: [], hat: [] };
for (let i = 0; i < buf.length; i += 128) for (const o of core.process(buf.subarray(i, i + 128))) found[o.band].push(o.t);

const TOL = 0.035, LAT = 0.012;   // expected latency: about one hop plus filter delay
function score(band, a, b) {
  const tr = truth[band].filter((t) => t >= a && t < b), fd = found[band].filter((t) => t >= a && t < b + TOL);
  const used = new Set(); let tp = 0;
  for (const t of tr) { const j = fd.findIndex((f, k) => !used.has(k) && Math.abs(f - LAT - t) <= TOL); if (j >= 0) { used.add(j); tp++; } }
  return { tp, fp: fd.length - tp, fn: tr.length - tp, n: tr.length };
}
let all = { kick: { tp: 0, fp: 0, fn: 0 }, snare: { tp: 0, fp: 0, fn: 0 }, hat: { tp: 0, fp: 0, fn: 0 } };
for (const [name, a, b] of secT) {
  const row = [];
  for (const band of ['kick', 'snare', 'hat']) {
    const s = score(band, a, b); for (const k of ['tp', 'fp', 'fn']) all[band][k] += s[k];
    row.push(`${band} ${s.tp}/${s.n}${s.fp ? ' +' + s.fp + ' false' : ''}`);
  }
  console.log(name.padEnd(24), row.join('   '));
}
for (const band of ['kick', 'snare', 'hat']) {
  const { tp, fp, fn } = all[band], p = tp / Math.max(1, tp + fp), r = tp / Math.max(1, tp + fn);
  console.log(`${band.padEnd(6)} precision ${(p * 100).toFixed(0)}%  recall ${(r * 100).toFixed(0)}%  F1 ${((2 * p * r) / Math.max(1e-9, p + r) * 100).toFixed(0)}%`);
}
if (process.argv[2] === 'lat') { const d = found.kick.map((f) => f - truth.kick.reduce((m, t) => (Math.abs(f - t) < Math.abs(f - m) ? t : m), 1e9)); console.log('kick latency ms', d.slice(0, 20).map((x) => (x * 1000).toFixed(0)).join(' ')); }
}
