"""Compare the rim luminance profile on the wall side vs the far side of each un-warped face.

Right cards are mirrored so the wall side is always index 0.  A leftover wall band shows as a
darker start on the wall side; a cut rim shows as the wall-side profile 'starting later'.
"""
import glob, os, sys
import numpy as np
from PIL import Image

D = sys.argv[1]
rows = []
for f in sorted(glob.glob(os.path.join(D, '*.webp'))):
    key = os.path.basename(f)[:-5]
    im = np.asarray(Image.open(f).convert('RGBA')).astype(np.float32) / 255
    if key.startswith('right_'):
        im = im[:, ::-1]
    L = im[..., 0] * .2126 + im[..., 1] * .7152 + im[..., 2] * .0722
    a = im[..., 3]
    band = slice(250, 550)
    wall = L[band, :60].mean(0)
    far = L[band, ::-1][:, :60].mean(0)
    bot = L[::-1, 150:450][:60].mean(1)     # bottom edge inward
    top = L[:60, 150:450].mean(1)
    idx = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32]
    fmt = lambda p: ' '.join(f'{p[i]*100:3.0f}' for i in idx)
    d_side = float(np.abs(wall[:32] - far[:32]).mean() * 100)
    d_tb = float(np.abs(bot[:32] - top[:32]).mean() * 100)
    rows.append((d_side, key, fmt(wall), fmt(far), d_tb, fmt(bot), fmt(top)))
rows.sort(reverse=True)
print('px:               ', ' '.join(f'{i:3d}' for i in [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32]))
for d_side, key, w, f, d_tb, b, t in rows:
    print(f'{key:13s} side {d_side:4.1f}  wall {w}\n{"":13s}            far  {f}\n{"":13s} tb {d_tb:4.1f}    bot  {b}\n{"":13s}            top  {t}')
