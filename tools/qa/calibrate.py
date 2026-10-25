"""Light calibration: with ?cal every 3D card faces the camera; compare rendered face colours with
the face texture over the same normalised region (median, sRGB and linear ratio)."""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, json, sys
import numpy as np
from PIL import Image
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high&cal'
CARDS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'public', 'gl', 'cards')
FW, FH = 184, 184 / 0.75
REG = (-0.30, 0.30, 0.18, 0.40)      # x0, x1, y0, y1 as fractions of face size from the centre (y down)

JS = '''() => { const s = window.WM3D, sc = s && s.scene; if (!sc) return null;
  return [...sc.leftCards.map(c => ['left', c]), ...sc.rightCards.map(c => ['right', c])].filter(([, c]) => c && c.active)
    .map(([side, c]) => ({ side, word: c.word, x: c.x, y: c.y, s: c.scaleX, ready: s.cards.isReady(c) })); }'''


def lin(c):
    c = np.asarray(c, float) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 800})
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count():
            await btn.click(force=True)
        prev = None
        for _ in range(80):
            await pg.wait_for_timeout(400)
            st = await pg.evaluate(JS)
            if st and len(st) == 6 and all(c['ready'] for c in st):
                xs = [round(c['x']) for c in st]
                if prev == xs and all(0 < x < 1280 for x in xs):
                    break
                prev = xs
        # stop Phaser tweens (float bob) so positions match the screenshot exactly
        await pg.evaluate('() => window.WM3D.scene.tweens.pauseAll()')
        await pg.wait_for_timeout(1500)
        st = await pg.evaluate(JS)
        await pg.screenshot(path=f'{OUT}/cal.png')
        shot = np.asarray(Image.open(f'{OUT}/cal.png').convert('RGB')).astype(float)
        rows = []
        for c in st:
            tex = np.asarray(Image.open(f"{CARDS}/{c['side']}_{c['word']}.webp").convert('RGB')).astype(float)
            th, tw = tex.shape[:2]
            tr = tex[int(th * (0.5 + REG[2])):int(th * (0.5 + REG[3])), int(tw * (0.5 + REG[0])):int(tw * (0.5 + REG[1]))]
            w, h = FW * c['s'], FH * c['s']
            sr = shot[int(c['y'] + h * REG[2]):int(c['y'] + h * REG[3]), int(c['x'] + w * REG[0]):int(c['x'] + w * REG[1])]
            mt, ms = np.median(tr.reshape(-1, 3), 0), np.median(sr.reshape(-1, 3), 0)
            ratio = lin(ms) / np.maximum(lin(mt), 1e-4)
            rows.append(ratio)
            print(f"{c['side']:5s} {c['word']:7s} tex {mt.astype(int)} shot {ms.astype(int)} lin-ratio {np.round(ratio, 3)}")
        print('mean lin ratio', np.round(np.mean(rows, 0), 3))
        await b.close()

asyncio.run(main())
