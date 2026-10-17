// Right-hand panel: settings for the selection, presets, backgrounds, and the layer tree.
import { byId, defaults } from './modules/index.js';
import { BLENDS, TONES } from './stage.js';
import { FX_PARAMS, FX_DEFAULTS } from './fx.js';
import { h, icon, toast } from './ui.js';
import { hexToRgb } from './modules/util.js';
import * as lib from './library.js';

const SWATCHES = ['#ffffff', '#e8eeff', '#ffd166', '#ff8a3d', '#ff5c8a', '#b28dff', '#5ab8ff', '#7fe3d6', '#8dffb0'];

// One-click color schemes: bright colors go to light/main color settings, the dark one to shadows and tints.
export const PALETTES = [
  { name: 'Phosphor', colors: ['#e8fff1', '#8dffb0', '#3ddc97', '#7fe3d6'], dark: '#0c2a1d' },
  { name: 'Ember', colors: ['#fff1d6', '#ffb547', '#ff6b35', '#ff4d6d'], dark: '#2a0d08' },
  { name: 'Ice', colors: ['#f2fbff', '#9ad9ff', '#4f8bff', '#8f7bff'], dark: '#0a1430' },
  { name: 'Neon', colors: ['#ffffff', '#ff4fd8', '#00e5ff', '#b4ff39'], dark: '#1a0a2a' },
  { name: 'Sunset', colors: ['#ffe3b3', '#ff8f6b', '#e5508f', '#8b5cf6'], dark: '#240b24' },
  { name: 'Gold', colors: ['#fff6d5', '#ffd166', '#e0a526', '#ffe9a8'], dark: '#2a1c04' },
  { name: 'Pastel', colors: ['#ffffff', '#ffc6e0', '#b8e1ff', '#c8f7c5'], dark: '#22202e' },
  { name: 'Mono', colors: ['#ffffff', '#d7d9df', '#a3a7b1', '#eef0f4'], dark: '#202227' }
];
export function applyPalette(mod, params, pal) {
  let i = 0;
  for (const p of mod.params) {
    if (p.type !== 'color') continue;
    if (/shadow|tint|dark/i.test(p.key + ' ' + p.label)) params[p.key] = pal.dark;
    else params[p.key] = pal.colors[i++ % pal.colors.length];
  }
}

export class Inspector {
  constructor(el, stage, hooks) {
    this.el = el; this.stage = stage; this.hooks = hooks;
    this.lastPreset = '';
  }

  render() {
    const st = this.stage;
    const keepScroll = this.el.scrollTop;
    this.el.innerHTML = '';
    const sel = st.selection;
    if (sel.length === 1) this.el.append(...this.single(sel[0]));
    else if (sel.length > 1) this.el.append(...this.multi(sel));
    else this.el.append(h('section', { class: 'sec' }, h('p', { class: 'note' }, 'Select a widget to edit it. Shift-click to select several, then group, align or arrange them.')));
    this.el.append(this.layers());
    this.el.scrollTop = keepScroll;
  }

