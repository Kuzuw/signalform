// The stage: widgets (each one module on its own canvas) that can be layered, resized,
// grouped and combined freely; plus the compositor used by recording and live output.
import { byId, defaults } from './modules/index.js';
import { h, uid, toast } from './ui.js';
import { hexToRgb } from './modules/util.js';
import { FX_DEFAULTS, shapeFrame, post, isNeutralLook } from './fx.js';
import { fxEngine, normalizeRack, rackActive } from './rack.js';

export const BLENDS = {
  normal: { label: 'Normal', css: 'normal', canvas: 'source-over' },
  screen: { label: 'Screen', css: 'screen', canvas: 'screen' },
  add: { label: 'Add (light)', css: 'plus-lighter', canvas: 'lighter' },
  lighten: { label: 'Lighten', css: 'lighten', canvas: 'lighten' },
  overlay: { label: 'Overlay', css: 'overlay', canvas: 'overlay' },
  multiply: { label: 'Multiply', css: 'multiply', canvas: 'multiply' },
  difference: { label: 'Difference', css: 'difference', canvas: 'difference' }
};
export const TONES = { dark: '#0c0c0f', light: '#f1efe9' };
export const ASPECTS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '21:9': 21 / 9 };
const SNAP = 0.012;
const INK_FILTER = 'invert(1) hue-rotate(180deg)';

export function bgColor(bg) { return bg.tone === 'custom' ? bg.color : TONES[bg.tone] || TONES.dark; }
// On a light card, visuals are drawn as ink (inverted, multiplied) so they stay visible.
export function isInk(bg) {
  if (bg.mode === 'clear') return false;
  const [r, g, b] = hexToRgb(bgColor(bg));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
}

