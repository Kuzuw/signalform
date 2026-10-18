// The timeline: when each layer is on (in and out points), keyframes for any of its settings, and a
// playhead. With a track loaded the playhead is the track's position, so playing, seeking and the
// track render all follow it. Without one the timeline runs on its own clock, and Render records it
// for its length with whatever the music source is.
//
// Saved with the scene as   timeline: { duration, keys: { widgetId: { path: [{ t, v, e }] } }, clips: { widgetId: { in, out } } }
// where path is "params.<key>" (a module setting), "fx.<key>" (Look and Audio) or "opacity", and e is
// how the value travels to the next key: "l" linear, "e" ease in and out, "h" hold.
import { byId } from './modules/index.js';
import { FX_PARAMS } from './fx.js';
import { h, icon } from './ui.js';
import { hexToRgb } from './modules/util.js';

const EPS = 1 / 120;                  // keys closer than this are the same key
const SNAP_PX = 6;
const ROW = 26, SUB = 22, AUDIO_ROW = 30, RULER = 24;
const OPACITY = { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 1, step: 0.01, pct: true };
const FX_ALL = [...FX_PARAMS.look.map((p) => ({ ...p, group: 'Look' })), ...FX_PARAMS.audio.map((p) => ({ ...p, group: 'Audio' }))];
const EASE = { l: 'Linear', e: 'Ease in and out', h: 'Hold' };
export const KEYABLE = new Set(['range', 'select', 'color', 'toggle']);
const ICON_START = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 5v14"/><path d="M18 6l-9 6 9 6z" fill="currentColor" stroke="none"/></svg>';
const ICON_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-7 6 7 6z" fill="currentColor"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l7 6-7 6z" fill="currentColor"/></svg>';

/* ---------------- the data ---------------- */
export function normalizeTimeline(tl) {
  tl = tl && typeof tl === 'object' ? tl : {};
  const out = { duration: clamp(num(tl.duration, 30), 1, 3600), keys: {}, clips: {} };
  for (const [id, props] of Object.entries(tl.keys || {})) {
    for (const [path, ks] of Object.entries(props || {})) {
      if (!Array.isArray(ks) || !/^(params\.|fx\.)[\w-]+$|^opacity$/.test(path)) continue;
      const list = ks.filter((k) => k && isFinite(k.t) && k.v !== undefined).map((k) => ({ t: Math.max(0, +k.t), v: k.v, e: EASE[k.e] ? k.e : 'l' })).sort((a, b) => a.t - b.t);
      if (list.length) (out.keys[id] ||= {})[path] = list;
    }
  }
  for (const [id, c] of Object.entries(tl.clips || {})) if (c && isFinite(c.in) && isFinite(c.out) && c.out > c.in) out.clips[id] = { in: Math.max(0, +c.in), out: +c.out };
  return out;
}

export function specFor(w, path) {
  if (path === 'opacity') return OPACITY;
  const [ns, key] = split(path);
  if (ns === 'params') return (byId[w.module] && byId[w.module].params.find((p) => p.key === key)) || null;
  if (ns === 'fx') return FX_ALL.find((p) => p.key === key) || null;
  return null;
}
export function pathLabel(w, path) {
  const s = specFor(w, path); if (!s) return path;
  return s.group ? `${s.group}: ${s.label}` : s.label;
}
export function getValue(w, path) { if (path === 'opacity') return w.opacity; const [ns, k] = split(path); return w[ns] ? w[ns][k] : undefined; }
function setValue(w, path, v) { if (path === 'opacity') w.opacity = v; else { const [ns, k] = split(path); if (w[ns]) w[ns][k] = v; } }
function split(p) { const i = p.indexOf('.'); return i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)]; }

// The value of an animated setting at time t.
export function evaluate(ks, t, spec) {
  const n = ks.length;
  if (t <= ks[0].t) return ks[0].v;
  if (t >= ks[n - 1].t) return ks[n - 1].v;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ks[m].t <= t) lo = m; else hi = m; }
  const a = ks[lo], b = ks[hi];
  if (a.e === 'h') return a.v;
  let u = (t - a.t) / Math.max(1e-9, b.t - a.t);
  if (a.e === 'e') u = u * u * (3 - 2 * u);
  if (spec && spec.type === 'range' && typeof a.v === 'number' && typeof b.v === 'number') {
    const v = a.v + (b.v - a.v) * u;
    return spec.step >= 1 ? Math.round(v) : Math.round(v * 1e5) / 1e5;
  }
  if (spec && spec.type === 'color' && typeof a.v === 'string' && typeof b.v === 'string') return lerpHex(a.v, b.v, u);
  return a.v;
}
function lerpHex(a, b, u) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * u).toString(16).padStart(2, '0')).join('');
}

