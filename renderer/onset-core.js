// Onset detection that runs on every audio sample, not once per video frame.
// Kicks: a candidate is any fast rise of the low end; ~24 ms later a small trained network
// (renderer/kick-net.js, fitted by scripts/train-kick.mjs) decides from the shape of the hit:
// loudness against earlier kicks, the click on top, how the pitch falls, the beat pulse.
// Used by the audio worklet (onset-worklet.js) and by the tests in Node (test/onsets.mjs).
//
// The mono mix is split into a few filtered bands whose smoothed power is read every 4 ms.
// A candidate is a fast rise of a band's power (in dB) over the previous ~16 ms that clears a
// threshold adapting to the music. Candidates are confirmed a few milliseconds later by what
// a real hit of that kind looks like:
//   kick   the energy sits low (sub well above upper bass), unlike a bass note's harmonics
//   snare  broadband: low-mid, mid and high-mid all jump, and it lasts longer than a click
//   hat    high band only, and it lasts longer than a click
// Each band has a refractory period and re-arms only once its rise has settled.

import NET from './kick-net.js';
import SNET from './snare-net.js';

class Biquad {
  constructor(type, f, q, sr) {
    const w = 2 * Math.PI * f / sr, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = a; b1 = 0; b2 = -a; }   // band-pass, 0 dB peak
    const a0 = 1 + a;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - a) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const HISTORY = 10, LOOKBACK = 4;
const ENV = (typeof process !== 'undefined' && process.env) || {};
const KICK_AGE = +(ENV.KICK_AGE || 6), KICK_THR = +(ENV.KICK_THR || 0.6);

// smoothed power of one filtered band, kept as a short history in dB
class Env {
  constructor(sr, tau, filters) { this.f = filters; this.k = 1 - Math.exp(-1 / (sr * tau)); this.p = 0; this.h = new Float32Array(HISTORY).fill(-90); this.L = -90; }
  push(x) { let y = x; for (const f of this.f) y = f.run(y); this.p += (y * y - this.p) * this.k; }
  hop() { this.L = Math.max(-90, 10 * Math.log10(this.p + 1e-12)); this.h.copyWithin(0, 1); this.h[HISTORY - 1] = this.L; }
  // rise of the newest value over the lowest of the LOOKBACK values before it
  rise(lb = LOOKBACK) { let m = Infinity; for (let j = HISTORY - 1 - lb; j < HISTORY - 1; j++) m = Math.min(m, this.h[j]); return this.L - m; }
}

const CFG = {
  kick: { gap: 0.1, minRise: 6, gate: 24, delay: 4 },
  snare: { gap: 0.09, minRise: 5, gate: 22, delay: 3 },
  hat: { gap: 0.045, minRise: 5, gate: 28, delay: 2 }
};
const NAMES = Object.keys(CFG);
// kick classifier weights (bias first), fitted by scripts/train-kick.mjs on varied synthetic mixes
let KICK_NET = NET, SNARE_NET = SNET;
export function setKickNet(n) { KICK_NET = n; }
export function setSnareNet(n) { SNARE_NET = n; }
const SNARE_AGE = +(ENV.SNARE_AGE || 5), SNARE_THR = +(ENV.SNARE_THR || 0.85);

export class OnsetCore {
  constructor(sr) {
    this.sr = sr;
    this.hop = Math.max(64, Math.round(sr * 0.004));
    this.n = 0; this.time = 0;
    this.sens = 1;
    const lp = (f) => new Biquad('lp', f, 0.71, sr), hp = (f) => new Biquad('hp', f, 0.71, sr), bp = (f, q) => new Biquad('bp', f, q, sr);
    this.e = {
      kick: new Env(sr, 0.005, [lp(150), hp(30)]),
      sub: new Env(sr, 0.008, [lp(85), lp(85), hp(30)]),
      upb: new Env(sr, 0.008, [bp(260, 0.9)]),
      lo2: new Env(sr, 0.004, [bp(150, 1.2)]),
      m1: new Env(sr, 0.004, [bp(900, 0.9)]),
      m2: new Env(sr, 0.004, [bp(2500, 0.9)]),
      m3: new Env(sr, 0.003, [bp(5500, 0.9)]),
      hat: new Env(sr, 0.003, [hp(7500), hp(7500)]),
      sn: new Env(sr, 0.004, [hp(1200), lp(7000)])     // broadband noise band where a snare or clap shows
    };
    this.envs = Object.values(this.e);
    // pitch track of the low end: a kick's pitch falls fast (its periods lengthen), a bass note's doesn't
    this.zf = [lp(220), lp(220), hp(30)];
    this.zPrev = 0; this.zEnv = 0; this.ns = 0;
    this.zc = new Float64Array(64); this.zi = 0; this.zn = 0;
    this.snareE = this.e.sn;   // the band snare candidates are found in
    this.b = {};
    for (const k of NAMES) this.b[k] = { peakRise: 12, peakLevel: -40, ref: null, refTop: -40, peaks: [], r1: 0, r2: 0, last: -9, armed: true, pending: null, cfg: CFG[k] };
  }

