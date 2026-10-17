import { installShim } from './shim.js';
import { AudioEngine } from './audio.js';
import { MODULES, byId, defaults } from './modules/index.js';
import { FX_DEFAULTS } from './fx.js';
import { randomize } from './inspector.js';
import { Stage } from './stage.js';
import { Inspector } from './inspector.js';
import { Recorder, Outputs } from './capture.js';
import * as lib from './library.js';
import * as D from './dialogs.js';
import { h, icon, toast, fmtTime } from './ui.js';

installShim();
const $ = (id) => document.getElementById(id);

const app = {
  settings: {},
  audio: new AudioEngine(),
  stage: null,
  inspector: null,
  recorder: null,
  outputs: null,
  devices: [],


  saveSettings: debounce(() => {
    app.settings.outputs = app.outputs ? app.outputs.serialize() : app.settings.outputs;
    window.sf.store.set('settings', app.settings);
  }, 400),

  loadScene(scene, quiet) {
    if (!scene || !Array.isArray(scene.widgets)) return toast('That scene could not be read.', true);
    app.stage.setScene(scene);
    $('aspectSel').value = app.stage.scene.aspect;
    $('sceneName').value = app.stage.scene.name;
    if (!quiet) toast(`Opened “${app.stage.scene.name}”`);
  },

  async importScene() {
    const s = await window.sf.scene.import();
    if (!s) return;
    if (s.error) return toast(s.error, true);
    app.loadScene(s);
  },

  pickTrack(thenRender = false) {
    const inp = $('trackFile');
    inp.value = '';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try { await app.audio.useFile(f); app.audio.media.loop = !!app.settings.loop; updateSource(); if (thenRender) D.renderDialog(app); }
      catch (e) { toast('This file could not be played: ' + e.message, true); }
    };
    inp.click();
  },

  async startRecording(opts) {
    try {
      const r = await app.recorder.start({ source: opts.source, height: opts.height, fps: opts.fps, withAudio: opts.audio, name: `Signalform ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}` });
      $('recBtn').classList.add('on');
      toast(`Recording ${app.stage.sourceLabel(opts.source)} at ${r.W}×${r.H}. Click Stop when you are done.`);
    } catch (e) { toast('Recording could not start: ' + e.message, true); }
  },

  async stopRecording() {
    $('recLabel').textContent = 'Saving…';
    const path = await app.recorder.stop();
    $('recBtn').classList.remove('on'); $('recLabel').textContent = 'Record';
    if (path) toast('Saved: ' + path);
  },

  async renderTrack(opts, onProgress) {
    const a = app.audio, m = a.media;
    const job = { done: false, cancelled: false };
    const wasMonitor = a.monitor.gain.value;
    const wasLoop = m.loop;
    m.pause(); m.currentTime = 0; m.loop = false;
    if (opts.mute) a.setMonitor(false);
    await app.recorder.start({ source: opts.source, height: opts.height, fps: opts.fps, withAudio: true, name: `${a.trackName || 'Track'} · Signalform` });
    $('recBtn').classList.add('on');
    let tick;
    job.result = new Promise((resolve) => {
      const finish = async (save) => {
        if (job.done) return; job.done = true;
        clearInterval(tick); m.removeEventListener('ended', onEnd);
        m.pause(); m.loop = wasLoop;
        const path = await app.recorder.stop({ save });
        $('recBtn').classList.remove('on'); $('recLabel').textContent = 'Record';
        if (opts.mute && wasMonitor > 0) a.setMonitor(true);
        resolve(path);
      };
      const onEnd = () => finish(true);
      m.addEventListener('ended', onEnd);
      job.cancel = () => { job.cancelled = true; finish(false); };
      tick = setInterval(() => onProgress(Math.min(1, m.currentTime / (m.duration || 1))), 200);
      m.play().catch((e) => { toast('Playback failed: ' + e.message, true); finish(false); });
    });
    return job;
  },

  updateLiveButton() { $('outBtn').classList.toggle('on', app.outputs.anyRunning); }
};
window.signalform = app;

