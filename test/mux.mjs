// main/mux.js with a real ffmpeg: an H.264 Annex B stream (what WebCodecs gives on Windows) and an
// IVF/VP9 stream (the fallback) joined with a float WAV into an MP4.   node test/mux.mjs
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const { mux, wavHeader } = require('../main/mux.js');
let ffmpeg; try { ffmpeg = execFileSync('which', ['ffmpeg']).toString().trim(); } catch { console.log('ffmpeg not installed: skipped'); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-mux-'));
let problems = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) problems++; };
const rate = 48000, secs = 3, n = rate * secs, pcm = new Float32Array(n * 2);
for (let i = 0; i < n; i++) pcm[2 * i] = pcm[2 * i + 1] = 0.3 * Math.sin(2 * Math.PI * 440 * i / rate);
const wav = path.join(tmp, 'a.wav');
fs.writeFileSync(wav, Buffer.concat([wavHeader(rate, 2, n), Buffer.from(pcm.buffer)]));
for (const [kind, args] of [['h264', ['-c:v', 'libx264', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264']], ['ivf', ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-f', 'ivf']]]) {
  const v = path.join(tmp, 'v.' + kind), out = path.join(tmp, kind + '.mp4');
  try { execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=60:duration=${secs}`, ...args, v]); }
  catch { console.log(`(this ffmpeg cannot make a ${kind} test stream: skipped)`); continue; }
  const r = await mux({ ffmpeg, video: v, kind, audio: wav, fps: 60, out });
  check(r.ok, `${kind}: joined into an MP4` + (r.ok ? '' : ': ' + r.log));
  if (!r.ok) continue;
  const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,nb_frames,r_frame_rate:format=duration', '-of', 'json', out]).toString());
  const vs = p.streams.find((s) => s.codec_type === 'video'), as = p.streams.find((s) => s.codec_type === 'audio');
  check(vs.codec_name === 'h264' && vs.r_frame_rate === '60/1' && +vs.nb_frames === secs * 60, `${kind}: H.264 at 60 fps, every frame (${vs.nb_frames})`);
  check(as && as.codec_name === 'aac' && Math.abs(+p.format.duration - secs) < 0.1, `${kind}: AAC audio, ${(+p.format.duration).toFixed(2)} s`);
}
const silent = path.join(tmp, 'silent.mp4');
const r = await mux({ ffmpeg, video: path.join(tmp, 'v.h264'), kind: 'h264', audio: null, fps: 60, out: silent });
check(r.ok, 'a render without audio works too');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(problems ? `${problems} problem(s)` : 'problems: none');
process.exitCode = problems ? 1 : 0;
