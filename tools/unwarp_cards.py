#!/usr/bin/env python3
"""Un-warp Word Mashup's pre-rendered clay cards into front-facing faces for the 3D cards.

The word cards (card_left_*.png / card_right_*.png) are renders of a thick clay card turned
toward the screen centre: left cards show their LEFT wall plus a thin BOTTOM wall, right cards
the mirror image. Per card we find the four edges of the front face:
  - top edge and far edge: the alpha silhouette (no wall is visible there)
  - near edge and bottom edge: the dark-crease -> bright-bevel step in luminance
intersect them into a quad, and warp the quad to a FACE_W x FACE_H rectangle (homography).

Outputs
  public/gl/cards/{left,right}_<word>.webp   face, rounded-corner alpha
  src/gl/cardFaces.ts                        wall colour per card + face aspect/radius
  --debug DIR                                per-card overlay + contact sheet (not committed)

Run:  uv run --with pillow --with numpy python tools/unwarp_cards.py [--debug DIR] [words...]
"""
import argparse, glob, json, os, re, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'Word Mashup', 'Images')
OUT = os.path.join(ROOT, 'public', 'gl', 'cards')
TS = os.path.join(ROOT, 'src', 'gl', 'cardFaces.ts')

FACE_W, FACE_H = 600, 800          # 3:4, same box as the 2D card (200 x 268 ~ 0.746)
RADIUS = 0.105                     # face corner radius, fraction of FACE_W (shared with the 3D slab).
                                   # The art's own corners measure 0.094-0.117 (median 0.0996, see the
                                   # 'art corner radius' line); 0.085 left wall/smear wedges at every corner.
INSET = 0.006                      # trim a hair off every edge (AA fringe / bevel residue)
EDGE_BAND = 5                      # px at the outline re-filled from just inside (fringe, smears)


