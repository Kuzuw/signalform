#!/usr/bin/env python3
"""Renders frames of the Signalform effects natively (test/harness.c) and saves PNGs.

  python3 test/render.py EFFECT OUT.png [--size 960x540] [--time 2.0] [--input picture.png]
                         [--set key=value ...] [--frames 6 --every 0.25]

Parameters not set take the manifest's defaults. Colours are r,g,b,a; points x,y as fractions.
With --frames, the frames are laid out in a strip over time.
"""
import argparse, json, os, struct, subprocess, sys, tempfile
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, '..', 'build')


def flat(manifest, sets, w, h):
    out = []
    for p in manifest['params']:
        v = sets.get(p['id'], p.get('default'))
        t = p['type']
        if t in ('slider', 'angle'):
            out.append(float(v if v is not None else 0))
        elif t == 'checkbox':
            out.append(1.0 if (v in (True, 'true', '1', 1)) else 0.0)
        elif t == 'popup':
            if isinstance(v, str) and not v.isdigit():
                v = p['options'].index(v)
            out.append(float(v or 0))
        elif t == 'point':
            x, y = (v if isinstance(v, list) else [float(a) for a in v.split(',')])
            out += [x * w, y * h]
        elif t == 'color':
            out += list(v if isinstance(v, list) else [float(a) for a in v.split(',')])
    return out


def render(effect, w, h, t, sets, inp=None, scale=1.0):
    exe = os.path.join(BUILD, effect)
    manifest = json.loads(subprocess.check_output([exe, '--manifest']))
    params = flat(manifest, sets, w, h)
    with tempfile.TemporaryDirectory() as d:
        src = '-'
        if inp:
            im = Image.open(inp).convert('RGBA').resize((w, h), Image.LANCZOS)
            src = os.path.join(d, 'in.raw')
            with open(src, 'wb') as f:
                f.write(struct.pack('<%df' % (w * h * 4), *[c / 255.0 for px in im.getdata() for c in px]))
        out = os.path.join(d, 'out.raw')
        r = subprocess.run([exe, str(w), str(h), str(t), str(scale), src, out] + ['%r' % v for v in params], capture_output=True, text=True)
        sys.stderr.write(f'{effect} t={t}: {r.stderr.strip()}\n')
        data = struct.unpack('<%df' % (w * h * 4), open(out, 'rb').read())
    img = Image.new('RGB', (w, h))
    pix = []
    for i in range(0, len(data), 4):
        r_, g_, b_, a = data[i:i + 4]
        # premultiplied over black
        pix.append(tuple(max(0, min(255, int(c * 255 + 0.5))) for c in (r_, g_, b_)))
    img.putdata(pix)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('effect'); ap.add_argument('out')
    ap.add_argument('--size', default='960x540'); ap.add_argument('--time', type=float, default=2.0)
    ap.add_argument('--input'); ap.add_argument('--set', action='append', default=[])
    ap.add_argument('--frames', type=int, default=1); ap.add_argument('--every', type=float, default=0.25)
    ap.add_argument('--cols', type=int, default=3)
    a = ap.parse_args()
    w, h = map(int, a.size.split('x'))
    sets = {}
    for s in a.set:
        k, v = s.split('=', 1)
        try: v = json.loads(v)
        except ValueError: pass
        sets[k] = v
    if a.frames == 1:
        render(a.effect, w, h, a.time, sets, a.input).save(a.out)
        return
    cols = min(a.cols, a.frames); rows = (a.frames + cols - 1) // cols
    sheet = Image.new('RGB', (w * cols, h * rows))
    for i in range(a.frames):
        sheet.paste(render(a.effect, w, h, a.time + i * a.every, sets, a.input), ((i % cols) * w, (i // cols) * h))
    sheet.save(a.out)


if __name__ == '__main__':
    main()
