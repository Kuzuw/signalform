'use strict';
// Exact (offline) renders: the renderer encodes the video frame by frame (WebCodecs) and mixes the
// audio, both streamed to temp files; ffmpeg then joins them into one MP4. Plain Node, so it can be
// tested without Electron (test/mux.mjs).
const fs = require('fs');
const { spawn } = require('child_process');

// A WAV header for 32-bit float PCM, written before the samples (their count is known up front).
function wavHeader(rate, channels, samples) {
  const bytes = samples * channels * 4, h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(Math.min(0xffffffff, 36 + bytes), 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 4, 28); h.writeUInt16LE(channels * 4, 32); h.writeUInt16LE(32, 34);
  h.write('data', 36); h.writeUInt32LE(Math.min(0xffffffff, bytes), 40);
  return h;
}

// video: an H.264 Annex B stream (kind 'h264', copied as is) or an IVF file of VP8/VP9 (kind 'ivf',
// converted to H.264). audio: a WAV file, or null for a silent video.
function mux({ ffmpeg, video, kind, audio, fps, out }) {
  return new Promise((resolve) => {
    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    if (kind === 'h264') args.push('-fflags', '+genpts', '-framerate', String(fps), '-f', 'h264', '-i', video);
    else args.push('-i', video);
    if (audio) args.push('-i', audio);
    args.push('-map', '0:v:0');
    if (audio) args.push('-map', '1:a:0');
    if (kind === 'h264') args.push('-c:v', 'copy');
    else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p');
    if (audio) args.push('-c:a', 'aac', '-b:a', '320k');
    args.push('-r', String(fps), '-movflags', '+faststart', out);
    let log = '';
    let p;
    try { p = spawn(ffmpeg, args, { windowsHide: true }); } catch (e) { return resolve({ ok: false, log: e.message }); }
    p.stderr.on('data', (d) => { log = (log + d).slice(-4000); });
    p.on('error', (e) => resolve({ ok: false, log: e.message }));
    p.on('close', (code) => resolve({ ok: code === 0 && fs.existsSync(out), log }));
  });
}

module.exports = { wavHeader, mux };
