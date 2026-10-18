// The timeline's audio: songs placed on lanes (a DJ set, an album, a mix), played in step with the
// playhead and analysed like any other source, so the visuals follow the whole set.
//
// A clip:  { id, name, key, path, start, offset, len, dur, fadeIn, fadeOut, gain, row }
//   start: where it sits on the timeline (s) · offset/len: the part of the file that plays · dur: the file's length
//   fadeIn/fadeOut: seconds of equal-power fade · gain: volume (1 = as is) · row: its lane (overlap on two lanes to crossfade)
//
// Songs are decoded only around the playhead (the song playing and the next ones), and let go once
// they have played, so a long set doesn't fill the memory. Waveforms are kept as small peak lists.
import { uid } from './ui.js';

const LOOKAHEAD = 40;     // decode songs that start within this many seconds
const KEEP_BEHIND = 4;    // let go of songs that ended this many seconds ago
const PEAK_RATE = 50;     // waveform peaks per second

export function normalizeAudio(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((c) => c && typeof c === 'object' && (c.key || c.path)).map((c) => {
    const dur = Math.max(0.1, num(c.dur, num(c.len, 1)));
    const offset = clamp(num(c.offset, 0), 0, dur - 0.05);
    const len = clamp(num(c.len, dur - offset), 0.05, dur - offset);
    return {
      id: String(c.id || uid()), name: String(c.name || 'Song').slice(0, 200), key: String(c.key || c.path), path: String(c.path || ''),
      start: Math.max(0, num(c.start, 0)), offset, len, dur,
      fadeIn: clamp(num(c.fadeIn, 0), 0, len), fadeOut: clamp(num(c.fadeOut, 0), 0, len),
      gain: clamp(num(c.gain, 1), 0, 4), row: clamp(Math.round(num(c.row, 0)), 0, 7)
    };
  });
}
export const clipEnd = (c) => c.start + c.len;
export function setEnd(clips) { let e = 0; for (const c of clips) e = Math.max(e, clipEnd(c)); return e; }

/* ---------------- the files behind the clips ---------------- */
const sources = new Map();      // key → { file, path }
const missing = new Set();      // keys whose file could not be read
const peaks = new Map();        // key → { data: Float32Array, rate }
const buffers = new Map();      // key@rate → { promise, buf, last }

// A file the person picked: its path on disk (desktop app) is the key, so the scene can find it again.
export function registerFile(file) {
  let path = '';
  try { path = (window.sf.file && window.sf.file.pathFor && window.sf.file.pathFor(file)) || ''; } catch {}
  const key = path || 'mem:' + uid();
  sources.set(key, { file, path });
  missing.delete(key);
  return { key, path };
}
export function relink(clip, file) { const r = registerFile(file); clip.key = r.key; clip.path = r.path; return r; }
export const isMissing = (clip) => missing.has(clip.key);
export const peaksFor = (clip) => peaks.get(clip.key) || null;

async function bytesFor(clip) {
  const s = sources.get(clip.key);
  if (s && s.file) return s.file.arrayBuffer();
  const p = clip.path || (s && s.path);
  if (p && window.sf.file && window.sf.file.readAudio) {
    const b = await window.sf.file.readAudio(p);
    if (b) return b instanceof ArrayBuffer ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  throw new Error(`“${clip.name}” could not be found${p ? ' at ' + p : ''}.`);
}

// The clip's whole file as an AudioBuffer at `rate`, shared by every clip of the same file.
export function decode(clip, rate) {
  const k = clip.key + '@' + rate;
  let e = buffers.get(k);
  if (!e) {
    e = { buf: null, last: performance.now() };
    e.promise = (async () => {
      try {
        const data = await bytesFor(clip);
        const buf = await new OfflineAudioContext(2, 1, rate).decodeAudioData(data);
        e.buf = buf;
        if (!peaks.has(clip.key)) peaks.set(clip.key, makePeaks(buf));
        missing.delete(clip.key);
        return buf;
      } catch (err) { missing.add(clip.key); buffers.delete(k); throw err; }
    })();
    buffers.set(k, e);
  }
  e.last = performance.now();
  return e.promise;
}
// Drop one file's decoded audio (after its waveform was made) unless a clip near the playhead needs it.
export function forget(clip, rate) { buffers.delete(clip.key + '@' + rate); }
export function bufferReady(clip, rate) { const e = buffers.get(clip.key + '@' + rate); return e && e.buf; }
// Let go of decoded files no clip in `keep` needs.
export function release(keep, rate) {
  const want = new Set([...keep].map((c) => c.key + '@' + rate));
  for (const [k, e] of buffers) if (!want.has(k) && e.buf && performance.now() - e.last > 1500) buffers.delete(k);
}
// Duration and waveform of a new file (decoded once, then let go unless it is near the playhead).
export async function probe(clip, rate) {
  const buf = await decode(clip, rate);
  return { dur: buf.duration };
}
function makePeaks(buf) {
  const n = Math.max(1, Math.ceil(buf.duration * PEAK_RATE)), step = buf.length / n;
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0; const j1 = Math.min(L.length, Math.floor((i + 1) * step));
    for (let j = Math.floor(i * step); j < j1; j += 4) { const v = Math.abs(L[j]) + Math.abs(R[j]); if (v > m) m = v; }
    out[i] = Math.min(1, m * 0.5);
  }
  return { data: out, rate: PEAK_RATE };
}

