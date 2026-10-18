// A stand-in for EffectCraft's plug-in host (crates/plugin in storytold/effectcraft), following its
// plug-in API v1 contract exactly: a module with no imports; exports memory, ec_api_version,
// ec_manifest_ptr/len, ec_alloc and ec_render; one buffer per render holding the parameters (f64)
// then the pixels (f32 premultiplied RGBA); the manifest validated by the same rules.
//   node test/host.mjs                 checks every dist/*.wasm (and compares with the native build)
//   node test/host.mjs file.wasm W H T out.raw [params…]   renders one frame
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(here, '..', 'dist'), build = path.join(here, '..', 'build');

// EffectCraft's PluginManifest::validate, in JavaScript
function validate(m) {
  const err = (s) => { throw new Error(s); };
  if (m.api !== 1) err(`targets plug-in API ${m.api}, host implements 1`);
  if (!/^[A-Za-z0-9._-]+$/.test(m.id || '') || m.id.startsWith('ec.')) err(`bad id ${m.id}`);
  if (!String(m.name || '').trim() || !String(m.category || '').trim()) err('needs a name and a category');
  if ((m.params || []).length > 256) err('too many parameters');
  const seen = new Set();
  for (const p of m.params || []) {
    if (!/^[A-Za-z0-9_]+$/.test(p.id || '') || seen.has(p.id)) err(`bad or duplicate parameter id ${p.id}`);
    seen.add(p.id);
    if (!['slider', 'angle', 'checkbox', 'popup', 'point', 'color'].includes(p.type)) err(`unknown parameter type ${p.type}`);
    if (p.type === 'popup' && (!p.options || !p.options.length || (p.default || 0) >= p.options.length)) err(`popup ${p.id} needs options and a default in range`);
    if (p.type === 'slider') {
      const min = p.min ?? 0, max = p.max ?? 100, lo = p.sliderMin ?? min, hi = p.sliderMax ?? max;
      if (![p.default, min, max, lo, hi].every(Number.isFinite) || min > max || lo > hi || p.default < min || p.default > max) err(`slider ${p.id} needs min ≤ default ≤ max`);
    }
  }
}
const width = (p) => (p.type === 'point' ? 2 : p.type === 'color' ? 4 : 1);
function defaults(m, W, H) {
  const out = [];
  for (const p of m.params) {
    if (p.type === 'point') { const d = p.default || [0.5, 0.5]; out.push(d[0] * W, d[1] * H); }
    else if (p.type === 'color') out.push(...(p.default || [1, 1, 1, 1]));
    else if (p.type === 'checkbox') out.push(p.default ? 1 : 0);
    else out.push(p.default ?? 0);
  }
  return out;
}

export async function load(file) {
  const bytes = fs.readFileSync(file);
  const mod = await WebAssembly.compile(bytes);
  const imports = WebAssembly.Module.imports(mod);
  if (imports.length) throw new Error(`has imports (${imports.map((i) => i.module + '.' + i.name).join(', ')}); plug-ins may not import anything`);
  const ex = new Set(WebAssembly.Module.exports(mod).map((e) => e.name));
  for (const n of ['memory', 'ec_api_version', 'ec_manifest_ptr', 'ec_manifest_len', 'ec_alloc', 'ec_render']) if (!ex.has(n)) throw new Error(`missing export ${n}`);
  const inst = await WebAssembly.instantiate(mod, {});
  const e = inst.exports;
  if (e.ec_api_version() !== 1) throw new Error('ec_api_version is not 1');
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer, e.ec_manifest_ptr(), e.ec_manifest_len())));
  validate(manifest);
  const flatLen = manifest.params.reduce((s, p) => s + width(p), 0);
  function render(W, H, t, params, pixels, scale = 1) {
    if (params.length !== flatLen) throw new Error(`expected ${flatLen} parameter values, got ${params.length}`);
    const pb = flatLen * 8, bytesN = pb + W * H * 16;
    const ptr = e.ec_alloc(bytesN);
    if (!ptr || ptr % 8) throw new Error('ec_alloc returned an unusable buffer');
    new Float64Array(e.memory.buffer, ptr, flatLen).set(params);
    const px = new Float32Array(e.memory.buffer, ptr + pb, W * H * 4);
    if (pixels) px.set(pixels); else px.fill(0);
    const rc = e.ec_render(ptr + pb, W, H, ptr, flatLen, t, scale);
    if (rc !== 0) throw new Error(`ec_render returned ${rc}`);
    return new Float32Array(e.memory.buffer, ptr + pb, W * H * 4).slice();   // memory may have grown: view it afresh
  }
  return { manifest, render, flatLen };
}

async function checkAll() {
  const files = fs.readdirSync(dist).filter((f) => f.endsWith('.wasm')).sort();
  let bad = 0;
  for (const f of files) {
    const name = f.replace(/^signalform-|\.wasm$/g, '');
    try {
      const P = await load(path.join(dist, f));
      const W = 320, H = 180, t = 1.7;
      const params = defaults(P.manifest, W, H);
      // an image to work on, for the effects that process the layer
      const input = new Float32Array(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; input[i] = x / W; input[i + 1] = y / H; input[i + 2] = ((x >> 4) + (y >> 4)) & 1; input[i + 3] = 1; }
      const t0 = performance.now();
      const out = P.render(W, H, t, params, input);
      const ms = performance.now() - t0;
      let finite = true, lit = 0;
      for (let i = 0; i < out.length; i += 4) { if (!out.slice(i, i + 4).every(Number.isFinite)) finite = false; if (out[i] + out[i + 1] + out[i + 2] > 0.01) lit++; }
      if (!finite) throw new Error('rendered NaN or infinity');
      if (lit < W * H * 0.02) throw new Error('rendered an (almost) empty frame');
      // the WebAssembly build must match the native one
      let diff = 0;
      const exe = path.join(build, name);
      if (fs.existsSync(exe)) {
        const tmp = fs.mkdtempSync('/tmp/sfhost-'), inF = path.join(tmp, 'in.raw'), outF = path.join(tmp, 'out.raw');
        fs.writeFileSync(inF, Buffer.from(input.buffer));
        execFileSync(exe, [String(W), String(H), String(t), '1', inF, outF, ...params.map(String)], { stdio: 'pipe' });
        const nat = new Float32Array(fs.readFileSync(outF).buffer.slice(0));
        for (let i = 0; i < out.length; i++) diff = Math.max(diff, Math.abs(out[i] - nat[i]));
        fs.rmSync(tmp, { recursive: true });
      }
      if (diff > 0.02) throw new Error(`differs from the native build by up to ${diff.toFixed(4)}`);
      console.log(`ok   ${f.padEnd(28)} ${P.manifest.name.padEnd(28)} ${String(P.manifest.params.length).padStart(2)} params  ${ms.toFixed(0).padStart(4)} ms (320×180, V8)  native diff ${diff.toFixed(5)}`);
    } catch (e) { bad++; console.log(`FAIL ${f}: ${e.message}`); }
  }
  console.log(bad ? `${bad} plug-in(s) failed` : `problems: none (${files.length} plug-ins)`);
  process.exitCode = bad ? 1 : 0;
}

if (process.argv[2]) {
  const [file, W, H, t, out, ...ps] = process.argv.slice(2);
  const P = await load(file);
  const params = ps.length ? ps.map(Number) : defaults(P.manifest, +W, +H);
  fs.writeFileSync(out, Buffer.from(P.render(+W, +H, +t, params).buffer));
} else await checkAll();