def lum(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def crossing(profile, i):
    """Sub-pixel position where `profile` crosses .5 between i and i+1."""
    a0, a1 = profile[i], profile[i + 1]
    if a0 == a1:
        return i + 0.5
    return i + (a0 - 0.5) / (a0 - a1)


def robust_line(t, v, rounds=3):
    """Fit v = p*t + q, dropping outliers (> 2.5 MAD) each round."""
    t = np.asarray(t, float); v = np.asarray(v, float)
    keep = np.ones(len(t), bool)
    p = q = 0.0
    for _ in range(rounds):
        p, q = np.polyfit(t[keep], v[keep], 1)
        r = np.abs(v - (p * t + q))
        mad = np.median(r[keep]) + 1e-6
        keep = r < max(2.5 * mad * 1.4826, 0.75)
        if keep.sum() < 8:
            break
    resid = np.abs(v[keep] - (p * t[keep] + q))
    return p, q, float(resid.mean()) if len(resid) else 9e9, int(keep.sum())


def peak(g, lo, hi):
    """Index (sub-pixel, parabolic) of the max of g in [lo, hi)."""
    seg = g[lo:hi]
    if len(seg) < 3:
        return None, 0
    k = int(np.argmax(seg))
    val = float(seg[k])
    if 0 < k < len(seg) - 1:
        y0, y1, y2 = seg[k - 1], seg[k], seg[k + 1]
        den = y0 - 2 * y1 + y2
        off = 0.5 * (y0 - y2) / den if den != 0 else 0
        return lo + k + off, val
    return lo + k, val


def smooth1d(x, axis, sigma=1.0):
    r = int(3 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    return np.apply_along_axis(lambda m: np.convolve(m, k, mode='same'), axis, x)


def bleed(rgb, alpha, iters=8):
    """Push opaque colours outward into transparent pixels so warping never pulls in black/white."""
    rgb = rgb.copy(); filled = alpha > 0.5
    for _ in range(iters):
        acc = np.zeros_like(rgb); cnt = np.zeros(alpha.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = np.roll(filled, (dy, dx), (0, 1)); c = np.roll(rgb, (dy, dx), (0, 1))
            acc += c * m[..., None]; cnt += m
        grow = (~filled) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        filled = filled | grow
    return rgb


def find_face(rgba):
    """Corners (TL, TR, BL, BR) of the front face of a LEFT-type card (walls on left + bottom)."""
    h, w = rgba.shape[:2]
    a = rgba[..., 3]
    L = lum(rgba[..., :3])
    L = smooth1d(smooth1d(L, 1, 0.8), 0, 0.8)
    rows = range(int(h * .2), int(h * .8))
    cols = range(int(w * .3), int(w * .72))
    # far edge (right): last alpha crossing per row
    fy, fx = [], []
    for y in rows:
        xs = np.where(a[y] >= 0.5)[0]
        if len(xs) and xs[-1] + 1 < w:
            fy.append(y); fx.append(crossing(a[y], xs[-1]))
    # top edge: first alpha crossing per column (scan downward)
    tx, ty = [], []
    for x in cols:
        ys = np.where(a[:, x] >= 0.5)[0]
        if len(ys) and ys[0] > 0:
            col = a[:, x][::-1]          # crossing() expects high->low, so walk from the bottom side
            i = h - 1 - ys[0]
            tx.append(x); ty.append(h - 1 - crossing(col, i))
    # near edge (left): strongest dark->bright step inside the wall window, per row
    gx = np.zeros_like(L); gx[:, 1:-1] = L[:, 2:] - L[:, :-2]
    ny, nx, nv = [], [], []
    for y in rows:
        xs = np.where(a[y] >= 0.5)[0]
        if not len(xs):
            continue
        x0 = xs[0] + max(3, int(w * .01))
        pk, val = peak(gx[y], x0, x0 + int(w * .17))
        if pk is not None:
            ny.append(y); nx.append(pk); nv.append(val)
    # bottom edge: strongest bright-above / dark-below step near the bottom, per column
    gy = np.zeros_like(L); gy[1:-1, :] = L[:-2, :] - L[2:, :]
    bx, by, bv = [], [], []
    for x in cols:
        ys = np.where(a[:, x] >= 0.5)[0]
        if not len(ys):
            continue
        y1 = ys[-1] - max(2, int(h * .004))
        pk, val = peak(gy[:, x], y1 - int(h * .08), y1)
        if pk is not None:
            bx.append(x); by.append(pk); bv.append(val)

    # silhouette near/bottom edges (back of the walls) - used when the luminance step is weak
    sy_, sx_ = [], []
    for y in rows:
        xs = np.where(a[y] >= 0.5)[0]
        if len(xs) and xs[0] > 0:
            prof = a[y][::-1]
            sy_.append(y); sx_.append(w - 1 - crossing(prof, w - 1 - xs[0]))
    ux_, uy_ = [], []
    for x in cols:
        ys = np.where(a[:, x] >= 0.5)[0]
        if len(ys) and ys[-1] + 1 < h:
            ux_.append(x); uy_.append(crossing(a[:, x], ys[-1]))

    lines = dict(
        far=robust_line(fy, fx),        # x = p*y + q
        top=robust_line(tx, ty),        # y = p*x + q
        near=robust_line(ny, nx),       # x = p*y + q
        bottom=robust_line(bx, by),     # y = p*x + q
        sil_near=robust_line(sy_, sx_),
        sil_bottom=robust_line(ux_, uy_),
    )
    steps = dict(near=float(np.median(nv)) if nv else 0, bottom=float(np.median(bv)) if bv else 0)
    pts = dict(far=(fx, fy), top=(tx, ty), near=(nx, ny), bottom=(bx, by))
    return lines, steps, pts, (w, h)


def meet(p, q, r, s):                        # x = p*y + q  and  y = r*x + s
    x = (p * s + q) / (1 - p * r)
    return np.array([x, r * x + s])


def corners_of(lines):
    pf, qf = lines['far'][:2]; pt, qt = lines['top'][:2]
    pn, qn = lines['near'][:2]; pb, qb = lines['bottom'][:2]
    return meet(pn, qn, pt, qt), meet(pf, qf, pt, qt), meet(pn, qn, pb, qb), meet(pf, qf, pb, qb)


def confident(lines, steps, edge):
    err = lines[edge][2]
    return err < 0.6 and steps[edge] > (0.06 if edge == 'near' else 0.08)


def wall_offsets(lines, size):
    """Wall thickness at mid-card: near (fraction of w), bottom (fraction of h)."""
    w, h = size
    ym, xm = h / 2, w / 2
    pn, qn = lines['near'][:2]; ps, qs = lines['sil_near'][:2]
    pb, qb = lines['bottom'][:2]; pu, qu = lines['sil_bottom'][:2]
    return ((pn * ym + qn) - (ps * ym + qs)) / w, ((pu * xm + qu) - (pb * xm + qb)) / h


def apply_fallback(lines, size, off_near, off_bottom, fix_near, fix_bottom):
    w, h = size
    lines = dict(lines)
    if fix_near:
        ps, qs, *_ = lines['sil_near']
        lines['near'] = (ps, qs + off_near * w, -1, 0)
    if fix_bottom:
        pu, qu, *_ = lines['sil_bottom']
        lines['bottom'] = (pu, qu - off_bottom * h, -1, 0)
    return lines


def aspect_zhang(corners, w, h):
    """Aspect (width/height) of the real rectangle from its perspective image (Zhang & He 2007)."""
    TL, TR, BL, BR = [np.array([c[0], c[1], 1.0]) for c in corners]
    m1, m2, m3, m4 = TL, TR, BL, BR
    k2 = np.dot(np.cross(m1, m4), m3) / np.dot(np.cross(m2, m4), m3)
    k3 = np.dot(np.cross(m1, m4), m2) / np.dot(np.cross(m3, m4), m2)
    n2 = k2 * m2 - m1
    n3 = k3 * m3 - m1
    u0, v0 = w / 2, h / 2
    if abs(n2[2] * n3[2]) < 1e-12:
        return float(np.hypot(*n2[:2]) / np.hypot(*n3[:2])), None
    f2 = -((n2[0] * n3[0] - (n2[0] * n3[2] + n2[2] * n3[0]) * u0 + n2[2] * n3[2] * u0 ** 2) +
           (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + n2[2] * n3[2] * v0 ** 2)) / (n2[2] * n3[2])
    if f2 <= 0:
        return float(np.hypot(*n2[:2]) / np.hypot(*n3[:2])), None
    f = np.sqrt(f2)
    Ai = np.linalg.inv(np.array([[f, 0, u0], [0, f, v0], [0, 0, 1]]))
    B = Ai.T @ Ai
    return float(np.sqrt((n2 @ B @ n2) / (n3 @ B @ n3))), float(f)


def perspective_coeffs(dst_quad, size):
    """PIL PERSPECTIVE coeffs mapping output pixel (u,v) -> source (x,y)."""
    W, H = size
    src = [(0, 0), (W, 0), (0, H), (W, H)]
    A, b = [], []
    for (u, v), (x, y) in zip(src, dst_quad):
        A.append([u, v, 1, 0, 0, 0, -x * u, -x * v]); b.append(x)
        A.append([0, 0, 0, u, v, 1, -y * u, -y * v]); b.append(y)
    return np.linalg.solve(np.array(A, float), np.array(b, float)).tolist()


def inset_quad(c, f):
    TL, TR, BL, BR = c
    cen = (TL + TR + BL + BR) / 4
    return [cen + (p - cen) * (1 - 2 * f) for p in c]


def rounded_mask(W, H, r, ss=4):
    big = Image.new('L', (W * ss, H * ss), 0)
    ImageDraw.Draw(big).rounded_rectangle([0, 0, W * ss - 1, H * ss - 1], radius=r * ss, fill=255)
    return big.resize((W, H), Image.LANCZOS)


def edge_extend(face, r, band):
    """Re-fill the outermost `band` px of the rounded outline (and the pixels just outside it, which
    the antialiased mask edge still shows) with colour from `band`+1 px further in, along the inward
    normal.  Removes the wall / smear wedges that the art leaves at its corners, so the painted rim
    runs cleanly all the way to the slab edge."""
    a = np.asarray(face).astype(np.float32)
    H, W = a.shape[:2]
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32) + 0.5
    cx = np.clip(xs, r, W - r); cy = np.clip(ys, r, H - r)      # nearest corner-circle centre
    dx, dy = xs - cx, ys - cy
    corner = (dx != 0) & (dy != 0)
    rr = np.maximum(np.hypot(dx, dy), 1e-6)
    dl, dR, dt, db = xs, W - xs, ys, H - ys
    m = np.minimum(np.minimum(dl, dR), np.minimum(dt, db))
    nx = np.zeros_like(xs); ny = np.zeros_like(xs)
    nx[dl == m] = 1
    nx[(dR == m) & (dl != m)] = -1
    hor = (dl != m) & (dR != m)
    ny[hor & (dt == m)] = 1
    ny[hor & (db == m) & (dt != m)] = -1
    d = m.copy()
    d[corner] = r - rr[corner]
    nx[corner] = -dx[corner] / rr[corner]
    ny[corner] = -dy[corner] / rr[corner]
    sel = d < band
    step = (band + 1.0) - d[sel]
    tx = xs[sel] + nx[sel] * step - 0.5
    ty = ys[sel] + ny[sel] * step - 0.5
    out = a.copy()
    for ch in range(3):
        o = out[..., ch]
        o[sel] = bilinear(a[..., ch], tx, ty)
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), 'RGB')


