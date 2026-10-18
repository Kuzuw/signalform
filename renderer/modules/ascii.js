import { noise3, hexToRgb, mixRgb, rgba, clear, clamp } from './util.js';

const GLYPHS = { signs: '  x%X&#@', classic: ' .:-=+*#%@', blocks: ' ░▒▓█', dots: ' ·•●', binary: ' 01', hex: ' 0123456789ABCDEF', lines: ' -=≡', kana: ' ｰｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺ' };

export default {
  id: 'ascii',
  name: 'ASCII',
  tagline: 'Audio-reactive character rasterization.',
  params: [
    { key: 'source', label: 'Source', type: 'select', default: 'field', options: [['field', 'Noise field'], ['spectrum', 'Spectrum'], ['wave', 'Waveform'], ['text', 'Your text']] },
    { key: 'text', label: 'Text', type: 'text', default: 'SIGNAL', showIf: { source: 'text' } },
    { key: 'glyphs', label: 'Glyph set', type: 'select', default: 'signs', section: 'Glyphs', options: [['signs', 'Signs x X % & # @'], ['classic', 'Classic  .:-=+*#%@'], ['blocks', 'Blocks ░▒▓█'], ['dots', 'Dots ·•●'], ['binary', 'Binary 01'], ['hex', 'Hex 0–F'], ['lines', 'Lines -=≡'], ['kana', 'Katakana'], ['custom', 'My characters']] },
    { key: 'charset', label: 'Characters (light → dense)', type: 'text', default: ' .:-=+*#%@', showIf: { glyphs: 'custom' } },
    { key: 'weight', label: 'Weight', type: 'select', default: '600', options: [['300', 'Light'], ['500', 'Regular'], ['600', 'Medium'], ['800', 'Bold']] },
    { key: 'cell', label: 'Glyph size', type: 'range', min: 6, max: 40, step: 1, default: 18 },
    { key: 'spacing', label: 'Letter spacing', type: 'range', min: 0.45, max: 1.2, step: 0.01, default: 0.62 },
    { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 2, step: 0.05, default: 1.05, section: 'Motion' },
    { key: 'contrast', label: 'Contrast', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'motion', label: 'Glyph motion', type: 'select', default: 'drift', options: [['still', 'Still'], ['drift', 'Drift'], ['rain', 'Rain'], ['jitter', 'Jitter']] },
    { key: 'speed', label: 'Motion speed', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'punch', label: 'Bass punch', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'sparkle', label: 'Hi-hat sparkle', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'bandMap', label: 'Columns follow frequencies', type: 'toggle', default: true },
    { key: 'colorMode', label: 'Coloring', type: 'select', default: 'gradient', section: 'Color', options: [['mono', 'Single color'], ['gradient', 'By intensity'], ['frequency', 'By frequency']] },
    { key: 'colorA', label: 'Color A', type: 'color', default: '#3c3c42' },
    { key: 'colorB', label: 'Color B', type: 'color', default: '#f4f4f6' },
    { key: 'bloom', label: 'Glow', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: 'invert', label: 'Invert', type: 'toggle', default: false }
  ],
  create(canvas) {
    const ctx = canvas.getContext('2d');
    let atlas = null, atlasPx = null, atlasKey = '', cw = 8, ch = 12, cols = 0, rows = 0;
    let frame = null, frame32 = null;
    const glowC = document.createElement('canvas'), gctx = glowC.getContext('2d');
    let mask = null, maskKey = '';
    let rings = [], rowShift = new Float32Array(0), scroll = 0, drift = 0;
    const LEVELS = 12;

    function buildAtlas(p, S) {
      const cell = Math.round(p.cell * S);
      const set = GLYPHS[p.glyphs] || p.charset || ' .:-=+*#%@';
      const key = [set, cell, p.colorA, p.colorB, p.colorMode, p.weight, p.spacing].join('|');
      if (key === atlasKey) return;
      atlasKey = key;
      ch = cell; cw = Math.max(3, Math.round(cell * p.spacing));
      const chars = [...set];
      atlas = document.createElement('canvas');
      atlas.width = cw * chars.length; atlas.height = ch * LEVELS;
      const a = atlas.getContext('2d', { willReadFrequently: true });
      a.fillStyle = '#000'; a.fillRect(0, 0, atlas.width, atlas.height);
      a.font = `${p.weight} ${cell}px ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace`;
      a.textBaseline = 'middle'; a.textAlign = 'center';
      const A = hexToRgb(p.colorA), B = hexToRgb(p.colorB);
      for (let l = 0; l < LEVELS; l++) {
        const t = l / (LEVELS - 1);
        a.fillStyle = rgba(p.colorMode === 'mono' ? A : mixRgb(A, B, t), p.colorMode === 'gradient' ? 0.55 + 0.45 * t : 1);
        chars.forEach((c, i) => a.fillText(c, i * cw + cw / 2, l * ch + ch / 2 + 1));
      }
      atlas.nChars = chars.length; atlas.blank = chars[0] === ' ';
      atlasPx = new Uint32Array(a.getImageData(0, 0, atlas.width, atlas.height).data.buffer);
      maskKey = '';
    }

    function buildMask(p) {
      const key = p.text + '|' + cols + 'x' + rows;
      if (key === maskKey) return;
      maskKey = key;
      const m = document.createElement('canvas'); m.width = cols; m.height = rows;
      const g = m.getContext('2d');
      const txt = (p.text || ' ').slice(0, 40);
      let size = rows * 0.8;
      g.font = `900 ${size}px system-ui, sans-serif`;
      // characters are ~1.6× taller than wide, so stretch text horizontally to look right
      const wTxt = g.measureText(txt).width * (ch / cw);
      if (wTxt > cols * 0.9) size *= (cols * 0.9) / wTxt;
      g.save(); g.scale(cw > 0 ? ch / cw : 1, 1);
      g.font = `900 ${size}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
      g.fillText(txt, (cols / 2) / (ch / cw), rows / 2);
      g.restore();
      const d = g.getImageData(0, 0, cols, rows).data;
      mask = new Float32Array(cols * rows);
      for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] / 255;
    }

    return {
      render(F, { dt, t, W, H, S, params: p }) {
        buildAtlas(p, S);
        cols = Math.max(4, Math.floor(W / cw)); rows = Math.max(3, Math.floor(H / ch));
        if (rowShift.length !== rows) rowShift = new Float32Array(rows);
        if (p.source === 'text') buildMask(p);
        if (!frame || frame.width !== W || frame.height !== H) { frame = ctx.createImageData(W, H); frame32 = new Uint32Array(frame.data.buffer); }
        frame32.fill(0xff000000);
        const AW = atlas.width;
        const n = atlas.nChars;
        const sp = p.speed;
        scroll += dt * sp * (4 + F.bass * 10);
        drift += dt * sp * (0.15 + F.mid * 0.4);
        for (const o of F.onsets) if (o.band === 'kick') rings.push({ r: 0, s: o.strength });
        rings = rings.filter((r) => (r.r += dt * (18 + 30 * sp)) < cols * 1.2);
        if (F.snare > 0.6) for (let y = 0; y < rows; y++) if (Math.random() < 0.08) rowShift[y] = (Math.random() - 0.5) * 8 * p.punch;
        for (let y = 0; y < rows; y++) rowShift[y] *= Math.exp(-dt * 8);
        const ox = Math.round(-cw * 0) , oy = Math.round((H - rows * ch) / 2), ox2 = Math.round((W - cols * cw) / 2);
        const cx = cols / 2, cy = rows / 2;
        const bands = F.bands, nb = bands.length;
        const spark = F.hat * p.sparkle * 0.05 + F.high * p.sparkle * 0.004;
        const dens = p.density;
        for (let y = 0; y < rows; y++) {
          const sy = p.motion === 'rain' ? y - scroll : y;
          for (let x = 0; x < cols; x++) {
            const xs = x + Math.round(rowShift[y]);
            let v;
            const bi = Math.min(nb - 1, Math.floor((x / cols) * nb));
            const bv = bands[bi];
            if (p.source === 'spectrum') {
              const yy = Math.abs(y - cy) / cy;
              v = clamp((bv * 1.25 - yy) * 3) * 0.9 + noise3(x * 0.2, sy * 0.2, t) * 0.08;
            } else if (p.source === 'wave') {
              const s = F.wave[Math.floor((x / cols) * 1024)] * (1.2 + F.bass * p.punch);
              const wy = cy + s * cy;
              v = Math.exp(-Math.abs(y - wy) * (0.55 - F.level * 0.25)) + noise3(x * 0.1, sy * 0.1, t * 0.5) * 0.05;
            } else if (p.source === 'text') {
              const m = mask[y * cols + ((xs % cols) + cols) % cols] || 0;
              v = m * (0.7 + 0.3 * F.bass * p.punch) + (noise3(x * 0.15, sy * 0.15, t * 0.7) * 0.5 + 0.5) * 0.12 * (1 - m);
            } else {
              const d = Math.hypot((x - cx) * 0.6, y - cy);
              let ring = 0;
              for (const r of rings) ring += Math.exp(-Math.pow((d - r.r) / 2.2, 2)) * r.s;
              const nx = p.motion === 'drift' ? x * 0.06 + drift : x * 0.06;
              v = (noise3(nx, sy * 0.1, t * 0.18 * sp) * 0.5 + 0.5) * (0.5 + F.mid * 0.6) + ring * 0.6 * p.punch + F.bass * 0.15 * p.punch - 0.12;
            }
            if (p.bandMap && p.source !== 'spectrum') v *= p.source === 'text' ? 0.8 + bv * 0.4 : 0.55 + bv * 0.9;
            v *= dens;
            // a contrast curve carves clear shapes out of the field instead of an even texture
            const cc = p.contrast ?? 0.6;
            if (cc > 0) { const u = clamp(v); v = u + (u * u * (3 - 2 * u) * u - u) * cc * 1.4; }
            if (Math.random() < spark) v = 1;
            if (p.invert) v = 1 - v;
            v = clamp(v);
            let ci = Math.floor(v * (n - 1) + 0.5);
            if (p.motion === 'jitter' && Math.random() < 0.04 * sp * (0.3 + F.hit)) ci = Math.min(n - 1, Math.max(0, ci + (Math.random() < 0.5 ? -1 : 1)));
            if (ci <= 0 && !p.invert && atlas.blank) continue;
            const lvl = p.colorMode === 'frequency' ? Math.floor((x / cols) * (LEVELS - 1)) : Math.floor(v * (LEVELS - 1));
            // copy the glyph's pixels straight into the frame buffer
            const dx = ox2 + x * cw + ox, dy = oy + y * ch;
            let src = lvl * ch * AW + ci * cw, dst = dy * W + dx;
            for (let r = 0; r < ch; r++, src += AW, dst += W) frame32.set(atlasPx.subarray(src, src + cw), dst);
          }
        }
        ctx.putImageData(frame, 0, 0);
        // soft glow: a blurred half-size copy added back on top
        if (p.bloom > 0) {
          const gw = Math.max(1, W >> 2), gh = Math.max(1, H >> 2);
          if (glowC.width !== gw || glowC.height !== gh) { glowC.width = gw; glowC.height = gh; }
          gctx.filter = `blur(${Math.max(1, ch * 0.25)}px)`; gctx.clearRect(0, 0, gw, gh); gctx.drawImage(canvas, 0, 0, gw, gh); gctx.filter = 'none';
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = p.bloom * (0.55 + F.level * 0.4);
          ctx.drawImage(glowC, 0, 0, W, H);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }
      },
      resize() { atlasKey = ''; frame = null; },
      dispose() {}
    };
  }
};