/* ---------------- the controller and its panel ---------------- */
export class Timeline {
  constructor(app, el) {
    this.app = app; this.el = el;
    this.clock = 0; this.playing = false; this.loop = true; this.onEnd = null;
    this._base = { clock: 0, real: 0 };
    this.open = new Set();                     // layers whose animated settings are listed
    this.view = { start: 0, span: 0 };         // span 0: the whole timeline fits
    this.selKey = null;                        // { id, path, k } the key picked in the panel
    this.peaks = null; this.peaksFor = null;
    this._refresh = true; this._lastSync = 0; this._shown = {};
    const s = app.settings.timeline || {};
    this.collapsed = !!s.collapsed;
    this.height = clamp(num(s.height, 200), 96, 520);
    this._build();
    window.addEventListener('keydown', (e) => this._key(e), true);
    new ResizeObserver(() => this.refreshSoon()).observe(this.right);
  }

  get stage() { return this.app.stage; }
  get data() { return this.stage.scene.timeline; }
  get hasTrack() { const a = this.app.audio, m = a.media; return a.sourceType === 'file' && !!m && isFinite(m.duration) && m.duration > 0; }
  get duration() { return this.hasTrack ? this.app.audio.media.duration : this.data.duration; }
  get isPlaying() { return this.hasTrack ? !this.app.audio.media.paused : this.playing; }
  now() { return this.hasTrack ? this.app.audio.media.currentTime : this.clock; }

  /* transport */
  togglePlay() {
    if (this.hasTrack) { this.app.audio.togglePlay(); return; }
    if (!this.playing && this.clock >= this.duration - 0.01) this.clock = 0;
    this.playing = !this.playing; this._rebase();
  }
  seek(t) {
    t = clamp(t, 0, this.duration);
    if (this.hasTrack) this.app.audio.media.currentTime = t; else { this.clock = t; this._rebase(); }
    this.apply(t); this._follow(t, true);
    this._syncInspector(true);
  }
  _rebase() { this._base = { clock: this.clock, real: performance.now() }; }

  // Called every frame before the stage renders.
  tick() {
    if (!this.data) return;
    if (!this.hasTrack && this.playing) {
      // the clock follows real time (not frame time), so a render of N seconds lasts N seconds
      this.clock = this._base.clock + (performance.now() - this._base.real) / 1000;
      const d = this.duration;
      if (this.clock >= d) {
        if (this.loop && !this.onEnd) { this.clock %= d; this._rebase(); }
        else { this.clock = d; this.playing = false; const f = this.onEnd; this.onEnd = null; if (f) f(); }
      }
    }
    this.apply(this.now());
  }

  // Sets every animated setting, and shows or hides layers by their in and out points.
  apply(t) {
    const st = this.stage, tl = this.data; if (!tl) return;
    for (const id in tl.keys) {
      const w = st.get(id); if (!w) continue;
      const props = tl.keys[id];
      for (const path in props) {
        const ks = props[path]; if (!ks.length) continue;
        const v = evaluate(ks, t, specFor(w, path));
        if (getValue(w, path) !== v) {
          setValue(w, path, v);
          if (path === 'opacity') { const r = st.rt.get(id); if (r) r.card.style.opacity = v; }
        }
      }
    }
    for (const w of st.widgets) {
      const c = tl.clips[w.id], off = !!c && (t < c.in || t >= c.out);
      if (off !== st.tlHidden.has(w.id)) { if (off) st.tlHidden.add(w.id); else st.tlHidden.delete(w.id); st.applyStyle(w); }
    }
  }

  /* keys */
  keys(w, path) { const k = this.data.keys[w.id]; return (k && k[path]) || null; }
  hasKeys(w, path) { const k = this.keys(w, path); return !!(k && k.length); }
  animated(w) { const k = this.data.keys[w.id]; return k ? Object.keys(k).filter((p) => k[p].length) : []; }
  keyIndexAt(w, path, t) { const ks = this.keys(w, path); return ks ? ks.findIndex((k) => Math.abs(k.t - t) < EPS) : -1; }
  setKey(w, path, t, v) {
    const all = this.data.keys[w.id] ||= {}, ks = all[path] ||= [];
    const i = ks.findIndex((k) => Math.abs(k.t - t) < EPS);
    if (i >= 0) ks[i].v = v; else { ks.push({ t, v, e: 'l' }); ks.sort((a, b) => a.t - b.t); }
  }
  // the ◆ button: start animating, or add or remove the key at the playhead
  toggleKey(w, path) {
    const t = this.now(), i = this.keyIndexAt(w, path, t);
    const first = !this.hasKeys(w, path);
    if (i >= 0) this.removeKey(w, path, this.keys(w, path)[i]);
    else this.setKey(w, path, t, clone(getValue(w, path)));
    if (first) { this.open.add(w.id); if (this.collapsed) this.setCollapsed(false); }
    this.changed();
  }
  // a setting was changed by hand: with keys, that change goes into the key at the playhead
  edited(w, path, v) {
    if (!this.hasKeys(w, path)) return;
    this.setKey(w, path, this.now(), clone(v));
    this.refreshSoon();
  }
  removeKey(w, path, key) {
    const all = this.data.keys[w.id]; if (!all || !all[path]) return;
    all[path] = all[path].filter((k) => k !== key);
    if (!all[path].length) delete all[path];
    if (!Object.keys(all).length) delete this.data.keys[w.id];
    if (this.selKey && this.selKey.k === key) this.selKey = null;
  }
  clearKeys(w, path) { const all = this.data.keys[w.id]; if (!all) return; delete all[path]; if (!Object.keys(all).length) delete this.data.keys[w.id]; this.changed(); }
  jump(w, path, dir) {
    const ks = this.keys(w, path); if (!ks) return;
    const t = this.now(), k = dir > 0 ? ks.find((x) => x.t > t + EPS) : [...ks].reverse().find((x) => x.t < t - EPS);
    if (k) this.seek(k.t);
  }

