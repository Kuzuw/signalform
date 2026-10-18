// Songs on the timeline and the exact render, in headless Chromium (browser shim instead of Electron):
// adding songs, playing them as the music, crossfading, saving, and an exact render whose video and
// audio are then joined with ffmpeg (main/mux.js) when ffmpeg is installed.
//   node test/set.mjs [screenshot dir]
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { mux } = require('../main/mux.js');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = process.argv[2] || os.tmpdir();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-set-'));

// a second song: 4 s of chords with a kick on every beat
function writeWav(file, seconds, rate = 44100) {
  const n = Math.round(seconds * rate), data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const t = i / rate, beat = t % 0.5, kick = Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-beat * 30)) * beat) * Math.exp(-beat * 9);
    const pad = 0.18 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t)) / 3;
    const v = Math.max(-1, Math.min(1, kick * 0.8 + pad));
    data.writeInt16LE(Math.round(v * 32000), i * 4); data.writeInt16LE(Math.round(v * 32000), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
const song2 = path.join(tmp, 'Second Song.wav');
writeWav(song2, 4);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/renderer/index.html`;
const browser = await pw.chromium.launch({
  executablePath: process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined),
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 }, acceptDownloads: true, bypassCSP: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
let problems = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) problems++; };
const ev = (fn, arg) => page.evaluate(fn, arg);
const TL = () => ev(() => { const t = window.signalform.timeline; return { songs: t.songs.map((c) => ({ ...c })), dur: t.duration, src: window.signalform.audio.sourceType, now: t.now(), playing: t.isPlaying }; });

await page.goto(base);
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 }).catch(() => { console.log('BOOT FAILED', errors); process.exit(1); });
await ev(() => window.signalform.loadScene({ name: 'Set test', widgets: [{ module: 'tunnel', rect: { x: 0, y: 0, w: 1, h: 1 } }, { module: 'aura', rect: { x: 0.25, y: 0.1, w: 0.5, h: 0.8 }, blend: 'add' }] }, true));
await page.waitForTimeout(500);

// add two songs
check(await page.isVisible('#tlAddAudio'), 'the timeline has an Add audio button');
await page.setInputFiles('#tlAudioFile', [path.join(root, 'test/fixture-5s.wav'), song2]);
await page.waitForFunction(() => window.signalform.timeline.songs.length === 2, null, { timeout: 20000 }).catch(() => {});
let s = await TL();
check(s.songs.length === 2, 'two songs added');
check(s.songs[1].start > 4.9 && Math.abs(s.songs[1].start - s.songs[0].len) < 0.01, `the second song starts where the first ends (${s.songs[1].start.toFixed(2)} s)`);
check(Math.abs(s.dur - 9) < 0.1, `the timeline is as long as the set (${s.dur.toFixed(2)} s)`);
check(s.src === 'timeline', 'the songs became the music ("Timeline audio")');
check((await page.$$('#timeline .tl-aclip')).length === 2, 'each song has a clip in the audio lanes');
await page.waitForTimeout(800);
check((await page.$$('#timeline .tl-aclip canvas.tl-awave')).length === 2, 'clips show their waveforms');

// play: the clock runs on the audio and the visuals hear it
await ev(() => window.signalform.timeline.seek(0));
await page.click('#tlPlay');
await page.waitForTimeout(1500);
const lv = await ev(() => window.signalform.audio.F.level);
s = await TL();
check(s.playing && s.now > 0.8 && s.now < 3, `play runs the set (${s.now.toFixed(2)} s after 1.5 s)`);
check(lv > 0.02, `the analysis hears the song (level ${lv.toFixed(3)})`);
// jump into the second song
await ev(() => window.signalform.timeline.seek(6));
await page.waitForTimeout(1200);
const lv2 = await ev(() => window.signalform.audio.F.level);
check(lv2 > 0.02, `seeking into the second song plays it (level ${lv2.toFixed(3)})`);
await page.click('#tlPlay');

// crossfade from the right-click menu
await page.click('#timeline .tl-aclip >> nth=1', { button: 'right' });
await page.locator('#tlMenu button', { hasText: 'Crossfade from the previous song' }).click();
s = await TL();
const [a, b] = s.songs;
check(b.row !== a.row && b.start < a.start + a.len - 1 && b.fadeIn > 1 && Math.abs(a.fadeOut - b.fadeIn) < 1e-6, `crossfade: overlapped on the other lane with matching fades (${b.fadeIn} s)`);
check(s.dur < 8.5, `the set got shorter by the overlap (${s.dur.toFixed(2)} s)`);
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, 'ui-set.png') });

// drag the first song later and back (snap)
const bx = await (await page.$('#timeline .tl-aclip >> nth=0')).boundingBox();
await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.mouse.down();
await page.mouse.move(bx.x + bx.width / 2 + 40, bx.y + bx.height / 2, { steps: 5 }); await page.mouse.up();
s = await TL();
check(s.songs[0].start > 0.2, `a song can be dragged along its lane (${s.songs[0].start.toFixed(2)} s)`);
await page.click('#timeline .tl-aclip >> nth=0', { button: 'right' });
await page.locator('#tlMenu button', { hasText: 'Start when the previous song ends' }).count().then(() => {});
await page.keyboard.press('Escape');
await ev(() => { const t = window.signalform.timeline; t.songs[0].start = 0; t.player.resync(); t.changed(); });

// saving keeps the songs
const saved = await ev(() => window.signalform.stage.serialize());
check(saved.timeline.audio.length === 2 && saved.timeline.audio[1].fadeIn > 0, 'the songs are saved with the scene');
await ev((sc) => window.signalform.loadScene(sc, true), saved);
await page.waitForTimeout(300);
s = await TL();
check(s.songs.length === 2, 'and come back when it is opened');

// exact render (720p30)
await ev(() => window.signalform.timeline.useSongs());
await page.click('#tlRender'); await page.waitForTimeout(200);
check(/set/i.test(await page.textContent('#dlg h3')), 'Render offers to render the set');
check(await page.isVisible('input[name="rnMode"][value="exact"]'), 'with an Exact mode');
await page.check('input[name="rnMode"][value="exact"]');
await page.selectOption('#rnHeight', '720'); await page.selectOption('#rnFps', '30');
const t0 = Date.now();
await page.click('#rnStart');
await page.waitForFunction(() => window.__lastRender || /stopped/.test(document.querySelector('#dlg .note, #dlg .err')?.textContent || ''), null, { timeout: 240000 }).catch(() => {});
const secs = (Date.now() - t0) / 1000;
const R = await ev(() => { const r = window.__lastRender; if (!r) return { err: document.querySelector('#dlg p')?.textContent }; return { opts: r.opts, videoBytes: r.videoBytes, audioBytes: r.audioBytes, video: r.video.map((b) => Array.from(new Uint8Array(b))), audio: r.audio.map((b) => Array.from(new Uint8Array(b))) }; });
if (R.err) console.log('render:', R.err);
const dur = s.dur;
check(R.videoBytes > 2000, `the exact render encoded video (${R.videoBytes} bytes, ${R.opts && R.opts.kind}, ${secs.toFixed(1)} s for ${dur.toFixed(1)} s of music)`);
const wantSamples = R.opts ? R.opts.samples : 0;
check(R.opts && R.audioBytes === wantSamples * 2 * 4 && Math.abs(wantSamples - dur * R.opts.rate) < 2, `and mixed the whole set's audio (${R.audioBytes} bytes)`);
check(await ev(() => !window.signalform.paused && window.signalform.stage.recScale == null), 'the app is back to normal after the render');

// join them with ffmpeg as the desktop app does
let ffmpeg = null; try { ffmpeg = execFileSync('which', ['ffmpeg']).toString().trim(); } catch {}
if (ffmpeg && R.opts) {
  const vf = path.join(tmp, 'v.' + (R.opts.kind === 'ivf' ? 'ivf' : 'h264')), af = path.join(tmp, 'a.wav'), out = path.join(tmp, 'out.mp4');
  fs.writeFileSync(vf, Buffer.concat(R.video.map((b) => Buffer.from(b))));
  const { wavHeader } = require('../main/mux.js');
  fs.writeFileSync(af, Buffer.concat([wavHeader(R.opts.rate, 2, R.opts.samples), ...R.audio.map((b) => Buffer.from(b))]));
  const res = await mux({ ffmpeg, video: vf, kind: R.opts.kind, audio: af, fps: R.opts.fps, out });
  check(res.ok, 'ffmpeg joins video and audio into an MP4' + (res.ok ? '' : ': ' + res.log));
  if (res.ok) {
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height,nb_frames:format=duration', '-of', 'json', out]).toString());
    const v = probe.streams.find((x) => x.codec_type === 'video'), au = probe.streams.find((x) => x.codec_type === 'audio');
    const d = +probe.format.duration;
    check(v && v.codec_name === 'h264' && v.height === 720, `the MP4 has H.264 video at 720p (${v && v.codec_name} ${v && v.width}×${v && v.height})`);
    check(au && au.codec_name === 'aac', 'and AAC audio');
    check(Math.abs(d - dur) < 0.25, `and lasts as long as the set (${d.toFixed(2)} s)`);
    check(v && Math.abs(+v.nb_frames - Math.ceil(dur * 30)) <= 1, `with every frame (${v && v.nb_frames} of ${Math.ceil(dur * 30)})`);
    fs.copyFileSync(out, path.join(outDir, 'set-render.mp4'));
  }
} else console.log('(ffmpeg not installed: the MP4 join is not checked)');

check(!errors.length, 'no errors in the page' + (errors.length ? ': ' + errors.join(' | ') : ''));
console.log(problems ? `${problems} problem(s)` : 'problems: none');
await browser.close(); server.close();
fs.rmSync(tmp, { recursive: true, force: true });
process.exitCode = problems ? 1 : 0;