  setSensitivity(s) { this.sens = Math.max(0.3, Math.min(3, s)); }

  // Feed mono samples; returns onsets confirmed in this block: [{ band, strength, t }]
  process(x) {
    const out = [], envs = this.envs;
    const zf = this.zf, zk = 1 - Math.exp(-1 / (this.sr * 0.02));
    for (let i = 0; i < x.length; i++) {
      const s = x[i];
      for (let j = 0; j < envs.length; j++) envs[j].push(s);
      let z = s; for (let j = 0; j < 3; j++) z = zf[j].run(z);
      this.zEnv += (Math.abs(z) - this.zEnv) * zk;
      if (this.zPrev < 0 && z >= 0 && this.zEnv > 1e-4) {          // upward zero crossing, interpolated
        this.zc[this.zi] = (this.ns - 1 + -this.zPrev / (z - this.zPrev)) / this.sr;
        this.zi = (this.zi + 1) & 63; if (this.zn < 64) this.zn++;
      }
      this.zPrev = z; this.ns++;
      if (++this.n >= this.hop) { this.n = 0; this._hop(out); }
    }
    return out;
  }

  // Periods (seconds) of the low band since time t0, oldest first.
  _periods(t0) {
    const out = [];
    let prev = -1;
    for (let j = this.zn; j > 0; j--) {
      const c = this.zc[(this.zi - j + 64) & 63];
      if (c < t0) continue;
      if (prev >= 0) out.push(c - prev);
      prev = c;
    }
    return out;
  }
  // How the low end's pitch moves after an onset. Crossing intervals are summed in pairs so a
  // waveform with harmonics (alternating short/long intervals) reads as one steady pitch.
  _sweep(t) {
    const raw = this._periods(t - 0.008), p = [];
    let carry = 0;
    for (const v of raw) { if (v + carry < 0.0035) { carry += v; continue; } p.push(v + carry); carry = 0; }   // fold glitches into the next interval
    const s = []; for (let j = 0; j + 1 < p.length; j++) s.push(p[j] + p[j + 1]);
    let rising = false;
    for (let j = 0; j + 2 < s.length && j < 3; j++) {
      if (s[j] < 0.03 && s[j + 1] >= s[j] * 1.03 && s[j + 2] >= s[j + 1] * 1.03 && s[j + 2] >= s[j] * 1.15) { rising = true; break; }
    }
    let flat = false;
    if (s.length >= 3) { const t3 = s.slice(-3); const lo = Math.min(...t3), hi = Math.max(...t3); flat = hi / lo < 1.06; }
    const q = (j) => (s.length > j + 1 ? Math.log(s[j + 1] / s[j]) : 0);
    return { n: s.length, rising, flat, ratio: s.length >= 2 ? s[s.length - 1] / s[0] : 1, s0: s.length ? s[0] : 0.03, q0: q(0), q1: q(1), q2: q(2) };
  }

  _level(k) { return k === 'snare' ? this.snareE.L : this.e[k].L; }
  // a kick's attack shows most clearly around 100-200 Hz even over a sustained sub bass
  _rise(k) { return k === 'snare' ? this.snareE.rise() : k === 'kick' ? Math.max(this.e.kick.rise(7), this.e.lo2.rise(5) - 2) : this.e[k].rise(); }