  changed() { this.stage.changed(); this.refreshSoon(); this._syncInspector(true); }
  refreshSoon() { this._refresh = true; }
  _syncInspector(now) {
    const ins = this.app.inspector; if (!ins) return;
    const t = performance.now();
    if (now || t - this._lastSync > 110) { this._lastSync = t; ins.syncValues(); }
  }

  setCollapsed(c) {
    this.collapsed = c;
    this.el.classList.toggle('collapsed', c);
    this.toggleBtn.setAttribute('aria-expanded', String(!c));
    this._save(); this.refreshSoon();
  }
  _save() { this.app.settings.timeline = { collapsed: this.collapsed, height: this.height }; this.app.saveSettings(); }

  /* ---------------- view: time ↔ pixels ---------------- */
  get span() { const d = this.duration; return clamp(this.view.span || d, Math.min(d, 0.5), d); }
  get start() { return clamp(this.view.start, 0, Math.max(0, this.duration - this.span)); }
  laneW() { return Math.max(1, this.right.clientWidth); }
  x(t) { return ((t - this.start) / this.span) * this.laneW(); }
  tAt(clientX) { const b = this.right.getBoundingClientRect(); return clamp(this.start + ((clientX - b.left) / Math.max(1, b.width)) * this.span, 0, this.duration); }
  zoomTo(span, around) {
    const d = this.duration, s0 = this.start, sp0 = this.span;
    const ns = clamp(span, Math.min(d, 0.5), d);
    const a = around ?? this.now();
    const frac = sp0 ? (a - s0) / sp0 : 0.5;
    this.view.span = ns >= d - 1e-6 ? 0 : ns;
    this.view.start = clamp(a - frac * ns, 0, Math.max(0, d - ns));
    this._paintZoom();
    this.refreshSoon();
  }
  _paintZoom() { const v = this._zoomValue(); this.zoomIn.value = String(v); this.zoomIn.style.setProperty('--p', (v * 100).toFixed(1) + '%'); }
  _zoomValue() { const d = this.duration, min = Math.min(d, 0.5); return d <= min ? 0 : Math.log(d / this.span) / Math.log(d / min); }
  _follow(t, force) {
    // keep the playhead in view while it plays (page along like a DAW)
    if (!this.view.span) return;
    const s = this.start, sp = this.span;
    if (t < s || t > s + sp * (force ? 1 : 0.98)) { this.view.start = clamp(t - sp * 0.1, 0, Math.max(0, this.duration - sp)); this.refreshSoon(); }
  }

