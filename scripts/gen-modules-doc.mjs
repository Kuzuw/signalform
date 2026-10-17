// Writes docs/MODULES.md from the modules' own parameter schemas, so the reference never drifts.
//   npm run docs:modules
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { MODULES } = await import(pathToFileURL(path.join(root, 'renderer/modules/index.js')));
const { FX_PARAMS, FX_DEFAULTS } = await import(pathToFileURL(path.join(root, 'renderer/fx.js')));
const { EFFECTS, EFFECT_CATS, MOD_SOURCES } = await import(pathToFileURL(path.join(root, 'renderer/rack.js')));

const esc = (s) => String(s).replace(/\|/g, '\\|');
const num = (v) => (typeof v === 'number' ? +v.toFixed(3) : v);

function range(p) {
  switch (p.type) {
    case 'range': {
      if (p.pct) return `${Math.round(p.min * 100)}–${Math.round(p.max * 100)} %`;
      return `${num(p.min)} – ${num(p.max)}${p.unit ? ' ' + p.unit : ''}`;
    }
    case 'select': return p.options.map(([, label]) => label).join(' · ');
    case 'toggle': return 'on / off';
    case 'color': return 'color';
    case 'text': return 'text';
    case 'action': return 'button';
    default: return '';
  }
}

function fmtDefault(p, v) {
  if (p.type === 'action') return '';
  if (v === undefined) return '';
  if (p.type === 'toggle') return v ? 'on' : 'off';
  if (p.type === 'select') { const o = p.options.find(([k]) => String(k) === String(v)); return o ? o[1] : String(v); }
  if (p.type === 'color') return `\`${v}\``;
  if (p.type === 'text') return v === '' ? '' : `\`${v}\``;
  if (p.pct) return `${Math.round(v * 100)} %`;
  return `${num(v)}${p.unit ? ' ' + p.unit : ''}`;
}

function when(p, all) {
  if (!p.showIf) return '';
  return Object.entries(p.showIf).map(([k, v]) => {
    const dep = all.find((q) => q.key === k);
    const vals = [].concat(v).map((x) => (dep && dep.type === 'select' ? (dep.options.find(([o]) => String(o) === String(x)) || [0, x])[1] : x));
    const name = dep ? dep.label : k;
    if (dep && dep.type === 'range') return `${name} ≥ ${Math.min(...vals)}`;
    return `${name}: ${vals.join(' / ')}`;
  }).join(', ');
}

function table(params, defaults) {
  const rows = ['| Section | Control | Range / options | Default |', '|---|---|---|---|'];
  let section = 'Settings', shown = '';
  for (const p of params) {
    if (p.type === 'hidden') continue;
    if (p.section) section = p.section;
    const head = section !== shown ? `**${esc(section)}**` : '';
    shown = section;
    const cond = when(p, params);
    const label = esc(p.label) + (cond ? `<br><sub>shown when ${esc(cond)}</sub>` : '');
    rows.push(`| ${head} | ${label} | ${esc(range(p))} | ${esc(fmtDefault(p, defaults ? defaults[p.key] : p.default))} |`);
  }
  return rows.join('\n');
}

const out = [];
out.push('# Module reference', '');
out.push('> Generated from the code by `npm run docs:modules`. Do not edit by hand.', '');
out.push(`Signalform ships with ${MODULES.length} modules. Every widget also has the shared [Look](#look-every-widget), [Audio](#audio-every-widget) and [Effects](#effects-every-widget-and-the-stage) controls, whatever its module.`, '');
out.push(MODULES.map((m) => `[${m.name}](#${m.name.toLowerCase().replace(/\s+/g, '-')})`).join(' · '), '');
for (const m of MODULES) {
  out.push(`## ${m.name}`, '');
  out.push(`<img src="images/modules/${m.id}.jpg" width="420" alt="${m.name}">`, '');
  out.push(`*${m.tagline.replace(/\.$/, '')}.*`, '');
  out.push(table(m.params), '');
}
out.push('## Look (every widget)', '', 'A post pass over the module\'s picture.', '', table(FX_PARAMS.look, FX_DEFAULTS), '');
out.push('## Audio (every widget)', '', 'How this widget hears the music. Two widgets can react to the same track differently.', '', table(FX_PARAMS.audio, FX_DEFAULTS), '');

out.push('## Effects (every widget, and the stage)', '', `The Effects tab holds an ordered rack of effects; with nothing selected, the inspector shows the stage's own rack, which applies to the whole picture, recordings and Live Output. Every effect except Mirror has a main setting the music can drive (${MOD_SOURCES.slice(1).map((m) => m[1]).join(', ')}), with an amount from −100% to 100%.`, '');
for (const c of EFFECT_CATS) {
  for (const [, E] of Object.entries(EFFECTS).filter(([, e]) => e.cat === c)) {
    const main = E.params.find((q) => q.key === E.main);
    out.push(`### ${E.name}`, '', `*${c}.*${main ? ` The music drives **${main.label.toLowerCase()}**.` : ''}`, '', table(E.params), '');
  }
}
const file = path.join(root, 'docs/MODULES.md');
fs.writeFileSync(file, out.join('\n'));
console.log('wrote', path.relative(root, file));