/* ---------------- boot ---------------- */
(async function boot() {
  const info = await window.sf.info();
  app.version = info.version;
  if (info.platform === 'darwin') document.body.classList.add('mac');
  await lib.load();
  app.settings = (await window.sf.store.get('settings')) || {};
  app.audio.sensitivity = app.settings.gain || 1;
  $('gainIn').value = app.audio.sensitivity;
  paintRange($('gainIn'));

  app.stage = new Stage($('stage'), $('stageWrap'), {
    onSelect: () => app.inspector && app.inspector.render(),
    onChange: (structural) => { autosave(); $('emptyState').hidden = app.stage.widgets.length > 0; if (structural && app.inspector) app.inspector.render(); },
    onDropModule: (id, rect) => addModule(id, rect),
    onContext: (x, y) => openContextMenu(x, y)
  });
  setQuality(app.settings.quality || 'auto', false);
  app.inspector = new Inspector($('inspector'), app.stage, {});
  app.recorder = new Recorder(app.stage, app.audio);
  app.outputs = new Outputs(app.stage);
  await app.outputs.init(app.settings.outputs);

  const start = app.settings.autosave && app.settings.autosave.widgets ? app.settings.autosave : { ...lib.STARTERS[0].scene, name: lib.STARTERS[0].name };
  app.loadScene(start, true);

  renderModuleList();
  wireTopbar();
  wireSource();
  wireKeys();
  window.sf.onMenu(onMenu);
  window.sf.onRecStatus((msg) => { $('recLabel').textContent = msg; toast(msg); });

  app.devices = await app.audio.listInputs();
  const last = app.settings.lastSource || 'demo';
  try {
    if (last.startsWith('device:')) { const d = app.devices.find((x) => 'device:' + x.id === last); if (d) await app.audio.useDevice(d.id, d.label); else await app.audio.useDemo(); }
    else if (last === 'system') await app.audio.useSystem();
    else await app.audio.useDemo();
  } catch { await app.audio.useDemo().catch(() => {}); }
  updateSource();
  requestAnimationFrame(loop);
  window.__ready = true;
  fillThumbs();
})();

function addModule(id, rect) {
  const m = MODULES.find((x) => x.id === id);
  app.stage.add(id, rect ? { rect } : {});
  toast(`${m.name} added`);
}

/* ---------------- frame loop ---------------- */
let lastT = performance.now(), t0 = lastT, meterTick = 0, fpsT = lastT, fpsFrames = 0;
function loop(now) {
  if (app.paused) { lastT = now; return requestAnimationFrame(loop); } // frame-by-frame capture (scripts/readme-assets)
  const dt = Math.min(0.1, Math.max(0.001, (now - lastT) / 1000)); lastT = now;
  const t = (now - t0) / 1000;
  const F = app.audio.update(dt, t);
  app.stage.render(F, dt, t);
  app.recorder.frame();
  app.outputs.frame(now);
  if ((meterTick++ & 1) === 0) updateMeters(F);
  fpsFrames++;
  if (now - fpsT > 500) { updateStatus(now); fpsT = now; fpsFrames = 0; }
  requestAnimationFrame(loop);
}

let seeking = false;
function updateMeters(F) {
  $('mLow').style.setProperty('--v', Math.min(1, F.bass).toFixed(3));
  $('mMid').style.setProperty('--v', Math.min(1, F.mid).toFixed(3));
  $('mHigh').style.setProperty('--v', Math.min(1, F.high * 1.3).toFixed(3));
  $('chipBeat').classList.toggle('on', F.kick > 0.45);
  $('chipBuild').classList.toggle('on', F.build > 0.35);
  $('chipBuild').style.setProperty('--b', F.build.toFixed(2));
  $('chipDrop').classList.toggle('on', F.drop > 0.3);
  if (app.recorder.recording) $('recLabel').textContent = 'Stop · ' + fmtTime(app.recorder.elapsed);
  const m = app.audio.media;
  if (app.audio.sourceType === 'file' && m && !seeking) {
    $('trackTime').textContent = fmtTime(m.currentTime);
    $('trackDur').textContent = fmtTime(m.duration);
    $('trackSeek').value = m.duration ? Math.round((m.currentTime / m.duration) * 1000) : 0;
    paintRange($('trackSeek'));
  }
}