  /* ---------------- building the panel ---------------- */
  _build() {
    const el = this.el;
    el.innerHTML = '';
    el.classList.toggle('collapsed', this.collapsed);
    el.style.setProperty('--tl-h', this.height + 'px');
    this.toggleBtn = h('button', { class: 'tl-toggle', type: 'button', id: 'tlToggle', 'aria-expanded': String(!this.collapsed), title: 'Show or hide the timeline', onclick: () => this.setCollapsed(!this.collapsed) },
      h('span', { class: 'chev', html: icon.chevron }), h('b', {}, 'Timeline'));
    this.playBtn = h('button', { class: 'icon-btn', type: 'button', id: 'tlPlay', title: 'Play or pause the timeline', html: icon.play, onclick: () => this.togglePlay() });
    this.timeEl = h('span', { class: 'tl-time', id: 'tlTime' }, '0:00.00');
    this.durEl = h('span', { class: 'tl-dur' });
    this.durIn = h('input', { type: 'number', class: 'tl-durin', id: 'tlDuration', min: 1, max: 3600, step: 1, 'aria-label': 'Timeline length in seconds', title: 'Length of the timeline in seconds. With a track loaded, the track sets it.',
      onchange: (e) => { this.data.duration = clamp(Math.round(+e.target.value) || 30, 1, 3600); this.clock = Math.min(this.clock, this.data.duration); this.changed(); },
      onkeydown: (e) => e.stopPropagation() });
    this.hint = h('span', { class: 'tl-hint' });
    this.zoomIn = h('input', { type: 'range', id: 'tlZoom', min: 0, max: 1, step: 0.001, value: 0, 'aria-label': 'Timeline zoom',
      oninput: (e) => { const d = this.duration, min = Math.min(d, 0.5); this.zoomTo(d * Math.pow(min / d, +e.target.value)); } });
    const renderBtn = h('button', { class: 'btn sm', type: 'button', id: 'tlRender', title: 'Render the timeline to a video file', onclick: () => this.app.openRender() }, h('span', { class: 'ico', html: icon.download }), 'Render');
    const bar = h('div', { class: 'tl-bar' }, this.toggleBtn, h('span', { class: 'vr', 'aria-hidden': 'true' }),
      h('button', { class: 'icon-btn', type: 'button', title: 'Go to the start (Home)', html: ICON_START, onclick: () => this.seek(0) }),
      this.playBtn, this.timeEl, h('span', { class: 'tl-slash' }, '/'), this.durEl, this.durIn, h('small', { class: 'tl-unit' }, 's'),
      this.hint, h('span', { class: 'spacer' }),
      h('label', { class: 'tl-zoom', title: 'Zoom (Ctrl + scroll over the lanes)' }, h('span', {}, 'Zoom'), this.zoomIn), renderBtn);
    this.leftCol = h('div', { class: 'tl-left' });
    this.ruler = h('canvas', { class: 'tl-ruler', height: RULER });
    this.rows = h('div', { class: 'tl-rows' });
    this.head = h('div', { class: 'tl-head', 'aria-hidden': 'true' }, h('i'));
    this.right = h('div', { class: 'tl-right' }, this.ruler, this.rows, this.head);
    this.scroll = h('div', { class: 'tl-scroll' }, this.leftCol, this.right);
    this.grip = h('div', { class: 'tl-grip', title: 'Drag to resize the timeline' });
    el.append(this.grip, bar, h('div', { class: 'tl-body' }, this.scroll));
    this._wire();
  }

