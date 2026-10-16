// Renders every module in headless Chromium with the demo beat and saves a contact sheet.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const out = process.argv[2] || '/tmp/modules.png';
const secs = Number(process.argv[3] || 6);

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--autoplay-policy=no-user-gesture-required', ...(process.env.NOGPU ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])]
});
const page = await browser.newPage({ viewport: { width: 2024, height: process.argv[4] ? 1200 : 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 400)); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:${port}/test/modules.html${process.env.ONLY ? '?only=' + process.env.ONLY : process.argv[4] ? '?variants' : ''}`);
await page.waitForFunction(() => window.ready);
await page.evaluate(() => window.start());
const samples = [];
for (let i = 0; i < secs * 4; i++) { await page.waitForTimeout(250); samples.push(await page.evaluate(() => window.F)); }
await page.screenshot({ path: out });
const res = await page.evaluate(() => ({ errors: window.errors || [], timings: window.timings }));
console.log('onset counts', await page.evaluate(() => window.counts), 'over', secs, 's (demo: 124 BPM → ~2 kicks/s in groove)');
console.log('errors', res.errors);
console.log('ms/frame', Object.fromEntries(Object.entries(res.timings).map(([k, v]) => [k, +v.toFixed(1)])));
const mx = (k) => Math.max(...samples.map((s) => s[k])).toFixed(2);
console.log('feature max', ['bass', 'mid', 'high', 'kick', 'snare', 'hat', 'build', 'drop', 'level'].map((k) => k + '=' + mx(k)).join(' '), 'active', samples.at(-1).active);
console.log(logs.slice(0, 20).join('\n'));
await browser.close(); server.close();