// status bar + live layer thumbnails, twice a second
function updateStatus(now) {
  const st = app.stage;
  const fps = Math.round(fpsFrames * 1000 / Math.max(1, now - fpsT));
  const a = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '21:9': 21 / 9 }[st.scene.aspect] || 16 / 9;
  const W = a >= 1 ? Math.round(1080 * a / 2) * 2 : 1080, H = a >= 1 ? 1080 : Math.round(1080 / a / 2) * 2;
  $('sbSize').textContent = `${st.scene.aspect} · ${W}×${H}`;
  $('sbFps').textContent = `${fps} fps`;
  $('sbFps').classList.toggle('warn', fps < 40);
  autoQuality(fps);
  $('sbWidgets').textContent = `${st.widgets.length} widget${st.widgets.length === 1 ? '' : 's'}${st.groups.length ? ` · ${st.groups.length} group${st.groups.length === 1 ? '' : 's'}` : ''}`;
  $('sbSource').textContent = app.audio.sourceLabel;
  for (const c of document.querySelectorAll('canvas[data-thumb]')) {
    const r = st.rt.get(c.dataset.thumb);
    if (r && r.size[0]) c.getContext('2d').drawImage(r.out(), 0, 0, c.width, c.height);
  }
}

/* ---------------- render quality ---------------- */
// Full / Balanced / Fast render the widgets at 100 / 75 / 50 % of their size on screen.
// Auto starts at full and steps down while the frame rate stays low, then back up when there is room.
const QUALITY = { full: 1, balanced: 0.75, fast: 0.5 };
let autoGood = 0, autoBad = 0;
const bootT = performance.now();
function setQuality(q, save = true) {
  app.quality = QUALITY[q] || q === 'auto' ? q : 'auto';
  app.stage.renderScale = app.quality === 'auto' ? (app.stage.renderScale || 1) : QUALITY[app.quality];
  const sel = $('sbQuality'); if (sel) sel.value = app.quality;
  if (save) { app.settings.quality = app.quality; app.saveSettings(); }
  showQuality();
}
function showQuality() {
  const o = $('sbQuality') && $('sbQuality').querySelector('option[value="auto"]');
  if (o) o.textContent = app.quality === 'auto' ? `Auto · ${Math.round(app.stage.renderScale * 100)}%` : 'Auto';
}
function autoQuality(fps) {
  if (app.quality !== 'auto' || document.hidden || app.recorder.recording || performance.now() - bootT < 5000) return;
  const st = app.stage;
  if (fps < 48 && st.renderScale > 0.5) { if (++autoBad >= 2) { st.renderScale = Math.max(0.5, +(st.renderScale - 0.1).toFixed(2)); autoBad = 0; showQuality(); } autoGood = 0; return; }
  autoBad = 0;
  if (fps >= 57 && st.renderScale < 1) { if (++autoGood >= 6) { st.renderScale = Math.min(1, +(st.renderScale + 0.05).toFixed(2)); autoGood = 0; showQuality(); } }
  else autoGood = 0;
}

/* ---------------- right-click menu on widgets ---------------- */
function openContextMenu(x, y) {
  const st = app.stage, sel = st.selection, ids = sel.map((w) => w.id), one = sel.length === 1 ? sel[0] : null;
  const g = st.selectedGroup;
  const menu = $('ctxMenu');
  const item = (label, fn, opts = {}) => h('button', { type: 'button', role: 'menuitem', class: opts.danger ? 'danger' : '', disabled: opts.disabled, onclick: () => { closeContextMenu(); fn(); } }, h('span', {}, label), opts.key ? h('kbd', {}, opts.key) : '');
  const sep = () => h('hr');
  const top = () => { for (const id of ids) { const list = st.widgets, w = st.get(id); list.splice(list.indexOf(w), 1); list.push(w); } st._zOrder(); st.changed(true); };
  const bottom = () => { for (const id of [...ids].reverse()) { const list = st.widgets, w = st.get(id); list.splice(list.indexOf(w), 1); list.unshift(w); } st._zOrder(); st.changed(true); };
  menu.innerHTML = '';
  menu.append(
    h('div', { class: 'ctx-title' }, one ? one.name : g ? g.name : `${sel.length} widgets`),
    item('Duplicate', () => st.duplicate(ids), { key: 'Ctrl+D' }),
    item('Bring to front', top, { key: ']' }),
    item('Send to back', bottom, { key: '[' }),
    item('Fill stage', () => st.fillStage(ids)),
    sep(),
    sel.length > 1 && !g ? item('Group', () => { const ng = st.groupSelection(); if (ng) toast(`${ng.name} created`); }, { key: 'Ctrl+G' }) : '',
    g ? item('Ungroup', () => st.ungroup(g.id), { key: 'Ctrl+Shift+G' }) : '',
    sel.length > 1 ? item('Side by side', () => st.arrangeRow(ids)) : '',
    item(sel.every((w) => w.locked) ? 'Unlock position' : 'Lock position', () => { const lock = !sel.every((w) => w.locked); for (const w of sel) { w.locked = lock; st.applyStyle(w); } st.changed(true); }),
    item(sel.every((w) => w.visible) ? 'Hide' : 'Show', () => { const vis = !sel.every((w) => w.visible); for (const w of sel) { w.visible = vis; st.applyStyle(w); } st.changed(true); }),
    one ? item('Randomize', () => { randomize(byId[one.module], one.params); st.changed(true); toast('Randomized'); }) : '',
    item('Reset Look and Audio', () => { for (const w of sel) Object.assign(w.fx, FX_DEFAULTS); st.changed(true); }),
    sep(),
    item('Record this…', () => { app.settings.record = Object.assign({}, app.settings.record || { height: 1080, fps: 60, audio: true }, { source: g ? g.id : one ? one.id : 'stage' }); D.recordDialog(app); }),
    item('Delete', () => st.remove(ids), { danger: true, key: 'Del' }));
  menu.hidden = false;
  const b = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - b.width - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - b.height - 8) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', ctxOutside), 0);
}
function ctxOutside(e) { if (!e.target.closest('#ctxMenu')) closeContextMenu(); }
function closeContextMenu() { $('ctxMenu').hidden = true; document.removeEventListener('pointerdown', ctxOutside); }

