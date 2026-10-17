// Quick visual check: open a scene, apply Look/Audio settings, screenshot the inspector tabs.
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] || '/tmp';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required', ...(process.env.GPU ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [])] });
const page = await browser.newPage({ viewport: { width: +(process.env.VW || 1600), height: +(process.env.VH || 940) } });
const problems = []; page.on('pageerror', (e) => problems.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) problems.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`, { timeout: 240000 });
await page.waitForFunction(() => window.__ready, null, { timeout: 240000 });
const steps = JSON.parse(process.env.STEPS || '[]');
for (const s of steps) {
  if (s.eval) await page.evaluate(s.eval);
  if (s.click) await page.click(s.click);
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) await page.screenshot({ path: path.join(out, s.shot + '.png') });
}
console.log("title:", await page.title());
console.log("problems:", problems.length ? problems : "none");
await browser.close(); server.close();
