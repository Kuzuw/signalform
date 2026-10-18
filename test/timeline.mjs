// Drives the timeline in headless Chromium (browser shim instead of Electron): keyframes from the
// inspector's ◆ buttons, interpolation, in and out points, the transport, saving, and a timeline render.
//   node test/timeline.mjs [screenshot dir]
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = process.argv[2] || '/tmp';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/renderer/index.html`;
const browser = await pw.chromium.launch({
  executablePath: process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined),
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 }, acceptDownloads: true, bypassCSP: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
let problems = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) problems++; };
const shot = (n) => page.screenshot({ path: path.join(outDir, n + '.png') });
const ev = (fn, arg) => page.evaluate(fn, arg);

await page.goto(base);
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 }).catch(() => { console.log('BOOT FAILED', errors); process.exit(1); });
await ev(() => { const a = window.signalform; a.loadScene({ name: 'Timeline test', widgets: [] }, true); a.audio.useDemo(); });
await page.click('.tile[data-mod="tunnel"]'); await page.waitForTimeout(400);
await page.click('.tile[data-mod="aura"]'); await page.waitForTimeout(400);
check(await page.isVisible('#timeline .tl-body'), 'the timeline is open under the stage');
check((await page.$$('#timeline .tl-lane .tl-clip')).length === 2, 'one layer bar per layer');

// keyframe a module setting with its ◆ button
await page.click('#tab-module');
const path0 = await page.getAttribute('#inspector .field:has(> input[type=range]) .kf[data-path^="params."] >> nth=0', 'data-path');
const key = path0.slice(7);
const range = await ev((k) => !!document.getElementById('r_' + k), key);
check(range, `first keyframable setting is a slider (${path0})`);
const spec = await ev((k) => { const s = window.signalform.stage, w = s.get(s.selected); return { min: +document.getElementById('r_' + k).min, max: +document.getElementById('r_' + k).max, v: w.params[k] }; }, key);
await ev(() => window.signalform.timeline.seek(0));
await page.click(`#inspector .kf[data-path="${path0}"]`);
const k1 = await ev((p) => { const s = window.signalform.stage, w = s.get(s.selected); return window.signalform.timeline.keys(w, p); }, path0);
check(k1 && k1.length === 1 && k1[0].t === 0, '◆ adds a key at the playhead');
check(await page.$eval(`#inspector .kf[data-path="${path0}"]`, (b) => b.classList.contains('on')), '◆ shows it is on a key');

// move the playhead and change the value: a second key
await ev(() => window.signalform.timeline.seek(4));
check(!(await page.$eval(`#inspector .kf[data-path="${path0}"]`, (b) => b.classList.contains('on'))), 'between keys the ◆ is outlined');
const target = spec.v === spec.max ? spec.min : spec.max;
await ev(([k, v]) => { const r = document.getElementById('r_' + k); r.value = v; r.dispatchEvent(new Event('input')); }, [key, target]);
const k2 = await ev((p) => { const s = window.signalform.stage; return window.signalform.timeline.keys(s.get(s.selected), p); }, path0);
check(k2.length === 2 && Math.abs(k2[1].t - 4) < 0.01 && k2[1].v === target, 'changing an animated setting keys it at the playhead');

// in between, the value is interpolated, and the inspector shows it
await ev(() => window.signalform.timeline.seek(2));
await page.waitForTimeout(200);
const mid = await ev((k) => { const s = window.signalform.stage; return s.get(s.selected).params[k]; }, key);
const want = (spec.v + target) / 2;
check(Math.abs(mid - want) <= Math.max(1, Math.abs(target - spec.v) * 0.02), `halfway the value is halfway (${mid} ≈ ${want})`);
const shown = await ev((k) => +document.getElementById('r_' + k).value, key);
check(Math.abs(shown - mid) <= Math.max(1e-6, Math.abs(target - spec.v) * 0.02), 'the inspector slider follows the playhead');

// the layer's row opens to show its animated setting
const subs = await page.$$('#timeline .tl-lane.sub .tl-key.edit');
check(subs.length === 2, 'the animated setting has its own row with two keys');

// ease: right-click a key, choose Hold
await page.click('#timeline .tl-lane.sub .tl-key.edit >> nth=0', { button: 'right' });
await page.locator('#tlMenu button', { hasText: 'Hold' }).click();
const e1 = await ev((p) => { const s = window.signalform.stage; return window.signalform.timeline.keys(s.get(s.selected), p)[0].e; }, path0);
check(e1 === 'h', 'a key can be set to Hold');
await ev(() => window.signalform.timeline.seek(3));
const held = await ev((k) => { const s = window.signalform.stage; return s.get(s.selected).params[k]; }, key);
check(held === spec.v, 'after a Hold key the value stays until the next key');