function paintRange(r) { r.style.setProperty('--p', (((r.value - r.min) / (r.max - r.min)) * 100).toFixed(1) + '%'); }

/* ---------------- module library ---------------- */
const thumbs = new Map();
function renderModuleList() {
  const box = $('modList');
  box.innerHTML = '';
  $('modCount').textContent = MODULES.length;
  for (const m of MODULES) {
    if (!thumbs.has(m.id)) thumbs.set(m.id, h('canvas', { width: 192, height: 108 }));
    const tile = h('button', {
      class: 'tile', type: 'button', draggable: 'true', 'data-mod': m.id,
      title: `${m.name}: ${m.tagline}`,
      onclick: () => addModule(m.id)
    }, h('span', { class: 'thumb' }, thumbs.get(m.id)),
      h('span', { class: 'tname' }, m.name));
    tile.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-module', m.id); e.dataTransfer.effectAllowed = 'copy'; });
    box.append(tile);
  }
}

// Tile pictures are drawn after the window is up, one module per idle moment, and kept in
// localStorage (per app version) so the next launch shows them at once.
function fillThumbs() {
  const ver = app.version || 'dev';
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem('sf.thumbs') || '{}'); } catch {}
  if (cache.v !== ver) cache = { v: ver, img: {} };
  const todo = [];
  for (const m of MODULES) {
    const c = thumbs.get(m.id); if (!c) continue;
    const url = cache.img[m.id];
    if (url) { const im = new Image(); im.onload = () => c.getContext('2d').drawImage(im, 0, 0); im.src = url; }
    else todo.push(m);
  }
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 30));
  const next = () => {
    const m = todo.shift(); if (!m) return;
    const src = makeThumb(m), c = thumbs.get(m.id);
    if (c) c.getContext('2d').drawImage(src, 0, 0);
    try { cache.img[m.id] = src.toDataURL('image/jpeg', 0.8); localStorage.setItem('sf.thumbs', JSON.stringify(cache)); } catch {}
    idle(next, { timeout: 500 });
  };
  idle(next, { timeout: 800 });
}

// Render each module for a moment on a small canvas to make its tile picture.
function makeThumb(m) {
  const out = h('canvas', { width: 192, height: 108 });
  try {
    const c = document.createElement('canvas'); c.width = 192; c.height = 108;
    const inst = m.create(c, defaults(m));
    const fake = new AudioEngine();
    for (let i = 0; i < 45; i++) {
      const F = fake.update(1 / 30, 3 + i / 30);
      if (i % 12 === 6) F.onsets.push({ band: 'kick', strength: 1 }, { band: 'snare', strength: 0.8 }); // give hit-driven modules something to show
      inst.render(F, { dt: 1 / 30, t: 3 + i / 30, W: 192, H: 108, S: 0.6, params: defaults(m) });
    }
    out.getContext('2d').drawImage(c, 0, 0);
    inst.dispose();
  } catch (e) { console.warn('thumb', m.id, e); }
  return out;
}


/* ---------------- audio source panel ---------------- */
const SRC = {
  demo: { ico: icon.beat, title: 'Demo beat', sub: '124 BPM loop with builds and drops' },
  system: { ico: icon.system, title: 'Connect', sub: 'Captures default audio output' },
  file: { ico: icon.music, title: 'Track', sub: '' },
  device: { ico: icon.mic, title: 'Input', sub: 'Live input' },
  none: { ico: icon.off, title: 'No input', sub: 'Visuals idle on their own' }
};

