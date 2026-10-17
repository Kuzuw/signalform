import { hexToRgb, rgba, fade, scaleRgb, TAU } from './util.js';
import { tracePicture, loadPicture, pictureGray } from './picture-trace.js';

function presetShape(name) {
  const pts = [];
  const M = 240;
  for (let i = 0; i < M; i++) {
    const u = i / M * TAU;
    let x, y;
    if (name === 'square') {
      const s = (i / M) * 4, k = Math.floor(s), f = s - k;
      [x, y] = [[-1 + 2 * f, -1], [1, -1 + 2 * f], [1 - 2 * f, 1], [-1, 1 - 2 * f]][k];
      x *= 0.8; y *= 0.8;
    } else if (name === 'triangle') {
      const s = (i / M) * 3, k = Math.floor(s), f = s - k;
      const v = [[0, -0.95], [0.85, 0.6], [-0.85, 0.6]];
      const a = v[k], b = v[(k + 1) % 3];
      x = a[0] + (b[0] - a[0]) * f; y = a[1] + (b[1] - a[1]) * f;
    } else if (name === 'star') {
      const s = (i / M) * 10, k = Math.floor(s), f = s - k;
      const pt = (j) => { const r = j % 2 ? 0.4 : 1; const a = j / 10 * TAU - Math.PI / 2; return [Math.cos(a) * r, Math.sin(a) * r]; };
      const a = pt(k), b = pt(k + 1);
      x = a[0] + (b[0] - a[0]) * f; y = a[1] + (b[1] - a[1]) * f;
    } else if (name === 'heart') {
      x = 16 * Math.pow(Math.sin(u), 3) / 17; y = -(13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u)) / 17;
    } else if (name === 'infinity') {
      x = Math.cos(u) / (1 + Math.sin(u) ** 2); y = Math.sin(u) * Math.cos(u) / (1 + Math.sin(u) ** 2) * 1.3;
    } else { x = Math.cos(u) * 0.9; y = Math.sin(u) * 0.9; }
    pts.push([x, y]);
  }
  return pts;
}

// even spacing by arc length so the beam speed stays constant around the shape
function resample(pts, M, closed) {
  if (pts.length < 2) return presetShape('circle');
  const P = closed ? [...pts, pts[0]] : pts;
  const L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = L[L.length - 1] || 1, out = [];
  let j = 1;
  for (let i = 0; i < M; i++) {
    const d = i / M * total;
    while (j < L.length - 1 && L[j] < d) j++;
    const f = (d - L[j - 1]) / ((L[j] - L[j - 1]) || 1);
    out.push([P[j - 1][0] + (P[j][0] - P[j - 1][0]) * f, P[j - 1][1] + (P[j][1] - P[j - 1][1]) * f]);
  }
  return out;
}

