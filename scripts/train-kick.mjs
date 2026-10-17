// Fits the kick (or, with TARGET=snare, the snare) classifier in renderer/onset-core.js on varied synthetic mixes (test/onset-data.mjs).
// A tiny two-layer network (leaky ReLU), trained with Adam. Prints the weights to paste as KICK_NET.
//   node scripts/train-kick.mjs [trainSeeds=100] [testSeeds=40] [hidden=10]     (TARGET=snare, WRITE=1 to save)
import { OnsetCore, setKickNet, setSnareNet } from '../renderer/onset-core.js';
const TARGET = process.env.TARGET === 'snare' ? 'snare' : 'kick';
import { makeMix, SR, TOL, LAT, rng } from '../test/onset-data.mjs';
import fs from 'fs';
const nTrain = +(process.argv[2] || 100), nTest = +(process.argv[3] || 40), H = +(process.argv[4] || 10);
function collect(seeds) {
  const X = [], Y = [];
  let truthN = 0, covered = 0;
  for (const seed of seeds) {
    const { buf, truth } = makeMix(seed);
    const core = new OnsetCore(SR);
    const isKick = (t) => truth[TARGET].some((k) => Math.abs(t - LAT - k) <= TOL);
    const cands = [];
    const grab = (t, f) => { X.push(f); Y.push(isKick(t) ? 1 : 0); cands.push(t); };
    if (TARGET === 'snare') { core.collectSnare = grab; core.oracleSnare = isKick; } else { core.collect = grab; core.oracle = isKick; }
    for (let i = 0; i < buf.length; i += 128) core.process(buf.subarray(i, i + 128));
    truthN += truth[TARGET].length; covered += truth[TARGET].filter((k) => cands.some((t) => Math.abs(t - LAT - k) <= TOL)).length;
  }
  return { X, Y, recall: covered / truthN };
}
const tr = collect(Array.from({ length: nTrain }, (_, i) => i + 1));
const te = collect(Array.from({ length: nTest }, (_, i) => i + 1001));
console.log(`${TARGET} candidates train ${tr.X.length} (${(tr.recall * 100).toFixed(1)}% of hits have one), test ${te.X.length} (${(te.recall * 100).toFixed(1)}%)`);
const D = tr.X[0].length, r = rng(42);
const P = { w1: Array.from({ length: H }, () => Array.from({ length: D }, () => (r() - 0.5) * 2 / Math.sqrt(D))), b1: new Array(H).fill(0.1), w2: Array.from({ length: H }, () => (r() - 0.5) * 2 / Math.sqrt(H)), b2: 0 };
// Adam
const flat = () => [...P.w1.flat(), ...P.b1, ...P.w2, P.b2];
const unflat = (v) => { let k = 0; for (let h = 0; h < H; h++) for (let i = 0; i < D; i++) P.w1[h][i] = v[k++]; for (let h = 0; h < H; h++) P.b1[h] = v[k++]; for (let h = 0; h < H; h++) P.w2[h] = v[k++]; P.b2 = v[k++]; };
let theta = flat(); const m = new Float64Array(theta.length), v2 = new Float64Array(theta.length);
const pos = tr.Y.filter((y) => y).length, wPos = tr.Y.length / (2 * pos), wNeg = tr.Y.length / (2 * (tr.Y.length - pos));
const idx = tr.X.map((_, i) => i);
const B = 256, lr = 0.01;
let step = 0;
for (let ep = 0; ep < 60; ep++) {
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  for (let b0 = 0; b0 < idx.length; b0 += B) {
    unflat(theta);
    const g = new Float64Array(theta.length);
    const nb = Math.min(B, idx.length - b0);
    for (let q = 0; q < nb; q++) {
      const n = idx[b0 + q], x = tr.X[n], y = tr.Y[n];
      const a = new Float64Array(H), hz = new Float64Array(H);
      let z = P.b2;
      for (let h = 0; h < H; h++) { let s = P.b1[h]; for (let i = 0; i < D; i++) s += P.w1[h][i] * x[i]; hz[h] = s; a[h] = s > 0 ? s : 0.05 * s; z += P.w2[h] * a[h]; }
      const p = 1 / (1 + Math.exp(-z)), e = (p - y) * (y ? wPos : wNeg);
      let k = 0;
      for (let h = 0; h < H; h++) { const dh = e * P.w2[h] * (hz[h] > 0 ? 1 : 0.05); for (let i = 0; i < D; i++) g[k++] += dh * x[i]; }
      for (let h = 0; h < H; h++) { g[k++] += e * P.w2[h] * (hz[h] > 0 ? 1 : 0.05); }
      for (let h = 0; h < H; h++) g[k++] += e * a[h];
      g[k++] += e;
    }
    step++;
    for (let i = 0; i < theta.length; i++) {
      const gi = g[i] / nb + 1e-4 * theta[i];
      m[i] = 0.9 * m[i] + 0.1 * gi; v2[i] = 0.999 * v2[i] + 0.001 * gi * gi;
      theta[i] -= lr * (m[i] / (1 - 0.9 ** step)) / (Math.sqrt(v2[i] / (1 - 0.999 ** step)) + 1e-8);
    }
  }
}
unflat(theta);
const round = (x) => +x.toFixed(4);
const net = { w1: P.w1.map((w) => w.map(round)), b1: P.b1.map(round), w2: P.w2.map(round), b2: round(P.b2) };
if (TARGET === 'snare') setSnareNet(net); else setKickNet(net);
const core = new OnsetCore(SR);
const acc = ({ X, Y }) => { let tp = 0, fp = 0, fn = 0; for (let n = 0; n < X.length; n++) { const p = core._prob(net, X[n]) > 0.5; if (p && Y[n]) tp++; else if (p) fp++; else if (Y[n]) fn++; } return `precision ${(tp / (tp + fp) * 100).toFixed(1)}% recall ${(tp / (tp + fn) * 100).toFixed(1)}%`; };
console.log('train', acc(tr), ' test', acc(te));
if (process.env.WRITE) { const f = `${TARGET}-net.js`; fs.writeFileSync(new URL('../renderer/' + f, import.meta.url), `// ${TARGET[0].toUpperCase() + TARGET.slice(1)} classifier weights, fitted by scripts/train-kick.mjs${TARGET === 'snare' ? ' (TARGET=snare)' : ''}. Regenerate rather than edit.\nexport default ${JSON.stringify(net)};\n`); console.log('wrote renderer/' + f); }
