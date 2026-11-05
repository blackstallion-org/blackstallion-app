#!/usr/bin/env python3
"""Build the app-sized image library from the generated sources.

Reads mobile/assets/library/assets-manifest.json. For every asset whose status
starts with "approved" and whose source exists:
  * cutouts (transparent PNG): trimmed to the alpha bounds plus a small margin,
    longest side 1200 px, quantized with pngquant (quality 80-95);
  * photographs: longest side 1400 px, JPEG quality 82, progressive.
Writes the derivative to the asset's app_path and records width/height/bytes in
the manifest. Rejected or unreviewed assets are skipped (never shipped).

Usage: python3 scripts/build-image-library.py   (run from mobile/)
"""
import json
import os
import shutil
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'assets', 'library')
MANIFEST = os.path.join(LIB, 'assets-manifest.json')
REPO = os.path.dirname(ROOT)


def build_cutout(src, dst):
    im = Image.open(src).convert('RGBA')
    alpha = im.split()[3].point(lambda v: 255 if v > 8 else 0)
    box = alpha.getbbox()
    if box:
        pad = int(max(im.size) * 0.02)
        box = (max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad))
        im = im.crop(box)
    im.thumbnail((1200, 1200), Image.LANCZOS)
    tmp = dst + '.tmp.png'
    im.save(tmp, optimize=True)
    pq = shutil.which('pngquant')
    if pq:
        subprocess.run([pq, '--quality=80-95', '--speed=1', '--force', '--output', dst, tmp], check=True)
        os.remove(tmp)
    else:
        os.replace(tmp, dst)
    return im.size


def build_photo(src, dst):
    im = Image.open(src).convert('RGB')
    im.thumbnail((1400, 1400), Image.LANCZOS)
    im.save(dst, 'JPEG', quality=82, optimize=True, progressive=True)
    return im.size


def main():
    m = json.load(open(MANIFEST))
    built = 0
    for a in m['assets']:
        if not str(a.get('status', '')).startswith('approved'):
            continue
        src = os.path.join(REPO, a['source_path'])
        if not os.path.exists(src):
            print('missing source', a['id'], file=sys.stderr)
            continue
        dst = os.path.join(REPO, a['app_path'])
        size = build_cutout(src, dst) if 'cut-out' in a.get('composition', '') else build_photo(src, dst)
        a['app_width'], a['app_height'] = size
        a['app_bytes'] = os.path.getsize(dst)
        built += 1
        print(f"{a['id']:18} {size[0]}x{size[1]} {a['app_bytes'] // 1024} KB")
    json.dump(m, open(MANIFEST, 'w'), indent=1)
    print('built', built)


if __name__ == '__main__':
    main()