  _wire() {
    // scrub on the ruler or the playhead
    const scrub = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const tgt = e.currentTarget; tgt.setPointerCapture(e.pointerId);
      const wasPlaying = this.isPlaying && this.hasTrack;
      if (wasPlaying) this.app.audio.media.pause();
      this.seek(this.tAt(e.clientX));
      const mv = (ev) => this.seek(this.tAt(ev.clientX));
      const up = () => { tgt.removeEventListener('pointermove', mv); tgt.removeEventListener('pointerup', up); if (wasPlaying) this.app.audio.media.play().catch(() => {}); };
      tgt.addEventListener('pointermove', mv); tgt.addEventListener('pointerup', up);
    };
    this.ruler.addEventListener('pointerdown', scrub);
    this.head.addEventListener('pointerdown', scrub);
    // zoom with Ctrl + scroll, pan with Shift + scroll or a sideways scroll
    this.right.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoomTo(this.span * Math.exp(e.deltaY * 0.0025), this.tAt(e.clientX)); return; }
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      if (dx && this.view.span) { e.preventDefault(); this.view.start = clamp(this.start + (dx / this.laneW()) * this.span, 0, this.duration - this.span); this.refreshSoon(); }
    }, { passive: false });
    this.rows.addEventListener('pointerdown', (e) => this._lanePointer(e));
    this.rows.addEventListener('contextmenu', (e) => { const k = e.target.closest('.tl-key.edit'); if (k) { e.preventDefault(); this._keyMenu(k, e.clientX, e.clientY); } });
    this.rows.addEventListener('dblclick', (e) => {
      const c = e.target.closest('.tl-clip'); if (!c) return;
      delete this.data.clips[c.dataset.id]; this.changed();
    });
    // resize the panel from its top edge
    this.grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); this.grip.setPointerCapture(e.pointerId);
      const y0 = e.clientY, h0 = this.height;
      const mv = (ev) => { this.height = clamp(h0 + (y0 - ev.clientY), 96, Math.min(520, innerHeight * 0.6)); this.el.style.setProperty('--tl-h', this.height + 'px'); };
      const up = () => { this.grip.removeEventListener('pointermove', mv); this.grip.removeEventListener('pointerup', up); this._save(); };
      this.grip.addEventListener('pointermove', mv); this.grip.addEventListener('pointerup', up);
    });
  }

  _key(e) {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (document.getElementById('dlg').open) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selKey) {
      const { id, path, k } = this.selKey, w = this.stage.get(id);
      e.preventDefault(); e.stopPropagation();
      if (w) { this.removeKey(w, path, k); this.changed(); }
      this.selKey = null; return;
    }
    if (e.key === 'Escape' && this.selKey) { this.selKey = null; this.refreshSoon(); e.stopPropagation(); return; }
    if (e.key === 'Home') { e.preventDefault(); this.seek(0); }
    if (e.key === 'End') { e.preventDefault(); this.seek(this.duration); }
  }

  // drag a key, or a layer bar (its ends set the in and out points)
  _lanePointer(e) {
    if (e.button !== 0) return;
    const keyEl = e.target.closest('.tl-key'), clipEl = e.target.closest('.tl-clip');
    if (keyEl && keyEl.classList.contains('sum')) { this.seek(+keyEl.dataset.t); return; }
    if (keyEl) return this._dragKey(e, keyEl);
    if (clipEl) return this._dragClip(e, clipEl);
    if (this.selKey) { this.selKey = null; this.refreshSoon(); }
    this.seek(this.tAt(e.clientX));
  }

  _snapT(t, skip) {
    const pxPer = this.laneW() / this.span, cands = [0, this.duration, this.now()];
    if (skip !== 'keys') for (const id in this.data.keys) for (const p in this.data.keys[id]) for (const k of this.data.keys[id][p]) cands.push(k.t);
    let best = t, bd = SNAP_PX / pxPer;
    for (const c of cands) { const d = Math.abs(c - t); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  _dragKey(e, keyEl) {
    e.preventDefault(); e.stopPropagation();
    const w = this.stage.get(keyEl.dataset.id), path = keyEl.dataset.path;
    const ks = w && this.keys(w, path); if (!ks) return;
    const k = ks[+keyEl.dataset.k]; if (!k) return;
    this.selKey = { id: w.id, path, k };
    this.rows.querySelectorAll('.tl-key.picked').forEach((x) => x.classList.remove('picked'));
    keyEl.classList.add('picked');
    keyEl.setPointerCapture(e.pointerId);
    const x0 = e.clientX, t0 = k.t, pxPer = this.laneW() / this.span;
    let moved = false;
    this._dragging = true;
    const mv = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      let t = clamp(t0 + (ev.clientX - x0) / pxPer, 0, this.duration);
      if (!ev.altKey) { const pt = this.now(); if (Math.abs(pt - t) * pxPer < SNAP_PX) t = pt; }
      k.t = Math.round(t * 1000) / 1000;
      ks.sort((a, b) => a.t - b.t);
      keyEl.style.left = this.x(k.t) + 'px';
      this.timeEl.title = 'Key at ' + fmtClock(k.t);
      this.apply(this.now());
    };
    const up = () => {
      keyEl.removeEventListener('pointermove', mv); keyEl.removeEventListener('pointerup', up);
      this._dragging = false;
      if (!moved) { this.seek(k.t); this.refreshSoon(); return; }
      // a key dropped onto another one replaces it
      const all = this.data.keys[w.id]; all[path] = ks.filter((o) => o === k || Math.abs(o.t - k.t) >= EPS);
      this.changed();
    };
    keyEl.addEventListener('pointermove', mv); keyEl.addEventListener('pointerup', up);
  }

  _dragClip(e, clipEl) {
    e.preventDefault(); e.stopPropagation();
    const id = clipEl.dataset.id, w = this.stage.get(id); if (!w) return;
    const mode = e.target.classList.contains('in') ? 'in' : e.target.classList.contains('out') ? 'out' : 'move';
    if (this.stage.selected !== id) this.stage.select(id);
    const el = this.rows.querySelector(`.tl-clip[data-id="${id}"]`) || clipEl;
    el.setPointerCapture(e.pointerId);
    const d = this.duration, c0 = this.data.clips[id] || { in: 0, out: d }, x0 = e.clientX, pxPer = this.laneW() / this.span;
    let c = { ...c0 }, moved = false;
    this._dragging = true;
    const mv = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      const dt = (ev.clientX - x0) / pxPer, len = c0.out - c0.in, snap = !ev.altKey;
      if (mode === 'move') {
        let a = clamp(c0.in + dt, 0, d - len);
        if (snap) { const s1 = this._snapT(a), s2 = this._snapT(a + len) - len; a = Math.abs(s1 - a) <= Math.abs(s2 - a) ? s1 : s2; a = clamp(a, 0, d - len); }
        c = { in: a, out: a + len };
      } else if (mode === 'in') c = { in: clamp(snap ? this._snapT(c0.in + dt) : c0.in + dt, 0, c0.out - 0.05), out: c0.out };
      else c = { in: c0.in, out: clamp(snap ? this._snapT(c0.out + dt) : c0.out + dt, c0.in + 0.05, d) };
      el.style.left = this.x(c.in) + 'px'; el.style.width = Math.max(4, this.x(c.out) - this.x(c.in)) + 'px';
      el.querySelector('.tl-cliptime').textContent = `${fmtClock(c.in)} – ${fmtClock(c.out)}`;
    };
    const up = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
      this._dragging = false;
      if (!moved) { this.seek(this.tAt(x0)); this.refreshSoon(); return; }
      c.in = Math.round(c.in * 1000) / 1000; c.out = Math.round(c.out * 1000) / 1000;
      if (c.in <= 0.001 && c.out >= d - 0.001) delete this.data.clips[id]; else this.data.clips[id] = c;
      this.changed();
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  }

  _keyMenu(keyEl, x, y) {
    const w = this.stage.get(keyEl.dataset.id), path = keyEl.dataset.path, ks = w && this.keys(w, path), k = ks && ks[+keyEl.dataset.k];
    if (!k) return;
    let menu = document.getElementById('tlMenu');
    if (!menu) { menu = h('div', { class: 'ctxmenu', id: 'tlMenu', role: 'menu' }); document.body.append(menu); }
    const close = () => { menu.hidden = true; document.removeEventListener('pointerdown', out, true); };
    const out = (ev) => { if (!ev.target.closest('#tlMenu')) close(); };
    const item = (label, fn, cls = '', on = false) => h('button', { type: 'button', role: 'menuitem', class: cls + (on ? ' on' : ''), onclick: () => { close(); fn(); } }, h('span', {}, label), on ? h('kbd', {}, '✓') : '');
    menu.innerHTML = '';
    menu.append(h('div', { class: 'ctx-title' }, `${pathLabel(w, path)} · ${fmtClock(k.t)}`),
      ...Object.entries(EASE).map(([e, l]) => item(l, () => { k.e = e; this.changed(); }, '', k.e === e)),
      h('hr'),
      item('Go to this key', () => this.seek(k.t)),
      item('Delete key', () => { this.removeKey(w, path, k); this.changed(); }, 'danger'));
    menu.hidden = false;
    const b = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - b.width - 8) + 'px';
    menu.style.top = Math.min(y, innerHeight - b.height - 8) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', out, true), 0);
  }

  /* ---------------- drawing ---------------- */
  // Called every frame after the stage renders: playhead, clock, and a rebuild when something changed.
  frame() {
    if (!this.data) return;
    const a = this.app.audio, f = this.hasTrack ? a.file : null;
    if (f !== this.peaksFor) { this.peaksFor = f; this.peaks = null; if (f) this._loadPeaks(f); this.view = { start: 0, span: 0 }; this.refreshSoon(); }
    const d = this.duration;
    if (d !== this._d) { this._d = d; this.refreshSoon(); }
    const t = this.now();
    if (this.isPlaying) this._follow(t, false);
    if (this._refresh && !this._dragging) { this._refresh = false; this._render(); }
    if (this.collapsed) { this.timeEl.textContent = fmtClock(t); this._playIcon(); return; }
    const x = this.x(t);
    this.head.style.transform = `translateX(${x.toFixed(1)}px)`;
    this.head.style.visibility = x < -1 || x > this.laneW() + 1 ? 'hidden' : '';
    const txt = fmtClock(t); if (txt !== this._txt) { this._txt = txt; this.timeEl.textContent = txt; }
    this._playIcon();
    const sel = this.stage.selected && this.stage.get(this.stage.selected);
    if (sel && this.data.keys[sel.id]) this._syncInspector(false);
  }
  _playIcon() { const p = this.isPlaying; if (p !== this._p) { this._p = p; this.playBtn.innerHTML = p ? icon.pause : icon.play; this.playBtn.setAttribute('aria-pressed', String(p)); } }

  async _loadPeaks(f) {
    try {
      const buf = await this.app.audio.ctx.decodeAudioData(await f.arrayBuffer());
      if (this.peaksFor !== f) return;
      const ch = buf.getChannelData(0), ch2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch;
      const N = 6000, step = ch.length / N, pk = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        let m = 0; const j1 = Math.min(ch.length, Math.floor((i + 1) * step));
        for (let j = Math.floor(i * step); j < j1; j += 3) { const v = Math.abs(ch[j]) + Math.abs(ch2[j]); if (v > m) m = v; }
        pk[i] = m * 0.5;
      }
      let mx = 0; for (const v of pk) mx = Math.max(mx, v);
      if (mx > 0) for (let i = 0; i < N; i++) pk[i] /= mx;
      this.peaks = { data: pk, duration: buf.duration };
      this.refreshSoon();
    } catch (e) { console.warn('timeline waveform', e); }
  }

  _render() {
    const st = this.stage, tl = this.data, d = this.duration;
    this.durEl.textContent = fmtClock(d);
    this.durEl.hidden = !this.hasTrack; this.durIn.hidden = this.hasTrack; this.durIn.nextSibling.hidden = this.hasTrack;
    if (!this.hasTrack && document.activeElement !== this.durIn) this.durIn.value = String(tl.duration);
    this._paintZoom();
    const nKeys = Object.values(tl.keys).reduce((s, p) => s + Object.values(p).reduce((a, k) => a + k.length, 0), 0);
    const nClips = Object.keys(tl.clips).length;
    this.hint.textContent = !st.widgets.length ? '' : nKeys || nClips
      ? [nKeys ? `${nKeys} keyframe${nKeys === 1 ? '' : 's'}` : '', nClips ? `${nClips} trimmed layer${nClips === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
      : 'Click ◆ beside a setting to keyframe it · drag a bar’s ends to trim a layer';
    if (this.collapsed) return;

    const W = this.laneW(), left = this.leftCol, rows = this.rows;
    left.innerHTML = ''; rows.innerHTML = '';
    left.append(h('div', { class: 'tl-corner' }, h('span', {}, 'Layers')));
    this._drawRuler(W);
    if (this.hasTrack) {
      const cv = h('canvas', { class: 'tl-wave', width: Math.round(W * dpr()), height: Math.round(AUDIO_ROW * dpr()) });
      left.append(h('div', { class: 'tl-name audio', title: this.app.audio.trackName }, h('span', { class: 'ico', html: icon.music }), h('span', { class: 'nm' }, this.app.audio.trackName || 'Track')));
      rows.append(h('div', { class: 'tl-lane audio' }, cv));
      this._drawWave(cv, W);
    }
    if (!st.widgets.length) {
      left.append(h('div', { class: 'tl-name empty' }, h('span', { class: 'nm' }, 'No layers')));
      rows.append(h('div', { class: 'tl-lane empty' }, h('span', {}, 'Add a module to the stage to animate it.')));
    }
    const selIds = new Set(st.selection.map((w) => w.id));
    for (const w of [...st.widgets].reverse()) {
      const paths = this.animated(w), open = this.open.has(w.id) && paths.length;
      const hue = hashHue(w.id), sel = selIds.has(w.id);
      left.append(h('div', { class: 'tl-name' + (sel ? ' sel' : '') + (w.visible ? '' : ' off'), 'data-id': w.id, style: `--c: hsl(${hue} 55% 62%)`, onclick: (e) => { if (!e.target.closest('.tl-caret')) st.select(w.id, e.shiftKey || e.ctrlKey || e.metaKey); } },
        h('button', { class: 'tl-caret' + (open ? ' open' : ''), type: 'button', disabled: !paths.length, title: paths.length ? 'Show the animated settings' : 'Nothing animated yet', 'aria-expanded': String(!!open), html: icon.chevron,
          onclick: () => { if (this.open.has(w.id)) this.open.delete(w.id); else this.open.add(w.id); this.refreshSoon(); } }),
        h('i', { class: 'tl-chip' }), h('span', { class: 'nm' }, w.name), paths.length ? h('small', { class: 'tl-count' }, String(paths.length)) : ''));
      const c = tl.clips[w.id] || { in: 0, out: d };
      const x0 = this.x(c.in), x1 = this.x(Math.min(d, c.out));
      const lane = h('div', { class: 'tl-lane' + (sel ? ' sel' : ''), 'data-id': w.id, style: `--c: hsl(${hue} 42% 50%)` },
        h('div', { class: 'tl-clip' + (tl.clips[w.id] ? ' trimmed' : '') + (w.visible ? '' : ' off'), 'data-id': w.id, style: { left: x0 + 'px', width: Math.max(4, x1 - x0) + 'px' }, title: 'Drag to move. Drag an end to set where the layer starts or stops. Double-click to reset.' },
          h('i', { class: 'in' }), h('span', { class: 'tl-cliptime' }, tl.clips[w.id] ? `${fmtClock(c.in)} – ${fmtClock(c.out)}` : ''), h('i', { class: 'out' })));
      // every key of the layer, in one row
      const times = [...new Set(paths.flatMap((p) => this.keys(w, p).map((k) => Math.round(k.t * 1000) / 1000)))];
      for (const t of times) { const x = this.x(t); if (x >= -8 && x <= W + 8) lane.append(h('i', { class: 'tl-key sum', 'data-t': t, style: { left: x + 'px' }, title: fmtClock(t) })); }
      rows.append(lane);
      if (!open) continue;
      for (const p of paths) {
        const ks = this.keys(w, p), atKey = this.keyIndexAt(w, p, this.now()) >= 0;
        left.append(h('div', { class: 'tl-name sub' }, h('span', { class: 'nm', title: pathLabel(w, p) }, pathLabel(w, p)),
          h('button', { class: 'tl-mini', type: 'button', title: 'Previous key', html: ICON_PREV, onclick: () => this.jump(w, p, -1) }),
          h('button', { class: 'kf has' + (atKey ? ' on' : ''), type: 'button', title: atKey ? 'Remove the key at the playhead' : 'Add a key at the playhead', onclick: () => this.toggleKey(w, p) }),
          h('button', { class: 'tl-mini', type: 'button', title: 'Next key', html: ICON_NEXT, onclick: () => this.jump(w, p, 1) }),
          h('button', { class: 'tl-mini x', type: 'button', title: 'Stop animating (keeps the current value)', html: icon.close, onclick: () => this.clearKeys(w, p) })));
        const sub = h('div', { class: 'tl-lane sub' });
        // a line between keys shows where the value is moving
        for (let i = 0; i < ks.length - 1; i++) if (ks[i].e !== 'h' && !same(ks[i].v, ks[i + 1].v)) {
          const a = this.x(ks[i].t), b = this.x(ks[i + 1].t);
          if (b >= 0 && a <= W) sub.append(h('i', { class: 'tl-span' + (ks[i].e === 'e' ? ' ease' : ''), style: { left: a + 'px', width: Math.max(0, b - a) + 'px' } }));
        }
        ks.forEach((k, i) => {
          const x = this.x(k.t); if (x < -8 || x > W + 8) return;
          const picked = this.selKey && this.selKey.k === k;
          sub.append(h('i', { class: `tl-key edit e-${k.e}` + (picked ? ' picked' : ''), 'data-id': w.id, 'data-path': p, 'data-k': i, style: { left: x + 'px' },
            title: `${fmtClock(k.t)} · ${fmtValue(specFor(w, p), k.v)} · ${EASE[k.e]}\nDrag to move, right-click for options, Delete to remove` }));
        });
        rows.append(sub);
      }
    }
  }

  _drawRuler(W) {
    const c = this.ruler, r = dpr();
    c.width = Math.round(W * r); c.height = Math.round(RULER * r);
    c.style.width = W + 'px'; c.style.height = RULER + 'px';
    const g = c.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0);
    g.clearRect(0, 0, W, RULER);
    const span = this.span, s = this.start, pxPer = W / span;
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const major = steps.find((x) => x * pxPer >= 64) || 600, minor = major / (major >= 60 ? 6 : major === 15 || major === 0.25 ? 3 : 5);
    g.fillStyle = '#8d8d96'; g.font = '10px ui-monospace, Menlo, Consolas, monospace'; g.textBaseline = 'top';
    for (let t = Math.floor(s / minor) * minor; t <= s + span + 1e-6; t += minor) {
      const x = Math.round((t - s) * pxPer) + 0.5, isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      g.fillStyle = isMajor ? '#5c5c64' : '#333338';
      g.fillRect(x - 0.5, isMajor ? 12 : 17, 1, isMajor ? 12 : 7);
      if (isMajor) { g.fillStyle = '#8d8d96'; g.fillText(fmtRuler(t, major), x + 4, 4); }
    }
  }
  _drawWave(cv, W) {
    const r = dpr(), H = AUDIO_ROW, g = cv.getContext('2d');
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, W, H);
    const P = this.peaks; if (!P) return;
    const pk = P.data, N = pk.length, s = this.start, span = this.span;
    g.fillStyle = 'rgba(160,170,190,0.42)';
    for (let x = 0; x < W; x++) {
      const t0 = s + (x / W) * span, t1 = s + ((x + 1) / W) * span;
      const i0 = Math.floor((t0 / P.duration) * N), i1 = Math.max(i0 + 1, Math.floor((t1 / P.duration) * N));
      let m = 0; for (let i = i0; i < i1 && i < N; i++) m = Math.max(m, pk[i]);
      const hh = Math.max(0.5, m * (H / 2 - 2));
      g.fillRect(x, H / 2 - hh, 1, hh * 2);
    }
  }
}

/* ---------------- helpers ---------------- */
export function fmtClock(t) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
function fmtRuler(t, step) {
  const m = Math.floor(t / 60 + 1e-9), s = t - m * 60;
  return step < 1 ? `${m}:${s.toFixed(step < 0.5 ? 2 : 1).padStart(step < 0.5 ? 5 : 4, '0')}` : `${m}:${String(Math.round(s)).padStart(2, '0')}`;
}
function fmtValue(spec, v) {
  if (!spec) return String(v);
  if (spec.type === 'range') return spec.pct ? Math.round(v * 100) + '%' : Number(v).toFixed(spec.step >= 1 ? 0 : 2) + (spec.unit || '');
  if (spec.type === 'toggle') return v ? 'On' : 'Off';
  if (spec.type === 'select') { const o = (spec.options || []).find(([k]) => String(k) === String(v)); return o ? o[1] : String(v); }
  return String(v);
}
function same(a, b) { return a === b || JSON.stringify(a) === JSON.stringify(b); }
function clone(v) { return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v; }
function hashHue(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return Math.round((x * 137.508) % 360); }   // golden angle: neighbouring ids get distinct colours
function dpr() { return Math.min(2, window.devicePixelRatio || 1); }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