def bilinear(img, x, y):
    h, w = img.shape
    x = np.clip(x, 0, w - 1.001); y = np.clip(y, 0, h - 1.001)
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    fx = x - x0; fy = y - y0
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) +
            img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


def to_src(coef, u, v):
    a, b, c, d, e, f, g, h = coef
    den = g * u + h * v + 1
    return (a * u + b * v + c) / den, (d * u + e * v + f) / den


def rim_shift(Ls, As, coef, axis, maxs=45):
    """How far (rectified px) the wall-side edge must move so its rim matches the opposite rim.

    axis 'near': compare the profile entering from the near (wall) edge u=0 with the one entering
    from the far edge u=FACE_W.  axis 'bottom': bottom edge v=FACE_H vs top edge v=0.
    Returns s: the true wall-side edge sits at u=s (near) or v=FACE_H-s (bottom)."""
    ks = np.arange(-60, 90)
    span = np.linspace(.3, .7, 48)
    if axis == 'near':
        U = ks[:, None] + 0 * span[None]; V = span[None] * FACE_H + 0 * ks[:, None]
        Uo = FACE_W - ks[:, None] + 0 * span[None]; Vo = V
    else:
        V = FACE_H - ks[:, None] + 0 * span[None]; U = span[None] * FACE_W + 0 * ks[:, None]
        Vo = ks[:, None] + 0 * span[None]; Uo = U
    def prof(Uq, Vq):
        x, y = to_src(coef, Uq, Vq)
        inside = (x >= 0) & (x < Ls.shape[1] - 1) & (y >= 0) & (y < Ls.shape[0] - 1)
        val = np.where(inside, bilinear(Ls, x, y), np.nan)
        al = np.where(inside, bilinear(As, x, y), 0)
        val = np.where(al > .5, val, np.nan)
        return np.nanmean(val, axis=1)
    pw, po = prof(U, V), prof(Uo, Vo)
    gw = np.gradient(pw); go = np.gradient(po)
    i0 = int(np.where(ks == 0)[0][0])
    ref = go[i0 + 3:i0 + 70]                 # opposite side, entering from its edge (k = 3..69)
    ref = (ref - np.nanmean(ref)) / (np.nanstd(ref) + 1e-6)
    best, best_s = None, 0
    for s in range(-maxs, maxs + 1):
        seg = gw[i0 + 3 + s:i0 + 70 + s]
        if len(seg) != len(ref) or np.isnan(seg).mean() > .2:
            continue
        seg = (seg - np.nanmean(seg)) / (np.nanstd(seg) + 1e-6)
        err = np.nanmean((seg - ref) ** 2)
        if best is None or err < best:
            best, best_s = err, s
    return best_s, best


