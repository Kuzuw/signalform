// Audio engine: sources (input devices, system audio, track files, built-in demo beat)
// and the per-frame analysis every visual module reads.

const FFT = 4096;
const WAVE = 2048;
const LOG_BANDS = 64;

function clamp(v, a = 0, b = 1) { return v < a ? a : v > b ? b : v; }
function ema(prev, v, dt, tau) { return prev + (v - prev) * (1 - Math.exp(-dt / tau)); }

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sourceType = 'none';
    this.sourceLabel = 'No source';
    this.stream = null;
    this.srcNode = null;
    this.media = null;
    this.mediaNode = null;
    this.trackName = '';
    this.demo = null;
    this.monitorVolume = 0.85;
    this.sensitivity = 1;
    this.listeners = new Set();
    this.F = makeFrame();
    this._hist = { kick: [], snare: [], hat: [] };
    this._last = { kick: 0, snare: 0, hat: 0 };
    this._prevSpec = new Float32Array(FFT / 2);
    this._peaks = {};
    this._buildMem = 0;
    this._lastDrop = -10;
    this._onsetRate = 0;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  ensure() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers'; // mono sources fill both sides
    this.split = ctx.createChannelSplitter(2);
    this.anL = ctx.createAnalyser(); this.anR = ctx.createAnalyser();
    for (const a of [this.anL, this.anR]) { a.fftSize = WAVE; a.smoothingTimeConstant = 0; }
    this.anMix = ctx.createAnalyser();
    this.anMix.fftSize = FFT; this.anMix.smoothingTimeConstant = 0.45;
    this.anMix.minDecibels = -95; this.anMix.maxDecibels = -15;
    this.input.connect(this.split);
    this.split.connect(this.anL, 0);
    this.split.connect(this.anR, 1);
    this.input.connect(this.anMix);
    this.monitor = ctx.createGain(); this.monitor.gain.value = 0;
    this.input.connect(this.monitor); this.monitor.connect(ctx.destination);
    this.recordDest = ctx.createMediaStreamDestination();
    this.input.connect(this.recordDest);
    this._specDb = new Float32Array(FFT / 2);
    this.F.sampleRate = ctx.sampleRate;
    this._startOnsets(ctx);
  }

  // Hits are found on the audio thread (renderer/onset-worklet.js), sample-accurate and independent
  // of the frame rate. Until it is running (or if it can't run) the per-frame detector below is used.
  async _startOnsets(ctx) {
    this._hits = [];
    try {
      await ctx.audioWorklet.addModule(new URL('./onset-worklet.js', import.meta.url));
      const node = new AudioWorkletNode(ctx, 'signalform-onsets', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit' });
      node.port.onmessage = (e) => {
        const d = e.data;
        if (d && d.scope) { this._scopeIn(d.L, d.R); return; }
        for (const h of d) this._hits.push(h);
        if (this._hits.length > 64) this._hits.splice(0, this._hits.length - 64);
      };
      const sink = ctx.createGain(); sink.gain.value = 0;
      this.input.connect(node); node.connect(sink); sink.connect(ctx.destination);
      this._onsetNode = node;
      node.port.postMessage({ sens: this.sensitivity });
    } catch (e) {
      console.warn('onset worklet unavailable, using the per-frame detector', e);
      this._onsetNode = null;
    }
  }
  // Every sample of the signal, kept in a ring for the oscilloscope (F.scope).
  _scopeIn(L, R) {
    const S = this.F.scope, m = S.mask, n = L.length;
    let w = S.pos & m;
    for (let i = 0; i < n; i++) { S.L[w] = L[i]; S.R[w] = R[i]; w = (w + 1) & m; }
    S.pos += n; S.live = true; this._scopeT = performance.now();
  }
  setSensitivity(v) { this.sensitivity = v; if (this._onsetNode) this._onsetNode.port.postMessage({ sens: v }); }

  async resume() { this.ensure(); if (this.ctx.state !== 'running') await this.ctx.resume(); }

  async listInputs() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
    } catch { return []; }
  }

  _teardown() {
    if (this.demo) { this.demo.stop(); this.demo = null; }
    if (this.srcNode) { try { this.srcNode.disconnect(); } catch {} this.srcNode = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.media) { this.media.pause(); }
  }

  setMonitor(on) {
    if (!this.ctx) return;
    this.monitor.gain.setTargetAtTime(on ? this.monitorVolume : 0, this.ctx.currentTime, 0.03);
  }

  async useDevice(deviceId, label) {
    await this.resume();
    if (window.sf && window.sf.requestMic) await window.sf.requestMic();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: { ideal: 2 }
      }
    });
    this._teardown();
    this.stream = stream;
    this.srcNode = this.ctx.createMediaStreamSource(stream);
    this.srcNode.connect(this.input);
    this.setMonitor(false);
    this.sourceType = 'device';
    this.sourceLabel = label || stream.getAudioTracks()[0]?.label || 'Input';
    this.emit();
  }

  async useSystem() {
    await this.resume();
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!stream.getAudioTracks().length) {
      throw new Error('No system audio was shared. Pick a virtual cable (such as VB-Cable) as the input instead.');
    }
    this._teardown();
    this.stream = stream;
    this.srcNode = this.ctx.createMediaStreamSource(stream);
    this.srcNode.connect(this.input);
    this.setMonitor(false);
    this.sourceType = 'system';
    this.sourceLabel = 'System audio';
    this.emit();
  }

  async useFile(file) {
    await this.resume();
    this._teardown();
    if (!this.media) {
      this.media = new Audio();
      this.media.preload = 'auto';
      this.mediaNode = this.ctx.createMediaElementSource(this.media);
      this.media.addEventListener('ended', () => this.emit());
      this.media.addEventListener('play', () => this.emit());
      this.media.addEventListener('pause', () => this.emit());
      this.media.addEventListener('loadedmetadata', () => this.emit());
    }
    if (this.media.src) URL.revokeObjectURL(this.media.src);
    this.media.src = URL.createObjectURL(file);
    this.mediaNode.connect(this.input);
    this.srcNode = this.mediaNode;
    this.trackName = file.name.replace(/\.[^.]+$/, '');
    this.setMonitor(true);
    this.sourceType = 'file';
    this.sourceLabel = file.name;
    await this.media.play().catch(() => {});
    this.emit();
  }

  async useDemo() {
    await this.resume();
    this._teardown();
    this.demo = new DemoBeat(this.ctx, this.input);
    this.demo.start();
    this.setMonitor(true);
    this.sourceType = 'demo';
    this.sourceLabel = 'Demo beat · 124 BPM';
    this.trackName = 'Demo beat';
    this.emit();
  }

  stopSource() {
    this._teardown();
    this.sourceType = 'none';
    this.sourceLabel = 'No source';
    this.emit();
  }

  get playing() {
    if (this.sourceType === 'file') return this.media && !this.media.paused;
    if (this.sourceType === 'demo') return !!(this.demo && this.demo.running);
    return this.sourceType === 'device' || this.sourceType === 'system';
  }

  togglePlay() {
    if (this.sourceType === 'file' && this.media) { this.media.paused ? this.media.play() : this.media.pause(); }
    else if (this.sourceType === 'demo' && this.demo) { this.demo.running ? this.demo.stop() : this.demo.start(); this.emit(); }
  }

  /* ---------------- analysis ---------------- */
  update(dt, time) {
    const F = this.F;
    F.dt = dt; F.time = time;
    if (F.scope.live && performance.now() - (this._scopeT || 0) > 400) F.scope.live = false;   // the stream stopped
    if (!this.ctx) { this._idle(time); return F; }
    this.anL.getFloatTimeDomainData(F.waveL);
    this.anR.getFloatTimeDomainData(F.waveR);
    this.anMix.getFloatFrequencyData(this._specDb);
    const n = F.spectrum.length, mn = this.anMix.minDecibels, rg = this.anMix.maxDecibels - mn;
    let flux = { kick: 0, snare: 0, hat: 0 };
    const hz = this.ctx.sampleRate / FFT;
    for (let i = 0; i < n; i++) {
      const v = clamp((this._specDb[i] - mn) / rg);
      const d = v - this._prevSpec[i];
      if (d > 0) {
        const f = i * hz;
        if (f >= 35 && f < 160) flux.kick += d;
        else if (f >= 160 && f < 4000) flux.snare += d;
        else if (f >= 6000 && f < 16000) flux.hat += d;
      }
      this._prevSpec[i] = v;
      F.spectrum[i] = v;
    }
    let sum = 0, peak = 0;
    for (let i = 0; i < WAVE; i++) {
      const m = (F.waveL[i] + F.waveR[i]) * 0.5;
      F.wave[i] = m; sum += m * m;
      const a = Math.abs(m); if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / WAVE);
    F.active = rms > 0.0015;
    F.peak = peak;

    const band = (lo, hi) => {
      const a = Math.max(1, Math.floor(lo / hz)), b = Math.max(a + 1, Math.floor(hi / hz));
      let s = 0; for (let i = a; i < b; i++) s += F.spectrum[i];
      return s / (b - a);
    };
    const raw = {
      sub: band(20, 60), bass: band(60, 160), lowMid: band(160, 400),
      mid: band(400, 2000), highMid: band(2000, 6000), high: band(6000, 16000), level: rms * 3
    };
    const sens = this.sensitivity;
    for (const k in raw) {
      // Gentle auto gain so quiet inputs still move the visuals.
      const p = this._peaks[k] = Math.max(raw[k], (this._peaks[k] || 0.25) * Math.exp(-dt / 6));
      const norm = clamp((raw[k] / Math.max(p, 0.12)) * sens * 0.95);
      F[k] = ema(F[k], norm, dt, raw[k] > F[k] ? 0.03 : 0.12);
    }

    // log-spaced bands, 30 Hz .. 16 kHz
    for (let i = 0; i < LOG_BANDS; i++) {
      const lo = 30 * Math.pow(16000 / 30, i / LOG_BANDS), hi = 30 * Math.pow(16000 / 30, (i + 1) / LOG_BANDS);
      const v = clamp(band(lo, Math.max(hi, lo + hz)) * sens * 1.15);
      F.bands[i] = v > F.bands[i] ? v : F.bands[i] * Math.exp(-dt / 0.18);
    }

    // centroid + dominant pitch (for melody-following modules)
    let cs = 0, cw = 0, best = 0, bestI = 0;
    const lim = Math.floor(5000 / hz);
    for (let i = 2; i < lim; i++) {
      const v = F.spectrum[i]; cs += v * i; cw += v;
      if (i * hz > 90 && v > best) { best = v; bestI = i; }
    }
    F.centroid = ema(F.centroid, cw > 0 ? clamp((cs / cw) * hz / 4000) : 0, dt, 0.15);
    F.pitch = bestI * hz;

    // onsets
    F.onsets.length = 0;
    if (this._onsetNode) {
      // hits from the audio thread since the last frame (anything older than half a second is stale)
      const now = this.ctx.currentTime;
      const got = { kick: 0, snare: 0, hat: 0 };
      for (const h of this._hits) if (now - h.t < 0.5) { F.onsets.push({ band: h.band, strength: h.strength }); got[h.band] = Math.max(got[h.band], h.strength); }
      this._hits.length = 0;
      for (const k of ['kick', 'snare', 'hat']) F[k] = got[k] ? Math.max(F[k], got[k]) : F[k] * Math.exp(-dt / (k === 'hat' ? 0.07 : 0.16));
    } else {
      this._onset('kick', flux.kick * 6 / Math.max(1, 160 / hz), time, 0.11, dt);
      this._onset('snare', flux.snare * 2.5 / Math.max(1, (4000 - 160) / hz) * 10, time, 0.1, dt);
      this._onset('hat', flux.hat * 2 / Math.max(1, 10000 / hz) * 14, time, 0.05, dt);
    }
    F.beat = F.kick;
    F.hit = Math.max(F.hit * Math.exp(-dt / 0.12), F.onsets.reduce((m, o) => Math.max(m, o.band === 'hat' ? o.strength * 0.4 : o.strength), 0));

    // build / drop: highs and onset density rising while the low end thins, then a heavy return
    this._bassMed = ema(this._bassMed ?? raw.bass, raw.bass, dt, 0.6);
    this._bassLong = ema(this._bassLong ?? raw.bass, raw.bass, dt, 8);
    this._highMed = ema(this._highMed ?? raw.highMid, raw.highMid + raw.high, dt, 0.8);
    this._highLong = ema(this._highLong ?? raw.highMid, raw.highMid + raw.high, dt, 8);
    this._onsetRate = ema(this._onsetRate, F.onsets.filter((o) => o.band !== 'hat').length / Math.max(dt, 1e-3), dt, 2);
    const thin = clamp(1 - this._bassMed / Math.max(this._bassLong, 0.02));
    const rise = clamp((this._highMed / Math.max(this._highLong, 0.02) - 0.9) * 2.5);
    const dense = clamp(this._onsetRate / 8);
    const target = F.active ? clamp(thin * 0.55 + rise * 0.3 + dense * 0.35 * thin) : 0;
    F.build = ema(F.build, target, dt, target > F.build ? 1.5 : 0.35);
    this._buildMem = Math.max(F.build, this._buildMem * Math.exp(-dt / 6));
    const slam = this._bassMed > this._bassLong * 1.25 && raw.bass > 0.35;
    if (this._buildMem > 0.35 && slam && F.onsets.some((o) => o.band === 'kick') && time - this._lastDrop > 4) {
      F.drop = 1; this._lastDrop = time; this._buildMem = 0; F.build = 0;
    } else F.drop *= Math.exp(-dt / 0.6);
    return F;
  }

  _onset(name, v, time, gap, dt) {
    const h = this._hist[name];
    h.push(v); if (h.length > 45) h.shift();
    let m = 0; for (const x of h) m += x; m /= h.length;
    let sd = 0; for (const x of h) sd += (x - m) * (x - m); sd = Math.sqrt(sd / h.length);
    const thr = m + sd * 1.6 + 0.012;
    const F = this.F;
    if (v > thr && time - this._last[name] > gap && h.length > 8) {
      this._last[name] = time;
      const s = clamp((v - m) / (sd * 4 + 0.03));
      F[name] = Math.max(F[name], 0.35 + 0.65 * s);
      F.onsets.push({ band: name, strength: 0.35 + 0.65 * s });
    } else {
      F[name] *= Math.exp(-dt / (name === 'hat' ? 0.07 : 0.16));
    }
  }

  // Without any source the modules still get a gentle, believable signal.
  _idle(t) {
    const F = this.F;
    const env = 0.35 + 0.15 * Math.sin(t * 0.6);
    for (let i = 0; i < WAVE; i++) {
      const v = env * (0.55 * Math.sin(i * 0.031 + t * 2.1) + 0.25 * Math.sin(i * 0.087 - t * 1.3) + 0.1 * Math.sin(i * 0.23 + t * 3.3));
      F.waveL[i] = v; F.waveR[i] = env * (0.55 * Math.cos(i * 0.031 + t * 2.1) + 0.2 * Math.sin(i * 0.071 + t));
      F.wave[i] = (F.waveL[i] + F.waveR[i]) * 0.5;
    }
    for (let i = 0; i < F.spectrum.length; i++) F.spectrum[i] = clamp(0.5 * Math.exp(-i / 90) * (0.7 + 0.3 * Math.sin(t * 1.7 + i * 0.03)));
    for (let i = 0; i < LOG_BANDS; i++) F.bands[i] = clamp(0.45 - i / LOG_BANDS * 0.3 + 0.12 * Math.sin(t * 1.4 + i * 0.4));
    const ph = (t * 1.2) % 1;
    F.kick = Math.exp(-ph * 6) * 0.5; F.beat = F.kick; F.snare = 0; F.hat = 0;
    F.sub = 0.3; F.bass = 0.3 + F.kick * 0.4; F.lowMid = 0.3; F.mid = 0.3 + 0.1 * Math.sin(t); F.highMid = 0.2; F.high = 0.15; F.level = 0.3;
    F.hit = F.kick; F.build = 0; F.drop = 0; F.centroid = 0.35; F.pitch = 220; F.active = false; F.peak = 0.5;
    F.onsets.length = 0;
  }
}

