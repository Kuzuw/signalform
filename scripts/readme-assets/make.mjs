// Renders the images used by the README straight from the app and its modules.
//   node scripts/readme-assets/make.mjs [all|tiles|gallery|banner|social|app|gif]
// Needs Playwright + Chromium (PW_CHROMIUM) and ffmpeg on PATH. Output: docs/images/
// (run `tiles` before `gallery` and `banner`: they are composed from the full-size stills)
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(root, 'docs/images');
const TILES = path.join(root, 'scripts/readme-assets/_tiles'); // full-size stills (not committed)
const THUMBS = path.join(OUT, 'modules'); // small JPEGs for the README table
fs.mkdirSync(TILES, { recursive: true }); fs.mkdirSync(THUMBS, { recursive: true });
const what = process.argv[2] || 'all';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const exe = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const launch = (gpu) => pw.chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required', ...(gpu ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [])] });
const log = (...a) => console.log('•', ...a);

// Module stills, with settings that show each one at its best.
const LOOKS = {
  ascii: { cell: 15, density: 1.5, colorB: '#ffb547', glyphs: 'classic' }, aura: { intensity: 1.1, blobs: 4, soft: 1.3 }, ferro: { zoom: 1.4, view: 0.45 }, flowfield: { count: 7000 }, fractal: { mode: '2', hue: 0.5 }, grain: { contrast: 0.6, colorB: '#ffe6c4' },
  lissajous: { layers: 7 }, oscilloscope: { shape: 'star', echoes: 3 }, spectre: { mode: 'bands' }, trace: { lines: 6, spread: 0.3 },
  waveform: {}, oscillon: { form: 'torus' }, stroke: { exposure: 0.995 }, discharge: { afterglow: 0.8 }, familiar: {},
  tunnel: {}, horizon: {}, strings: { count: 16 }, halo: { echoes: 2 }, cells: {}
};
const GL = ['aura', 'ferro', 'fractal', 'tunnel', 'cells'];
const NAMES = {};

async function tiles() {
  const rest = Object.keys(LOOKS).filter((m) => !GL.includes(m));
  const only = process.argv[3] ? process.argv[3].split(',') : null;
  const batches = [[GL, true, 24]];
  for (let i = 0; i < rest.length; i += 3) batches.push([rest.slice(i, i + 3), false, 14]);
  for (const [all, gpu, secs] of batches) {
    const ids = only ? all.filter((x) => only.includes(x)) : all;
    if (!ids.length) continue;
    const browser = await launch(gpu);
    const page = await browser.newPage({ viewport: { width: 700, height: ids.length * 370 + 20 }, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => console.log('pageerror', e.message)); page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
    const spec = ids.map((id) => id + '~' + encodeURIComponent(JSON.stringify(LOOKS[id]))).join('|');
    await page.goto(`${base}/scripts/readme-assets/tiles.html?m=${spec}`);
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => window.start());
    await page.waitForTimeout(secs * 1000);
    await page.evaluate(() => { window.halt = true; });
    await page.waitForTimeout(300);
    for (let i = 0; i < ids.length; i++) await page.locator('#c' + i).screenshot({ path: path.join(TILES, ids[i] + '.png') });
    for (const id of ids) execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(TILES, id + '.png'), '-vf', 'scale=640:360:flags=lanczos', '-q:v', '3', path.join(THUMBS, id + '.jpg')]);
    log('tiles', ids.join(', '), 'frames', await page.evaluate(() => window.nframes));
    await browser.close();
  }
}

async function shotHtml(file, html, w, h, scale = 2, full = true) {
  const tmp = path.join(root, 'scripts/readme-assets/_page.html');
  fs.writeFileSync(tmp, html);
  const browser = await launch(false);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.goto(`${base}/scripts/readme-assets/_page.html`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: file, fullPage: full });
  await browser.close();
  fs.unlinkSync(tmp);
}

