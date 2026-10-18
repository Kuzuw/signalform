// Exact render: instead of recording the screen in real time (where a slow frame is a dropped frame),
// the music is played through an OfflineAudioContext and every video frame is analysed, drawn and
// encoded in turn (WebCodecs), as fast as the machine allows. The video is perfectly smooth whatever
// the computer, the app stays responsive, and on most machines it finishes faster than real time.
//
// The music is processed in segments (a minute each, plus a few seconds of run-up so the beat and
// drop detection is warmed up), so an hour-long set never has to fit in memory at once. The encoded
// video and the audio mix stream to the main process, which joins them with ffmpeg (main/mux.js).
import { AudioEngine } from './audio.js';
import { decode, envelope, clipEnd, registerFile } from './audioset.js';

const SEGMENT = 60, RUNUP = 8;

export function exactRenderSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof OfflineAudioContext !== 'undefined' && !!(window.sf && window.sf.render);
}

// The songs to render: the loaded track, or the timeline's audio clips.
export function audioPlan(app) {
  const a = app.audio, tl = app.timeline;
  if (a.sourceType === 'file' && a.file && a.media && isFinite(a.media.duration)) {
    if (!a.file.__sfKey) a.file.__sfKey = registerFile(a.file).key;
    const d = a.media.duration;
    return { duration: d, name: a.trackName || 'Track', clips: [{ id: 'track', name: a.trackName, key: a.file.__sfKey, path: '', start: 0, offset: 0, len: d, dur: d, fadeIn: 0, fadeOut: 0, gain: 1, row: 0 }] };
  }
  const clips = tl.data.audio || [];
  if (clips.length) return { duration: tl.duration, name: app.stage.scene.name || 'Set', clips };
  return null;
}

