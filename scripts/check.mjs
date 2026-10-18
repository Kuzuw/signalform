// Static checks run by CI and `npm test`:
//   1. every source file parses;
//   2. every module, Look/Audio setting, effect, monitor preset and starter scene is well formed.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

// ---- 1. syntax
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, f.name);
  if (f.isDirectory()) { if (!['node_modules', '_tmp', '_tiles', '_frames', 'dist'].includes(f.name)) walk(p); }
  else if (/\.(m?js)$/.test(f.name)) files.push(p);
} };
for (const d of ['main', 'renderer', 'scripts', 'test']) walk(path.join(root, d));
for (const f of files) {
  // renderer files are ES modules; parse them strictly as such (a plain --check misses some errors in them)
  const esm = f.includes(path.sep + 'renderer' + path.sep) && f.endsWith('.js');
  const r = spawnSync(process.execPath, ['--no-warnings', ...(esm ? ['--experimental-default-type=module'] : []), '--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail(path.relative(root, f), (r.stderr || '').trim().split('\n').slice(0, 4).join(' | '));
}

// ---- 2. schemas
const imp = (p) => import(pathToFileURL(path.join(root, p)));
const { MODULES } = await imp('renderer/modules/index.js');
const { FX_PARAMS, FX_DEFAULTS } = await imp('renderer/fx.js');
const { EFFECTS, EFFECT_CATS } = await imp('renderer/rack.js');
const { CRT_PRESETS } = await imp('renderer/crt.js');
const { STARTERS } = await imp('renderer/library.js');

const TYPES = new Set(['range', 'select', 'toggle', 'color', 'text', 'action', 'hidden']);
function checkParams(where, params, defaults) {
  const keys = new Set();
  for (const p of params) {
    const w = `${where} › ${p.key}`;
    if (!p.key) { fail(where, 'a parameter has no key'); continue; }
    if (keys.has(p.key)) fail(w, 'duplicate key');
    keys.add(p.key);
    if (!TYPES.has(p.type)) fail(w, `unknown type "${p.type}"`);
    if (p.type !== 'hidden' && !p.label) fail(w, 'no label');
    const d = defaults ? defaults[p.key] : p.default;
    if (p.type === 'range') {
      if (!(p.min < p.max)) fail(w, 'min must be below max');
      if (!(p.step > 0)) fail(w, 'step must be positive');
      if (typeof d !== 'number' || d < p.min - 1e-9 || d > p.max + 1e-9) fail(w, `default ${d} outside ${p.min}…${p.max}`);
    }
    if (p.type === 'select') {
      if (!Array.isArray(p.options) || !p.options.length) fail(w, 'no options');
      else if (!p.options.some(([v]) => String(v) === String(d))) fail(w, `default "${d}" is not an option`);
    }
    if (p.type === 'toggle' && typeof d !== 'boolean') fail(w, 'toggle default must be true or false');
    if (p.type === 'color' && !/^#[0-9a-f]{6}$/i.test(d)) fail(w, `colour default "${d}" is not #rrggbb`);
  }
  for (const p of params) if (p.showIf) for (const k of Object.keys(p.showIf)) if (!keys.has(k)) fail(`${where} › ${p.key}`, `showIf refers to unknown "${k}"`);
  return keys;
}

const ids = new Set();
for (const m of MODULES) {
  const w = `module ${m.id}`;
  if (!m.id || !m.name || !m.tagline) fail(w, 'needs id, name and tagline');
  if (ids.has(m.id)) fail(w, 'duplicate id');
  ids.add(m.id);
  if (typeof m.create !== 'function') fail(w, 'no create()');
  checkParams(w, m.params);
}
checkParams('Look', FX_PARAMS.look, FX_DEFAULTS);
checkParams('Audio', FX_PARAMS.audio, FX_DEFAULTS);

for (const [k, E] of Object.entries(EFFECTS)) {
  const w = `effect ${k}`;
  if (!E.name || !EFFECT_CATS.includes(E.cat)) fail(w, 'needs a name and a known category');
  if (!E.frag && typeof E.run !== 'function') fail(w, 'needs frag or run()');
  const keys = checkParams(w, E.params);
  if (E.main !== 'none' && !keys.has(E.main)) fail(w, `main "${E.main}" is not a parameter`);
}
const crt = EFFECTS.crt;
for (const [name, pr] of Object.entries(CRT_PRESETS)) for (const [k, v] of Object.entries(pr)) {
  const q = crt.params.find((x) => x.key === k), w = `CRT preset ${name} › ${k}`;
  if (!q) { fail(w, 'not a CRT parameter'); continue; }
  if (q.type === 'range' && (v < q.min || v > q.max)) fail(w, `${v} outside ${q.min}…${q.max}`);
  if (q.type === 'select' && !q.options.some(([o]) => o === v)) fail(w, `"${v}" is not an option`);
}

for (const s of STARTERS) {
  const w = `starter "${s.name}"`;
  for (const wd of s.scene.widgets) if (!ids.has(wd.module)) fail(w, `unknown module "${wd.module}"`);
  for (const it of s.scene.rack || []) if (!EFFECTS[it.type]) fail(w, `unknown effect "${it.type}"`);
}

console.log(`checked ${files.length} files, ${MODULES.length} modules, ${Object.keys(EFFECTS).length} effects, ${STARTERS.length} starter scenes`);
if (problems.length) { console.error(problems.map((p) => '  ✗ ' + p).join('\n')); process.exit(1); }
console.log('problems: none');
