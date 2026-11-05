#!/usr/bin/env python3
"""
Labelled contact sheet from a web-shots.py output directory.

Usage (from mobile/):  python3 scripts/contact-sheet.py <dir> <out.png> [--title TEXT] [--cols 8]

Uses <dir>/manifest.json (written by web-shots.py) for labels when present,
otherwise parses NAME-THEME-WxH.png file names. Tall captures (--full) are shown
by their first screens. Every sheet carries the "web render — not native" label.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess

from PIL import Image, ImageDraw, ImageFont

LABEL = 'web render (react-native-web, Chromium) — not native iOS/Android'
BAND = 150  # label band added by web-shots.py (device pixels)


def font(size: int, bold: bool = False):
    try:
        f = subprocess.run(['fc-match', '-f', '%{file}', 'Inter:semibold' if bold else 'Inter'], capture_output=True, text=True).stdout
        if f and os.path.exists(f):
            return ImageFont.truetype(f, size)
    except Exception:
        pass
    return ImageFont.load_default()


def entries(src: str) -> list[dict]:
    man = os.path.join(src, 'manifest.json')
    if os.path.exists(man):
        rows = [m for m in json.load(open(man)) if os.path.exists(os.path.join(src, m['file']))]
        if rows:
            return rows
    out = []
    for f in sorted(os.listdir(src)):
        m = re.match(r'(.+)-(dark|light|system)-(\d+x\d+)\.png$', f)
        if m and 'FAILED' not in f:
            out.append({'file': f, 'name': m.group(1), 'theme': m.group(2), 'size': m.group(3), 'route': ''})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dir')
    ap.add_argument('out')
    ap.add_argument('--title', default='BSAH screens')
    ap.add_argument('--cols', type=int, default=8)
    ap.add_argument('--thumb-height', type=int, default=520)
    args = ap.parse_args()

    rows = entries(args.dir)
    if not rows:
        raise SystemExit(f'no captures found in {args.dir}')
    th = args.thumb_height
    thumbs = []
    for e in rows:
        im = Image.open(os.path.join(args.dir, e['file'])).convert('RGB')
        body = im.crop((0, 0, im.width, im.height - BAND)) if im.height > BAND * 3 else im
        if body.height > body.width * 2.3:  # --full captures: first screens only
            body = body.crop((0, 0, body.width, int(body.width * 2.16)))
        tw = max(1, int(body.width * th / body.height))
        t = body.resize((tw, th), Image.LANCZOS)
        cap = Image.new('RGB', (max(tw, 230), th + 64), (24, 13, 7))
        cap.paste(t, ((cap.width - tw) // 2, 0))
        d = ImageDraw.Draw(cap)
        d.text((8, th + 6), e['name'][:30], fill=(255, 246, 236), font=font(15, True))
        d.text((8, th + 26), f"{e.get('theme', '')} · {e.get('size', '')}", fill=(255, 217, 163), font=font(14))
        d.text((8, th + 44), (e.get('route') or ' ')[:34], fill=(226, 205, 186), font=font(12))
        thumbs.append(cap)

    gap, margin, header = 18, 40, 150
    lines = [thumbs[i:i + args.cols] for i in range(0, len(thumbs), args.cols)]
    width = max(1400, max(sum(t.width for t in r) + gap * (len(r) - 1) for r in lines) + 2 * margin)
    height = header + sum(max(t.height for t in r) for r in lines) + gap * (len(lines) - 1) + 60
    sheet = Image.new('RGB', (width, height), (26, 13, 6))
    d = ImageDraw.Draw(sheet)
    d.text((margin, 30), args.title, fill=(255, 246, 236), font=font(34, True))
    d.text((margin, 82), f'{LABEL}. Synthetic preview personas and fixtures. {len(thumbs)} captures.', fill=(255, 217, 163), font=font(20))
    y = header
    for r in lines:
        x = margin
        for t in r:
            sheet.paste(t, (x, y))
            x += t.width + gap
        y += max(t.height for t in r) + gap
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    sheet.save(args.out, optimize=True)
    print(f'[contact-sheet] {args.out} {sheet.size[0]}x{sheet.size[1]} ({len(thumbs)} tiles)')


if __name__ == '__main__':
    main()
