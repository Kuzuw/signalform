'use strict';
// Syphon server (macOS) through the optional `node-syphon` native module.
// Install: npm install node-syphon   (the CI workflow does this on macOS runners)
let lib = null, loadError = '';
if (process.platform === 'darwin') {
  try { lib = require('node-syphon'); } catch (e) { loadError = e.message; }
}

module.exports = {
  label: 'Syphon',
  platform: 'darwin',
  available: () => !!lib,
  reason: () => process.platform !== 'darwin'
    ? 'Syphon is macOS only.'
    : 'The Syphon module is not installed in this build. ' + (loadError ? '(' + loadError.split('\n')[0] + ')' : ''),
  async create(name) {
    const Server = lib.SyphonOpenGLServer || lib.SyphonServer;
    if (!Server) throw new Error('node-syphon has no OpenGL server export');
    const server = new Server(name);
    return {
      send(w, h, rgba) {
        // Pixels arrive top-down; Syphon's GL texture origin is bottom-left, so flip.
        server.publishImageData(rgba, 'GL_TEXTURE_2D', { x: 0, y: 0, width: w, height: h }, { width: w, height: h }, true);
      },
      close() { if (server.dispose) server.dispose(); }
    };
  }
};
