// Scores the onset detector on many varied synthetic mixes (see onset-data.mjs).
//   node test/onsets-varied.mjs [firstSeed] [count]
import { OnsetCore } from '../renderer/onset-core.js';
import { makeMix, score, SR } from './onset-data.mjs';
const first = +(process.argv[2] || 1), count = +(process.argv[3] || 24);
const tot = { kick: { tp: 0, fp: 0, fn: 0 }, snare: { tp: 0, fp: 0, fn: 0 }, hat: { tp: 0, fp: 0, fn: 0 } };
for (let seed = first; seed < first + count; seed++) {
  const { buf, truth, meta } = makeMix(seed);
  const core = new OnsetCore(SR), found = { kick: [], snare: [], hat: [] };
  for (let i = 0; i < buf.length; i += 128) for (const o of core.process(buf.subarray(i, i + 128))) found[o.band].push(o.t);
  const row = [];
  for (const b of ['kick', 'snare', 'hat']) { const s = score(truth[b], found[b]); for (const k in s) tot[b][k] += s[k]; if (b === 'kick') row.push(`kick ${s.tp}/${truth.kick.length}${s.fp ? ' +' + s.fp : ''}`); }
  if (process.env.V) console.log(String(seed).padStart(3), JSON.stringify(meta).padEnd(96), row.join(' '));
}
for (const b of ['kick', 'snare', 'hat']) {
  const { tp, fp, fn } = tot[b], p = tp / Math.max(1, tp + fp), r = tp / Math.max(1, tp + fn);
  const f1 = (2 * p * r) / Math.max(1e-9, p + r) * 100;
  console.log(`${b.padEnd(6)} precision ${(p * 100).toFixed(0)}%  recall ${(r * 100).toFixed(0)}%  F1 ${f1.toFixed(0)}%`);
  // MIN_F1=80 makes this a test: kicks and snares must reach it
  if (process.env.MIN_F1 && b !== 'hat' && f1 < +process.env.MIN_F1) { console.error(`${b} F1 ${f1.toFixed(0)}% is below ${process.env.MIN_F1}%`); process.exitCode = 1; }
}