function updateSource() {
  const a = app.audio, t = a.sourceType;
  const s = SRC[t] || SRC.none;
  $('srcIco').innerHTML = s.ico;
  $('srcChev').innerHTML = icon.chevron;
  $('srcTitle').textContent = t === 'device' ? a.sourceLabel : t === 'file' ? 'Track loaded' : s.title;
  $('srcSub').textContent = t === 'file' ? 'Open another track…' : t === 'device' ? 'Microphone or audio interface' : s.sub;
  const showCard = t === 'file' || t === 'demo';
  $('trackCard').hidden = !showCard;
  $('seekBox').hidden = t !== 'file';
  $('loopBtn').hidden = t !== 'file';
  $('exportBtn').hidden = t !== 'file';
  $('trackName').textContent = t === 'file' ? a.trackName : 'Demo beat · 124 BPM';
  $('playBtn').innerHTML = a.playing ? icon.pause : icon.play;
  $('playBtn').title = a.playing ? 'Pause (Space)' : 'Play (Space)';
  const mon = a.monitor && a.monitor.gain.value > 0.001;
  $('monitorBtn').innerHTML = mon ? icon.speaker : icon.mute;
  $('monitorBtn').setAttribute('aria-pressed', String(mon));
  $('loopBtn').innerHTML = icon.loop;
  $('loopBtn').setAttribute('aria-pressed', String(!!(a.media && a.media.loop)));
  $('ejectBtn').innerHTML = icon.close;
  $('exportBtn').innerHTML = icon.download + '<span>Export video from this track</span>';
}

async function openSourceMenu() {
  const menu = $('sourceMenu');
  if (!menu.hidden) return closeSourceMenu();
  app.devices = await app.audio.listInputs();
  const item = (key, ico, title, sub, fn) => h('button', { class: 'src-item', type: 'button', role: 'option', 'data-src': key, onclick: async () => { closeSourceMenu(); await fn(); } },
    h('span', { class: 'src-ico', html: ico }), h('span', { class: 'src-txt' }, h('b', {}, title), h('small', {}, sub)));
  menu.innerHTML = '';
  menu.append(
    item('system', icon.system, 'Connect', 'Captures default audio output', () => choose('system')),
    ...(app.devices.length ? app.devices : [{ id: '', label: 'Microphone' }]).map((d) => item('device:' + d.id, icon.mic, d.label, 'Microphone or audio interface', () => choose('device:' + d.id, d))),
    item('file', icon.music, 'Open a track…', 'WAV, MP3, AIFF, FLAC, M4A', () => app.pickTrack()),
    item('demo', icon.beat, 'Demo beat', 'Built-in loop with builds and drops', () => choose('demo')),
    item('none', icon.off, 'No input', 'Visuals idle on their own', () => choose('none')));
  menu.hidden = false;
  $('sourceCard').setAttribute('aria-expanded', 'true');
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
}
function outside(e) { if (!e.target.closest('.source-wrap')) closeSourceMenu(); }
function closeSourceMenu() { $('sourceMenu').hidden = true; $('sourceCard').setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside); }

async function choose(v, dev) {
  try {
    if (v === 'demo') await app.audio.useDemo();
    else if (v === 'system') await app.audio.useSystem();
    else if (v === 'none') app.audio.stopSource();
    else if (v.startsWith('device:')) await app.audio.useDevice(v.slice(7) || undefined, dev && dev.label);
    if (v !== 'none') { app.settings.lastSource = v; app.saveSettings(); }
    toast('Listening to ' + app.audio.sourceLabel);
  } catch (err) {
    toast(err.name === 'NotAllowedError' ? 'Access was denied. Allow microphone or screen recording access for Signalform in your system settings.' : err.message, true, 6000);
  }
  updateSource();
}

