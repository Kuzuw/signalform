// Varied synthetic mixes with known kick / snare / hat times, for scoring and tuning the onset detector.
// Every seed picks its own kick, bass, tempo, groove and levels, so tuning on some seeds and
// scoring on others shows whether the detector generalizes.
export const SR = 44100;

export function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

const KICKS = {
  classic: { f0: 155, f1: 45, sweep: 28, decay: 11, click: 0.35, len: 0.35 },
  techno: { f0: 95, f1: 48, sweep: 22, decay: 9, click: 0.5, len: 0.4 },
  round: { f0: 120, f1: 50, sweep: 18, decay: 8, click: 0, len: 0.45 },
  punchy: { f0: 210, f1: 55, sweep: 45, decay: 16, click: 0.25, len: 0.25 },
  e808: { f0: 130, f1: 46, sweep: 25, decay: 3.5, click: 0.1, len: 1.0 },
  hard: { f0: 180, f1: 52, sweep: 30, decay: 6, click: 0.6, len: 0.5, drive: 3 }
};
const BASSES = ['pluck', 'sub', 'subHard', 'reese', 'none'];

export function makeMix(seed, opts = {}) {
  const r = rng(seed * 7919 + 13);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const kickName = opts.kick || pick(Object.keys(KICKS));
  const K = KICKS[kickName];
  const bassType = opts.bass || pick(BASSES);
  const bpm = opts.bpm || Math.round(85 + r() * 70);
  const BEAT = 60 / bpm, S16 = BEAT / 4;
  const bars = opts.bars || 12;
  const total = bars * 4 * BEAT + 1;
  const N = Math.ceil(total * SR);
  const buf = new Float32Array(N), truth = { kick: [], snare: [], hat: [] };
  const add = (t0, len, fn) => { const a = Math.max(0, Math.floor(t0 * SR)), b = Math.min(N, a + Math.floor(len * SR)); for (let i = a; i < b; i++) buf[i] += fn((i - a) / SR, i); };
  const kickAmp = 0.45 + r() * 0.5, bassAmp = bassType === 'none' ? 0 : 0.15 + r() * 0.5;
  const pump = r() < 0.5;            // sidechain: bass and pad duck under each kick
  const kickTimes = [];
  const kick = (t, amp) => {
    truth.kick.push(t); kickTimes.push(t);
    let ph = 0;
    add(t, K.len, (x) => {
      const f = K.f1 + (K.f0 - K.f1) * Math.exp(-x * K.sweep);
      ph += 2 * Math.PI * f / SR;
      let y = Math.sin(ph) * Math.exp(-x * K.decay);
      if (K.drive) y = Math.tanh(y * K.drive) / Math.tanh(K.drive);
      const click = x < 0.005 ? (r() * 2 - 1) * K.click * (1 - x / 0.005) : 0;
      return amp * (y + click);
    });
  };
  const duck = (t) => { if (!pump) return 1; let g = 1; for (let j = kickTimes.length - 1; j >= 0 && j > kickTimes.length - 3; j--) { const d = t - kickTimes[j]; if (d >= 0 && d < 0.3) g = Math.min(g, 0.25 + 0.75 * (d / 0.3)); } return g; };
  const snare = (t, amp, clap) => {
    truth.snare.push(t); let ph = 0;
    add(t, 0.25, (x) => { ph += 2 * Math.PI * 190 / SR; const n = r() * 2 - 1; const env = clap ? (x < 0.03 ? Math.exp(-((x * 1000) % 10) * 0.3) : Math.exp(-(x - 0.03) * 22)) : Math.exp(-x * 18); return amp * (clap ? 0 : Math.sin(ph) * Math.exp(-x * 30) * 0.5) + amp * n * env; });
  };
  let hpz = 0;
  const hat = (t, amp, open) => { truth.hat.push(t); add(t, open ? 0.25 : 0.06, (x) => { const n = r() * 2 - 1, y = n - hpz; hpz = n; return amp * y * Math.exp(-x * (open ? 14 : 70)); }); };
  const bassNote = (t, f, len, amp) => {
    let ph = 0, ph2 = 0, lp = 0;
    add(t, len, (x, i) => {
      const g = duck(i / SR);
      if (bassType === 'sub') { ph += 2 * Math.PI * f / SR; return amp * g * Math.sin(ph) * Math.min(1, x / 0.015) * Math.min(1, (len - x) / 0.02); }
      if (bassType === 'subHard') { ph += 2 * Math.PI * f / SR; return amp * g * Math.sin(ph) * Math.min(1, x / 0.002) * Math.exp(-x * 3); }
      if (bassType === 'reese') { ph = (ph + f / SR) % 1; ph2 = (ph2 + f * 1.012 / SR) % 1; lp += ((ph + ph2 - 1) - lp) * 0.05; return amp * g * lp * Math.min(1, x / 0.01); }
      ph = (ph + f / SR) % 1; lp += (ph * 2 - 1 - lp) * 0.06; return amp * g * lp * Math.min(1, x / 0.003) * Math.exp(-x * 2.5);
    });
  };
  const padAmp = r() * 0.12;
  // grooves: 16-step patterns
  const GROOVES = [
    { k: [0, 4, 8, 12], s: [4, 12], h: [2, 6, 10, 14] },                 // four on the floor
    { k: [0, 4, 8, 12], s: [4, 12], h: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
    { k: [0, 6, 10], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14] },          // hip hop
    { k: [0, 3, 7, 10, 11], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14] },   // broken
    { k: [0, 10], s: [8], h: [0, 2, 4, 6, 8, 10, 12, 14, 15] },             // half time
    { k: [0, 2, 4, 6, 8, 10, 12, 14], s: [4, 12], h: [1, 3, 5, 7, 9, 11, 13, 15] } // fast kicks
  ];
  const groove = opts.groove != null ? GROOVES[opts.groove] : pick(GROOVES);
  const bassSteps = pick([[2, 6, 10, 14], [0, 3, 6, 8, 11, 14], [1, 2, 5, 6, 9, 10, 13, 14], [0, 8], [0, 2, 4, 6, 8, 10, 12, 14]]);
  const swing = r() < 0.3 ? 0.15 : 0;
  const roots = [55, 43.65, 65.41, 49];
  // arrangement: groove / breakdown (no kicks) / groove
  for (let bar = 0; bar < bars; bar++) {
    const tb = bar * 4 * BEAT;
    const breakdown = bar >= Math.floor(bars * 0.4) && bar < Math.floor(bars * 0.4) + 3;
    if (padAmp > 0.01) add(tb, 4 * BEAT, (x, i) => padAmp * duck(i / SR) * (Math.sin(2 * Math.PI * 220 * x) + Math.sin(2 * Math.PI * 277 * x) + Math.sin(2 * Math.PI * 330 * x)) / 3 * Math.min(1, x / 0.4));
    for (let i = 0; i < 16; i++) {
      const t = tb + i * S16 + (swing && i % 2 ? S16 * swing : 0);
      if (!breakdown && groove.k.includes(i)) kick(t, kickAmp * (0.85 + r() * 0.3));
      if (!breakdown && groove.s.includes(i)) snare(t, 0.15 + r() * 0.25, seed % 3 === 0);
      if (groove.h.includes(i) && (!breakdown || i % 4 === 2)) hat(t, (0.05 + r() * 0.1) * (i % 4 === 2 ? 1 : 0.6), r() < 0.08);
      if (bassAmp > 0 && bassSteps.includes(i)) bassNote(t, roots[bar % 4] * (i % 3 === 0 ? 2 : 1), S16 * (bassType === 'reese' ? 3.5 : 2.5), bassAmp);
    }
  }
  for (let i = 0; i < N; i++) buf[i] += (r() * 2 - 1) * 0.002;
  const drive = 1 + r() * 1.5;
  for (let i = 0; i < N; i++) buf[i] = Math.tanh(buf[i] * drive) / Math.min(1, Math.tanh(drive));
  return { buf, truth, meta: { kick: kickName, bass: bassType, bpm, pump, kickAmp: +kickAmp.toFixed(2), bassAmp: +bassAmp.toFixed(2) } };
}

export const TOL = 0.035, LAT = 0.012;
export function score(truthT, found) {
  const used = new Set(); let tp = 0;
  for (const t of truthT) { const j = found.findIndex((f, k) => !used.has(k) && Math.abs(f - LAT - t) <= TOL); if (j >= 0) { used.add(j); tp++; } }
  return { tp, fp: found.length - tp, fn: truthT.length - tp };
}