const META = [
  ['ascii', 'ASCII', 'Audio-reactive character rasterization'], ['aura', 'Aura', 'Light bends into cinematic motion'], ['ferro', 'Ferro', 'Reactive magnetic fluid'],
  ['flowfield', 'Flow Field', 'Sound flows through motion fields'], ['fractal', 'Fractal', 'Sound transformed into recursive form'], ['grain', 'Grain', 'Dynamic grain structures and flow'],
  ['lissajous', 'Lissajous', 'Flowing harmonic line structures'], ['oscilloscope', 'Oscilloscope', 'Signal rendered through light'], ['spectre', 'Spectre', 'Harmonic frequencies as light'],
  ['trace', 'Trace', 'A living line driven by sound'], ['waveform', 'Waveform', 'Layered waveform shapes'], ['oscillon', 'Oscillon', 'A shell drawn by a phosphor beam'],
  ['stroke', 'Stroke', 'A pen of light on a long exposure'], ['discharge', 'Discharge', 'Lightning on a photographic plate'], ['familiar', 'Familiar', 'A body made of light'],
  ['tunnel', 'Tunnel', 'An endless flight carried by the beat'], ['horizon', 'Horizon', 'A landscape grown from the spectrum'], ['strings', 'Strings', 'Plucked by the hits, bowed by the mix'],
  ['halo', 'Halo', 'Every hit throws a ring of light'], ['cells', 'Cells', 'A living tissue that listens cell by cell']
];
const FONT = `font-family: "Inter", "Inter Display", system-ui, sans-serif;`;

async function gallery() {
  const cards = META.map(([id, name, tag]) => `<figure><img src="_tiles/${id}.png"><figcaption><b>${name}</b><span>${tag}</span></figcaption></figure>`).join('');
  await shotHtml(path.join(OUT, 'modules.png'), `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0b0b0d;${FONT};-webkit-font-smoothing:antialiased}
    main{display:grid;grid-template-columns:repeat(5,1fr);gap:18px;padding:28px}
    figure{margin:0;background:#141416;border:1px solid #26262a;border-radius:14px;overflow:hidden}
    img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#000}
    figcaption{padding:11px 14px 13px;display:grid;gap:2px}
    b{color:#f2f2f4;font-size:15px;font-weight:650;letter-spacing:-.005em} span{color:#8d8d96;font-size:12.5px}
  </style><main>${cards}</main>`, 1600, 700, 1.5);
  log('modules.png');
}

async function banner(file = 'banner.png', W = 1280, H = 400, strip0 = 600) {
  const pick = ['flowfield', 'oscillon', 'horizon', 'familiar', 'tunnel', 'discharge', 'ferro', 'lissajous', 'cells', 'halo', 'fractal', 'strings'];
  const strip = pick.map((id, i) => `<img style="--i:${i}" src="_tiles/${id}.png">`).join('');
  await shotHtml(path.join(OUT, file), `<!doctype html><meta charset="utf-8"><style>
    html{overflow:hidden}body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#09090b;${FONT};-webkit-font-smoothing:antialiased;position:relative}
    .strip{position:absolute;left:${strip0}px;top:50%;display:grid;grid-template-columns:repeat(4,220px);gap:14px;transform:translateY(-50%) rotate(-8deg) skewX(-4deg)}
    .strip img{width:220px;aspect-ratio:16/9;object-fit:cover;border-radius:10px;box-shadow:0 0 0 1px #ffffff1f,0 18px 40px #000c}
    .fade{position:absolute;inset:0;background:linear-gradient(90deg,#09090b 40%,#09090b99 52%,#09090b00 66%),linear-gradient(0deg,#09090b 0%,#09090b00 22%,#09090b00 78%,#09090b 100%)}
    .t{position:absolute;left:64px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:16px}
    .row{display:flex;align-items:center;gap:16px}
    .mark{width:44px;height:44px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff,#c9c9d4 35%,#55555e 70%,#1a1a1d);box-shadow:0 0 30px #ffffff30}
    h1{margin:0;font-family:"Inter Display","Inter",sans-serif;font-weight:800;font-size:64px;letter-spacing:-.035em;color:#f4f4f6}
    p{margin:0;max-width:420px;font-size:20px;line-height:1.45;color:#a3a3ad}
    .tags{display:flex;gap:8px;margin-top:6px}.tags span{font-size:13px;color:#d8d8de;border:1px solid #33333a;border-radius:999px;padding:5px 11px;background:#141416}
  </style><div class="strip">${strip}</div><div class="fade"></div>
  <div class="t"><div class="row"><div class="mark"></div><h1>Signalform</h1></div>
  <p>Realtime audio-reactive visuals for Windows. Free and open source.</p>
  <div class="tags"><span>20 modules</span><span>Free layering</span><span>MP4 export</span></div></div>`, W, H, file === 'banner.png' ? 2 : 1, false);
  log(file);
}