  _hop(out) {
    const dtHop = this.hop / this.sr;
    this.time += dtHop;
    const t = this.time, E = this.e;
    for (const env of this.envs) env.hop();
    for (const k of NAMES) {
      const B = this.b[k], cfg = B.cfg;
      const L = this._level(k);
      // rises out of near-silence count only up to 30 dB, so one hit after a pause can't set the bar too high
      const floor = Math.max(L - this._rise(k), B.peakLevel - 45);
      const rise = Math.min(30, Math.max(0, L - floor));
      B.peakLevel = L > B.peakLevel ? L : B.peakLevel - dtHop * 4;        // falls 4 dB per second
      if (B.ref !== null) B.ref -= dtHop * (B.ref > B.refTop - 6 ? 2.5 : 0.5);   // the hit level eases down, slowly once well below the last big hit
      // the threshold follows the size of recent rises: 45% of the 80th percentile of the last 3 s of rise peaks
      if (B.r1 > B.r2 && B.r1 >= rise && B.r1 > cfg.minRise * 0.5) { B.peaks.push([t, B.r1]); }
      while (B.peaks.length && t - B.peaks[0][0] > 3) B.peaks.shift();
      B.r2 = B.r1; B.r1 = rise;
      if (B.peaks.length >= 3) { const v = B.peaks.map((q) => q[1]).sort((a, b) => a - b); B.peakRise = v[Math.floor(v.length * 0.8)]; }
      else B.peakRise = Math.max(cfg.minRise * 1.5, B.peakRise - dtHop * 3);
      const thr = (k === 'kick' ? Math.max(4, B.peakRise * 0.3) : Math.max(cfg.minRise, B.peakRise * 0.45) / this.sens);

      // confirm a pending candidate once its delay has passed
      const P = B.pending;
      if (P) { P.peak = Math.max(P.peak, L); P.m2pk = Math.max(P.m2pk, E.m2.L); P.m3pk = Math.max(P.m3pk, E.m3.L); P.m1pk = Math.max(P.m1pk, E.m1.L); P.lowpk = Math.max(P.lowpk, E.kick.L, E.upb.L); P.hatpk = Math.max(P.hatpk, E.hat.L); }
      let decide = P && ++P.age >= cfg.delay;
      let ok = false;
      if (P && k === 'kick') {
        // a kick is judged on a handful of features once its first ~24 ms are in (see _kickFeatures)
        decide = P.age >= KICK_AGE;
        if (decide) {
          const f = this._kickFeatures(P);
          P.f = f;
          if (this.collect) { this.collect(P.t, f); ok = this.oracle(P.t); }
          else ok = this._kickProb(f) > KICK_THR - (this.sens - 1) * 0.12;
        }
      } else if (P && k === 'snare') {
        // a snare is judged by a second small network once its first ~20 ms are in (see _snareFeatures)
        decide = P.age >= SNARE_AGE;
        if (decide) {
          const f = this._snareFeatures(P);
          if (this.collectSnare) { this.collectSnare(P.t, f); ok = this.oracleSnare(P.t); }
          else ok = SNARE_NET ? this._prob(SNARE_NET, f) > SNARE_THR - (this.sens - 1) * 0.12 : this._confirm(k, P);
        }
      } else if (decide) ok = this._confirm(k, P);
      if (decide) {
        B.pending = null;
        if (this.debug) this.debug(k, P, ok, this);
        if (ok) {
          B.last = P.t;
          B.ref = B.ref === null ? P.peak : Math.max(P.peak, B.ref);           // level of this band's loudest recent hits
          if (P.peak >= B.ref - 0.01) B.refTop = B.ref;
          if (k === 'kick') this._learnPulse(P.t, P.peak - (B.ref ?? P.peak));
          const s = 0.35 + 0.5 * Math.min(1, (P.rise - P.thr) / Math.max(3, B.peakRise - P.thr)) + 0.15 * Math.min(1, Math.max(0, (P.L - B.peakLevel + 9) / 9));
          out.push({ band: k, strength: Math.min(1, s), t: P.t });
        }
      }
      if (!B.armed && rise < thr * 0.5) B.armed = true;
      const loud = L > B.peakLevel - cfg.gate && L > -72;
      if (!B.pending && B.armed && loud && rise > thr && t - B.last > cfg.gap) {
        B.armed = false;
        B.pending = { t, L, rise, thr, age: 0, peak: L, m2pk: E.m2.L, m3pk: E.m3.L, m1pk: E.m1.L, kickNear: !!this.b.kick.pending || t - this.b.kick.last < 0.03, m10: E.m1.L, m20: E.m2.L, m30: E.m3.L, sn: E.sn.rise(), up0: E.upb.L, sub00: E.sub.L, lowpk: Math.max(E.kick.L, E.upb.L), hatpk: E.hat.L, sub0: E.sub.L, lo20: E.lo2.L, kr: E.kick.rise(7), lr: E.lo2.rise(5), m1: E.m1.rise(), m2: E.m2.rise(), m3: E.m3.rise(), hat: E.hat.rise(), sub: E.sub.rise(), upb: E.upb.rise() };
      }
    }
  }

