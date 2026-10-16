// Presets (per module) and scenes (whole layouts), stored as JSON in the app's user folder.
import { uid } from './ui.js';

let presets = null; // { [moduleId]: [{ name, params }] }
let scenes = null;  // [{ id, name, savedAt, scene }]

export async function load() {
  presets = (await window.sf.store.get('presets')) || {};
  scenes = (await window.sf.store.get('scenes')) || [];
}

export function presetsFor(mod) { return presets[mod] || []; }
export async function savePreset(mod, name, params, fx) {
  const list = presets[mod] = presets[mod] || [];
  const i = list.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  const entry = { name, params: JSON.parse(JSON.stringify(params)), fx: fx ? JSON.parse(JSON.stringify(fx)) : undefined };
  if (i >= 0) list[i] = entry; else list.push(entry);
  await window.sf.store.set('presets', presets);
}
export async function deletePreset(mod, name) {
  presets[mod] = (presets[mod] || []).filter((p) => p.name !== name);
  await window.sf.store.set('presets', presets);
}

export function savedScenes() { return scenes; }
export async function saveScene(scene) {
  const copy = JSON.parse(JSON.stringify(scene));
  const i = scenes.findIndex((s) => s.name.toLowerCase() === copy.name.toLowerCase());
  const entry = { id: i >= 0 ? scenes[i].id : uid(), name: copy.name, savedAt: Date.now(), scene: copy };
  if (i >= 0) scenes[i] = entry; else scenes.unshift(entry);
  await window.sf.store.set('scenes', scenes);
}
export async function deleteScene(id) {
  scenes = scenes.filter((s) => s.id !== id);
  await window.sf.store.set('scenes', scenes);
}

const W = (module, rect, extra = {}) => ({ module, rect, opacity: 1, blend: 'screen', visible: true, bg: { mode: 'clear', tone: 'dark' }, radius: 0, params: {}, ...extra });
const BASE = { blend: 'normal', bg: { mode: 'solid', tone: 'dark' } };
export const STARTERS = [
  {
    name: 'Phosphor Room',
    note: 'Oscilloscope drawing a shape over a field of glyphs.',
    scene: { aspect: '16:9', widgets: [
      W('ascii', { x: 0, y: 0, w: 1, h: 1 }, { ...BASE, opacity: 0.55, params: { source: 'field', colorA: '#3a4a3f', colorB: '#8dffb0', cell: 11 } }),
      W('oscilloscope', { x: 0.2, y: 0.05, w: 0.6, h: 0.9 }, { params: { mode: 'shape', shape: 'star' } })
    ] }
  },
  {
    name: 'Three Cards',
    note: 'Three modules side by side as rounded cards, grouped as one source.',
    scene: { aspect: '16:9', groups: [{ id: 'g1', name: 'Cards' }], widgets: [
      W('waveform', { x: 0.03, y: 0.1, w: 0.3, h: 0.8 }, { ...BASE, group: 'g1', radius: 18, params: { mode: 'mirror', colorMode: 'single', color: '#ffffff', layers: 8 } }),
      W('flowfield', { x: 0.35, y: 0.1, w: 0.3, h: 0.8 }, { ...BASE, group: 'g1', radius: 18, params: { colorMode: 'mono', colorA: '#d99a3c', colorB: '#d99a3c', count: 2500 } }),
      W('familiar', { x: 0.67, y: 0.1, w: 0.3, h: 0.8 }, { ...BASE, group: 'g1', radius: 18, params: { shape: 'orb', count: 20000 } })
    ] }
  },
  {
    name: 'Storm Shell',
    note: 'Lightning on a plate with a phosphor shell floating over it.',
    scene: { aspect: '16:9', widgets: [
      W('discharge', { x: 0, y: 0, w: 1, h: 1 }, BASE),
      W('oscillon', { x: 0.25, y: 0.05, w: 0.5, h: 0.9 }, { params: { form: 'auto' } })
    ] }
  },
  {
    name: 'Long Exposure',
    note: 'A pen of light behind a creature made of points, on a glass card.',
    scene: { aspect: '16:9', widgets: [
      W('stroke', { x: 0, y: 0, w: 1, h: 1 }, BASE),
      W('familiar', { x: 0.58, y: 0.12, w: 0.36, h: 0.76 }, { bg: { mode: 'glass', tone: 'dark' }, blend: 'normal', radius: 24 })
    ] }
  },
  {
    name: 'Magnetic',
    note: 'A pool of ferrofluid with spectral layers glowing along the floor.',
    scene: { aspect: '16:9', widgets: [
      W('ferro', { x: 0, y: 0, w: 1, h: 1 }, BASE),
      W('spectre', { x: 0, y: 0.72, w: 1, h: 0.28 }, { opacity: 0.8, params: { mode: 'layers', mirror: false } })
    ] }
  },
  {
    name: 'Paper',
    note: 'Light cards: visuals print as ink on paper.',
    scene: { aspect: '1:1', widgets: [
      W('oscillon', { x: 0.06, y: 0.06, w: 0.88, h: 0.88 }, { blend: 'normal', bg: { mode: 'solid', tone: 'light' }, radius: 28 })
    ] }
  },
  {
    name: 'Vertical Story',
    note: '9:16 for phone video: grain texture, a trace line and lissajous.',
    scene: { aspect: '9:16', widgets: [
      W('grain', { x: 0, y: 0, w: 1, h: 1 }, { ...BASE, opacity: 0.8 }),
      W('lissajous', { x: 0, y: 0.18, w: 1, h: 0.5 }),
      W('trace', { x: 0, y: 0.7, w: 1, h: 0.25 })
    ] }
  },
  {
    name: 'Hyperspace',
    note: 'A tunnel flight with rings of light thrown out by every hit.',
    scene: { aspect: '16:9', widgets: [
      W('tunnel', { x: 0, y: 0, w: 1, h: 1 }, { ...BASE, params: { style: 'warp' } }),
      W('halo', { x: 0.2, y: 0, w: 0.6, h: 1 }, { params: { core: 0, trails: 0.4 } })
    ] }
  },
  {
    name: 'Sunset Run',
    note: 'A landscape grown from the spectrum, rolling towards a setting sun.',
    scene: { aspect: '16:9', widgets: [
      W('horizon', { x: 0, y: 0, w: 1, h: 1 }, BASE)
    ] }
  },
  {
    name: 'Stained Glass',
    note: 'Cells of colored glass behind strings strung across a circle.',
    scene: { aspect: '16:9', widgets: [
      W('cells', { x: 0, y: 0, w: 1, h: 1 }, { ...BASE, opacity: 0.7, params: { style: 'mosaic' } }),
      W('strings', { x: 0.2, y: 0, w: 0.6, h: 1 }, { params: { layout: 'star', count: 18, colorLow: '#ffffff', colorHigh: '#ffe2b0' } })
    ] }
  }
];