function wireSource() {
  app.audio.on(() => updateSource());
  $('sourceCard').addEventListener('click', openSourceMenu);
  $('playBtn').addEventListener('click', () => { app.audio.togglePlay(); setTimeout(updateSource, 30); });
  $('loopBtn').addEventListener('click', () => { const m = app.audio.media; if (!m) return; m.loop = !m.loop; app.settings.loop = m.loop; app.saveSettings(); updateSource(); });
  $('monitorBtn').addEventListener('click', () => { const on = !(app.audio.monitor.gain.value > 0.001); app.audio.setMonitor(on); setTimeout(updateSource, 60); });
  $('ejectBtn').addEventListener('click', () => { app.audio.stopSource(); updateSource(); });
  $('exportBtn').addEventListener('click', () => D.renderDialog(app));
  $('trackSeek').addEventListener('input', () => { seeking = true; paintRange($('trackSeek')); const m = app.audio.media; if (m && m.duration) $('trackTime').textContent = fmtTime(($('trackSeek').value / 1000) * m.duration); });
  $('trackSeek').addEventListener('change', () => { const m = app.audio.media; if (m && m.duration) m.currentTime = ($('trackSeek').value / 1000) * m.duration; seeking = false; });
  $('gainIn').addEventListener('input', (e) => { paintRange(e.target); app.audio.setSensitivity(+e.target.value); app.settings.gain = app.audio.sensitivity; app.saveSettings(); });
  navigator.mediaDevices?.addEventListener?.('devicechange', async () => { app.devices = await app.audio.listInputs(); });
}

function wireTopbar() {
  $('sbQuality').addEventListener('change', (e) => setQuality(e.target.value));
  $('sceneName').addEventListener('change', (e) => { app.stage.scene.name = e.target.value.trim() || 'Untitled'; e.target.value = app.stage.scene.name; autosave(); });
  $('aspectSel').addEventListener('change', (e) => app.stage.setAspect(e.target.value));
  $('scenesBtn').addEventListener('click', () => D.scenesDialog(app));
  $('recBtn').addEventListener('click', () => (app.recorder.recording ? app.stopRecording() : D.recordDialog(app)));
  $('outBtn').addEventListener('click', () => D.outputDialog(app));
  $('performBtn').innerHTML = icon.expand;
  $('performBtn').addEventListener('click', () => togglePerform());
}

function togglePerform(force) {
  const on = $('app').classList.toggle('perform', typeof force === 'boolean' ? force : undefined);
  app.stage.fit();
  if (on) toast('Perform mode. Press F or Esc to come back.', false, 2200);
}

function wireKeys() {
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
    if (typing || $('dlg').open) return;
    const mod = e.metaKey || e.ctrlKey;
    const st = app.stage, sel = st.selection, ids = sel.map((w) => w.id);
    if (e.key === 'Escape' && !$('ctxMenu').hidden) return closeContextMenu();
    if (e.key === 'Escape') {
      const one = st.get(st.selected), r = one && st.rt.get(one.id);
      if (r && r.inst && r.inst.capturing) { r.inst.pointer('cancel'); toast('Drawing cancelled'); return; }
      if ($('app').classList.contains('perform')) return togglePerform(false);
      st.select(null); return;
    }
    if (e.code === 'Space') { e.preventDefault(); app.audio.togglePlay(); setTimeout(updateSource, 30); return; }
    if ((e.key === 'f' || e.key === 'F') && !mod) return togglePerform();
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); return D.scenesDialog(app); }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); return st.selectMany(st.widgets.map((w) => w.id)); }
    if (!sel.length) return;
    if (mod && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      if (e.shiftKey) { const g = st.selectedGroup || (sel[0].group && st.group(sel[0].group)); if (g) st.ungroup(g.id); }
      else if (sel.length > 1 && !st.selectedGroup) { const g = st.groupSelection(); if (g) toast(`${g.name} created`); }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return st.remove(ids); }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); return st.duplicate(ids); }
    if (e.key === ']' && sel.length === 1) return st.move(sel[0].id, 1);
    if (e.key === '[' && sel.length === 1) return st.move(sel[0].id, -1);
    const step = e.shiftKey ? 0.05 : 0.005;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) { e.preventDefault(); for (const w of sel) if (!w.locked) { w.rect.x += d[0]; w.rect.y += d[1]; st.applyStyle(w); } st.changed(); }
  });
}

function onMenu(cmd) {
  if (cmd === 'scene:new') app.loadScene({ name: 'Untitled', aspect: app.stage.scene.aspect, widgets: [] });
  else if (cmd === 'scene:import') app.importScene();
  else if (cmd === 'scene:export') window.sf.scene.export(app.stage.serialize());
  else if (cmd === 'track:import') app.pickTrack();
  else if (cmd === 'render:open') D.renderDialog(app);
  else if (cmd === 'perform:toggle') togglePerform();
}

const autosave = debounce(() => { app.settings.autosave = app.stage.serialize(); app.saveSettings(); }, 700);
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