  // ---- the kick pulse: the period between strong kicks, learned as the music plays
  _learnPulse(t, margin) {
    if (margin < -0.5) return;                      // learn from the clear hits only
    const K = this.pulse || (this.pulse = { last: -9, iv: [], period: 0 });
    const d = t - K.last; K.last = t;
    if (d < 0.25 || d > 2.2) return;
    let p = d; while (p > 1.0) p /= 2;              // fold half-time into the 0.25-1 s range
    K.iv.push(p); if (K.iv.length > 9) K.iv.shift();
    const v = [...K.iv].sort((a, b) => a - b); K.period = v[v.length >> 1];
  }
  _onPulse(t) {
    const K = this.pulse;
    if (!K || !K.period || K.iv.length < 3 || t - K.last > 4) return true;   // no pulse yet: don't hold anything back
    const ph = ((t - K.last) / K.period) % 1;
    return Math.min(ph, 1 - ph) * K.period < 0.045;
  }

  // Everything the kick classifier looks at, scaled to roughly -1..1.
  _kickFeatures(P) {
    const E = this.e, B = this.b.kick, sw = this._sweep(P.t);
    const ref = B.ref === null ? P.peak : B.ref;
    const K = this.pulse;
    const pulseKnown = K && K.period && K.iv.length >= 3 && P.t - K.last < 4 ? 1 : 0;
    const onPulse = pulseKnown && this._onPulse(P.t) ? 1 : 0;
    const c = (v) => Math.max(-3, Math.min(3, v));
    return [
      P.rise / 30, P.kr / 20, P.lr / 20,
      c((P.peak - ref) / 10),
      P.m1 / 20, P.m2 / 20, P.m3 / 20, P.hat / 20,
      P.sub / 20, P.upb / 20,
      c((E.sub.L - E.upb.L) / 20), c((E.sub.L - E.lo2.L) / 20),
      c((E.sub.L - P.sub0) / 10), c((E.lo2.L - P.lo20) / 10),
      sw.rising ? 1 : 0, sw.flat ? 1 : 0, c(Math.log(sw.ratio || 1) * 3),
      c(Math.log(sw.s0 / 0.016) * 2), c(sw.q0 * 5), c(sw.q1 * 5), c(sw.q2 * 5), Math.min(1, sw.n / 5),
      c((P.peak - E.kick.L) / 10),
      pulseKnown, onPulse,
      c((P.L - B.peakLevel) / 10)
    ];
  }
  // Everything the snare classifier looks at: is the jump broadband noise (flat across the mids and
  // highs, unlike a bass note's falling harmonics), does it last, and where does it sit in the beat.
  _snareFeatures(P) {
    const E = this.e, B = this.b.snare, c = (v) => Math.max(-3, Math.min(3, v));
    const ref = B.ref === null ? P.peak : B.ref;
    const K = this.pulse;
    const known = K && K.period && K.iv.length >= 3 && P.t - K.last < 4;
    const ph = known ? ((P.t - K.last) / K.period) % 1 : 0;
    return [
      P.rise / 30, P.sn / 20, P.m1 / 20, P.m2 / 20, P.m3 / 20, P.hat / 20, P.kr / 20, P.lr / 20, P.sub / 20, P.upb / 20,
      c((P.m3pk - P.m2pk) / 15), c((P.m2pk - P.m1pk) / 15), c((P.m1pk - P.lowpk) / 20), c((P.hatpk - P.m3pk) / 15),
      c((P.m2pk - P.lowpk) / 20),
      c((E.sn.L - P.peak) / 10), c((E.m3.L - P.m3pk) / 10), c((E.m1.L - P.m1pk) / 10),
      c((P.m1pk - P.m10) / 15), c((P.m2pk - P.m20) / 15), c((P.m3pk - P.m30) / 15),
      c((E.upb.L - P.up0) / 10), c((E.sub.L - P.sub00) / 10),
      c((P.peak - B.peakLevel) / 10), c((P.peak - ref) / 10),
      P.kickNear ? 1 : 0, known ? 1 : 0, known ? Math.cos(2 * Math.PI * ph) : 0, known ? Math.sin(2 * Math.PI * ph) : 0,
      known ? Math.cos(4 * Math.PI * ph) : 0
    ];
  }
  _prob(N, f) {
    let z = N.b2;
    for (let h = 0; h < N.b1.length; h++) {
      let a = N.b1[h]; const w = N.w1[h];
      for (let i = 0; i < f.length; i++) a += w[i] * f[i];
      z += N.w2[h] * (a > 0 ? a : 0.05 * a);
    }
    return 1 / (1 + Math.exp(-z));
  }
  // a small two-layer network: KICK_NET = { w1: [hidden][in], b1: [hidden], w2: [hidden], b2 }
  _kickProb(f) {
    const N = KICK_NET;
    let z = N.b2;
    for (let h = 0; h < N.b1.length; h++) {
      let a = N.b1[h]; const w = N.w1[h];
      for (let i = 0; i < f.length; i++) a += w[i] * f[i];
      z += N.w2[h] * (a > 0 ? a : 0.05 * a);
    }
    return 1 / (1 + Math.exp(-z));
  }