def refine(d, lines, iters=3, log=None, maxs=45):
    """Move the near and bottom face edges until their painted rims match the far/top rims."""
    rgba = d['rgba']
    Ls = lum(rgba[..., :3]); As = rgba[..., 3]
    for it in range(iters):
        quad = corners_of(lines)
        coef = perspective_coeffs([tuple(p) for p in quad], (FACE_W, FACE_H))
        sn, en = rim_shift(Ls, As, coef, 'near', maxs)
        sb, eb = rim_shift(Ls, As, coef, 'bottom', maxs)
        if log is not None:
            log.append((it, sn, round(float(en), 3) if en is not None else None, sb, round(float(eb), 3) if eb is not None else None))
        if sn == 0 and sb == 0:
            break
        lines = dict(lines)
        if sn:
            x0, y0 = to_src(coef, sn, 0.0); x1, y1 = to_src(coef, sn, float(FACE_H))
            p = (x1 - x0) / (y1 - y0); lines['near'] = (p, x0 - p * y0, -1, 0)
        if sb:
            x0, y0 = to_src(coef, 0.0, FACE_H - sb); x1, y1 = to_src(coef, float(FACE_W), FACE_H - sb)
            p = (y1 - y0) / (x1 - x0); lines['bottom'] = (p, y0 - p * x0, -1, 0)
    return lines


