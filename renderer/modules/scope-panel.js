// The front panel of the real-life oscilloscope look: a dual-trace analog instrument around the tube.
// Every knob and button shows the scope's actual setting. The panel is painted on a 2D canvas only when
// a setting or the size changes; the lamps (POWER, TRIG'D, READY) are lit by the GPU every frame.

const TAU = Math.PI * 2;
const SWEEP = (135 * Math.PI) / 180;            // knobs turn from -135° to +135°
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

// Where everything goes. `cx`, `cy` (canvas coordinates) and `div` place the screen.
export function layoutInstrument(W, H) {
  const m = Math.round(Math.min(W, H) * 0.018);               // the dark case around the panel
  const px0 = m, py0 = m, pw = W - 2 * m, ph = H - 2 * m;
  const land = pw / ph >= 1.25;
  const u = Math.min(pw, ph * 1.6) / 100;                       // panel unit for sizes and type
  const pad = u * 2.2;
  let scr, ctl, div;
  if (land) {
    const sw = pw * 0.53;
    scr = { x: px0, y: py0, w: sw, h: ph };
    ctl = { x: px0 + sw, y: py0 + pad * 0.6, w: pw - sw - pad * 0.6, h: ph - pad * 1.2 };
  } else {
    const sh = ph * 0.56;
    scr = { x: px0, y: py0, w: pw, h: sh };
    ctl = { x: px0 + pad * 0.6, y: py0 + sh, w: pw - pad * 1.2, h: ph - sh - pad * 0.6 };
  }
  // the screen column: brand row, the tube in its recess, a row of small knobs
  const brandH = u * 6.5, rowH = u * 15;
  div = Math.min((scr.w - pad * 2) / 11.6, (scr.h - brandH - rowH - pad) / 9.6);
  const cx = scr.x + scr.w / 2, cy = scr.y + brandH + pad * 0.3 + 4.8 * div;
  const row = { y: cy + 4.8 * div + rowH * 0.5, x0: cx - 5.2 * div, x1: cx + 5.2 * div };
  // control sections side by side: vertical, horizontal, trigger
  const gap = pad * 0.5, fr = [0.42, 0.27, 0.31], secs = [];
  let x = ctl.x;
  for (const f of fr) { const w = (ctl.w - gap * 2) * f; secs.push({ x, y: ctl.y, w, h: ctl.h }); x += w + gap; }
  const [V, Hz, T] = secs;
  const R = Math.min(V.w * 0.118, V.h * 0.11, Hz.w * 0.26);     // big knob radius (two dials and their scales fit side by side)
  const L = { W, H, m, px0, py0, pw, ph, u, pad, div, cx, cy, row, secs, R, land, brandH, scr };
  L.leds = {
    power: [row.x1 - u * 2.2, row.y - u * 4.6],
    trig: [T.x + T.w * 0.3, T.y + T.h * 0.43],
    ready: [T.x + T.w * 0.7, T.y + T.h * 0.43]
  };
  L.ledR = Math.max(2, u * 0.75);
  return L;
}

const VLAB = ['10', '20', '50', '.1', '.2', '.5', '1', '2'];
const TLAB = ['.1', '.2', '.5', '1', '2', '5', '10', '20', '50', 'X-Y'];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

let noisePat = null;
function grain(ctx) {
  if (noisePat) return noisePat;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), d = g.createImageData(128, 128);
  for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 60; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 10; }
  g.putImageData(d, 0, 0);
  noisePat = ctx.createPattern(c, 'repeat');
  return noisePat;
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