  // Kick verdict from the pitch track: true / false when it is clear, null while it is still unclear.
  _kickNow(P) {
    const sw = P.sw;
    if (!sw) return null;
    const B = this.b.kick, ref = B.ref === null ? B.peakLevel : B.ref, margin = P.peak - ref;
    if (sw.rising && margin > -14 / this.sens) return true;  // the pitch falls like a kick drum's
    if (sw.flat && sw.n >= 4) return false;                  // the pitch settled and holds: a bass note or a tone
    return null;
  }

  _confirm(k, P) {
    const E = this.e, B = this.b[k];
    if (k === 'kick') {
      const now = this._kickNow(P);
      if (now !== null) return now;
      // as loud as the kicks so far (a bass note under the kicks is quieter in the low band),
      // or a jump with a transient click on top
      const ref = B.ref === null ? B.peakLevel : B.ref;
      const margin = P.peak - ref;
      // strong hits always count; borderline ones only when they land on the kick pulse
      // timed out without a clear pitch fall: only an unmistakably loud hit with a click on top still counts,
      // and never a steady tone (a bass note holds its pitch)
      if (P.sw && P.sw.flat) return false;
      const clicked = P.m1 > 8 && P.m2 > 8;
      return (margin > 1.5 / this.sens && clicked) || (margin > -1 / this.sens && this._onPulse(P.t) && this.pulse && this.pulse.period > 0);
    }
    if (k === 'snare') {
      // broadband, prominent in the mids compared with the low end, and still there after a click would be gone
      const broad = P.m1 > 2 && P.m2 > 4 && P.m3 > 3;
      const prominent = P.m2pk > P.lowpk - 22;
      const lasting = E.m2.L > P.m2pk - 9;
      const loudAsSnares = P.peak > B.peakLevel - 6 / this.sens;   // near the loudest the mids have been lately
      const notHats = P.m3 < P.m2 + 6;              // a jump mostly in the highs is a hat over something else
      return broad && prominent && lasting && loudAsSnares && notHats;
    }
    // hat: audible over the low end and still ringing a few ms later
    // hat: the jump is in the highs, not across the mids (that is a snare or a click)
    return P.hatpk > P.lowpk - 40 && E.hat.L > P.hatpk - 9 && P.m1 < P.hat - 4;
  }
}