// drag a key later
const kb = await (await page.$('#timeline .tl-lane.sub .tl-key.edit >> nth=1')).boundingBox();
await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2); await page.mouse.down();
await page.mouse.move(kb.x + 60, kb.y + kb.height / 2, { steps: 6 }); await page.mouse.up();
const moved = await ev((p) => { const s = window.signalform.stage; return window.signalform.timeline.keys(s.get(s.selected), p)[1].t; }, path0);
check(moved > 4.2, `a key can be dragged along the lane (4 s → ${moved.toFixed(2)} s)`);

// a Look setting and the opacity can be keyed too
await page.click('#tab-look'); await page.waitForTimeout(100);
check(!!(await page.$('#inspector .kf[data-path="opacity"]')) && !!(await page.$('#inspector .kf[data-path="fx.hue"]')), 'Look settings and opacity have ◆ buttons');
await page.click('#tab-module');

// in point: drag the start of the selected layer's bar to the right
const sel = await ev(() => window.signalform.stage.selected);
const clip = await (await page.$(`#timeline .tl-clip[data-id="${sel}"] i.in`)).boundingBox();
await page.mouse.move(clip.x + 2, clip.y + clip.height / 2); await page.mouse.down();
await page.mouse.move(clip.x + 150, clip.y + clip.height / 2, { steps: 8 }); await page.mouse.up();
const c = await ev((id) => window.signalform.stage.scene.timeline.clips[id], sel);
check(c && c.in > 1, `dragging the bar's start sets an in point (${c && c.in.toFixed(2)} s)`);
await ev(() => window.signalform.timeline.seek(0.2));
await page.waitForTimeout(100);
check(await ev((id) => window.signalform.stage.tlHidden.has(id) && window.signalform.stage.rt.get(id).el.style.display === 'none', sel), 'before its in point the layer is off');
await ev((t) => window.signalform.timeline.seek(t), c.in + 0.5);
await page.waitForTimeout(100);
check(await ev((id) => !window.signalform.stage.tlHidden.has(id), sel), 'after it, the layer is on');

// transport
await ev(() => window.signalform.timeline.seek(0));
await page.click('#tlPlay'); await page.waitForTimeout(1200); await page.click('#tlPlay');
const clock = await ev(() => window.signalform.timeline.now());
check(clock > 0.8 && clock < 2.5, `play runs the timeline's clock (${clock.toFixed(2)} s after 1.2 s)`);
await shot('ui-timeline');

// saving and loading keeps it all
const saved = await ev(() => window.signalform.stage.serialize());
await ev((s) => window.signalform.loadScene(s, true), saved);
const back = await ev(([id, p]) => { const st = window.signalform.stage, w = st.get(id); return w && { keys: window.signalform.timeline.keys(w, p).length, clip: !!st.scene.timeline.clips[id] }; }, [sel, path0]);
check(back && back.keys === 2 && back.clip, 'keys and in/out points survive saving the scene');

// Delete removes the picked key
await ev(() => window.signalform.timeline.open.add(window.signalform.stage.selected));
await ev(() => window.signalform.timeline.refreshSoon()); await page.waitForTimeout(100);
const kd = await (await page.$('#timeline .tl-lane.sub .tl-key.edit >> nth=0')).boundingBox();
await page.mouse.click(kd.x + kd.width / 2, kd.y + kd.height / 2);
await page.keyboard.press('Delete');
const left = await ev(([id, p]) => { const w = window.signalform.stage.get(id); return w ? (window.signalform.timeline.keys(w, p) || []).length : -1; }, [sel, path0]);
check(left === 1, 'Delete removes the picked key (and not the layer)');

// render the timeline (no track): 2 s
await page.fill('#tlDuration', '2'); await page.press('#tlDuration', 'Enter'); await page.waitForTimeout(100);
await page.click('#tlRender'); await page.waitForTimeout(200);
check(/timeline/i.test(await page.textContent('#dlg h3')), 'Render offers a timeline render without a track');
await page.selectOption('#rnHeight', '720');
const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
await page.click('#rnStart');
const got = await dl;
await page.waitForTimeout(300);
const rec = await ev(() => window.__lastRecording);
check(!!got && rec && rec.bytes > 1000, `the render stops by itself at the end and saves (${rec ? rec.bytes : 0} bytes)`);
check(await ev(() => !window.signalform.timeline.playing), 'the transport stops after the render');

check(!errors.length, 'no errors in the page' + (errors.length ? ': ' + errors.join(' | ') : ''));
console.log(problems ? `${problems} problem(s)` : 'problems: none');
await browser.close(); server.close();
process.exitCode = problems ? 1 : 0;
