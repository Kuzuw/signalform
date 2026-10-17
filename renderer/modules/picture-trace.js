// Turns a picture into one long beam path, the way oscilloscope art is made:
// find the edges (and optionally hatch the dark areas), then visit every edge pixel in a single
// tour, walking to neighbours where it can and jumping (beam blanking) where it can't.
// Pure functions over plain pixel arrays, so the tests can run them in Node.

// gray: Float32Array (0..1, 1 = white), w, h. Returns { pts: Float32Array [x, y, jump]*, count }
// with x, y in -1..1 (the longer side spans -1..1) and jump = 1 where the beam jumps to this point.
export function tracePicture(gray, w, h, { detail = 3000, edges = 0.5, shade = 0, invert = false } = {}) {
  const N = w * h;
  const g = new Float32Array(N);
  // light blur so noise and JPEG blocks don't become edges
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += gray[yy * w + xx]; c++; }
    }
    g[y * w + x] = s / c;
  }
  // Sobel gradient
  const mag = new Float32Array(N), dir = new Uint8Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = (g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - 1] + g[i + w - 1]);
    const gy = (g[i + w - 1] + 2 * g[i + w] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1]);
    mag[i] = Math.hypot(gx, gy);
    const a = (Math.atan2(gy, gx) + Math.PI) / Math.PI * 4;      // 0..8
    dir[i] = Math.round(a) % 4;                                    // 0: horizontal gradient, 1: diagonal, 2: vertical, 3: other diagonal
  }
  // threshold: keep the strongest share of gradients (more with a higher "edges" setting)
  const sample = [];
  for (let i = 0; i < N; i += 3) if (mag[i] > 0.02) sample.push(mag[i]);
  sample.sort((a, b) => a - b);
  const keep = 0.08 + edges * 0.5;                                  // share of textured pixels kept
  const thr = Math.max(0.12, sample.length ? sample[Math.floor(sample.length * (1 - keep))] || 0 : 1);
  // non-maximum suppression: thin edges to one pixel
  const OFF = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  const on = new Uint8Array(N);
  let count = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, m = mag[i];
    if (m < thr) continue;
    const [ox, oy] = OFF[dir[i]];
    if (m >= mag[i + oy * w + ox] && m >= mag[i - oy * w - ox]) { on[i] = 1; count++; }
  }
  // hatching: horizontal lines through the dark areas, every few rows
  if (shade > 0) {
    let mean = 0; for (let i = 0; i < N; i++) mean += g[i]; mean /= N;
    const level = invert ? 1 - mean * (0.25 + shade * 0.45) : mean * (0.25 + shade * 0.45);
    const step = Math.max(2, Math.round(6 - shade * 3));
    for (let y = 1; y < h - 1; y += step) for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x, v = g[i];
      if ((invert ? v > level : v < level) && !on[i]) { on[i] = 2; count++; }
    }
  }
  if (!count) return { pts: new Float32Array(0), count: 0 };

  // spatial buckets for finding the nearest unvisited pixel after a dead end
  const B = 8, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const buckets = Array.from({ length: bw * bh }, () => []);
  for (let i = 0; i < N; i++) if (on[i]) buckets[((i / w | 0) / B | 0) * bw + ((i % w) / B | 0)].push(i);
  const left = new Int32Array(bw * bh); for (let k = 0; k < buckets.length; k++) left[k] = buckets[k].length;
  const seen = new Uint8Array(N);
  const take = (i) => { seen[i] = 1; left[((i / w | 0) / B | 0) * bw + ((i % w) / B | 0)]--; };
  function nearest(x, y) {
    const bx = x / B | 0, by = y / B | 0;
    for (let r = 0; r < Math.max(bw, bh); r++) {
      let best = -1, bd = Infinity;
      for (let yy = by - r; yy <= by + r; yy++) for (let xx = bx - r; xx <= bx + r; xx++) {
        if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
        if (Math.max(Math.abs(xx - bx), Math.abs(yy - by)) !== r) continue;   // ring only
        const k = yy * bw + xx;
        if (!left[k]) continue;
        for (const i of buckets[k]) if (!seen[i]) { const d = (i % w - x) ** 2 + ((i / w | 0) - y) ** 2; if (d < bd) { bd = d; best = i; } }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  // the tour
  const order = new Int32Array(count), jump = new Uint8Array(count);
  let n = 0, cur = -1;
  for (let i = 0; i < N && cur < 0; i++) if (on[i]) cur = i;
  take(cur); order[n] = cur; jump[n] = 1; n++;
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]];
  while (n < count) {
    const x = cur % w, y = cur / w | 0;
    let next = -1;
    for (const [dx, dy] of NB) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (on[j] && !seen[j]) { next = j; break; }
    }
    let jumped = 0;
    if (next < 0) { next = nearest(x, y); jumped = 1; }
    if (next < 0) break;
    take(next); order[n] = next; jump[n] = jumped; n++; cur = next;
  }
  // thin out to the requested number of points, never dropping a jump or a stroke's first point
  const stride = Math.max(1, n / Math.max(200, detail));
  const out = [];
  const S = Math.max(w, h) / 2;
  let acc = stride, pendingJump = 0;
  for (let k = 0; k < n; k++) {
    pendingJump |= jump[k];
    acc += 1;
    const isEnd = k + 1 < n && jump[k + 1];
    if (acc >= stride || jump[k] || isEnd) {
      acc -= stride; if (acc > stride) acc = 0;
      const i = order[k];
      out.push((i % w - w / 2) / S, ((i / w | 0) - h / 2) / S, pendingJump);
      pendingJump = 0;
    }
  }
  return { pts: Float32Array.from(out), count: out.length / 3 };
}

// Browser only: read an image file, scale it down and return a small JPEG data URL plus its pixels.
export async function loadPicture(file, maxSide = 320) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Not an image this app can read')); im.src = url; });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(img.naturalWidth * k)); c.height = Math.max(8, Math.round(img.naturalHeight * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);   // transparent areas count as white paper
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  } finally { URL.revokeObjectURL(url); }
}

// Browser only: data URL → grayscale pixels
export function pictureGray(dataUrl) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data, gray = new Float32Array(c.width * c.height);
      for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      res({ gray, w: c.width, h: c.height });
    };
    im.onerror = () => rej(new Error('Could not read the picture'));
    im.src = dataUrl;
  });
}