  /* ---------- one widget: Module · Look · Audio ---------- */
  single(w) {
    const mod = byId[w.module];
    const changed = () => this.stage.changed();
    const tab = this.tab || 'module';
    const head = h('section', { class: 'sec head' },
      h('div', { class: 'title-row' },
        h('input', { class: 'name', id: 'wName', type: 'text', value: w.name, 'aria-label': 'Widget name', onchange: (e) => { w.name = e.target.value.trim() || mod.name; this.stage.applyStyle(w); this.stage.changed(true); } }),
        h('button', { class: 'icon-btn', type: 'button', title: w.locked ? 'Unlock position' : 'Lock position', 'aria-pressed': String(w.locked), html: icon.lock, onclick: () => { w.locked = !w.locked; this.stage.applyStyle(w); this.stage.changed(true); } }),
        h('button', { class: 'icon-btn', type: 'button', title: 'Duplicate (Ctrl+D)', html: icon.copy, onclick: () => this.stage.duplicate([w.id]) }),
        h('button', { class: 'icon-btn danger', type: 'button', title: 'Remove widget (Delete)', html: icon.close, onclick: () => this.stage.remove(w.id) })),
      h('small', { class: 'muted' }, `${mod.name} · ${mod.tagline}`),
      h('div', { class: 'tabs', role: 'tablist' }, ...[['module', 'Module'], ['look', 'Look'], ['audio', 'Audio']].map(([k, l]) =>
        h('button', { type: 'button', role: 'tab', class: k === tab ? 'on' : '', 'aria-selected': String(k === tab), id: 'tab-' + k, onclick: () => { this.tab = k; this.render(); } }, l,
          k === 'look' && !lookIsDefault(w) ? h('i', { class: 'dotmark', title: 'Changed' }) : '',
          k === 'audio' && !audioIsDefault(w) ? h('i', { class: 'dotmark', title: 'Changed' }) : ''))));

    if (tab === 'look') {
      return [head, this.backgroundSec([w]), ...this.schemaSections(w.fx, FX_PARAMS.look, w.id + ':look'),
        h('section', { class: 'sec' }, h('button', { class: 'btn wide ghost', type: 'button', onclick: () => { for (const p of FX_PARAMS.look) w.fx[p.key] = FX_DEFAULTS[p.key]; changed(); this.render(); toast('Look reset'); } }, 'Reset look'))];
    }
    if (tab === 'audio') {
      return [head, h('section', { class: 'sec' }, h('p', { class: 'note' }, 'How this widget hears the music. Each widget can react to a different part of the mix.')),
        ...this.schemaSections(w.fx, FX_PARAMS.audio, w.id + ':audio'),
        h('section', { class: 'sec' }, h('button', { class: 'btn wide ghost', type: 'button', onclick: () => { for (const p of FX_PARAMS.audio) w.fx[p.key] = FX_DEFAULTS[p.key]; changed(); this.render(); toast('Audio settings reset'); } }, 'Reset audio'))];
    }

    // Module tab
    const actions = h('section', { class: 'sec' },
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', id: 'randomize', onclick: () => { randomize(mod, w.params); changed(); this.render(); toast('Randomized'); } }, h('span', { class: 'ico', html: icon.dice }), 'Randomize'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { Object.assign(w.params, defaults(mod)); this.lastPreset = ''; changed(); this.render(); toast('Back to defaults'); } }, 'Reset to defaults')),
      mod.params.some((p) => p.type === 'color') ? h('div', { class: 'palettes' }, ...PALETTES.map((pal) =>
        h('button', { type: 'button', class: 'pal', title: pal.name + ' colors', onclick: () => { applyPalette(mod, w.params, pal); changed(); this.render(); toast(pal.name + ' colors'); } },
          h('span', { class: 'sw' }, ...[pal.dark, ...pal.colors.slice(0, 3)].map((c) => h('i', { style: { background: c } }))), h('small', {}, pal.name)))) : '');

    const presets = lib.presetsFor(w.module);
    const nameIn = h('input', { type: 'text', id: 'presetName', placeholder: 'Preset name', value: this.lastPreset });
    const pick = h('select', { id: 'presetSel', class: 'chev', title: 'Apply a preset', 'aria-label': 'Apply a preset' },
      h('option', { value: '' }, '▾'), ...presets.map((p) => h('option', { value: p.name }, p.name)));
    pick.onchange = () => {
      const p = presets.find((x) => x.name === pick.value); if (!p) return;
      for (const k of Object.keys(w.params)) if (k in p.params) w.params[k] = JSON.parse(JSON.stringify(p.params[k]));
      if (p.fx) Object.assign(w.fx, p.fx);
      this.lastPreset = p.name; changed(); this.render(); toast(`Preset “${p.name}” applied`);
    };
    const presetSec = h('section', { class: 'sec' }, h('h3', {}, 'Presets', h('span', { class: 'count' }, presets.length ? String(presets.length) : '')),
      h('div', { class: 'preset-row' }, nameIn,
        h('button', { class: 'btn', type: 'button', id: 'presetSave', onclick: async () => {
          const n = nameIn.value.trim(); if (!n) { nameIn.focus(); return toast('Type a name for the preset.'); }
          await lib.savePreset(w.module, n, w.params, w.fx); this.lastPreset = n; this.render(); toast(`Preset “${n}” saved`);
        } }, 'Save'),
        h('button', { class: 'icon-btn boxed', type: 'button', title: 'Delete this preset', html: icon.close, onclick: async () => {
          const n = nameIn.value.trim() || this.lastPreset; if (!presets.some((p) => p.name === n)) return toast(presets.length ? 'Apply a preset with ▾ first, then press × to delete it.' : 'No saved presets yet.');
          await lib.deletePreset(w.module, n); this.lastPreset = ''; this.render(); toast(`Preset “${n}” deleted`);
        } }),
        pick),
      h('p', { class: 'note' }, 'Presets keep this module’s settings plus its Look and Audio.'));
    return [head, actions, ...this.schemaSections(w.params, mod.params, w.id + ':mod', w.id), presetSec];
  }