export class Stage {
  constructor(el, wrap, hooks) {
    this.el = el; this.wrap = wrap; this.hooks = hooks;
    this.scene = { name: 'Untitled', aspect: '16:9', widgets: [], groups: [], rack: [] };
    this.rt = new Map();
    this.masterState = {}; this.lastF = null; this.lastT = 0;
    this.sel = new Set();
    this.renderScale = 1;
    this.forceRender = new Set();
    this.px = { w: 1, h: 1 };
    this.tmp = document.createElement('canvas');
    this.tmpCtx = this.tmp.getContext('2d');
    new ResizeObserver(() => this.fit()).observe(wrap);
    el.addEventListener('pointerdown', (e) => { if (e.target === el) this.select(null); });
    // drop a module tile from the library onto the stage
    el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-module')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    el.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('text/x-module'); if (!id) return;
      e.preventDefault();
      const b = el.getBoundingClientRect();
      const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
      this.hooks.onDropModule(id, { x: clamp(x - 0.2, 0, 0.6), y: clamp(y - 0.2, 0, 0.6), w: 0.4, h: 0.4 });
    });
  }

  get widgets() { return this.scene.widgets; }
  get groups() { return this.scene.groups; }
  get(id) { return this.scene.widgets.find((w) => w.id === id); }
  group(id) { return this.scene.groups.find((g) => g.id === id); }
  members(gid) { return this.scene.widgets.filter((w) => w.group === gid); }
  get selected() { return this.sel.size === 1 ? [...this.sel][0] : null; }
  get selection() { return this.scene.widgets.filter((w) => this.sel.has(w.id)); }
  // a group counts as selected when all of its members are
  get selectedGroup() {
    const s = this.selection; if (!s.length || !s[0].group) return null;
    const g = s[0].group;
    return s.every((w) => w.group === g) && this.members(g).length === s.length ? this.group(g) : null;
  }

  fit() {
    const a = ASPECTS[this.scene.aspect] || 16 / 9;
    const perform = document.getElementById('app').classList.contains('perform');
    const pad = perform ? 0 : 32;
    const W = this.wrap.clientWidth - pad * 2, H = this.wrap.clientHeight - pad * 2;
    let w = W, hh = W / a;
    if (hh > H) { hh = H; w = H * a; }
    w = Math.max(64, Math.floor(w)); hh = Math.max(36, Math.floor(hh));
    this.el.style.width = w + 'px'; this.el.style.height = hh + 'px';
    this.px = { w, h: hh };
    for (const wd of this.scene.widgets) this.applyStyle(wd);
  }

  setAspect(a) { this.scene.aspect = a; this.fit(); this.changed(); }

  setScene(scene) {
    for (const id of [...this.rt.keys()]) this._destroy(id);
    this.sel.clear();
    this.scene = {
      name: scene.name || 'Untitled',
      aspect: ASPECTS[scene.aspect] ? scene.aspect : '16:9',
      widgets: [],
      groups: (scene.groups || []).map((g) => ({ id: g.id || uid(), name: g.name || 'Group' })),
      rack: normalizeRack(scene.rack)
    };
    this.masterState = {};
    this.fit();
    for (const w of scene.widgets || []) if (byId[w.module]) this._build(this._normalize(w));
    // drop groups that lost their members
    this.scene.groups = this.scene.groups.filter((g) => this.members(g.id).length > 0);
    const last = this.scene.widgets[this.scene.widgets.length - 1];
    this.select(last ? last.id : null);
    this.changed(true);
  }

  _normalize(w) {
    const mod = byId[w.module];
    const r = w.rect || {};
    const bg = w.bg || {};
    return {
      id: w.id && !this.get(w.id) ? w.id : uid(),
      module: w.module,
      name: w.name || mod.name,
      rect: { x: num(r.x, 0), y: num(r.y, 0), w: num(r.w, 1), h: num(r.h, 1) },
      opacity: num(w.opacity, 1),
      blend: BLENDS[w.blend] ? w.blend : 'screen',
      visible: w.visible !== false,
      locked: !!w.locked,
      group: w.group && this.group(w.group) ? w.group : null,
      bg: { mode: ['clear', 'solid', 'glass'].includes(bg.mode) ? bg.mode : 'clear', tone: ['dark', 'light', 'custom'].includes(bg.tone) ? bg.tone : 'dark', color: bg.color || '#1b2030' },
      radius: num(w.radius, 0),
      feather: num(w.feather, 0),
      rack: normalizeRack(w.rack),
      fx: Object.assign({}, FX_DEFAULTS, w.fx || {}),
      params: Object.assign(defaults(mod), w.params || {})
    };
  }

  add(moduleId, opts = {}) {
    const n = this.scene.widgets.length;
    const w = this._normalize({
      module: moduleId,
      rect: opts.rect || (n === 0 ? { x: 0, y: 0, w: 1, h: 1 } : { x: 0.12 + (n % 4) * 0.04, y: 0.12 + (n % 4) * 0.04, w: 0.56, h: 0.56 }),
      blend: opts.blend || (n === 0 ? 'normal' : 'screen'),
      bg: opts.bg || (n === 0 ? { mode: 'solid', tone: 'dark' } : { mode: 'clear', tone: 'dark' }),
      params: opts.params
    });
    this._build(w);
    this.select(w.id);
    this.changed(true);
    return w;
  }

  duplicate(ids) {
    const fresh = [];
    const gmap = {};
    for (const id of ids) {
      const src = this.get(id); if (!src) continue;
      const copy = JSON.parse(JSON.stringify(src));
      delete copy.id; copy.name = src.name + ' copy';
      if (src.group) { if (!gmap[src.group]) { const g = { id: uid(), name: this.group(src.group).name + ' copy' }; this.scene.groups.push(g); gmap[src.group] = g.id; } copy.group = gmap[src.group]; }
      copy.rect.x = Math.min(0.95, copy.rect.x + 0.03); copy.rect.y = Math.min(0.95, copy.rect.y + 0.03);
      const w = this._normalize(copy);
      this._build(w); fresh.push(w.id);
    }
    this.selectMany(fresh);
    this.changed(true);
  }

  remove(ids) {
    for (const id of [].concat(ids)) {
      this._destroy(id);
      this.scene.widgets = this.scene.widgets.filter((w) => w.id !== id);
      this.sel.delete(id);
    }
    this.scene.groups = this.scene.groups.filter((g) => this.members(g.id).length > 0);
    if (!this.sel.size) { const last = this.scene.widgets[this.scene.widgets.length - 1]; if (last) this.sel.add(last.id); }
    this._paintSel(); this.hooks.onSelect();
    this.changed(true);
  }

  // move widget(s) up/down the layer stack
  move(id, dir) {
    const list = this.scene.widgets, i = list.findIndex((w) => w.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this._zOrder(); this.changed(true);
  }
  // place widget `id` directly above (or below) widget `target` in the stack
  reorder(id, target, above) {
    if (id === target) return;
    const list = this.scene.widgets, w = this.get(id);
    list.splice(list.indexOf(w), 1);
    const t = list.findIndex((x) => x.id === target);
    list.splice(above ? t + 1 : t, 0, w);
    this._zOrder(); this.changed(true);
  }
  _zOrder() { this.scene.widgets.forEach((w, k) => { const r = this.rt.get(w.id); if (r) r.el.style.zIndex = k + 1; }); }

  groupSelection() {
    const s = this.selection; if (s.length < 2) return null;
    const g = { id: uid(), name: `Group ${this.scene.groups.length + 1}` };
    this.scene.groups.push(g);
    for (const w of s) w.group = g.id;
    // keep members adjacent in the stack, at the position of the topmost one
    const list = this.scene.widgets, top = Math.max(...s.map((w) => list.indexOf(w)));
    const rest = list.filter((w) => !this.sel.has(w.id));
    const above = list.slice(top + 1).filter((w) => !this.sel.has(w.id));
    this.scene.widgets = [...rest.filter((w) => !above.includes(w)), ...s, ...above];
    this.scene.groups = this.scene.groups.filter((x) => this.members(x.id).length > 0);
    this._zOrder(); this.hooks.onSelect(); this.changed(true);
    return g;
  }
  ungroup(gid) {
    for (const w of this.members(gid)) w.group = null;
    this.scene.groups = this.scene.groups.filter((g) => g.id !== gid);
    this.hooks.onSelect(); this.changed(true);
  }
  setGroup(id, gid) {
    const w = this.get(id); if (!w) return;
    w.group = gid;
    this.scene.groups = this.scene.groups.filter((g) => this.members(g.id).length > 0);
    this.changed(true);
  }

  select(id, additive = false) {
    if (!additive) this.sel.clear();
    if (id) { if (additive && this.sel.has(id)) this.sel.delete(id); else this.sel.add(id); }
    this._paintSel(); this.hooks.onSelect();
  }
  selectMany(ids) { this.sel = new Set(ids); this._paintSel(); this.hooks.onSelect(); }
  selectGroup(gid) { this.selectMany(this.members(gid).map((w) => w.id)); }
  _paintSel() {
    for (const [wid, r] of this.rt) { r.el.classList.toggle('sel', this.sel.has(wid)); r.el.classList.toggle('solo', this.sel.size === 1 && this.sel.has(wid)); }
    this._selBox();
  }
  _selBox() {
    let box = this.el.querySelector('.selbox');
    const s = this.selection.filter((w) => w.visible);
    if (s.length < 2) { if (box) box.remove(); return; }
    if (!box) { box = h('div', { class: 'selbox' }); this.el.append(box); }
    const b = bbox(s.map((w) => w.rect));
    Object.assign(box.style, { left: b.x * 100 + '%', top: b.y * 100 + '%', width: b.w * 100 + '%', height: b.h * 100 + '%' });
  }

  changed(structural = false) { this.hooks.onChange(structural); }

  applyStyle(w) {
    const r = this.rt.get(w.id); if (!r) return;
    const s = r.el.style;
    s.left = w.rect.x * 100 + '%'; s.top = w.rect.y * 100 + '%';
    s.width = w.rect.w * 100 + '%'; s.height = w.rect.h * 100 + '%';
    s.display = w.visible ? '' : 'none';
    s.mixBlendMode = BLENDS[w.blend].css;
    const rad = (w.radius / 1000) * this.px.w;
    const card = r.card.style, bg = r.bgEl.style, cv = r.canvas.style;
    card.borderRadius = rad + 'px';
    // feather: a soft alpha mask that fades the card out towards its edges and corners
    const fpx = (w.feather / 1000) * this.px.w, ew = w.rect.w * this.px.w, eh = w.rect.h * this.px.h;
    if (fpx > 0.5 && ew > 2 && eh > 2) {
      const k = Math.min(1, 220 / Math.max(ew, eh));
      const key = [Math.round(ew * k), Math.round(eh * k), Math.round(rad * k), Math.round(fpx * k * 2)].join('x');
      if (r.maskKey !== key) {
        r.maskKey = key;
        const url = `url(${featherMask(Math.round(ew * k), Math.round(eh * k), rad * k, fpx * k).toDataURL()})`;
        card.maskImage = card.webkitMaskImage = url;
        card.maskSize = card.webkitMaskSize = '100% 100%';
        card.maskRepeat = card.webkitMaskRepeat = 'no-repeat';
      }
    } else if (r.maskKey) { r.maskKey = ''; card.maskImage = card.webkitMaskImage = 'none'; }
    card.opacity = w.opacity;
    const mode = w.bg.mode, ink = isInk(w.bg);
    bg.display = mode === 'clear' ? 'none' : '';
    bg.background = mode === 'glass' ? hexA(bgColor(w.bg), ink ? 0.45 : 0.38) : bgColor(w.bg);
    bg.backdropFilter = mode === 'glass' ? 'blur(18px) saturate(1.25)' : 'none';
    r.card.classList.toggle('isolate', mode !== 'clear');
    cv.mixBlendMode = r.src.style.mixBlendMode = mode === 'clear' ? 'normal' : ink ? 'multiply' : 'screen';
    cv.filter = r.src.style.filter = ink ? INK_FILTER : 'none';
    r.el.classList.toggle('pinned', w.locked);
    r.el.querySelector('.label').textContent = w.name + (w.group ? '  ·  ' + (this.group(w.group)?.name || '') : '');
    r.el.dataset.name = byId[w.module].name;
    if (this.sel.has(w.id)) this._selBox();
  }

  _build(w, keepOrder = false) {
    const mod = byId[w.module];
    const canvas = h('canvas');
    const bgEl = h('div', { class: 'cardbg' });
    const card = h('div', { class: 'card' }, bgEl, canvas);
    const el = h('div', { class: 'widget', 'data-id': w.id },
      card, h('div', { class: 'chrome' }), h('div', { class: 'label' }, w.name),
      ...['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => h('div', { class: 'h ' + d, 'data-h': d })));
    // the module draws into `src`; with a neutral Look that canvas is shown directly (no copy per frame),
    // otherwise the Look pass draws it into `canvas`
    const src = document.createElement('canvas');
    src.style.display = 'none'; card.append(src);
    const r = { el, card, bgEl, canvas, src, dctx: canvas.getContext('2d'), fxState: {}, inst: null, size: [0, 0], failed: false, direct: false };
    r.out = () => (r.direct ? r.src : r.canvas);
    try { r.inst = mod.create(src, w.params); }
    catch (e) { console.error(e); r.failed = true; toast(`${mod.name} could not start: ${e.message}`, true); }
    this.rt.set(w.id, r);
    if (!keepOrder) this.scene.widgets.push(w);
    el.style.zIndex = this.scene.widgets.indexOf(w) + 1;
    this.el.append(el);
    this.applyStyle(w);
    this._wireDrag(w, r);
  }

  _destroy(id) {
    const r = this.rt.get(id); if (!r) return;
    try { r.inst && r.inst.dispose(); } catch {}
    r.el.remove();
    this.rt.delete(id);
  }

  _wireDrag(w, r) {
    const el = r.el;
    const toLocal = (e) => { const b = this.el.getBoundingClientRect(); return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height]; };
    el.addEventListener('dblclick', (e) => { e.stopPropagation(); this.select(w.id); }); // step into a group
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!this.sel.has(w.id)) { if (w.group) this.selectGroup(w.group); else this.select(w.id); }
      this.hooks.onContext && this.hooks.onContext(e.clientX, e.clientY);
    });
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || document.getElementById('app').classList.contains('perform')) return;
      if (r.inst && r.inst.capturing) {
        const b = el.getBoundingClientRect();
        el.setPointerCapture(e.pointerId);
        const send = (type, ev) => r.inst.pointer(type, (ev.clientX - b.left) / b.width, (ev.clientY - b.top) / b.height, w.params);
        send('down', e);
        const mv = (ev) => send('move', ev);
        const up = (ev) => { send('up', ev); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); this.changed(true); this.hooks.onSelect(); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
        e.stopPropagation(); return;
      }
      e.stopPropagation();
      const handle = e.target.dataset.h || '';
      // clicking a grouped widget selects its whole group (double-click to pick one)
      if (e.shiftKey || e.metaKey || e.ctrlKey) this.select(w.id, true);
      else if (!this.sel.has(w.id)) { if (w.group) this.selectGroup(w.group); else this.select(w.id); }
      const movers = this.selection.filter((x) => !x.locked);
      if (!movers.length || (handle && this.sel.size !== 1)) return;
      if (w.locked && !handle) return;
      const start = toLocal(e), r0 = movers.map((x) => ({ x, r: { ...x.rect } })), one = { ...w.rect };
      el.setPointerCapture(e.pointerId);
      let moved = false;
      const onMove = (ev) => {
        const [x, y] = toLocal(ev);
        let dx = x - start[0], dy = y - start[1];
        if (!moved && Math.hypot(dx * this.px.w, dy * this.px.h) < 3) return;
        moved = true;
        if (!handle) {
          // snap the moving selection as one block
          const b0 = bbox(r0.map((m) => m.r));
          const B = { x: b0.x + dx, y: b0.y + dy, w: b0.w, h: b0.h };
          if (!ev.altKey) this._snap(B, '', new Set(movers.map((m) => m.id)));
          dx = B.x - b0.x; dy = B.y - b0.y;
          for (const m of r0) { m.x.rect = { ...m.r, x: m.r.x + dx, y: m.r.y + dy }; this.applyStyle(m.x); }
        } else {
          const R = { ...one };
          if (handle.includes('w')) { R.x = Math.min(one.x + one.w - 0.03, one.x + dx); R.w = one.w + (one.x - R.x); }
          if (handle.includes('e')) R.w = Math.max(0.03, one.w + dx);
          if (handle.includes('n')) { R.y = Math.min(one.y + one.h - 0.03, one.y + dy); R.h = one.h + (one.y - R.y); }
          if (handle.includes('s')) R.h = Math.max(0.03, one.h + dy);
          if (ev.shiftKey && /[ns]/.test(handle) && /[ew]/.test(handle)) R.h = R.w * (one.h / one.w);
          if (!ev.altKey) this._snap(R, handle, new Set([w.id]));
          w.rect = R; this.applyStyle(w);
        }
        this._selBox();
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp);
        this._guides([]);
        if (moved) { for (const m of movers) { m.rect = roundRect(m.rect); this.applyStyle(m); } this.changed(); this.hooks.onSelect(); }
      };
      el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp);
    });
  }

  _snap(R, handle, skip) {
    const xs = [0, 0.5, 1], ys = [0, 0.5, 1];
    for (const o of this.scene.widgets) if (o.visible && !skip.has(o.id)) { xs.push(o.rect.x, o.rect.x + o.rect.w); ys.push(o.rect.y, o.rect.y + o.rect.h); }
    const guides = [];
    const snapAxis = (lo, size, lines, isX) => {
      let best = null;
      for (const [v, off] of [[lo, 0], [lo + size / 2, size / 2], [lo + size, size]]) for (const L of lines) { const d = Math.abs(v - L); if (d < SNAP && (!best || d < best.d)) best = { d, L, off }; }
      if (best) { guides.push([isX, best.L]); return best.L - best.off; }
      return lo;
    };
    if (!handle) { R.x = snapAxis(R.x, R.w, xs, true); R.y = snapAxis(R.y, R.h, ys, false); }
    else {
      const edge = (v, lines, isX) => { for (const L of lines) if (Math.abs(v - L) < SNAP) { guides.push([isX, L]); return L; } return v; };
      if (handle.includes('e')) R.w = edge(R.x + R.w, xs, true) - R.x;
      if (handle.includes('s')) R.h = edge(R.y + R.h, ys, false) - R.y;
      if (handle.includes('w')) { const nx = edge(R.x, xs, true); R.w += R.x - nx; R.x = nx; }
      if (handle.includes('n')) { const ny = edge(R.y, ys, false); R.h += R.y - ny; R.y = ny; }
    }
    this._guides(guides);
  }

  _guides(list) {
    this.el.querySelectorAll('.guide').forEach((g) => g.remove());
    for (const [isX, v] of list) this.el.append(h('div', { class: 'guide', style: isX ? { left: v * 100 + '%', top: 0, bottom: 0, width: '1px' } : { top: v * 100 + '%', left: 0, right: 0, height: '1px' } }));
  }

  /* ---------- arranging ---------- */
  setRect(w, R) { w.rect = roundRect(R); this.applyStyle(w); }
  fillStage(ids) { for (const id of ids) { const w = this.get(id); if (w) this.setRect(w, { x: 0, y: 0, w: 1, h: 1 }); } this.changed(); }
  align(ids, how) {
    const ws = ids.map((id) => this.get(id)).filter(Boolean);
    const b = ws.length > 1 ? bbox(ws.map((w) => w.rect)) : { x: 0, y: 0, w: 1, h: 1 };
    for (const w of ws) {
      const R = { ...w.rect };
      if (how === 'left') R.x = b.x; if (how === 'right') R.x = b.x + b.w - R.w; if (how === 'hcenter') R.x = b.x + (b.w - R.w) / 2;
      if (how === 'top') R.y = b.y; if (how === 'bottom') R.y = b.y + b.h - R.h; if (how === 'vcenter') R.y = b.y + (b.h - R.h) / 2;
      this.setRect(w, R);
    }
    this._selBox(); this.changed();
  }
  // lay the widgets out side by side, as separate cards with a gap
  arrangeRow(ids, gap = 0.012) {
    const ws = ids.map((id) => this.get(id)).filter(Boolean).sort((a, b) => a.rect.x - b.rect.x);
    const n = ws.length; if (!n) return;
    const m = 0.03, w = (1 - m * 2 - gap * (n - 1)) / n;
    ws.forEach((x, i) => this.setRect(x, { x: m + i * (w + gap), y: 0.08, w, h: 0.84 }));
    this._selBox(); this.changed();
  }
  arrangeGrid(ids, gap = 0.012) {
    const ws = ids.map((id) => this.get(id)).filter(Boolean);
    const n = ws.length; if (!n) return;
    const cols = Math.ceil(Math.sqrt(n * (this.px.w / this.px.h) / 1.6)), rows = Math.ceil(n / cols);
    const m = 0.02, w = (1 - m * 2 - gap * (cols - 1)) / cols, hh = (1 - m * 2 - gap * (rows - 1)) / rows;
    ws.forEach((x, i) => this.setRect(x, { x: m + (i % cols) * (w + gap), y: m + Math.floor(i / cols) * (hh + gap), w, h: hh }));
    this._selBox(); this.changed();
  }

  action(id, key) {
    const w = this.get(id), r = this.rt.get(id);
    // a module may finish later (e.g. after a file picker); `done` saves and refreshes the panel then
    if (w && r && r.inst && r.inst.action) { const msg = r.inst.action(key, w.params, () => this.changed(true)); this.changed(true); return msg; }
  }

  /* ---------- per-frame ---------- */
  render(F, dt, t) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const w of this.scene.widgets) {
      const r = this.rt.get(w.id);
      if (!r || !r.inst || r.failed) continue;
      if (!w.visible && !this.forceRender.has(w.id) && !this.forceRender.has('*') && !(w.group && this.forceRender.has(w.group))) continue;
      const S = dpr * this.renderScale;
      let cw = Math.max(16, Math.round(w.rect.w * this.px.w * S)), ch = Math.max(16, Math.round(w.rect.h * this.px.h * S));
      const cap = 3840 / Math.max(cw, ch); if (cap < 1) { cw = Math.round(cw * cap); ch = Math.round(ch * cap); }
      if (r.size[0] !== cw || r.size[1] !== ch) {
        r.src.width = r.canvas.width = cw; r.src.height = r.canvas.height = ch; r.size = [cw, ch];
        try { r.inst.resize(cw, ch, S); } catch {}
      }
      const fx = w.fx, st = r.fxState;
      const mdt = dt * fx.speed;
      st.t = (st.t ?? t) + mdt;
      try {
        const WF = shapeFrame(F, fx, st);
        r.inst.render(WF, { dt: mdt, t: st.t, W: cw, H: ch, S: Math.max(0.5, cw / Math.max(1, w.rect.w * this.px.w)), params: w.params });
        const look = !isNeutralLook(fx), E = rackActive(w.rack) ? fxEngine() : null;
        const neutral = !look && !E;
        if (neutral !== r.direct) { r.direct = neutral; r.src.style.display = neutral ? '' : 'none'; r.canvas.style.display = neutral ? 'none' : ''; }
        if (look) post(r.canvas, r.dctx, r.src, fx, st, dt);
        // the widget's effect rack runs after its Look
        if (E) E.run(look ? r.canvas : r.src, r.dctx, cw, ch, w.rack, r.rackState || (r.rackState = {}), WF, st.t);
      } catch (e) { console.error(e); r.failed = true; toast(`${w.name} stopped: ${e.message}`, true); }
    }
    this.lastF = F; this.lastT = t;
    try { this._master(dpr); } catch (e) { console.error(e); }
  }

  // Source: 'stage', a widget id, or a group id.
  sourceRect(source) {
    if (source === 'stage') return { x: 0, y: 0, w: 1, h: 1 };
    const w = this.get(source); if (w) return w.rect;
    const ms = this.members(source); if (ms.length) return bbox(ms.map((m) => m.rect));
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  sourceLabel(source) {
    if (source === 'stage') return 'Whole stage';
    const w = this.get(source); if (w) return w.name;
    const g = this.group(source); return g ? g.name : 'Whole stage';
  }

  // Composite a source into a 2D context of any size, matching what the stage shows.
  compose(ctx, W, H, source = 'stage') {
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.filter = 'none';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const single = this.get(source);
    const list = single ? [single] : source === 'stage' ? this.scene.widgets : this.members(source);
    const area = this.sourceRect(source);
    const sx = W / area.w, sy = H / area.h;
    for (const w of list) {
      const r = this.rt.get(w.id);
      if ((!w.visible && !single) || !r || !r.inst || !r.size[0]) continue;
      const x = (w.rect.x - area.x) * sx, y = (w.rect.y - area.y) * sy, cw = Math.max(1, Math.round(w.rect.w * sx)), ch = Math.max(1, Math.round(w.rect.h * sy));
      const t = this.tmp, tc = this.tmpCtx;
      if (t.width !== cw || t.height !== ch) { t.width = cw; t.height = ch; } else tc.clearRect(0, 0, cw, ch);
      const mode = w.bg.mode, ink = isInk(w.bg);
      if (mode === 'glass') {
        tc.filter = `blur(${Math.round(18 * (W / this.px.w))}px) saturate(1.25)`;
        tc.drawImage(ctx.canvas, x, y, cw, ch, 0, 0, cw, ch);
        tc.filter = 'none';
        tc.fillStyle = hexA(bgColor(w.bg), ink ? 0.45 : 0.38); tc.fillRect(0, 0, cw, ch);
      } else if (mode === 'solid') { tc.fillStyle = bgColor(w.bg); tc.fillRect(0, 0, cw, ch); }
      tc.globalCompositeOperation = mode === 'clear' ? 'source-over' : ink ? 'multiply' : 'screen';
      if (ink) tc.filter = INK_FILTER;
      tc.drawImage(r.out(), 0, 0, cw, ch);
      tc.filter = 'none';
      const radPx = (w.radius / 1000) * (W / area.w);
      const featherPx = (w.feather / 1000) * (W / area.w);
      if (featherPx > 0.5) { tc.globalCompositeOperation = 'destination-in'; tc.drawImage(featherMask(cw, ch, radPx, featherPx), 0, 0); }
      else if (radPx > 0.5) { tc.globalCompositeOperation = 'destination-in'; tc.fillStyle = '#000'; tc.beginPath(); tc.roundRect(0, 0, cw, ch, radPx); tc.fill(); }
      tc.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = w.opacity;
      ctx.globalCompositeOperation = single ? 'source-over' : BLENDS[w.blend].canvas;
      ctx.drawImage(t, x, y);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // the stage's own effect rack applies to the whole picture
    if (source === 'stage' && rackActive(this.scene.rack) && this.lastF) {
      const E = fxEngine();
      if (E) { const k = W + 'x' + H, st = this.masterState[k] || (this.masterState[k] = {}); E.run(ctx.canvas, ctx, W, H, this.scene.rack, st, this.lastF, this.lastT); }
    }
  }

  // With effects on the stage rack, the stage is shown as one composited picture on an overlay
  // (the widgets keep their frames and handles for editing on top of it).
  _master(dpr) {
    const on = rackActive(this.scene.rack) && !!fxEngine();
    this.el.classList.toggle('mastered', on);
    if (!on) { if (this.masterCv) this.masterCv.style.display = 'none'; return; }
    if (!this.masterCv) {
      this.masterCv = h('canvas', { class: 'master-out' });
      this.masterCtx = this.masterCv.getContext('2d');
      this.el.prepend(this.masterCv);
    }
    const S = dpr * this.renderScale, W = Math.max(16, Math.round(this.px.w * S)), H = Math.max(16, Math.round(this.px.h * S));
    if (this.masterCv.width !== W || this.masterCv.height !== H) { this.masterCv.width = W; this.masterCv.height = H; }
    this.masterCv.style.display = '';
    this.compose(this.masterCtx, W, H, 'stage');
  }

  // Output size for a source at a target height, keeping its aspect ratio (even numbers for encoders).
  sizeFor(source, height) {
    const R = this.sourceRect(source);
    const a = (R.w * this.px.w) / Math.max(1, R.h * this.px.h);
    let H = height, W = Math.round(H * a);
    if (a < 1) { W = height; H = Math.round(W / a); }
    return [Math.max(2, W & ~1), Math.max(2, H & ~1)];
  }

  serialize() {
    return {
      app: 'signalform', version: 2, name: this.scene.name, aspect: this.scene.aspect,
      groups: this.scene.groups.map((g) => ({ id: g.id, name: g.name })),
      widgets: this.scene.widgets.map((w) => ({ module: w.module, name: w.name, rect: w.rect, opacity: w.opacity, blend: w.blend, visible: w.visible, locked: w.locked, group: w.group, bg: w.bg, radius: w.radius, feather: w.feather, rack: w.rack, fx: w.fx, params: w.params })),
      rack: this.scene.rack
    };
  }
}

export function bbox(rects) {
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
// A white rounded rectangle whose edges fade to transparent over `f` pixels, for masking a card.
// The shape is inset by the feather width and blurred, so the fade ends exactly at the card's border.
const maskCache = new Map();
function featherMask(w, h, rad, f) {
  const key = [w, h, Math.round(rad), Math.round(f * 2)].join('x');
  let c = maskCache.get(key);
  if (c) return c;
  c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h);
  const g = c.getContext('2d');
  const inset = Math.min(f, w / 2 - 1, h / 2 - 1);
  g.filter = `blur(${Math.max(0.5, inset / 2)}px)`;
  g.fillStyle = '#fff';
  g.beginPath(); g.roundRect(inset, inset, Math.max(1, w - inset * 2), Math.max(1, h - inset * 2), Math.max(0, rad - inset / 2)); g.fill();
  if (maskCache.size > 40) maskCache.delete(maskCache.keys().next().value);
  maskCache.set(key, c);
  return c;
}
function hexA(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function roundRect(r) { const f = (v) => Math.round(v * 10000) / 10000; return { x: f(r.x), y: f(r.y), w: f(r.w), h: f(r.h) }; }
