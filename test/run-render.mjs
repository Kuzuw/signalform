// Imports a 5 s track and renders it to video through the Render dialog.
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined), args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 860 } })).newPage();
const problems = []; page.on('pageerror', (e) => problems.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
await page.waitForFunction(() => window.__ready);
await page.evaluate(() => window.signalform.pickTrack(true));
await page.setInputFiles('#trackFile', path.join(root, 'test/fixture-5s.wav'));
await page.waitForSelector('#rnStart', { timeout: 10000 });
console.log('render dialog open, track:', await page.evaluate(() => window.signalform.audio.trackName));
await page.selectOption('#rnHeight', '720');
const dl = page.waitForEvent('download', { timeout: 30000 });
await page.click('#rnStart');
const t0 = Date.now();
const d = await dl;
await page.waitForTimeout(300);
console.log('rendered in', ((Date.now() - t0) / 1000).toFixed(1), 's →', d.suggestedFilename(), JSON.stringify(await page.evaluate(() => window.__lastRecording)));
const out = process.argv[2]; if (out) { await d.saveAs(out); console.log('saved', out); }
await page.screenshot({ path: '/tmp/render-done.png' });
console.log('dialog status:', await page.$eval('.dlg-b .ok, .dlg-b .note', (e) => e.textContent).catch(() => '?'));
console.log('problems:', problems.length ? problems : 'none');
await browser.close(); server.close();
