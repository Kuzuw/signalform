'use strict';
// NDI sender through the optional `grandiose` native module
// (a fork with send support, e.g. github.com/rse/grandiose). NDI Tools or the
// NDI runtime must be installed on the machine.
let lib = null, loadError = '';
for (const id of ['grandiose', '@rse/grandiose']) {
  try { lib = require(id); break; } catch (e) { loadError = e.message; }
}

module.exports = {
  label: 'NDI',
  platform: 'any',
  available: () => !!(lib && lib.send),
  reason: () => lib && !lib.send
    ? 'The installed grandiose build has no NDI send support.'
    : 'The NDI module is not installed in this build. ' + (loadError ? '(' + loadError.split('\n')[0] + ')' : ''),
  async create(name) {
    const sender = await lib.send({ name, clockVideo: false, clockAudio: false });
    let t0 = process.hrtime.bigint();
    return {
      async send(w, h, rgba) {
        const now = process.hrtime.bigint();
        const dt = Number(now - t0) / 1e9; t0 = now;
        const fps = dt > 0 ? Math.min(60, Math.max(15, Math.round(1 / dt))) : 30;
        await sender.video({
          type: 'video',
          xres: w,
          yres: h,
          frameRateN: fps * 1000,
          frameRateD: 1000,
          pictureAspectRatio: w / h,
          frameFormatType: lib.FORMAT_TYPE_PROGRESSIVE,
          fourCC: lib.FOURCC_RGBA,
          lineStrideBytes: w * 4,
          data: rgba
        });
      },
      async close() { if (sender.destroy) await sender.destroy(); }
    };
  }
};
