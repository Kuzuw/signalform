// Recording (live takes and track renders) and live output frame pumping.

// H.264 straight from the encoder when the system has it; otherwise WebM, which the app
// converts to an H.264 MP4 after recording (see main.js).
const MIMES = [
  ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4', false],
  ['video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'mp4', false],
  ['video/mp4;codecs=avc1,mp4a.40.2', 'mp4', false],
  ['video/webm;codecs=vp9,opus', 'webm', true],
  ['video/webm;codecs=vp8,opus', 'webm', true],
  ['video/webm', 'webm', true]
];
export function pickFormat() {
  for (const [m, ext, transcode] of MIMES) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return { mime: m, ext, transcode };
  return null;
}

export class Recorder {
  constructor(stage, audio) {
    this.stage = stage; this.audio = audio;
    this.active = null;
  }

  get recording() { return !!this.active; }
  get elapsed() { return this.active ? (performance.now() - this.active.t0) / 1000 : 0; }

  async start({ source = 'stage', height = 1080, fps = 60, withAudio = true, name = 'Signalform' }) {
    if (this.active) throw new Error('Already recording.');
    const fmt = pickFormat();
    if (!fmt) throw new Error('This system cannot encode video.');
    const [W, H] = this.stage.sizeFor(source, height);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    this.stage.compose(ctx, W, H, source);
    const stream = canvas.captureStream(fps);
    if (withAudio && this.audio.recordDest) for (const t of this.audio.recordDest.stream.getAudioTracks()) stream.addTrack(t);
    const { id, finalExt } = await window.sf.rec.begin({ ext: fmt.ext, transcode: fmt.transcode });
    const bitrate = Math.round(W * H * fps * 0.12); // ~25 Mbps at 1080p60
    const mr = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 320000 });
    let chain = Promise.resolve();
    let bytes = 0;
    mr.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      bytes += e.data.size;
      chain = chain.then(async () => window.sf.rec.chunk(id, await e.data.arrayBuffer()));
    };
    const stopped = new Promise((r) => { mr.onstop = r; });
    this.stage.forceRender.add(source === 'stage' ? '*' : source);
    mr.start(1000);
    this.active = { id, mr, ctx, canvas, W, H, source, name, chain: () => chain, stopped, t0: performance.now(), fmt, bytes: () => bytes };
    return { W, H, ext: finalExt };
  }

  frame() {
    const a = this.active;
    if (a) this.stage.compose(a.ctx, a.W, a.H, a.source);
  }

  async stop({ save = true } = {}) {
    const a = this.active; if (!a) return null;
    this.active = null;
    this.stage.forceRender.delete(a.source === 'stage' ? '*' : a.source);
    if (a.mr.state !== 'inactive') a.mr.stop();
    await a.stopped;
    await new Promise((r) => setTimeout(r, 50));
    await a.chain();
    if (!save) { await window.sf.rec.abort(a.id); return null; }
    return window.sf.rec.end(a.id, a.name);
  }
}

export class Outputs {
  constructor(stage) {
    this.stage = stage;
    this.list = []; // { id, name, source, height, fps, kinds, running, active[], errors[] }
    this.backends = [];
  }

  async init(saved) {
    this.backends = await window.sf.output.backends();
    this.list = (saved || []).map((o) => ({ ...o, running: false, active: [], errors: [] }));
    if (!this.list.length) this.add();
  }

  add() {
    const n = this.list.length + 1;
    const avail = this.backends.filter((b) => b.available).map((b) => b.kind);
    this.list.push({ id: 'out' + Date.now().toString(36) + n, name: n === 1 ? 'Signalform' : `Signalform ${n}`, source: 'stage', height: 1080, fps: 60, kinds: avail.length ? avail : [], running: false, active: [], errors: [] });
  }

  remove(o) { this.stopOne(o); this.list = this.list.filter((x) => x !== o); }

  get anyRunning() { return this.list.some((o) => o.running); }

  async startOne(o) {
    const r = await window.sf.output.start({ id: o.id, name: o.name, kinds: o.kinds });
    o.active = r.active || []; o.errors = r.errors || [];
    o.running = !!r.ok;
    if (o.running) {
      const [W, H] = this.stage.sizeFor(o.source, o.height);
      o.canvas = document.createElement('canvas'); o.canvas.width = W; o.canvas.height = H;
      o.ctx = o.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      o.W = W; o.H = H; o.last = 0;
      this.stage.forceRender.add(o.source === 'stage' ? '*' : o.source);
    }
    return r;
  }

  async stopOne(o) {
    if (!o.running) return;
    o.running = false; o.active = [];
    this.stage.forceRender.delete(o.source === 'stage' ? '*' : o.source);
    await window.sf.output.stop(o.id);
  }

  async stopAll() { for (const o of this.list) await this.stopOne(o); }

  frame(now) {
    for (const o of this.list) {
      if (!o.running) continue;
      if (now - o.last < 1000 / o.fps - 2) continue;
      o.last = now;
      const [W, H] = this.stage.sizeFor(o.source, o.height);
      if (W !== o.W || H !== o.H) { o.canvas.width = o.W = W; o.canvas.height = o.H = H; }
      this.stage.compose(o.ctx, o.W, o.H, o.source);
      const img = o.ctx.getImageData(0, 0, o.W, o.H);
      window.sf.output.frame(o.id, o.W, o.H, img.data);
    }
  }

  serialize() { return this.list.map(({ id, name, source, height, fps, kinds }) => ({ id, name, source, height, fps, kinds })); }
}