async function app() {
  const browser = await launch(true);
  const page = await browser.newPage({ viewport: { width: 1600, height: 940 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/renderer/index.html`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.evaluate(() => window.signalform.loadScene({
    name: 'Night Drive', aspect: '16:9', widgets: [
      { module: 'aura', rect: { x: 0, y: 0, w: 1, h: 1 }, blend: 'normal', bg: { mode: 'solid', tone: 'dark' }, params: { intensity: 0.55, blobs: 3 } },
      { module: 'oscillon', rect: { x: 0.04, y: 0.08, w: 0.44, h: 0.84 }, blend: 'screen', params: { form: 'torus' } },
      { module: 'spectre', name: 'Spectrum', rect: { x: 0.52, y: 0.08, w: 0.44, h: 0.4 }, blend: 'normal', bg: { mode: 'glass', tone: 'dark' }, radius: 22, params: { mode: 'bands', bands: 40 } },
      { module: 'lissajous', rect: { x: 0.52, y: 0.52, w: 0.44, h: 0.4 }, blend: 'normal', bg: { mode: 'glass', tone: 'dark' }, radius: 22, params: { layers: 6 } }
    ]
  }, true));
  await page.waitForTimeout(9000);
  await page.click('.widget >> nth=2', { position: { x: 60, y: 60 } });
  await page.waitForTimeout(1500);
  // the capture machine renders in software; hide its frame counter rather than show a misleading number
  await page.evaluate(() => { document.getElementById('statusBar').style.visibility = 'hidden'; });
  await page.screenshot({ path: path.join(OUT, 'app.png') });
  log('app.png');
  await browser.close();
}

function encodeGif(dir) {
  // particles and lightning are noisy: a small palette without dithering keeps the file small
  const pal = path.join(dir, 'pal.png');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '20', '-i', path.join(dir, '%03d.png'), '-vf', 'scale=640:-1:flags=lanczos,palettegen=max_colors=32:stats_mode=full', pal]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '20', '-i', path.join(dir, '%03d.png'), '-i', pal, '-lavfi', 'fps=12,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', path.join(OUT, 'demo.gif')]);
}

// Frame-by-frame capture of the stage composite, assembled into a looping GIF.
async function gif() {
  const browser = await launch(true);
  const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
  await page.goto(`${base}/renderer/index.html`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.evaluate(() => window.signalform.loadScene({
    name: 'Storm', aspect: '16:9', widgets: [
      { module: 'discharge', rect: { x: 0, y: 0, w: 1, h: 1 }, blend: 'normal', bg: { mode: 'solid', tone: 'dark' }, params: { afterglow: 0.75, sky: 1 } },
      { module: 'oscillon', rect: { x: 0.22, y: 0.02, w: 0.56, h: 0.96 }, blend: 'screen', params: { form: 'auto', points: 24000 } }
    ]
  }, true));
  await page.waitForTimeout(3000);
  const dir = path.join(root, 'scripts/readme-assets/_frames');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  await page.evaluate(() => {
    const app = window.signalform;
    app.paused = true;
    window.__cap = document.createElement('canvas'); window.__cap.width = 800; window.__cap.height = 450;
    window.__pending = [];
    window.__clock = 0;
    let last = performance.now();
    // keep the analysis running at 60 Hz in real time, gather every hit for the next drawn frame
    setInterval(() => { const now = performance.now(); const F = app.audio.update(Math.min(0.05, (now - last) / 1000), now / 1000); last = now; window.__pending.push(...F.onsets.map((o) => ({ ...o }))); }, 16);
  });
  const N = 90;
  for (let i = 0; i < N; i++) {
    const data = await page.evaluate(() => {
      const app = window.signalform, F = app.audio.F, saved = F.onsets;
      F.onsets = window.__pending.splice(0);
      window.__clock += 1 / 20;
      app.stage.render(F, 1 / 20, window.__clock);
      F.onsets = saved;
      const c = window.__cap, ctx = c.getContext('2d');
      app.stage.compose(ctx, c.width, c.height, 'stage');
      return c.toDataURL('image/png');
    });
    fs.writeFileSync(path.join(dir, String(i).padStart(3, '0') + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    await page.waitForTimeout(50);
  }
  await browser.close();
  encodeGif(dir);
  if (!process.env.KEEP) fs.rmSync(dir, { recursive: true, force: true });
  log('demo.gif', (fs.statSync(path.join(OUT, 'demo.gif')).size / 1048576).toFixed(1) + ' MB');
}

if (what === 'all' || what === 'tiles') await tiles();
if (what === 'all' || what === 'gallery') await gallery();
if (what === 'all' || what === 'banner') await banner();
if (what === 'all' || what === 'social') await banner('social.png', 1280, 640, 620); // upload in Settings → Social preview
if (what === 'all' || what === 'app') await app();
if (what === 'all' || what === 'gif') await gif();
server.close();