  // Build collapsible sections from a parameter list acting on `target`.
  schemaSections(target, list, key, widgetId) {
    const out = [];
    this.collapsed = this.collapsed || new Set();
    let cur = null, title = 'Settings', n = 0;
    const flush = () => { if (cur && n) out.push(cur); };
    const start = (t) => {
      flush(); title = t; n = 0;
      const ck = key + ':' + t, closed = this.collapsed.has(ck);
      cur = h('section', { class: 'sec' + (closed ? ' closed' : '') },
        h('button', { class: 'sec-toggle', type: 'button', 'aria-expanded': String(!closed), onclick: () => { closed ? this.collapsed.delete(ck) : this.collapsed.add(ck); this.render(); } },
          h('h3', {}, t), h('span', { class: 'chev', html: icon.chevron })));
      cur._closed = closed;
    };
    start('Settings');
    for (const p of list) {
      if (p.type === 'hidden') continue;
      if (p.section) start(p.section);
      if (p.showIf && !Object.entries(p.showIf).every(([k, v]) => (Array.isArray(v) ? v.includes(target[k]) : target[k] === v))) continue;
      n++;
      if (!cur._closed) cur.append(this.control(target, list, p, false, widgetId));
    }
    flush();
    return out;
  }

  /* ---------- several widgets / a group ---------- */
  multi(ws) {
    const st = this.stage, ids = ws.map((w) => w.id);
    const g = st.selectedGroup;
    const head = h('section', { class: 'sec head' },
      g ? h('div', { class: 'title-row' },
        h('input', { class: 'name', type: 'text', value: g.name, 'aria-label': 'Group name', onchange: (e) => { g.name = e.target.value.trim() || 'Group'; ws.forEach((w) => st.applyStyle(w)); st.changed(true); } }),
        h('button', { class: 'icon-btn danger', type: 'button', title: 'Remove these widgets', html: icon.close, onclick: () => st.remove(ids) }))
        : h('div', { class: 'title-row' }, h('b', { class: 'name static' }, `${ws.length} widgets selected`), h('button', { class: 'icon-btn danger', type: 'button', title: 'Remove these widgets', html: icon.close, onclick: () => st.remove(ids) })),
      h('small', { class: 'muted' }, g ? `Group of ${ws.length}. Moves, records and streams as one source. Double-click a widget to edit it alone.` : 'Move them together, or group them to keep them together.'),
      h('div', { class: 'row' },
        g ? h('button', { class: 'btn', type: 'button', onclick: () => st.ungroup(g.id) }, 'Ungroup')
          : h('button', { class: 'btn primary', type: 'button', id: 'groupBtn', onclick: () => { const ng = st.groupSelection(); if (ng) toast(`${ng.name} created`); } }, 'Group'),
        h('button', { class: 'btn', type: 'button', onclick: () => st.duplicate(ids) }, 'Duplicate')));

    const arrange = h('section', { class: 'sec' }, h('h3', {}, 'Arrange'),
      h('div', { class: 'seg six' }, ...[['left', 'Left'], ['hcenter', 'Center'], ['right', 'Right'], ['top', 'Top'], ['vcenter', 'Middle'], ['bottom', 'Bottom']].map(([k, l]) =>
        h('button', { type: 'button', title: 'Align ' + l.toLowerCase(), onclick: () => st.align(ids, k) }, l))),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', id: 'rowBtn', onclick: () => st.arrangeRow(ids) }, 'Side by side'),
        h('button', { class: 'btn', type: 'button', onclick: () => st.arrangeGrid(ids) }, 'Grid'),
        h('button', { class: 'btn', type: 'button', onclick: () => st.fillStage(ids) }, 'Stack full')));
    return [head, arrange, this.backgroundSec(ws)];
  }

  /* ---------- background + layer ---------- */
  backgroundSec(ws) {
    const w = ws[0], st = this.stage;
    const apply = (fn) => { for (const x of ws) { fn(x); st.applyStyle(x); } st.changed(); this.render(); };
    const seg = (items, isOn, onPick) => h('div', { class: 'seg' }, ...items.map(([k, label]) =>
      h('button', { type: 'button', class: isOn(k) ? 'on' : '', 'aria-pressed': String(isOn(k)), onclick: () => onPick(k) }, label)));
    const custom = h('input', { type: 'color', id: 'bgColor', value: w.bg.tone === 'custom' ? w.bg.color : TONES[w.bg.tone] || TONES.dark, title: 'Custom background color',
      oninput: (e) => { for (const x of ws) { x.bg.tone = 'custom'; x.bg.color = e.target.value; if (x.bg.mode === 'clear') x.bg.mode = 'solid'; st.applyStyle(x); } st.changed(); },
      onchange: () => this.render() });
    return h('section', { class: 'sec' }, h('h3', {}, 'Background'),
      seg([['glass', 'Glass'], ['solid', 'Solid']], (k) => w.bg.mode === k, (k) => apply((x) => { x.bg.mode = k; })),
      h('div', { class: 'row tight' },
        seg([['dark', 'Dark'], ['light', 'Light'], ['clear', 'Clear']], (k) => (k === 'clear' ? w.bg.mode === 'clear' : w.bg.mode !== 'clear' && w.bg.tone === k),
          (k) => apply((x) => { if (k === 'clear') x.bg.mode = 'clear'; else { x.bg.tone = k; if (x.bg.mode === 'clear') x.bg.mode = 'solid'; } })),
        h('label', { class: 'swatch-pick' + (w.bg.tone === 'custom' && w.bg.mode !== 'clear' ? ' on' : ''), title: 'Custom color', style: { background: w.bg.tone === 'custom' ? w.bg.color : TONES.dark } }, custom)),
      h('p', { class: 'note' }, w.bg.mode === 'clear' ? 'Clear: the visual floats over the layers below it.' : w.bg.mode === 'glass' ? 'Glass: blurs whatever is behind the card.' : 'Solid: the widget is its own card.'),
      this.rangeField('Corner radius', 'radius', w.radius, 0, 60, 1, (v) => { for (const x of ws) { x.radius = v; st.applyStyle(x); } st.changed(); }, (v) => Math.round(v) + ''),
      this.rangeField('Edge feather', 'feather', w.feather || 0, 0, 120, 1, (v) => { for (const x of ws) { x.feather = v; st.applyStyle(x); } st.changed(); }, (v) => (v < 0.5 ? 'Off' : Math.round(v) + ''), false, 0),
      this.rangeField('Opacity', 'opacity', w.opacity, 0, 1, 0.01, (v) => { for (const x of ws) { x.opacity = v; st.applyStyle(x); } st.changed(); }, (v) => Math.round(v * 100) + '%'),
      this.field('Blend with layers below', 'blend', h('select', { id: 'f_blend', onchange: (e) => apply((x) => { x.blend = e.target.value; }) },
        ...Object.entries(BLENDS).map(([k, b]) => h('option', { value: k, selected: k === w.blend }, b.label)))),
      ws.length === 1 ? h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => st.fillStage([w.id]) }, 'Fill stage'),
        h('button', { class: 'btn', type: 'button', onclick: () => st.duplicate([w.id]) }, 'Duplicate')) : '');
  }

  control(T, list, p, disabled, widgetId) {
    const set = (v, rerender) => { T[p.key] = v; this.stage.changed(); if (rerender) this.render(); };
    const needsRerender = list.some((q) => q.showIf && p.key in q.showIf);
    const id = 'p_' + p.key;
    const def = p.default ?? FX_DEFAULTS[p.key];
    if (p.type === 'range') {
      const dec = p.step >= 1 ? 0 : p.step >= 0.1 ? 1 : 2;
      const fmt = p.pct || (p.max === 1 && p.min === 0 && /amount|follow|corner|shadow|sensitiv/i.test(p.label)) ? (v) => Math.round(v * 100) + '%'
        : p.unit ? (v) => Number(v).toFixed(dec) + p.unit : (v) => Number(v).toFixed(dec);
      return this.rangeField(p.label, p.key, T[p.key], p.min, p.max, p.step, (v) => set(v), fmt, disabled, def);
    }
    if (p.type === 'select') {
      return this.field(p.label, p.key, h('select', { id, disabled, onchange: (e) => set(e.target.value, needsRerender) },
        ...p.options.map(([v, l]) => h('option', { value: v, selected: String(T[p.key]) === String(v) }, l))));
    }
    if (p.type === 'color') {
      const cur = String(T[p.key]).toLowerCase();
      const picker = h('input', { type: 'color', id, value: T[p.key], disabled, oninput: (e) => { set(e.target.value); paint(e.target.value); } });
      const dots = SWATCHES.map((c) => h('button', { type: 'button', class: 'dot' + (c === cur ? ' on' : ''), style: { background: c }, title: c, disabled, onclick: () => { set(c); picker.value = c; paint(c); } }));
      const custom = h('label', { class: 'dot custom' + (SWATCHES.includes(cur) ? '' : ' on'), title: 'Custom color', style: { background: SWATCHES.includes(cur) ? '' : cur } }, picker);
      const paint = (c) => { dots.forEach((d) => d.classList.toggle('on', d.title === c)); custom.classList.toggle('on', !SWATCHES.includes(c)); if (!SWATCHES.includes(c)) custom.style.background = c; };
      return h('div', { class: 'field color' }, h('label', { for: id }, p.label), h('div', { class: 'swatches' }, ...dots, custom));
    }
    if (p.type === 'toggle') {
      return h('div', { class: 'field inline' }, h('label', { for: id }, p.label),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', id, checked: !!T[p.key], disabled, onchange: (e) => set(e.target.checked, needsRerender) }), h('i')));
    }
    if (p.type === 'text') return this.field(p.label, p.key, h('input', { type: 'text', id, value: T[p.key] ?? '', disabled, spellcheck: 'false', oninput: (e) => set(e.target.value) }));
    if (p.type === 'action') return h('button', { class: 'btn wide', type: 'button', disabled, onclick: () => { const msg = this.stage.action(widgetId, p.key); if (typeof msg === 'string') toast(msg); } }, p.label);
    return h('div');
  }

  field(label, key, control) {
    control.id = control.id || 'f_' + key;
    return h('div', { class: 'field' }, h('label', { for: control.id }, label), control);
  }

  rangeField(label, key, value, min, max, step, onInput, fmt, disabled, def) {
    const id = 'r_' + key;
    const out = h('output', { for: id, title: 'Click to type a value', tabindex: '0' }, fmt(value));
    const input = h('input', { type: 'range', id, min, max, step, value, disabled });
    const paint = () => input.style.setProperty('--p', (((input.value - min) / (max - min)) * 100).toFixed(1) + '%');
    input.addEventListener('input', () => { const v = Number(input.value); out.textContent = fmt(v); paint(); onInput(v); });
    // click the number to type an exact value
    const edit = () => {
      if (disabled) return;
      const box = h('input', { type: 'number', class: 'num', value: input.value, step, min, max });
      out.replaceWith(box); box.focus(); box.select();
      const done = (commit) => {
        if (commit && box.value !== '') { const v = Math.min(max, Math.max(min, Number(box.value))); input.value = v; out.textContent = fmt(v); paint(); onInput(Number(input.value)); }
        box.replaceWith(out);
      };
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
      box.addEventListener('blur', () => done(true), { once: true });
    };
    out.addEventListener('click', edit);
    out.addEventListener('keydown', (e) => { if (e.key === 'Enter') edit(); });
    input.addEventListener('dblclick', () => { if (def == null) return; input.value = def; input.dispatchEvent(new Event('input')); });
    paint();
    return h('div', { class: 'field', title: def != null ? 'Double-click to reset' : null }, h('label', { for: id }, label), out, input);
  }

  /* ---------- layers: groups and widgets, drag to reorder ---------- */
  layers() {
    const st = this.stage;
    const list = h('ul', { class: 'layers', id: 'layerList' });
    const ws = [...st.widgets].reverse(); // top first
    const seen = new Set();
    let dragId = null;
    const row = (w, nested) => {
      const li = h('li', { class: 'layer' + (st.sel.has(w.id) ? ' sel' : '') + (w.visible ? '' : ' off') + (nested ? ' nested' : ''), draggable: 'true', 'data-id': w.id,
        onclick: (e) => st.select(w.id, e.shiftKey || e.metaKey || e.ctrlKey) },
        h('button', { class: 'icon-btn', type: 'button', title: w.visible ? 'Hide' : 'Show', html: w.visible ? icon.eye : icon.eyeOff, onclick: (e) => { e.stopPropagation(); w.visible = !w.visible; st.applyStyle(w); st.changed(true); } }),
        h('canvas', { class: 'lthumb', width: 48, height: 27, 'data-thumb': w.id }),
        h('span', { class: 'nm' }, w.name, h('small', {}, byId[w.module].name)),
        w.locked ? h('span', { class: 'pin', html: icon.lock, title: 'Position locked' }) : h('span'));
      li.addEventListener('dragstart', (e) => { dragId = w.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-layer', w.id); li.classList.add('dragging'); });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      li.addEventListener('dragover', (e) => { if (!dragId || dragId === w.id) return; e.preventDefault(); const b = li.getBoundingClientRect(); li.classList.toggle('drop-above', e.clientY < b.top + b.height / 2); li.classList.toggle('drop-below', e.clientY >= b.top + b.height / 2); });
      li.addEventListener('dragleave', () => li.classList.remove('drop-above', 'drop-below'));
      li.addEventListener('drop', (e) => {
        e.preventDefault(); li.classList.remove('drop-above', 'drop-below');
        if (!dragId || dragId === w.id) return;
        const b = li.getBoundingClientRect(), upper = e.clientY < b.top + b.height / 2;
        st.reorder(dragId, w.id, upper); // the list is top-first, so "upper" means above in the stack
        st.setGroup(dragId, w.group);
      });
      return li;
    };
    for (const w of ws) {
      if (seen.has(w.id)) continue;
      if (w.group) {
        const g = st.group(w.group), ms = ws.filter((x) => x.group === w.group);
        ms.forEach((m) => seen.add(m.id));
        const allSel = ms.every((m) => st.sel.has(m.id));
        list.append(h('li', { class: 'layer group' + (allSel ? ' sel' : ''), onclick: () => st.selectGroup(g.id) },
          h('span', { class: 'gicon', html: icon.group }), h('span', { class: 'nm' }, g.name, h('small', {}, `${ms.length} widgets`)),
          h('button', { class: 'icon-btn', type: 'button', title: 'Ungroup', html: icon.close, onclick: (e) => { e.stopPropagation(); st.ungroup(g.id); } })));
        ms.forEach((m) => list.append(row(m, true)));
      } else { seen.add(w.id); list.append(row(w, false)); }
    }
    return h('section', { class: 'sec layers-sec' }, h('h3', {}, `Layers · ${st.widgets.length}`),
      st.widgets.length ? list : h('p', { class: 'note' }, 'No widgets yet. Click or drag a module onto the stage.'),
      st.widgets.length ? h('p', { class: 'note' }, 'Drag to reorder. Top of the list is drawn on top.') : '');
  }
}

function lookIsDefault(w) { return FX_PARAMS.look.every((p) => w.fx[p.key] === FX_DEFAULTS[p.key]); }
function audioIsDefault(w) { return FX_PARAMS.audio.every((p) => w.fx[p.key] === FX_DEFAULTS[p.key]); }

/* ---------- randomize: stay near musical defaults, keep colors in harmony ---------- */
export function randomize(mod, params) {
  const baseHue = Math.random() * 360;
  let ci = 0;
  for (const p of mod.params) {
    if (p.type === 'range') {
      if (/count|points|iter|detail|samples|layers/i.test(p.key)) continue; // keep the cost the same
      const span = (p.max - p.min) * 0.45;
      let v = p.default + (Math.random() - 0.5) * span;
      v = Math.min(p.max, Math.max(p.min, v));
      params[p.key] = Math.round(v / p.step) * p.step;
      params[p.key] = +params[p.key].toFixed(4);
    } else if (p.type === 'select' && !/source|shape|form|mode|structure|react|body|curve|display/i.test(p.key + p.label)) {
      params[p.key] = p.options[(Math.random() * p.options.length) | 0][0];
    } else if (p.type === 'color') {
      const [r, g, b] = hexToRgb(p.default);
      const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
      params[p.key] = hslHex(baseHue + ci * (40 + Math.random() * 90), l > 0.85 ? 30 : 75, Math.min(92, Math.max(18, l * 100)));
      ci++;
    }
  }
}
function hslHex(hh, s, l) {
  s /= 100; l /= 100; hh = ((hh % 360) + 360) % 360;
  const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return '#' + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
