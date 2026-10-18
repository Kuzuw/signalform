// Runs the EffectCraft scripts Signalform makes against a small mock of the After Effects object model
// (which EffectCraft implements): the analysis export and the Signalform Audio Link panel.
//   node test/effectcraft-scripts.mjs
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { analysisScript } from '../renderer/effectcraft.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let problems = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) problems++; };

function makeHost() {
  class Property { constructor(name) { this.name = name; this.expression = ''; this.keys = []; } setValuesAtTimes(t, v) { this.keys = t.map((x, i) => [x, v[i]]); } setValue(v) { this.value = v; } }
  class Effect {
    constructor(matchName, name, props) { this.matchName = matchName; this.name = name; this.props = props.map((p) => new Property(p)); }
    property(k) { return typeof k === 'number' ? this.props[k - 1] : this.props.find((p) => p.name === k) || null; }
    get numProperties() { return this.props.length; }
  }
  class Parade {
    constructor() { this.list = []; }
    addProperty(mn) { const e = new Effect(mn, 'Slider Control', ['Slider']); this.list.push(e); return e; }
    property(i) { return this.list[i - 1]; }
    get numProperties() { return this.list.length; }
  }
  class Layer {
    constructor(name) { this.name = name; this.parade = new Parade(); this.enabled = true; }
    property(k) { return k === 'ADBE Effect Parade' ? this.parade : null; }
    remove() { comp._layers.splice(comp._layers.indexOf(this), 1); }
  }
  class CompItem {
    constructor() { this._layers = []; this.duration = 10; this.frameDuration = 1 / 30; this.selectedLayers = []; this.layers = { addNull: (d) => { const l = new Layer('Null 1'); l.duration = d; this._layers.unshift(l); return l; } }; }
    get numLayers() { return this._layers.length; }
    layer(i) { return this._layers[i - 1]; }
  }
  const comp = new CompItem();
  // a solid with a Signalform Tunnel on it
  const solid = new Layer('Tunnel solid');
  solid.parade.list.push(new Effect('org.signalform.tunnel', 'Signalform Tunnel', ['Walls', 'Audio: Level', 'Audio: Bass', 'Audio: Mids', 'Audio: Highs', 'Audio: Kick', 'Audio: Drop']));
  comp._layers.push(solid);
  const undo = [];
  const ctx = {
    CompItem, Panel: function Panel() {}, comp, solid, undo,
    app: { project: { activeItem: comp }, beginUndoGroup: (n) => undo.push(n), endUndoGroup: () => {} },
    alert: (m) => { throw new Error('alert: ' + m); }, writeLn: () => {}
  };
  return ctx;
}

// 1. the analysis export
{
  const n = 90, frames = {};
  for (const k of ['level', 'bass', 'mid', 'high', 'kick', 'snare', 'hat', 'build', 'drop']) frames[k] = Float32Array.from({ length: n }, (_, i) => (Math.sin(i / 7) + 1) / 2);
  const code = analysisScript({ fps: 30, duration: 3, frames, name: 'Test "track"' }, '2.1.0');
  const H = makeHost();
  vm.runInNewContext(code, H);
  const nul = H.comp._layers.find((l) => l.name === 'Signalform Audio');
  check(!!nul, 'adds a "Signalform Audio" null');
  check(nul && nul.parade.list.length === 9, 'with nine sliders');
  check(nul && nul.parade.list.every((e) => e.props[0].keys.length === n), `each keyframed ${n} times`);
  check(nul && nul.parade.list.map((e) => e.name).join(',') === 'Level,Bass,Mids,Highs,Kick,Snare,Hi-hat,Build,Drop', 'named Level … Drop');
  check(nul && Math.max(...nul.parade.list[0].props[0].keys.map((k) => k[1])) <= 100, 'values within 0–100 %');
  const eff = H.solid.parade.list[0];
  check(eff.property('Audio: Bass').expression === 'thisComp.layer("Signalform Audio").effect("Bass")("Slider")', 'links the Tunnel\'s Audio: Bass slider');
  check(eff.property('Walls').expression === '', 'leaves its other settings alone');
  check(H.undo.length === 1, 'in one undo step');
  // running it again replaces the null instead of adding a second one
  vm.runInNewContext(code, H);
  check(H.comp._layers.filter((l) => l.name === 'Signalform Audio').length === 1, 'running it again replaces the null');
}

// 2. the Signalform Audio Link panel, against Convert Audio to Keyframes' "Audio Amplitude" null
{
  const code = fs.readFileSync(path.join(root, 'plugins/effectcraft/scripts/Signalform Audio Link.jsx'), 'utf8');
  const H = makeHost();
  const amp = { name: 'Audio Amplitude', property: () => null };
  H.comp._layers.push(amp);
  H.comp.selectedLayers = [H.solid];
  const buttons = {};
  class Ctl { constructor(type, text) { this.type = type; this.text = text; } }
  class Win {
    constructor() { this.children = []; this.layout = { layout() {} }; }
    add(type, b, text) { const c = new Ctl(type, text); this.children.push(c); if (type === 'button') buttons[text] = c; return c; }
    center() {} show() {}
  }
  H.Window = Win;
  vm.runInNewContext(code, H);
  buttons['Link selected layers'].onClick();
  const eff = H.solid.parade.list[0];
  check(/Audio Amplitude/.test(eff.property('Audio: Level').expression), 'Link panel: links to Audio Amplitude when there is no Signalform Audio');
  check(/valueAtTime/.test(eff.property('Audio: Kick').expression), 'Link panel: takes the kick from how fast the loudness rises');
  buttons['Unlink selected layers'].onClick();
  check(eff.property('Audio: Level').expression === '', 'Link panel: unlinks');
  // expressions must at least parse as JavaScript
  buttons['Link selected layers'].onClick();
  let ok = true;
  for (const p of eff.props) if (p.expression) try { new Function('thisComp', 'time', 'clamp', p.expression); } catch { ok = false; }
  check(ok, 'Link panel: every expression parses');
}

console.log(problems ? `${problems} problem(s)` : 'problems: none');
process.exitCode = problems ? 1 : 0;
