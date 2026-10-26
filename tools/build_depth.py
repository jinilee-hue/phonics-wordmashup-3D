#!/usr/bin/env python3
"""Depth map for the backdrop painting, so the 3D camera can fly INTO the picture (2.5D parallax).

Runs Depth Anything V2 Small locally on CPU (Apache-2.0; no network service sees the image) and
writes public/gl/bg_depth.png: 8-bit relative disparity, 1024 x 576, 255 = nearest.

Run:  uv run --with torch --with transformers --with pillow --with numpy python tools/build_depth.py
"""
import os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'Word Mashup', 'Images', 'game_bg.png')
OUT = os.path.join(ROOT, 'public', 'gl', 'bg_depth.png')
W, H = 1024, 576


def main():
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    name = 'depth-anything/Depth-Anything-V2-Small-hf'
    proc = AutoImageProcessor.from_pretrained(name)
    model = AutoModelForDepthEstimation.from_pretrained(name).eval()
    img = Image.open(SRC).convert('RGB')
    with torch.no_grad():
        inputs = proc(images=img, return_tensors='pt')
        pred = model(**inputs).predicted_depth            # (1, h, w) relative inverse depth
        pred = torch.nn.functional.interpolate(pred[:, None], size=(H, W), mode='bicubic', align_corners=False)[0, 0]
    d = pred.numpy().astype(np.float64)
    lo, hi = np.percentile(d, 0.5), np.percentile(d, 99.5)
    d = np.clip((d - lo) / (hi - lo), 0, 1)
    im = Image.fromarray((d * 255 + 0.5).astype(np.uint8), 'L')
    # soften pixel noise; keep big edges (median then light blur)
    im = im.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.GaussianBlur(1.2))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    im.save(OUT, optimize=True)
    a = np.asarray(im)
    print('wrote', OUT, im.size, 'min/median/max', a.min(), int(np.median(a)), a.max())
    # quick profile down the centre column (top -> bottom): far sky should be low, stage high
    col = a[:, W // 2]
    print('centre column (10% steps):', [int(col[int(i * (H - 1) / 10)]) for i in range(11)])


if __name__ == '__main__':
    main()