def detect(path, side):
    im = Image.open(path).convert('RGBA')
    rgba = np.asarray(im).astype(np.float32) / 255
    if side == 'right':
        rgba = rgba[:, ::-1].copy()       # mirror so the walls are on the left for both sides
    lines, steps, pts, size = find_face(rgba)
    return dict(im=im, rgba=rgba, lines=lines, steps=steps, pts=pts, size=size, side=side)


def corner_radius(alpha, ss):
    """The art's own corner radius (output px) at the free top-far corner of a warped alpha.

    The far edge and the top edge of the face are the silhouette itself (no wall there), so the
    rounded corner between them is the painted card's real corner.  Radius from the 45-degree cut:
    a circular corner of radius r leaves r(sqrt2 - 1) between the sharp corner and the arc."""
    h, w = alpha.shape
    a = alpha > 0.5
    col = a[:, w // 2]; row = a[h // 2]
    if not col.any() or not row.any():
        return None
    top = np.argmax(col)                       # first opaque row at mid-width
    right = w - 1 - np.argmax(row[::-1])       # last opaque column at mid-height
    for k in range(0, min(h, w) // 3):
        y, x = top + k, right - k
        if 0 <= y < h and 0 <= x < w and a[y, x]:
            return (k * np.sqrt(2) / (np.sqrt(2) - 1)) / ss
    return None


def render(d, lines, radius=None):
    rgba, side = d['rgba'], d['side']
    corners = corners_of(lines)
    rgb = bleed(rgba[..., :3], rgba[..., 3])
    src = Image.fromarray((np.clip(rgb, 0, 1) * 255 + .5).astype(np.uint8), 'RGB')
    quad = inset_quad(corners, INSET)
    SS = 2
    coef = perspective_coeffs([tuple(p) for p in quad], (FACE_W * SS, FACE_H * SS))
    big = src.transform((FACE_W * SS, FACE_H * SS), Image.PERSPECTIVE, coef, resample=Image.BICUBIC)
    asrc = Image.fromarray((np.clip(rgba[..., 3], 0, 1) * 255 + .5).astype(np.uint8), 'L')
    abig = np.asarray(asrc.transform((FACE_W * SS, FACE_H * SS), Image.PERSPECTIVE, coef, resample=Image.BILINEAR)).astype(np.float32) / 255
    art_r = corner_radius(abig, SS)
    face = big.resize((FACE_W, FACE_H), Image.LANCZOS)
    if side == 'right':
        face = face.transpose(Image.FLIP_LEFT_RIGHT)
    arr = np.asarray(face).astype(np.float32)
    # rim colour (= wall albedo for the 3D slab): median of a band 1.5-4.5% inside the edge
    bw0, bw1 = int(FACE_W * .015), int(FACE_W * .045)
    band = np.concatenate([
        arr[int(FACE_H * .2):int(FACE_H * .8), bw0:bw1].reshape(-1, 3),
        arr[int(FACE_H * .2):int(FACE_H * .8), FACE_W - bw1:FACE_W - bw0].reshape(-1, 3),
        arr[bw0:bw1, int(FACE_W * .2):int(FACE_W * .8)].reshape(-1, 3),
    ])
    rim = np.median(band, axis=0)
    r_px = int(round((radius if radius is not None else RADIUS) * FACE_W))
    # The written texture is OPAQUE: the 3D face geometry (same rounded outline) defines the shape.
    # An alpha cut-out (alphaTest) aliased the corners and let transparent texels bleed dark
    # colour into the edge at small mip levels.
    face = edge_extend(face, r_px, EDGE_BAND)
    shown = face.convert('RGBA')
    shown.putalpha(rounded_mask(FACE_W, FACE_H, r_px))
    return dict(face=face, shown=shown, corners=corners, rim='#%02x%02x%02x' % tuple(int(round(c)) for c in rim), art_r=art_r)


def debug_tile(name, d, r, note):
    im = d['im']
    if d['side'] == 'right':
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    w, h = im.size
    s = 380 / h
    bg = Image.new('RGBA', im.size, (40, 170, 80, 255)); bg.alpha_composite(im)
    bg = bg.resize((int(w * s), int(h * s)), Image.LANCZOS).convert('RGB')
    dr = ImageDraw.Draw(bg)
    for key, col in (('far', (255, 60, 60)), ('top', (60, 160, 255)), ('near', (255, 230, 0)), ('bottom', (255, 0, 255))):
        xs, ys = d['pts'][key]
        for x, y in zip(xs[::3], ys[::3]):
            dr.point((x * s, y * s), fill=col)
    TL, TR, BL, BR = r['corners']
    dr.line([tuple(TL * s), tuple(TR * s), tuple(BR * s), tuple(BL * s), tuple(TL * s)], fill=(255, 255, 255), width=1)
    face = r['shown'].resize((int(FACE_W * 380 / FACE_H), 380), Image.LANCZOS)
    fb = Image.new('RGBA', face.size, (40, 170, 80, 255)); fb.alpha_composite(face)
    tile = Image.new('RGB', (bg.width + fb.width + 6, 400), (25, 25, 30))
    tile.paste(bg, (0, 0)); tile.paste(fb.convert('RGB'), (bg.width + 6, 0))
    ImageDraw.Draw(tile).text((4, 384), f"{name} {note}", fill=(240, 240, 240))
    return tile


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('words', nargs='*', help='left_sun right_flower ... (default: all)')
    ap.add_argument('--debug', help='write overlays + sheets to this dir')
    ap.add_argument('--no-write', action='store_true')
    args = ap.parse_args()
    files = []
    for side in ('left', 'right'):
        for p in sorted(glob.glob(os.path.join(SRC, f'card_{side}_*.png'))):
            word = re.match(rf'card_{side}_(.+)\.png$', os.path.basename(p)).group(1)
            files.append((f'{side}_{word}', side, p))
    # pass 1: detect every card (the wall-thickness medians need all of them)
    dets = {key: detect(p, side) for key, side, p in files}
    med = {}
    for side in ('left', 'right'):
        offs = [wall_offsets(d['lines'], d['size']) for d in dets.values() if d['side'] == side]
        okn = [o[0] for (o, d) in zip(offs, [d for d in dets.values() if d['side'] == side]) if confident(d['lines'], d['steps'], 'near')]
        okb = [o[1] for (o, d) in zip(offs, [d for d in dets.values() if d['side'] == side]) if confident(d['lines'], d['steps'], 'bottom')]
        med[side] = (float(np.median(okn)), float(np.median(okb)))
        print(f'{side}: wall near {med[side][0]:.4f} w (n={len(okn)})  bottom {med[side][1]:.4f} h (n={len(okb)})')
    # pass 2: weak edges fall back to the silhouette shifted by the median wall; also when a
    # detected wall is far off the median (the step locked onto artwork instead of the bevel).
    # Then refine each edge so the wall-side rim matches the opposite rim.
    stage2 = {}
    for key, side, p in files:
        d = dets[key]
        on, ob = wall_offsets(d['lines'], d['size'])
        mn, mb = med[side]
        fix_n = not confident(d['lines'], d['steps'], 'near') or abs(on - mn) > 0.02
        fix_b = not confident(d['lines'], d['steps'], 'bottom') or abs(ob - mb) > 0.012
        lines = apply_fallback(d['lines'], d['size'], mn, mb, fix_n, fix_b)
        log = []
        lines = refine(d, lines, log=log)
        stage2[key] = (lines, log, fix_n, fix_b)
    # pass 3: the cards of one side share one pose, so the refined wall widths should agree.
    # Outliers (rim matching locked onto a pattern) restart from the side median, small search.
    final_off = {k: wall_offsets(stage2[k][0], dets[k]['size']) for k in stage2}
    med2 = {}
    for side in ('left', 'right'):
        ks = [k for k in final_off if dets[k]['side'] == side]
        med2[side] = (float(np.median([final_off[k][0] for k in ks])), float(np.median([final_off[k][1] for k in ks])))
        print(f'{side}: refined wall near {med2[side][0]:.4f} w  bottom {med2[side][1]:.4f} h')
    os.makedirs(OUT, exist_ok=True)
    meta, tiles, radii = {}, [], []
    for key, side, p in files:
        if args.words and key not in args.words:
            continue
        d = dets[key]
        lines, log, fix_n, fix_b = stage2[key]
        on2, ob2 = final_off[key]
        mn2, mb2 = med2[side]
        out_n, out_b = abs(on2 - mn2) > 0.015, abs(ob2 - mb2) > 0.008
        if out_n or out_b:
            lines = apply_fallback(lines, d['size'], mn2, mb2, out_n, out_b)
            log.append(('reset', 'R', 0, 'R', 0))
            lines = refine(d, lines, log=log, maxs=8)
        r = render(d, lines)
        on3, ob3 = wall_offsets(lines, d['size'])
        note = f"wall {on3:.3f}/{ob3:.3f}" + (' FIXn' if fix_n else '') + (' FIXb' if fix_b else '')
        note += (' RESETn' if out_n else '') + (' RESETb' if out_b else '')
        note += ' | ' + ' '.join(f'{s1:+d}/{s2:+d}' if isinstance(s1, int) else 'R' for (_, s1, _, s2, _) in log)
        ar = r['art_r'] / FACE_W if r['art_r'] else float('nan')
        radii.append((key, ar))
        print(f"{key:14s} {d['size'][0]:4d}x{d['size'][1]:<4d} {note} rim {r['rim']} art-r {ar:.4f}")
        meta[key] = dict(rim=r['rim'])
        if not args.no_write:
            r['face'].save(os.path.join(OUT, f'{key}.webp'), 'WEBP', quality=90, method=6)
        if args.debug:
            tiles.append(debug_tile(key, d, r, note))
    rs = np.array([v for _, v in radii if v == v])
    if len(rs):
        print(f'art corner radius (fraction of face width): median {np.median(rs):.4f}  '
              f'p10 {np.percentile(rs, 10):.4f}  p90 {np.percentile(rs, 90):.4f}  (mask uses {RADIUS})')
    if args.debug and tiles:
        os.makedirs(args.debug, exist_ok=True)
        per_row = 4
        tw = max(t.width for t in tiles); th = 400
        for start in range(0, len(tiles), 16):
            chunk = tiles[start:start + 16]
            rows = (len(chunk) + per_row - 1) // per_row
            sheet = Image.new('RGB', (per_row * (tw + 8), rows * (th + 8)), (15, 15, 18))
            for i, t in enumerate(chunk):
                sheet.paste(t, ((i % per_row) * (tw + 8), (i // per_row) * (th + 8)))
            sheet.save(os.path.join(args.debug, f'unwarp_{start // 16:02d}.png'))
        print('debug sheets ->', args.debug)
    if not args.no_write and not args.words:
        with open(TS, 'w') as fh:
            fh.write('// Generated by tools/unwarp_cards.py - do not edit.\n')
            fh.write(f'export const FACE_ASPECT = {FACE_W / FACE_H};\n')
            fh.write(f'export const FACE_RADIUS = {RADIUS};   // fraction of face width\n')
            fh.write('export const CARD_FACES: Record<string, { rim: string }> = ')
            fh.write(json.dumps(meta, indent=2) + ';\n')
        print('wrote', TS)


if __name__ == '__main__':
    main()