export default {
  id: 'oscilloscope',
  name: 'Oscilloscope',
  tagline: 'Signal rendered through light.',
  params: [
    { key: 'mode', label: 'Display', type: 'select', default: 'xy', options: [['yt', 'Waveform (Y/T)'], ['xy', 'Stereo phase (X/Y)'], ['shape', 'Custom shape'], ['picture', 'A picture']] },
    { key: 'loadPicture', label: 'Choose a picture…', type: 'action', showIf: { mode: 'picture' } },
    { key: 'picture', type: 'hidden', default: null },
    { key: 'picDetail', label: 'Beam points', type: 'range', min: 500, max: 12000, step: 100, default: 4000, showIf: { mode: 'picture' } },
    { key: 'picEdges', label: 'Edge detail', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45, showIf: { mode: 'picture' } },
    { key: 'picShade', label: 'Shade dark areas', type: 'range', min: 0, max: 1, step: 0.01, default: 0, showIf: { mode: 'picture' } },
    { key: 'picInvert', label: 'Light subject on dark', type: 'toggle', default: false, showIf: { mode: 'picture' } },
    { key: 'picSize', label: 'Picture size', type: 'range', min: 0.3, max: 1.4, step: 0.01, default: 1, showIf: { mode: 'picture' } },
    { key: 'picReact', label: 'Wobble with the sound', type: 'range', min: 0, max: 3, step: 0.05, default: 1, showIf: { mode: 'picture' } },
    { key: 'picSweep', label: 'Beam sweep', type: 'range', min: 0.05, max: 1, step: 0.01, default: 1, showIf: { mode: 'picture' } },
    { key: 'picJumps', label: 'Show beam jumps', type: 'toggle', default: false, showIf: { mode: 'picture' } },
    { key: 'shape', label: 'Shape', type: 'select', default: 'circle', showIf: { mode: 'shape' }, options: [['circle', 'Circle'], ['square', 'Square'], ['triangle', 'Triangle'], ['star', 'Star'], ['heart', 'Heart'], ['infinity', 'Infinity'], ['custom', 'My drawing']] },
    { key: 'draw', label: 'Draw a shape on the widget', type: 'action', showIf: { mode: 'shape' } },
    { key: 'customShape', type: 'hidden', default: null },
    { key: 'gain', label: 'Gain', type: 'range', min: 0.1, max: 4, step: 0.05, default: 1 },
    { key: 'channels', label: 'Channels', type: 'select', default: 'both', showIf: { mode: 'yt' }, options: [['mix', 'Mono mix'], ['both', 'Left + right']] },
    { key: 'spin', label: 'Shape rotation', type: 'range', min: -2, max: 2, step: 0.05, default: 0.2, showIf: { mode: 'shape' } },
    { key: 'echoes', label: 'Echoes', type: 'range', min: 0, max: 8, step: 1, default: 0 },
    { key: 'echoScale', label: 'Echo size step', type: 'range', min: -0.3, max: 0.3, step: 0.01, default: -0.12, showIf: { echoes: [1, 2, 3, 4, 5, 6, 7, 8] } },
    { key: 'echoTwist', label: 'Echo twist', type: 'range', min: -90, max: 90, step: 1, default: 12, showIf: { echoes: [1, 2, 3, 4, 5, 6, 7, 8] } },
    { key: 'persist', label: 'Phosphor persistence', section: 'Phosphor', type: 'range', min: 0, max: 0.97, step: 0.01, default: 0.8 },
    { key: 'width', label: 'Beam width', type: 'range', min: 0.5, max: 5, step: 0.1, default: 1.5 },
    { key: 'glow', label: 'Optical bloom', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'color', label: 'Phosphor color', section: 'Color', type: 'color', default: '#2fe3a2' },
    { key: 'grid', label: 'Graticule', type: 'toggle', default: false }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let shapeKey = '', shape = [], normals = [], rot = 0;
    let drawing = false, stroke = [];
    // picture mode: the traced path is cached and rebuilt only when the picture or its settings change
    const pic = { key: '', path: null, busy: false, error: '', gray: null, graySrc: '', head: 0 };
    function picturePath(p) {
      if (!p.picture) return null;
      const key = [p.picture.length, p.picture.slice(-24), p.picDetail, p.picEdges, p.picShade, p.picInvert].join('|');
      if (key === pic.key) return pic.path;
      if (pic.busy) return pic.path;
      if (pic.graySrc !== p.picture) {
        pic.busy = true;
        pictureGray(p.picture).then((g) => { pic.gray = g; pic.graySrc = p.picture; pic.error = ''; })
          .catch((e) => { pic.error = e.message; pic.graySrc = p.picture; pic.gray = null; })
          .finally(() => { pic.busy = false; });
        return pic.path;
      }
      pic.key = key;
      if (!pic.gray) { pic.path = null; return null; }
      const { gray, w, h } = pic.gray;
      const src = p.picInvert ? gray.map((v) => 1 - v) : gray;
      const t = tracePicture(src, w, h, { detail: p.picDetail, edges: p.picEdges, shade: p.picShade });
      if (!t.count) { pic.path = null; pic.error = 'No lines found in this picture. Try more edge detail.'; return null; }
      // normals for the sound to push the beam sideways along each line
      const n = t.count, nrm = new Float32Array(n * 2), P = t.pts;
      for (let i = 0; i < n; i++) {
        const a = i > 0 && !P[i * 3 + 2] ? i - 1 : i, b = i + 1 < n && !P[(i + 1) * 3 + 2] ? i + 1 : i;
        const tx = P[b * 3] - P[a * 3], ty = P[b * 3 + 1] - P[a * 3 + 1], l = Math.hypot(tx, ty) || 1;
        nrm[i * 2] = ty / l; nrm[i * 2 + 1] = -tx / l;
      }
      pic.path = { pts: P, count: n, nrm }; pic.head = 0;
      return pic.path;
    }
    const self = {
      capturing: false,
      render(F, { dt, W, H, S, params: p }) {
        fade(ctx, W, H, p.persist);
        const col = hexToRgb(p.color);
        const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.42;
        if (p.grid) {
          ctx.strokeStyle = rgba(col, 0.08); ctx.lineWidth = S;
          ctx.beginPath();
          for (let i = 1; i < 10; i++) { const x = (W * i) / 10; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
          for (let i = 1; i < 8; i++) { const y = (H * i) / 8; ctx.moveTo(0, y); ctx.lineTo(W, y); }
          ctx.stroke();
        }
        const traces = [];
        if (p.mode === 'yt') {
          let i0 = 0;
          for (let i = 1; i < 1000; i++) if (F.wave[i - 1] < 0 && F.wave[i] >= 0) { i0 = i; break; }
          const chans = p.channels === 'both' ? [[F.waveL, -0.22], [F.waveR, 0.22]] : [[F.wave, 0]];
          for (const [buf, off] of chans) {
            const pts = [];
            for (let i = 0; i < 1024; i += 2) pts.push([(i / 1023) * W, cy + off * H + buf[i0 + i] * H * 0.3 * p.gain]);
            traces.push(pts);
          }
        } else if (p.mode === 'xy') {
          const pts = [];
          for (let i = 0; i < 2048; i += 2) {
            const l = F.waveL[i] * p.gain, r = F.waveR[i] * p.gain;
            pts.push([cx + (l - r) * 0.7071 * R * 1.4, cy - (l + r) * 0.7071 * R * 1.4]);
          }
          traces.push(pts);
        } else if (p.mode === 'picture') {
          const P = picturePath(p);
          if (!P) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = rgba(col, 0.75); ctx.font = `${13 * S}px system-ui, sans-serif`; ctx.textAlign = 'center';
            ctx.fillText(pic.busy ? 'Tracing the picture…' : pic.error || 'Choose a picture in the panel on the right.', cx, cy);
          } else {
            // the beam traces the picture; the sound shakes it along each line, kicks pulse it
            const n = P.count, pts = P.pts, nrm = P.nrm;
            const k = Math.min(W, H) * 0.47 * p.picSize * (1 + F.kick * 0.05 * p.picReact + F.drop * 0.1);
            const amp = 0.035 * p.gain * p.picReact, jit = F.hat * 0.004 * p.picReact;
            const sweep = Math.min(n, Math.max(2, Math.round(n * p.picSweep)));
            pic.head = p.picSweep >= 1 ? 0 : (pic.head + Math.max(1, Math.round(sweep * dt * 4))) % n;
            const line = [], jumps = [];
            let prev = null;
            for (let q = 0; q < sweep; q++) {
              const i = (pic.head + q) % n, o = i * 3;
              const d = F.wave[(i * 7) % 2048] * amp;
              const x = cx + (pts[o] + nrm[i * 2] * d + (Math.random() - 0.5) * jit) * k;
              const y = cy + (pts[o + 1] + nrm[i * 2 + 1] * d + (Math.random() - 0.5) * jit) * k;
              if (pts[o + 2] || q === 0 || i === 0) { if (prev && p.picJumps) jumps.push(prev, [x, y]); line.push(null); }
              line.push([x, y]); prev = [x, y];
            }
            traces.push(line);
            if (jumps.length) {
              ctx.globalCompositeOperation = 'lighter';
              ctx.strokeStyle = rgba(col, 0.06); ctx.lineWidth = Math.max(0.5, p.width * S * 0.5);
              ctx.beginPath(); for (let j = 0; j < jumps.length; j += 2) { ctx.moveTo(jumps[j][0], jumps[j][1]); ctx.lineTo(jumps[j + 1][0], jumps[j + 1][1]); } ctx.stroke();
            }
          }
        } else {
          const key = p.shape + (p.shape === 'custom' ? JSON.stringify(p.customShape || []).length : '');
          if (key !== shapeKey) {
            shapeKey = key;
            const src = p.shape === 'custom' && p.customShape && p.customShape.length > 2 ? p.customShape : presetShape(p.shape);
            shape = resample(src, 512, true);
            normals = shape.map((pt, i) => {
              const a = shape[(i + shape.length - 1) % shape.length], b = shape[(i + 1) % shape.length];
              const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
              return [ty / l, -tx / l];
            });
          }
          rot += dt * p.spin * (0.5 + F.mid);
          const c = Math.cos(rot), s = Math.sin(rot);
          const k = R * (1 + F.kick * 0.08 + F.drop * 0.15);
          const pts = [];
          for (let i = 0; i <= shape.length; i++) {
            const j = i % shape.length;
            const d = F.wave[(j * 4) % 2048] * 0.35 * p.gain;
            const x = shape[j][0] + normals[j][0] * d, y = shape[j][1] + normals[j][1] * d;
            pts.push([cx + (x * c - y * s) * k, cy + (x * s + y * c) * k]);
          }
          traces.push(pts);
        }
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const baseBright = 0.6 + F.level * 0.8;
        const E = Math.round(p.echoes || 0);
        for (let e = E; e >= 0; e--) {
        const bright = baseBright * (e ? Math.pow(0.62, e) : 1);
        ctx.save();
        if (e) { ctx.translate(cx, cy); ctx.rotate((p.echoTwist * e * Math.PI) / 180); const sc = Math.max(0.05, 1 + p.echoScale * e); ctx.scale(sc, sc); ctx.translate(-cx, -cy); }
        for (const pts of traces) {
          // bloom pass along the whole trace
          // (a null entry breaks the line: the beam is blanked while it jumps)
          if (p.glow > 0) {
            ctx.lineWidth = p.width * S * (5 + p.glow * 5);
            ctx.strokeStyle = rgba(col, 0.045 * p.glow * bright);
            ctx.beginPath(); let pen = false; for (const pt of pts) { if (!pt) { pen = false; continue; } pen ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]); pen = true; } ctx.stroke();
          }
          // phosphor: a slow beam burns brighter than a fast one
          const buckets = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
          const ref = p.mode === 'picture' ? Math.max(1, Math.min(W, H) / 120) : Math.max(1, (W + H) / pts.length);
          for (let i = 1; i < pts.length; i++) {
            if (!pts[i] || !pts[i - 1]) continue;
            const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
            const b = len < ref * 0.6 ? 3 : len < ref * 1.5 ? 2 : len < ref * 4 ? 1 : 0;
            buckets[b].moveTo(pts[i - 1][0], pts[i - 1][1]); buckets[b].lineTo(pts[i][0], pts[i][1]);
          }
          const alphas = [0.18, 0.4, 0.7, 1];
          buckets.forEach((path, b) => {
            ctx.lineWidth = p.width * S * 2.2; ctx.strokeStyle = rgba(col, alphas[b] * 0.35 * bright); ctx.stroke(path);
            ctx.lineWidth = p.width * S; ctx.strokeStyle = rgba(scaleRgb(col, 1.25), alphas[b] * bright); ctx.stroke(path);
          });
        }
        ctx.restore();
        }
        if (self.capturing) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = rgba(col, 0.9); ctx.font = `${13 * S}px system-ui, sans-serif`; ctx.textAlign = 'center';
          ctx.fillText(drawing ? 'Release to finish' : 'Draw one continuous line. Press Esc to cancel.', cx, 24 * S);
          if (stroke.length > 1) {
            ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = 2 * S;
            ctx.beginPath(); stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H))); ctx.stroke();
          }
          self._lastParams = p; self._WH = [W, H];
        }
        ctx.globalCompositeOperation = 'source-over';
      },
      action(key, p, done) {
        if (key === 'draw') { self.capturing = true; stroke = []; p.mode = 'shape'; return 'Draw on the widget now. Press Esc to cancel.'; }
        if (key === 'loadPicture') {
          const input = document.createElement('input');
          input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml';
          input.onchange = async () => {
            const f = input.files && input.files[0];
            if (!f) return;
            try { p.picture = await loadPicture(f); p.mode = 'picture'; pic.error = ''; }
            catch (e) { pic.error = e.message; }
            if (done) done();
          };
          input.click();
        }
      },
      // x, y are 0..1 within the widget
      pointer(type, x, y, p) {
        if (!self.capturing) return false;
        if (type === 'cancel') { self.capturing = false; drawing = false; stroke = []; return true; }
        if (type === 'down') { drawing = true; stroke = [[x, y]]; }
        else if (type === 'move' && drawing) { const l = stroke[stroke.length - 1]; if (Math.hypot(x - l[0], y - l[1]) > 0.004) stroke.push([x, y]); }
        else if (type === 'up' && drawing) {
          drawing = false; self.capturing = false;
          if (stroke.length > 4) {
            const [W, H] = self._WH || [1, 1];
            const m = Math.min(W, H) * 0.42;
            p.customShape = stroke.map(([sx, sy]) => [+(((sx - 0.5) * W) / m).toFixed(4), +(((sy - 0.5) * H) / m).toFixed(4)]);
            p.shape = 'custom'; shapeKey = '';
          }
          stroke = [];
        }
        return true;
      },
      resize() {},
      dispose() {}
    };
    return self;
  }
};