/* ---------------- volume over a clip's length ---------------- */
// Fade lengths, shortened together if they would overlap.
function fades(c) {
  let fi = Math.max(0, c.fadeIn), fo = Math.max(0, c.fadeOut);
  if (fi + fo > c.len) { const k = c.len / (fi + fo); fi *= k; fo *= k; }
  return [fi, fo];
}
// Gain at timeline time t: the clip's volume times its equal-power fades.
export function gainAt(c, t) {
  const [fi, fo] = fades(c), u = t - c.start, v = clipEnd(c) - t;
  let g = c.gain;
  if (fi > 0 && u < fi) g *= Math.sin(Math.max(0, u / fi) * Math.PI / 2);
  if (fo > 0 && v < fo) g *= Math.sin(Math.max(0, v / fo) * Math.PI / 2);
  return g;
}
// Schedules the clip's volume on an AudioParam from timeline time `from` to the clip's end; `at(t)`
// turns timeline time into the audio context's time.
export function envelope(param, c, from, at) {
  const [fi, fo] = fades(c), end = clipEnd(c), fiEnd = c.start + fi, foStart = end - fo;
  const curve = (t0, t1) => {
    const n = Math.max(2, Math.min(256, Math.ceil((t1 - t0) * 30))), arr = new Float32Array(n);
    for (let i = 0; i < n; i++) arr[i] = gainAt(c, t0 + ((t1 - t0) * i) / (n - 1));
    param.setValueCurveAtTime(arr, at(t0), t1 - t0);
  };
  const inFadeIn = fi > 0.005 && from < fiEnd - 0.005, inFadeOut = fo > 0.005 && from >= foStart;
  if (!inFadeIn && !inFadeOut) param.setValueAtTime(gainAt(c, from), at(from));
  if (inFadeIn) curve(from, fiEnd);
  if (fo > 0.005 && from < end - 0.005) curve(Math.max(from, foStart, inFadeIn ? fiEnd + 0.001 : from), end);
}

/* ---------------- live playback ---------------- */
export class SetPlayer {
  constructor(audio, clips) {
    this.audio = audio; this.clips = clips;      // clips(): the timeline's list
    this.playing = false; this.pos0 = 0; this.ctx0 = 0;
    this.live = new Map();                       // clip id → { src, g }
    this.out = null;
  }
  get ctx() { return this.audio.ctx; }
  get rate() { return this.ctx ? this.ctx.sampleRate : 48000; }
  attach() {
    const ctx = this.ctx; if (!ctx) return;
    if (!this.out) this.out = ctx.createGain();
    try { this.out.connect(this.audio.input); } catch {}
  }
  detach() { this.pause(); if (this.out) try { this.out.disconnect(); } catch {} }
  now() { return this.playing ? this.pos0 + Math.max(0, this.ctx.currentTime - this.ctx0) : this.pos0; }
  at(t) { return this.ctx0 + (t - this.pos0); }
  play(t) {
    this._stopAll();
    this.pos0 = Math.max(0, t); this.ctx0 = this.ctx.currentTime + 0.04; this.playing = true;
    this.pump(true);
  }
  pause() { if (this.playing) this.pos0 = this.now(); this.playing = false; this._stopAll(); }
  seek(t) { if (this.playing) this.play(t); else this.pos0 = Math.max(0, t); }
  // A clip was moved, trimmed or removed: start over from where we are.
  resync() { if (this.playing) this.play(this.now()); }
  // Decode what plays from t, before a render starts.
  async prepare(t) { await Promise.all(this.clips().filter((c) => clipEnd(c) > t && c.start < t + 2).map((c) => decode(c, this.rate).catch(() => null))); }

  // Called every frame: starts clips that are about to play, decodes the next songs, lets go of old ones.
  pump(force) {
    const list = this.clips(); if (!this.ctx) return;
    const t = this.now(), rate = this.rate, keep = [];
    for (const c of list) {
      const s = c.start, e = clipEnd(c);
      if (e < t - KEEP_BEHIND || s > t + LOOKAHEAD) continue;
      keep.push(c);
      if (isMissing(c) && !force) continue;
      const buf = bufferReady(c, rate);
      if (!buf) { decode(c, rate).then(() => this.playing && this.pump()).catch(() => {}); continue; }
      if (this.playing && !this.live.has(c.id) && e > t + 0.05 && s < t + 1.5) this._start(c, buf);
    }
    release(keep, rate);
  }
  _start(c, buf) {
    const ctx = this.ctx, t = this.now();
    const from = Math.max(c.start, t + 0.05), dur = clipEnd(c) - from;
    if (dur <= 0.01) return;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain();
    envelope(g.gain, c, from, (x) => this.at(x));
    src.connect(g); g.connect(this.out);
    src.start(Math.max(ctx.currentTime, this.at(from)), c.offset + (from - c.start), dur);
    const rec = { src, g };
    src.onended = () => { if (this.live.get(c.id) === rec) this.live.delete(c.id); try { g.disconnect(); } catch {} };
    this.live.set(c.id, rec);
  }
  _stopAll() {
    for (const { src, g } of this.live.values()) { try { src.onended = null; src.stop(); } catch {} try { g.disconnect(); } catch {} }
    this.live.clear();
  }
}

function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
