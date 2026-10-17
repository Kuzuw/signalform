// Runs the onset detector on the audio thread, sample by sample, and posts each hit to the page
// with its audio-clock time. Loaded with audioWorklet.addModule().
import { OnsetCore } from './onset-core.js';

class OnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new OnsetCore(sampleRate);
    this.mono = new Float32Array(128);
    this.port.onmessage = (e) => { if (e.data && typeof e.data.sens === 'number') this.core.setSensitivity(e.data.sens); };
  }
  process(inputs) {
    const ch = inputs[0];
    if (!ch || !ch.length) return true;
    const L = ch[0], R = ch[1] || ch[0], n = L.length;
    if (this.mono.length !== n) this.mono = new Float32Array(n);
    for (let i = 0; i < n; i++) this.mono[i] = (L[i] + R[i]) * 0.5;
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
