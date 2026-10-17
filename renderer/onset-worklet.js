// Runs the onset detector on the audio thread, sample by sample, and posts each hit to the page
// with its audio-clock time. Loaded with audioWorklet.addModule().
import { OnsetCore } from './onset-core.js';

class OnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new OnsetCore(sampleRate);
    this.mono = new Float32Array(128);
    // the raw stereo signal is streamed to the page in small blocks for the oscilloscope
    this.blk = 256; this.sL = new Float32Array(this.blk); this.sR = new Float32Array(this.blk); this.sn = 0;
    this.port.onmessage = (e) => { if (e.data && typeof e.data.sens === 'number') this.core.setSensitivity(e.data.sens); };
  }
  process(inputs) {
    const ch = inputs[0];
    if (!ch || !ch.length) return true;
    const L = ch[0], R = ch[1] || ch[0], n = L.length;
    if (this.mono.length !== n) this.mono = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.mono[i] = (L[i] + R[i]) * 0.5;
      this.sL[this.sn] = L[i]; this.sR[this.sn] = R[i];
      if (++this.sn === this.blk) {
        this.port.postMessage({ scope: true, L: this.sL, R: this.sR }, [this.sL.buffer, this.sR.buffer]);
        this.sL = new Float32Array(this.blk); this.sR = new Float32Array(this.blk); this.sn = 0;
      }
    }
    const hits = this.core.process(this.mono);
    if (hits.length) {
      // core time counts from when the worklet started; send audio-clock time instead
      const lag = this.core.time - currentTime;
      this.port.postMessage(hits.map((h) => ({ band: h.band, strength: h.strength, t: h.t - lag })));
    }
    return true;
  }
}
registerProcessor('signalform-onsets', OnsetProcessor);