// H.264 level for the frame size and rate (macroblocks per second), so hardware encoders accept it.
function avcLevel(W, H, fps) {
  const fs = Math.ceil(W / 16) * Math.ceil(H / 16), mbps = fs * fps;
  for (const [rate, size, lv] of [[245760, 8192, '28'], [522240, 8704, '2a'], [589824, 22080, '32'], [983040, 36864, '33'], [2073600, 36864, '34'], [4177920, 139264, '3c']]) if (mbps <= rate && fs <= size) return lv;
  return '3e';
}
export async function pickCodec(W, H, fps, bitrate) {
  const lv = avcLevel(W, H, fps);
  const cands = [['avc1.6400' + lv, 'h264'], ['avc1.4d00' + lv, 'h264'], ['avc1.4200' + lv, 'h264'], ['vp09.00.41.08', 'ivf'], ['vp8', 'ivf']];
  for (const [codec, kind] of cands) {
    for (const hw of ['prefer-hardware', 'no-preference']) {
      const cfg = { codec, width: W, height: H, bitrate, framerate: fps, hardwareAcceleration: hw, latencyMode: 'quality' };
      if (kind === 'h264') cfg.avc = { format: 'annexb' };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r && r.supported) return { cfg, kind, fourcc: codec.startsWith('vp09') ? 'VP90' : 'VP80' }; } catch {}
    }
  }
  return null;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function renderExact(app, opts, onProgress) {
  const plan = audioPlan(app);
  if (!plan) throw new Error('There is no music to render: load a track or add songs to the timeline.');
  const st = app.stage, tl = app.timeline, a = app.audio;
  const fps = opts.fps, D = plan.duration, N = Math.max(1, Math.ceil(D * fps - 1e-6));
  const [W, H] = st.sizeFor(opts.source, opts.height);
  const bitrate = Math.round(W * H * fps * 0.14);
  const codec = await pickCodec(W, H, fps, bitrate);
  if (!codec) throw new Error('This computer has no video encoder the exact render can use. Choose Real time instead.');
  const rate = (a.ctx && a.ctx.sampleRate) || 48000, channels = 2, total = Math.round(D * rate);
  const job = { done: false, cancelled: false };
  const { id } = await window.sf.render.begin({ kind: codec.kind, fps, rate, channels, samples: opts.audio === false ? 0 : total });

  // video: encoded chunks are gathered and sent in batches, in order
  let pending = [], pendingBytes = 0, sendChain = Promise.resolve(), encErr = null;
  const flushVideo = () => {
    if (!pending.length) return sendChain;
    const parts = pending, n = pendingBytes; pending = []; pendingBytes = 0;
    const buf = new Uint8Array(n); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    sendChain = sendChain.then(() => window.sf.render.video(id, buf.buffer));
    return sendChain;
  };
  const push = (u8) => { pending.push(u8); pendingBytes += u8.length; if (pendingBytes > 4 << 20) flushVideo(); };
  if (codec.kind === 'ivf') {
    const h = new DataView(new ArrayBuffer(32));
    [...'DKIF'].forEach((c, i) => h.setUint8(i, c.charCodeAt(0)));
    h.setUint16(4, 0, true); h.setUint16(6, 32, true);
    [...codec.fourcc].forEach((c, i) => h.setUint8(8 + i, c.charCodeAt(0)));
    h.setUint16(12, W, true); h.setUint16(14, H, true); h.setUint32(16, fps, true); h.setUint32(20, 1, true); h.setUint32(24, N, true);
    push(new Uint8Array(h.buffer));
  }
  let outFrames = 0;
  const enc = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      if (codec.kind === 'ivf') {
        const fh = new DataView(new ArrayBuffer(12));
        fh.setUint32(0, data.length, true); fh.setUint32(4, outFrames, true); fh.setUint32(8, 0, true);
        push(new Uint8Array(fh.buffer));
      }
      outFrames++;
      push(data);
    },
    error: (e) => { encErr = e; }
  });
  enc.configure(codec.cfg);

  // the picture: the same compositor as recording, at the output size
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  const state = { paused: app.paused };
  if (a.sourceType === 'file' && a.media) a.media.pause();
  if (tl.isPlaying) tl.togglePlay();
  app.paused = true;
  st.recScale = W / Math.max(1, st.sourceRect(opts.source).w * st.px.w);
  if (opts.source !== 'stage') st.forceRender.add(opts.source); else st.mirror = { canvas };
  const restore = () => {
    app.paused = state.paused; st.recScale = null; st.mirror = null; tl.renderT = null;
    if (opts.source !== 'stage') st.forceRender.delete(opts.source);
    st.fit();
  };
  const t0 = performance.now(), dt = 1 / fps;
  let frame = 0, lastYield = 0;
  job.cancel = () => { job.cancelled = true; };

  const run = async () => {
    for (let s0 = 0; s0 < D - 1e-9 && !job.cancelled; s0 += SEGMENT) {
      const s1 = Math.min(D, s0 + SEGMENT), a0 = Math.max(0, s0 - RUNUP);
      const i0 = Math.round(a0 * rate), i1 = Math.round(s1 * rate), skip = Math.round(s0 * rate) - i0, len = Math.max(128, i1 - i0);
      const off = new OfflineAudioContext(channels, len, rate);
      const eng = new AudioEngine();
      eng.sensitivity = a.sensitivity;
      eng.ensure(off);
      eng.monitor.gain.value = 1;          // the mix goes to the destination: that is the soundtrack
      await eng._onsetsReady;
      // the songs that sound in this stretch
      for (const c of plan.clips) {
        if (clipEnd(c) <= a0 || c.start >= s1) continue;
        let buf;
        try { buf = await decode(c, rate); } catch (e) { throw new Error(e.message + ' Find it with right-click on its clip, or remove it, and render again.'); }
        if (job.cancelled) return;
        const from = Math.max(c.start, a0), src = off.createBufferSource(), g = off.createGain();
        src.buffer = buf;
        envelope(g.gain, c, from, (t) => t - a0);
        src.connect(g); g.connect(eng.input);
        src.start(from - a0, c.offset + (from - c.start), clipEnd(c) - from);
      }
      // one stop per video frame (and per run-up frame, which only warms up the analysis)
      const firstRun = Math.ceil(a0 * fps - 1e-6), last = Math.min(N, Math.ceil(s1 * fps - 1e-6));
      const q = 128 / rate;
      for (let i = firstRun; i < last; i++) {
        const t = i / fps, lt = Math.max(q, t - a0);
        if (lt >= len / rate) break;
        off.suspend(lt).then(async () => {
          try {
            const F = eng.update(dt, t);
            if (t >= s0 - 1e-9 && !job.cancelled && !encErr) {
              tl.renderT = t; tl.apply(t);
              st.render(F, dt, t);
              st.compose(ctx, W, H, opts.source);
              while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
              const vf = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
              enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
              vf.close();
              frame = i + 1;
              if (i % 3 === 0) {
                const el = (performance.now() - t0) / 1000;
                onProgress({ p: frame / N, t, duration: D, speed: t / Math.max(0.001, el), eta: (el / Math.max(1, frame)) * (N - frame) });
                tl.frame();
              }
              // let the window repaint and handle clicks now and then (not every frame: that would slow the render)
              if (performance.now() - lastYield > 80) { await tick(); lastYield = performance.now(); }
            }
          } catch (e) { encErr = encErr || e; }
          off.resume();
        });
      }
      const mixed = await off.startRendering();
      if (job.cancelled) return;
      if (encErr) throw encErr;
      if (opts.audio !== false) {
        const L = mixed.getChannelData(0), R = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : L;
        const n = Math.min(i1 - i0 - skip, L.length - skip);
        for (let p = 0; p < n; p += 1 << 19) {
          const m = Math.min(1 << 19, n - p), out = new Float32Array(m * 2);
          for (let k = 0; k < m; k++) { out[2 * k] = L[skip + p + k]; out[2 * k + 1] = R[skip + p + k]; }
          await window.sf.render.audio(id, out.buffer);
        }
      }
    }
  };

  job.result = (async () => {
    try {
      await run();
      if (job.cancelled) { try { enc.close(); } catch {} await sendChain; await window.sf.render.abort(id); restore(); return null; }
      await enc.flush();
      if (encErr) throw encErr;
      enc.close();
      await flushVideo(); await sendChain;
      restore();
      onProgress({ p: 1, t: D, duration: D, speed: D / Math.max(0.001, (performance.now() - t0) / 1000), eta: 0, saving: true });
      const r = await window.sf.render.end(id, `${plan.name} · Signalform`);
      if (r && r.error) throw new Error(r.error);
      job.seconds = (performance.now() - t0) / 1000;
      return r ? r.path : null;
    } catch (e) {
      try { enc.close(); } catch {}
      await window.sf.render.abort(id).catch(() => {});
      restore();
      job.error = e;
      throw e;
    } finally { job.done = true; }
  })();
  return job;
}
