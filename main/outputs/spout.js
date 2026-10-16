'use strict';
// Spout sender (Windows) through the optional `electron-spout` native module
// (github.com/reitowo/electron-spout). It expects BGRA pixels.
let lib = null, loadError = '';
if (process.platform === 'win32') {
  for (const id of ['electron-spout', 'electron_spout']) {
    try { lib = require(id); break; } catch (e) { loadError = e.message; }
  }
}

function rgbaToBgra(buf) {
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i]; buf[i] = buf[i + 2]; buf[i + 2] = r;
  }
  return buf;
}

module.exports = {
  label: 'Spout',
  platform: 'win32',
  available: () => !!lib,
  reason: () => process.platform !== 'win32'
    ? 'Spout is Windows only.'
    : 'The Spout module is not installed in this build. ' + (loadError ? '(' + loadError.split('\n')[0] + ')' : ''),
  async create(name) {
    const Output = lib.SpoutOutput || (lib.default && lib.default.SpoutOutput);
    if (!Output) throw new Error('electron-spout has no SpoutOutput export');
    const out = new Output(name);
    return {
      send(w, h, rgba) { out.updateFrame(rgbaToBgra(rgba), { width: w, height: h }); },
      close() { if (out.release) out.release(); else if (out.close) out.close(); }
    };
  }
};
