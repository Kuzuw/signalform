'use strict';
const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer, systemPreferences, Menu, shell, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');
const store = require('./store');
const outputs = require('./outputs');
const { wavHeader, mux } = require('./mux');

const isMac = process.platform === 'darwin';
const DEV = process.argv.includes('--dev');
let win = null;

app.setName('Signalform');
// The UI is served from app://signalform/ rather than file:// so ES modules, fetch and
// media behave exactly as on the web.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const RENDERER = path.join(__dirname, '..', 'renderer');
// The engine starts listening at launch, before any click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#08090c',
    title: 'Signalform',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://signalform/index.html');
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; outputs.stopAll(); });
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Scene', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'scene:new') },
        { label: 'Open Scene…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'scene:import') },
        { label: 'Export Scene…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('menu', 'scene:export') },
        { type: 'separator' },
        { label: 'Import Track…', accelerator: 'CmdOrCtrl+I', click: () => send('menu', 'track:import') },
        { label: 'Render to Video…', accelerator: 'CmdOrCtrl+R', click: () => send('menu', 'render:open') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Perform Mode', accelerator: 'F', registerAccelerator: false, click: () => send('menu', 'perform:toggle') },
        { label: 'Timeline', accelerator: 'CmdOrCtrl+T', click: () => send('menu', 'timeline:toggle') },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Signalform on GitHub', click: () => shell.openExternal('https://github.com/Kuzuw/signalform') }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }

function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'display-capture', 'fullscreen', 'clipboard-sanitized-write'].includes(permission));
  });
  ses.setPermissionCheckHandler((wc, permission) => ['media', 'display-capture', 'fullscreen'].includes(permission));

  // System audio: Windows WASAPI loopback of the default output device.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (!sources.length) return callback({});
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });
}

