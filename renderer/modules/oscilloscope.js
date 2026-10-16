import { hexToRgb, rgba, fade, scaleRgb, TAU } from './util.js';

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
    { key: 'mode', label: 'Display', type: 'select', default: 'shape', options: [['yt', 'Waveform (Y/T)'], ['xy', 'Stereo phase (X/Y)'], ['shape', 'Custom shape']] },
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
    { key: 'color', label: 'Phosphor color', section: 'Color', type: 'color', default: '#8dffb0' },
    { key: 'grid', label: 'Graticule', type: 'toggle', default: false }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let shapeKey = '', shape = [], normals = [], rot = 0;
    let drawing = false, stroke = [];
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
          if (p.glow > 0) {
            ctx.lineWidth = p.width * S * (5 + p.glow * 5);
            ctx.strokeStyle = rgba(col, 0.045 * p.glow * bright);
            ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
          }
          // phosphor: a slow beam burns brighter than a fast one
          const buckets = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
          const ref = Math.max(1, (W + H) / pts.length);
          for (let i = 1; i < pts.length; i++) {
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
      action(key, p) { if (key === 'draw') { self.capturing = true; stroke = []; p.mode = 'shape'; } },
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