// a black plastic knob with a ridged skirt, a brushed cap and a white pointer; `v` 0..1 sets the angle
function knob(ctx, L, x, y, r, v, o = {}) {
  const a = -SWEEP + 2 * SWEEP * clamp01(v), u = L.u;
  // scale printed on the panel around the knob
  if (o.ticks) {
    const n = o.ticks.length;
    ctx.strokeStyle = '#2a2c30'; ctx.fillStyle = '#2a2c30'; ctx.lineWidth = Math.max(1, u * 0.18);
    ctx.font = `600 ${Math.max(3, u * 1.55)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const t = -SWEEP + 2 * SWEEP * (n === 1 ? 0.5 : i / (n - 1)), s = Math.sin(t), c = -Math.cos(t);
      ctx.beginPath(); ctx.moveTo(x + s * r * 1.12, y + c * r * 1.12); ctx.lineTo(x + s * r * 1.24, y + c * r * 1.24); ctx.stroke();
      if (o.ticks[i]) ctx.fillText(o.ticks[i], x + s * r * 1.45, y + c * r * 1.45);
    }
  } else if (o.dots !== false) {
    ctx.fillStyle = '#3a3c40';
    for (let i = 0; i <= 10; i++) { const t = -SWEEP + 2 * SWEEP * i / 10; ctx.beginPath(); ctx.arc(x + Math.sin(t) * r * 1.22, y - Math.cos(t) * r * 1.22, Math.max(0.7, u * 0.16), 0, TAU); ctx.fill(); }
  }
  // shadow on the panel
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = r * 0.35; ctx.shadowOffsetX = r * 0.08; ctx.shadowOffsetY = r * 0.16;
  ctx.fillStyle = '#141416'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
  // ridged skirt
  const sk = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
  sk.addColorStop(0, '#3b3d42'); sk.addColorStop(1, '#0e0e10');
  ctx.fillStyle = sk; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = Math.max(0.6, r * 0.03);
  const ribs = Math.round(Math.max(18, r * 1.4));
  for (let i = 0; i < ribs; i++) { const t = (i / ribs) * TAU; ctx.beginPath(); ctx.moveTo(x + Math.cos(t) * r * 0.8, y + Math.sin(t) * r * 0.8); ctx.lineTo(x + Math.cos(t) * r * 0.98, y + Math.sin(t) * r * 0.98); ctx.stroke(); }
  // cap: brushed metal or black, with a soft highlight
  const cr = r * (o.cap || 0.72);
  const cg = ctx.createLinearGradient(x - cr, y - cr, x + cr, y + cr);
  if (o.metal) { cg.addColorStop(0, '#e9eaec'); cg.addColorStop(0.5, '#a9acb2'); cg.addColorStop(1, '#6d7076'); }
  else { cg.addColorStop(0, '#45474c'); cg.addColorStop(1, '#17181a'); }
  ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(x, y, cr, 0, TAU); ctx.fill();
  if (o.metal) {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = Math.max(0.5, cr * 0.02);
    for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.arc(x, y, cr * i / 6, 0, TAU); ctx.stroke(); }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = Math.max(0.6, r * 0.03); ctx.beginPath(); ctx.arc(x, y, cr, 0, TAU); ctx.stroke();
  // pointer line
  const s = Math.sin(a), c = -Math.cos(a);
  ctx.strokeStyle = o.metal ? '#111' : '#f4f4f0'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.2, r * 0.09);
  ctx.beginPath(); ctx.moveTo(x + s * r * 0.25, y + c * r * 0.25); ctx.lineTo(x + s * r * 0.95, y + c * r * 0.95); ctx.stroke();
  // a smaller red variable knob on top (VAR / CAL)
  if (o.inner !== undefined) {
    const ir = r * 0.34, ia = -SWEEP + 2 * SWEEP * clamp01(o.inner);
    const ig = ctx.createRadialGradient(x - ir * 0.3, y - ir * 0.4, ir * 0.1, x, y, ir);
    ig.addColorStop(0, '#e2504a'); ig.addColorStop(1, '#8a1d1a');
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = ir * 0.4; ctx.shadowOffsetY = ir * 0.15;
    ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(x, y, ir, 0, TAU); ctx.fill(); ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, ir * 0.14);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(ia) * ir * 0.9, y - Math.cos(ia) * ir * 0.9); ctx.stroke();
  }
  if (o.label) label(ctx, L, o.label, x, y + r * (o.ticks ? 1.95 : 1.62), o.sub);
}
function label(ctx, L, text, x, y, sub) {
  const u = L.u;
  ctx.fillStyle = '#25272b'; ctx.font = `700 ${Math.max(3, u * 1.6)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  if (sub) { ctx.font = `500 ${Math.max(3, u * 1.25)}px ${FONT}`; ctx.fillStyle = '#4b4e54'; ctx.fillText(sub, x, y + u * 1.8); }
}
// a push button; `on` lights the little window in it
function button(ctx, L, x, y, w, h, text, on) {
  const u = L.u;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = u * 0.6; ctx.shadowOffsetY = u * 0.3;
  const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2); g.addColorStop(0, '#f3f3f0'); g.addColorStop(1, '#c4c5c0');
  ctx.fillStyle = g; rrect(ctx, x - w / 2, y - h / 2, w, h, h * 0.18); ctx.fill(); ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = Math.max(0.6, u * 0.12); rrect(ctx, x - w / 2, y - h / 2, w, h, h * 0.18); ctx.stroke();
  // indicator window
  const iw = w * 0.42, ih = h * 0.16;
  ctx.fillStyle = on ? '#7dff9a' : '#3a4a3d';
  if (on) { ctx.save(); ctx.shadowColor = 'rgba(90,255,130,0.9)'; ctx.shadowBlur = u * 1.2; }
  rrect(ctx, x - iw / 2, y - h / 2 + h * 0.16, iw, ih, ih / 2); ctx.fill();
  if (on) ctx.restore();
  ctx.fillStyle = '#25272b'; ctx.font = `700 ${Math.max(3, Math.min(h * 0.36, u * 1.45))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + h * 0.16);
}
// a BNC input socket
function bnc(ctx, L, x, y, r, text, sub) {
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = r * 0.5; ctx.shadowOffsetY = r * 0.2;
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#f2f3f5'); g.addColorStop(0.6, '#a6a9ae'); g.addColorStop(1, '#5f6268');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#7d8086'; ctx.beginPath(); ctx.arc(x, y, r * 0.66, 0, TAU); ctx.fill();
  ctx.fillStyle = '#d9dadc'; ctx.fillRect(x - r * 0.95, y - r * 0.12, r * 0.3, r * 0.24); ctx.fillRect(x + r * 0.65, y - r * 0.12, r * 0.3, r * 0.24);
  ctx.fillStyle = '#151618'; ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, TAU); ctx.fill();
  ctx.fillStyle = '#c8a24a'; ctx.beginPath(); ctx.arc(x, y, r * 0.11, 0, TAU); ctx.fill();
  label(ctx, L, text, x, y + r * 1.75, sub);
}
function section(ctx, L, s, title) {
  const u = L.u;
  ctx.strokeStyle = 'rgba(30,32,36,0.55)'; ctx.lineWidth = Math.max(0.8, u * 0.16);
  rrect(ctx, s.x, s.y + u * 1.2, s.w, s.h - u * 1.2, u * 0.9); ctx.stroke();
  ctx.font = `800 ${Math.max(3, u * 1.7)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(title).width + u * 2.4;
  ctx.fillStyle = '#26476e'; rrect(ctx, s.x + s.w / 2 - tw / 2, s.y, tw, u * 2.6, u * 0.5); ctx.fill();
  ctx.fillStyle = '#f2f4f7'; ctx.fillText(title, s.x + s.w / 2, s.y + u * 1.35);
}
function screw(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r); g.addColorStop(0, '#f0f0f0'); g.addColorStop(1, '#808389');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#4a4d52'; ctx.lineWidth = Math.max(0.8, r * 0.25); ctx.beginPath(); ctx.moveTo(x - r * 0.6, y - r * 0.3); ctx.lineTo(x + r * 0.6, y + r * 0.3); ctx.stroke();
}

// Paint the panel (everything except the picture on the tube and the lamps).
export function drawPanel(ctx, L, p, vdivIdx, tdivIdx) {
  const { W, H, u, m } = L;
  ctx.clearRect(0, 0, W, H);
  // case
  const cg = ctx.createLinearGradient(0, 0, 0, H); cg.addColorStop(0, '#2c2e33'); cg.addColorStop(1, '#141518');
  ctx.fillStyle = cg; rrect(ctx, 0, 0, W, H, m * 1.6); ctx.fill();
  // painted aluminium front panel
  const pg = ctx.createLinearGradient(0, L.py0, 0, L.py0 + L.ph); pg.addColorStop(0, '#dcddd8'); pg.addColorStop(1, '#bfc1bb');
  ctx.fillStyle = pg; rrect(ctx, L.px0, L.py0, L.pw, L.ph, m * 0.8); ctx.fill();
  ctx.fillStyle = grain(ctx); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = Math.max(1, u * 0.15); rrect(ctx, L.px0 + 0.5, L.py0 + 0.5, L.pw - 1, L.ph - 1, m * 0.8); ctx.stroke();
  const sr = Math.max(2, u * 0.9);
  for (const [x, y] of [[L.px0 + u * 2, L.py0 + u * 2], [L.px0 + L.pw - u * 2, L.py0 + u * 2], [L.px0 + u * 2, L.py0 + L.ph - u * 2], [L.px0 + L.pw - u * 2, L.py0 + L.ph - u * 2]]) screw(ctx, x, y, sr);

  // brand
  const { cx, cy, div } = L;
  const bx = cx - 5.4 * div, by = L.py0 + L.brandH * 0.55;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = '#1d1f23';
  ctx.font = `800 ${Math.max(3, u * 2.6)}px ${FONT}`; ctx.fillText('SIGNALFORM', bx, by);
  const bw = ctx.measureText('SIGNALFORM').width, right = cx + 5.4 * div;
  ctx.textAlign = 'right'; ctx.font = `700 ${Math.max(3, u * 1.8)}px ${FONT}`; ctx.fillStyle = '#26476e'; ctx.fillText('50 MHz', right, by);
  const mw = ctx.measureText('50 MHz').width;
  // the model line takes whatever room is left between the brand and the bandwidth
  const room = right - mw - (bx + bw) - u * 3.2;
  ctx.textAlign = 'left'; ctx.fillStyle = '#3d4046';
  for (const t of ['SF-2250  DUAL TRACE OSCILLOSCOPE', 'SF-2250  OSCILLOSCOPE', 'SF-2250']) {
    ctx.font = `500 ${Math.max(3, u * 1.6)}px ${FONT}`;
    if (ctx.measureText(t).width <= room) { ctx.fillText(t, bx + bw + u * 1.6, by); break; }
  }

  // the tube in a recessed black bezel
  const hw = 5.35 * div, hh = 4.35 * div, rw = hw + 0.45 * div, rh = hh + 0.45 * div;
  ctx.save(); ctx.shadowColor = 'rgba(255,255,255,0.55)'; ctx.shadowOffsetY = u * 0.25; ctx.shadowBlur = u * 0.3;
  ctx.fillStyle = '#0d0e10'; rrect(ctx, cx - rw, cy - rh, rw * 2, rh * 2, div * 0.7); ctx.fill(); ctx.restore();
  const rg = ctx.createLinearGradient(0, cy - rh, 0, cy + rh); rg.addColorStop(0, '#050506'); rg.addColorStop(1, '#1d1e22');
  ctx.fillStyle = rg; rrect(ctx, cx - rw + u * 0.5, cy - rh + u * 0.5, rw * 2 - u, rh * 2 - u, div * 0.62); ctx.fill();

  // the row under the tube
  const r = L.row, rr = Math.min(u * 3.6, div * 0.8), ky = r.y - u * 1.5;
  const xs = [0, 1, 2, 3].map((i) => r.x0 + (r.x1 - r.x0 - u * 9) * (i + 0.5) / 4);
  knob(ctx, L, xs[0], ky, rr, (p.intensity - 0.05) / 3.95, { label: 'INTENSITY' });
  knob(ctx, L, xs[1], ky, rr, (p.width - 0.4) / 4.6, { label: 'FOCUS' });
  knob(ctx, L, xs[2], ky, rr * 0.55, 0.5, { label: 'TRACE ROT', dots: false, metal: true, cap: 0.9 });
  knob(ctx, L, xs[3], ky, rr, p.grid ? p.gridLight : 0, { label: 'SCALE ILLUM' });
  // power switch, with its lamp lit by the GPU
  const pxp = r.x1 - u * 2.2;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = u; ctx.shadowOffsetY = u * 0.4;
  ctx.fillStyle = '#1a1b1e'; rrect(ctx, pxp - u * 2.2, ky - u * 1.6, u * 4.4, u * 3.2, u * 0.6); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#2c2e33'; rrect(ctx, pxp - u * 1.8, ky - u * 1.25, u * 3.6, u * 2.5, u * 0.5); ctx.fill();
  label(ctx, L, 'POWER', pxp, ky + rr * 1.62);

  const [V, Hz, T] = L.secs, R = L.R;
  // ---- vertical
  section(ctx, L, V, 'VERTICAL');
  const vk = vdivIdx / 7, gainV = clamp01((p.gain - 0.25) / 3.75);
  const ch = p.channels, yt = p.mode === 'yt';
  for (const [i, nm, pos] of [[0, 'CH1', p.pos1], [1, 'CH2', p.pos2]]) {
    const x = V.x + V.w * (i ? 0.73 : 0.27);
    knob(ctx, L, x, V.y + V.h * 0.27, R, vk, { ticks: VLAB, label: 'VOLTS/DIV', sub: nm + '   mV · V', inner: gainV });
    knob(ctx, L, x, V.y + V.h * 0.58, R * 0.42, (pos + 4) / 8, { label: 'POSITION' });
  }
  const bwid = V.w * 0.19, bh = Math.min(V.h * 0.065, u * 4);
  [['CH1', yt && ch === 'l'], ['CH2', yt && ch === 'r'], ['BOTH', yt && ch === 'both'], ['ADD', yt && ch === 'mix']].forEach(([t, on], i) => button(ctx, L, V.x + V.w * (0.14 + i * 0.24), V.y + V.h * 0.745, bwid, bh, t, on));
  label(ctx, L, 'MODE', V.x + V.w * 0.5, V.y + V.h * 0.68);
  bnc(ctx, L, V.x + V.w * 0.27, V.y + V.h * 0.86, R * 0.36, 'CH1 OR X');
  bnc(ctx, L, V.x + V.w * 0.73, V.y + V.h * 0.86, R * 0.36, 'CH2 OR Y');
  // ---- horizontal
  section(ctx, L, Hz, 'HORIZONTAL');
  const hx = Hz.x + Hz.w / 2;
  knob(ctx, L, hx, Hz.y + Hz.h * 0.27, R, yt ? tdivIdx / 9 : 1, { ticks: TLAB, label: 'SEC/DIV', sub: 'ms', metal: false });
  knob(ctx, L, hx, Hz.y + Hz.h * 0.58, R * 0.42, (p.posX + 4) / 8, { label: 'POSITION' });
  const hbw = Hz.w * 0.36;
  button(ctx, L, Hz.x + Hz.w * 0.28, Hz.y + Hz.h * 0.745, hbw, bh, 'X-Y', !yt);
  button(ctx, L, Hz.x + Hz.w * 0.72, Hz.y + Hz.h * 0.745, hbw, bh, '×10 MAG', false);
  // calibrator terminal
  const tx = hx, ty = Hz.y + Hz.h * 0.86, tr = R * 0.2;
  ctx.fillStyle = '#9da0a6'; ctx.beginPath(); ctx.arc(tx, ty, tr * 1.6, 0, TAU); ctx.fill();
  ctx.fillStyle = '#d7d9dc'; ctx.beginPath(); ctx.arc(tx, ty, tr, 0, TAU); ctx.fill();
  label(ctx, L, 'CAL', tx, ty + R * 0.63, '0.5 V  1 kHz');
  // ---- trigger
  section(ctx, L, T, 'TRIGGER');
  const tcx = T.x + T.w / 2;
  knob(ctx, L, tcx, T.y + T.h * 0.22, R * 0.7, (p.level + 0.5), { label: 'LEVEL' });
  // lamp housings (the light itself comes from the GPU)
  for (const [k, t] of [['trig', "TRIG'D"], ['ready', 'READY']]) {
    const [lx, ly] = L.leds[k];
    ctx.fillStyle = '#1b1c1f'; ctx.beginPath(); ctx.arc(lx, ly, L.ledR * 1.6, 0, TAU); ctx.fill();
    label(ctx, L, t, lx, ly + L.ledR * 3.2);
  }
  const tbw = T.w * 0.27, nm = p.trigMode, srcT = p.trigSrc;
  label(ctx, L, 'MODE', tcx, T.y + T.h * 0.555);
  [['AUTO', nm === 'auto'], ['NORM', nm === 'normal'], ['FREE', nm === 'free']].forEach(([t, on], i) => button(ctx, L, T.x + T.w * (0.2 + i * 0.3), T.y + T.h * 0.615, tbw, bh, t, yt && on));
  label(ctx, L, 'SOURCE', tcx, T.y + T.h * 0.69);
  [['CH1', srcT === 'l'], ['CH2', srcT === 'r'], ['ADD', srcT === 'mix']].forEach(([t, on], i) => button(ctx, L, T.x + T.w * (0.2 + i * 0.3), T.y + T.h * 0.75, tbw, bh, t, yt && on));
  label(ctx, L, 'SLOPE', tcx, T.y + T.h * 0.825);
  [['+ ↗', p.slope !== 'fall'], ['− ↘', p.slope === 'fall']].forEach(([t, on], i) => button(ctx, L, T.x + T.w * (0.32 + i * 0.36), T.y + T.h * 0.885, tbw * 1.1, bh, t, yt && on));
}