/* ---------------- IPC ---------------- */
function setupIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release()
  }));

  ipcMain.handle('media:request-mic', async () => {
    if (!isMac) return true;
    try {
      const st = systemPreferences.getMediaAccessStatus('microphone');
      if (st === 'granted') return true;
      return await systemPreferences.askForMediaAccess('microphone');
    } catch { return false; }
  });

  // JSON storage for presets, scenes, settings
  ipcMain.handle('store:get', (e, name) => store.read(name));
  ipcMain.handle('store:set', (e, name, data) => store.write(name, data));

  ipcMain.handle('scene:export', async (e, scene) => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Export Scene',
      defaultPath: (scene.name || 'scene').replace(/[^\w\- ]+/g, '') + '.sfscene',
      filters: [{ name: 'Signalform Scene', extensions: ['sfscene'] }]
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(scene, null, 2));
    return r.filePath;
  });
  // save a text file the renderer made (the EffectCraft / After Effects analysis script)
  ipcMain.handle('file:save-text', async (e, { text, name, kind, ext }) => {
    const safeExt = String(ext || 'txt').replace(/[^\w]/g, '');
    const r = await dialog.showSaveDialog(win, {
      title: 'Save ' + (kind || 'file'),
      defaultPath: String(name || 'export').replace(/[^\w\- .]+/g, '') + '.' + safeExt,
      filters: [{ name: kind || 'File', extensions: [safeExt] }]
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, String(text));
    return r.filePath;
  });
  ipcMain.handle('scene:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Open Scene',
      properties: ['openFile'],
      filters: [{ name: 'Signalform Scene', extensions: ['sfscene', 'json'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    try { return JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return { error: 'This file is not a Signalform scene.' }; }
  });

  // Recording: chunks stream to a temp file, then the user picks where to save it.
  // When the system encoder can't write H.264 directly, the take is recorded as WebM and
  // converted to an H.264/AAC MP4 with the bundled ffmpeg, so every editor can open it.
  const recs = new Map();
  ipcMain.handle('rec:begin', (e, { ext, transcode }) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const tmp = path.join(app.getPath('temp'), `signalform-${id}.${ext}`);
    const conv = !!(transcode && ffmpegPath());
    const finalExt = conv ? 'mp4' : ext;
    recs.set(id, { tmp, ext, finalExt, conv, stream: fs.createWriteStream(tmp) });
    return { id, finalExt };
  });
  ipcMain.handle('rec:chunk', (e, id, chunk) => new Promise((resolve) => {
    const r = recs.get(id);
    if (!r) return resolve(false);
    r.stream.write(Buffer.from(chunk), () => resolve(true));
  }));
  ipcMain.handle('rec:end', async (e, id, suggestedName) => {
    const r = recs.get(id);
    if (!r) return null;
    recs.delete(id);
    await new Promise((res) => r.stream.end(res));
    const out = await dialog.showSaveDialog(win, {
      title: 'Save Video',
      defaultPath: path.join(app.getPath('videos'), `${suggestedName || 'Signalform'}.${r.finalExt}`),
      filters: [{ name: r.finalExt.toUpperCase() + ' video', extensions: [r.finalExt] }]
    });
    if (out.canceled || !out.filePath) { fs.rm(r.tmp, () => {}); return null; }
    if (r.conv) {
      send('rec:status', 'Converting to MP4…');
      const ok = await transcode(r.tmp, out.filePath);
      if (ok) { fs.rm(r.tmp, () => {}); return out.filePath; }
      // conversion failed: keep the original recording next to the chosen name
      const fallback = out.filePath.replace(/\.mp4$/i, '') + '.' + r.ext;
      fs.copyFileSync(r.tmp, fallback); fs.rm(r.tmp, () => {});
      return fallback;
    }
    try { fs.renameSync(r.tmp, out.filePath); }
    catch { fs.copyFileSync(r.tmp, out.filePath); fs.rm(r.tmp, () => {}); }
    return out.filePath;
  });
  ipcMain.handle('rec:abort', (e, id) => {
    const r = recs.get(id);
    if (r) { recs.delete(id); r.stream.end(() => fs.rm(r.tmp, () => {})); }
    return true;
  });
  ipcMain.handle('shell:reveal', (e, p) => { if (p) shell.showItemInFolder(p); });

  // Songs on the timeline are saved by path; read one back (audio and video files only).
  const AUDIO_EXT = /\.(mp3|wav|wave|aif|aiff|flac|m4a|aac|ogg|oga|opus|wma|webm|mp4|m4v|mov|mkv)$/i;
  ipcMain.handle('file:read-audio', async (e, p) => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !AUDIO_EXT.test(p)) return null;
    try { const st = await fs.promises.stat(p); if (!st.isFile() || st.size > 2 * 1024 ** 3) return null; return await fs.promises.readFile(p); }
    catch { return null; }
  });

  // Exact renders: encoded video and the audio mix arrive in order and go to temp files.
  const renders = new Map();
  ipcMain.handle('render:begin', (e, { kind, fps, rate, channels, samples }) => {
    const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const base = path.join(app.getPath('temp'), `signalform-${id}`);
    const r = { kind: kind === 'ivf' ? 'ivf' : 'h264', fps: Math.max(1, Math.min(240, +fps || 60)), video: base + (kind === 'ivf' ? '.ivf' : '.h264'), audio: samples > 0 ? base + '.wav' : null };
    r.vs = fs.createWriteStream(r.video);
    if (r.audio) { r.as = fs.createWriteStream(r.audio); r.as.write(wavHeader(rate, channels, samples)); }
    renders.set(id, r);
    return { id, ffmpeg: !!ffmpegPath() };
  });
  const put = (st, buf) => new Promise((res) => st.write(Buffer.from(buf), () => res(true)));
  ipcMain.handle('render:video', (e, id, buf) => { const r = renders.get(id); return r ? put(r.vs, buf) : false; });
  ipcMain.handle('render:audio', (e, id, buf) => { const r = renders.get(id); return r && r.as ? put(r.as, buf) : false; });
  const cleanup = (r) => { for (const f of [r.video, r.audio]) if (f) fs.rm(f, () => {}); };
  ipcMain.handle('render:abort', async (e, id) => {
    const r = renders.get(id); if (!r) return true;
    renders.delete(id);
    await Promise.all([new Promise((res) => r.vs.end(res)), r.as ? new Promise((res) => r.as.end(res)) : null]);
    cleanup(r); return true;
  });
  ipcMain.handle('render:end', async (e, id, suggestedName) => {
    const r = renders.get(id); if (!r) return { error: 'This render is no longer running.' };
    renders.delete(id);
    await Promise.all([new Promise((res) => r.vs.end(res)), r.as ? new Promise((res) => r.as.end(res)) : null]);
    const ff = ffmpegPath();
    if (!ff) { cleanup(r); return { error: 'ffmpeg is missing, so the video could not be put together.' }; }
    const out = await dialog.showSaveDialog(win, {
      title: 'Save Video',
      defaultPath: path.join(app.getPath('videos'), `${suggestedName || 'Signalform'}.mp4`),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    });
    if (out.canceled || !out.filePath) { cleanup(r); return { path: null }; }
    send('rec:status', 'Putting the video together…');
    const res = await mux({ ffmpeg: ff, video: r.video, kind: r.kind, audio: r.audio, fps: r.fps, out: out.filePath });
    cleanup(r);
    return res.ok ? { path: out.filePath } : { error: 'ffmpeg could not write the video: ' + res.log.trim().split('\n').pop() };
  });

  // Live output
  ipcMain.handle('output:backends', () => outputs.backends());
  ipcMain.handle('output:start', (e, cfg) => outputs.start(cfg));
  ipcMain.handle('output:stop', (e, id) => outputs.stop(id));
  ipcMain.on('output:frame', (e, id, w, h, data) => outputs.frame(id, w, h, data));
}

function ffmpegPath() {
  try {
    const p = require('ffmpeg-static');
    const real = p && p.replace('app.asar', 'app.asar.unpacked');
    return real && fs.existsSync(real) ? real : null;
  } catch { return null; }
}

function transcode(src, dst) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const args = ['-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', dst];
    const p = spawn(ffmpegPath(), args, { windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(RENDERER, rel || 'index.html'));
    if (!file.startsWith(RENDERER)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  store.init(app.getPath('userData'));
  setupPermissions();
  setupIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  outputs.stopAll();
  if (!isMac) app.quit();
});