function makeFrame() {
  return {
    scope: { L: new Float32Array(1 << 15), R: new Float32Array(1 << 15), mask: (1 << 15) - 1, pos: 0, live: false },
    dt: 0.016, time: 0, sampleRate: 48000, active: false, peak: 0,
    waveL: new Float32Array(WAVE), waveR: new Float32Array(WAVE), wave: new Float32Array(WAVE),
    spectrum: new Float32Array(FFT / 2), bands: new Float32Array(LOG_BANDS),
    sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, high: 0, level: 0,
    kick: 0, snare: 0, hat: 0, beat: 0, hit: 0, onsets: [],
    build: 0, drop: 0, centroid: 0, pitch: 0
  };
}

/* ---------------- built-in demo beat: 32-bar arrangement with builds and drops ---------------- */
class DemoBeat {
  constructor(ctx, out) {
    this.ctx = ctx; this.out = ctx.createGain(); this.out.gain.value = 0.7; this.out.connect(out);
    // a little stereo room: short, different delays on each side so the mix is wide, not mono
    for (const [time, pan, fb] of [[0.013, -1, 0.25], [0.021, 1, 0.28]]) {
      const d = ctx.createDelay(0.1), g = ctx.createGain(), fbg = ctx.createGain(), pn = ctx.createStereoPanner();
      d.delayTime.value = time; g.gain.value = 0.42; fbg.gain.value = fb; pn.pan.value = pan;
      this.out.connect(d); d.connect(fbg); fbg.connect(d); d.connect(g); g.connect(pn); pn.connect(out);
    }
    this.running = false; this.step = 0; this.bpm = 124;
    const b = this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.next = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.tick(), 25);
  }
  stop() { this.running = false; clearInterval(this.timer); }
  tick() {
    const S = 60 / this.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.12) { this.play(this.step, this.next); this.next += S; this.step = (this.step + 1) % 512; }
  }
  section(bar) {
    if (bar < 8) return 'groove';
    if (bar < 12) return 'build';
    if (bar < 20) return 'drop';
    if (bar < 24) return 'break';
    if (bar < 28) return 'build';
    return 'drop';
  }
  play(s, t) {
    const bar = s >> 4, i = s & 15, sec = this.section(bar), chord = (bar >> 1) & 3;
    const roots = [55, 43.65, 65.41, 49];
    const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
    const S = 60 / this.bpm / 4;
    const full = sec === 'drop', groove = sec === 'groove';
    if ((full || groove) && i % 4 === 0) this.kick(t, full ? 1 : 0.85);
    if ((full || groove) && (i === 4 || i === 12)) this.hit(t, 'bandpass', 1700, 0.17, 0.5);
    if ((full || groove) && i % 2 === 1) this.hit(t, 'highpass', 7500, 0.04, full ? 0.22 : 0.15, i % 4 === 1 ? -0.6 : 0.6);
    if (full && i === 14) this.hit(t, 'highpass', 6000, 0.18, 0.16);
    if ((full || groove) && [0, 3, 6, 10, 13].includes(i)) this.tone(t, 'sawtooth', roots[chord] * (i === 6 ? 2 : 1), 0.2, full ? 0.45 : 0.32, full ? 520 : 380);
    if (i === 0 && bar % 2 === 0) chords[chord].forEach((f, k) => this.tone(t, 'triangle', f, S * 32, sec === 'break' ? 0.1 : 0.06, 1500, (k - 1) * 0.5));
    if (sec !== 'break' && i % 2 === 0) this.tone(t, 'square', [440, 523.25, 587.33, 659.25, 783.99, 880][([0, 2, 4, 2, 5, 3, 4, 1][(i >> 1)] + (bar % 2)) % 6], 0.12, 0.07, sec === 'build' ? 1200 + 3000 * ((bar % 4) / 4 + i / 64) : 3200, i % 4 === 0 ? -0.4 : 0.4);
    if (sec === 'build') {
      const prog = ((bar - (bar < 12 ? 8 : 24)) * 16 + i) / 64; // 0..1 over 4 bars
      const every = prog < 0.25 ? 4 : prog < 0.5 ? 2 : 1;
      if (i % every === 0) this.hit(t, 'bandpass', 1800 + prog * 1800, 0.12, 0.25 + prog * 0.35);
      if (i === 0) this.riser(t, S * 16, prog);
    }
  }
  kick(t, amp) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.42);
  }
  hit(t, type, f, dur, peak, pan = 0) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const bq = this.ctx.createBiquadFilter(); bq.type = type; bq.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bq); bq.connect(g);
    if (pan) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.out); } else g.connect(this.out);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  riser(t, dur, prog) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const bq = this.ctx.createBiquadFilter(); bq.type = 'bandpass'; bq.Q.value = 3;
    bq.frequency.setValueAtTime(800 + prog * 4000, t); bq.frequency.exponentialRampToValueAtTime(1400 + (prog + 0.25) * 6000, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.02 + prog * 0.1, t); g.gain.linearRampToValueAtTime(0.05 + prog * 0.14, t + dur);
    s.connect(bq); bq.connect(g); g.connect(this.out); s.start(t); s.stop(t + dur);
  }
  tone(t, type, f, dur, peak, cut, pan) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const bq = this.ctx.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.value = cut;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bq); bq.connect(g);
    if (pan) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.out); } else g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
  }
}
