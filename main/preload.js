'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('sf', {
  native: true,
  info: () => ipcRenderer.invoke('app:info'),
  requestMic: () => ipcRenderer.invoke('media:request-mic'),
  store: {
    get: (name) => ipcRenderer.invoke('store:get', name),
    set: (name, data) => ipcRenderer.invoke('store:set', name, data)
  },
  scene: {
    export: (scene) => ipcRenderer.invoke('scene:export', scene),
    import: () => ipcRenderer.invoke('scene:import')
  },
  file: {
    saveText: (text, name, kind, ext) => ipcRenderer.invoke('file:save-text', { text, name, kind, ext }),
    // where a picked or dropped file lives on disk, so a scene can find its songs again
    pathFor: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
    readAudio: (p) => ipcRenderer.invoke('file:read-audio', p)
  },
  rec: {
    begin: (opts) => ipcRenderer.invoke('rec:begin', opts),
    chunk: (id, buf) => ipcRenderer.invoke('rec:chunk', id, buf),
    end: (id, name) => ipcRenderer.invoke('rec:end', id, name),
    abort: (id) => ipcRenderer.invoke('rec:abort', id),
    reveal: (p) => ipcRenderer.invoke('shell:reveal', p)
  },
  // exact (offline) renders: encoded video and the audio mix stream to temp files, ffmpeg joins them
  render: {
    begin: (opts) => ipcRenderer.invoke('render:begin', opts),
    video: (id, buf) => ipcRenderer.invoke('render:video', id, buf),
    audio: (id, buf) => ipcRenderer.invoke('render:audio', id, buf),
    end: (id, name) => ipcRenderer.invoke('render:end', id, name),
    abort: (id) => ipcRenderer.invoke('render:abort', id)
  },
  output: {
    backends: () => ipcRenderer.invoke('output:backends'),
    start: (cfg) => ipcRenderer.invoke('output:start', cfg),
    stop: (id) => ipcRenderer.invoke('output:stop', id),
    frame: (id, w, h, data) => ipcRenderer.send('output:frame', id, w, h, data)
  },
  onMenu: (fn) => ipcRenderer.on('menu', (e, cmd) => fn(cmd)),
  onRecStatus: (fn) => ipcRenderer.on('rec:status', (e, msg) => fn(msg))
});
