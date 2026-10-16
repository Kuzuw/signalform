// Drives the full renderer UI in headless Chromium (browser shim instead of Electron).
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
  executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 }, acceptDownloads: true });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) problems.push('console: ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
const step = (s) => console.log('•', s);
const shot = (n) => page.screenshot({ path: path.join(outDir, n + '.png') });
const S = () => page.evaluate(() => window.signalform.stage);

// trial
await page.goto(base);
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 }).catch(() => { console.log('BOOT FAILED', problems); process.exit(1); });
await page.waitForTimeout(2000);
await shot('ui-trial');
step(`modules available: ${await page.$$eval('.tile', (l) => l.length)} (expect 15)`);
await page.click('#sourceCard'); await page.waitForTimeout(200);
await shot('ui-source-menu');
step('source menu items: ' + (await page.$$eval('.src-item b', (l) => l.map((x) => x.textContent))).join(' | '));
await page.keyboard.press('Escape'); await page.mouse.click(800, 500);

// unlocked: starter scenes
await page.goto(base);
await page.waitForFunction(() => window.__ready);
for (const name of ['Three Cards', 'Storm Shell', 'Long Exposure', 'Paper']) {
  await page.click('#scenesBtn'); await page.waitForTimeout(150);
  await page.locator('.scene-list li', { hasText: name }).getByRole('button', { name: 'Open' }).click();
  await page.waitForTimeout(3000);
  await shot('ui-scene-' + name.toLowerCase().replace(/\s+/g, '-'));
}
// group behaviour on "Three Cards"
await page.click('#scenesBtn'); await page.waitForTimeout(150);
await page.locator('.scene-list li', { hasText: 'Three Cards' }).getByRole('button', { name: 'Open' }).click();
await page.waitForTimeout(800);
await page.click('.widget >> nth=0', { position: { x: 40, y: 40 } });
step('click on grouped widget selects ' + (await page.evaluate(() => window.signalform.stage.sel.size)) + ' widgets (expect 3)');
await shot('ui-group-selected');
const before = await page.evaluate(() => window.signalform.stage.widgets.map((w) => w.rect.x));
const b = await page.locator('.widget >> nth=1').boundingBox();
await page.mouse.move(b.x + 50, b.y + 50); await page.mouse.down(); await page.mouse.move(b.x + 50, b.y + 110, { steps: 5 }); await page.mouse.up();
const after = await page.evaluate(() => window.signalform.stage.widgets.map((w) => w.rect.y.toFixed(3)));
step('group dragged together, new y: ' + after.join(', '));
await page.click('text=Ungroup');
step('groups after ungroup: ' + (await page.evaluate(() => window.signalform.stage.groups.length)));

// build a composition from scratch: drag modules onto the stage, select two, group them
await page.evaluate(() => window.signalform.loadScene({ name: 'Fresh', aspect: '16:9', widgets: [] }));
const stageBox = await page.locator('#stage').boundingBox();
for (const [id, fx, fy] of [['discharge', 0.3, 0.4], ['oscillon', 0.6, 0.5], ['familiar', 0.8, 0.7]]) {
  await page.locator(`.tile[data-mod="${id}"]`).dragTo(page.locator('#stage'), { targetPosition: { x: stageBox.width * fx, y: stageBox.height * fy } });
}
step('widgets after drag & drop: ' + (await page.evaluate(() => window.signalform.stage.widgets.map((w) => w.module).join(', '))));
await page.click('.widget >> nth=1', { position: { x: 30, y: 30 } });
await page.click('.widget >> nth=2', { position: { x: 30, y: 30 }, modifiers: ['Shift'] });
await page.click('#groupBtn');
step('groups after Group: ' + JSON.stringify(await page.evaluate(() => window.signalform.stage.groups.map((g) => [g.name, window.signalform.stage.members(g.id).length]))));
await page.click('#rowBtn'); await page.waitForTimeout(300);
// single-widget inspector: background, randomize, presets
await page.dblclick('.widget >> nth=2', { position: { x: 30, y: 30 } });
await page.click('#tab-look');
await page.click('.seg button:has-text("Glass")');
await page.selectOption('#p_mirror', 'kaleido');
await page.evaluate(() => { const r = document.getElementById('r_glow'); r.value = 0.8; r.dispatchEvent(new Event('input')); });
await page.click('#tab-audio');
await page.selectOption('#p_focus', 'bass');
await page.click('#tab-look');
await page.fill('#r_radius', '24').catch(() => {});
await page.evaluate(() => { const r = document.getElementById('r_radius'); r.value = 24; r.dispatchEvent(new Event('input')); });
await page.click('#tab-module');
await page.click('.pal >> nth=3');
await page.click('#randomize');
await page.fill('#presetName', 'Wild'); await page.click('#presetSave');
await page.waitForTimeout(300); step('presets saved: ' + JSON.stringify(Object.fromEntries(Object.entries(await page.evaluate(() => JSON.parse(localStorage.getItem('sf.presets')) || {})).map(([k, v]) => [k, v.map((p) => p.name)]))));
step('selected bg + fx: ' + JSON.stringify(await page.evaluate(() => { const s = window.signalform.stage, w = s.get(s.selected); return { bg: w.bg.mode, mirror: w.fx.mirror, glow: w.fx.glow, focus: w.fx.focus }; })));
await page.waitForTimeout(2500);
await shot('ui-composition');

// record a group via the widget picker
await page.click('#recBtn'); await page.waitForTimeout(200);
await shot('ui-record-dialog');
const groupId = await page.evaluate(() => window.signalform.stage.groups[0].id);
await page.check(`input[name="recSrc"][value="${groupId}"]`);
await page.selectOption('#recHeight', '720');
await page.click('#recStart');
await page.waitForTimeout(2500);
const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
await page.click('#recBtn');
await dl;
step('recorded group: ' + JSON.stringify(await page.evaluate(() => window.__lastRecording)));

// outputs dialog lists groups
await page.click('#outBtn'); await page.waitForTimeout(200);
step('output sources: ' + (await page.$$eval('.out-card select >> nth=0', (s) => [...s[0].options].map((o) => o.textContent))).join(' | '));
await shot('ui-output');
await page.keyboard.press('Escape');

console.log('\nproblems:', problems.length ? problems : 'none');
await browser.close(); server.close();
