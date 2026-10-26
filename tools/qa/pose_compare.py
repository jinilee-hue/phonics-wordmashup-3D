"""Same round, same slots: the original 2D cards (Phaser sprites, shown in the 3D page) next to 3D
card poses.  Writes {tag}_2d.png, {tag}_<name>.png and side-by-side crops {tag}_left.png / {tag}_right.png.

usage: uv run --with playwright --with pillow python tools/qa/pose_compare.py [base-url] [tag] name=yaw,pitch,roll,thick ...
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, sys
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'pc'
VARIANTS = [a.split('=', 1) for a in sys.argv[3:]] or [('now', '18,7,1,46'), ('fit', '30,10,1,26')]
SEED = """(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();"""
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
READY = """() => { const s = window.WM3D, sc = s && s.scene; if (!sc || !s.cards) return false;
  const cs = [...sc.leftCards, ...sc.rightCards];
  return cs.length === 6 && cs.every(c => s.cards.isReady(c) && Math.abs(c.x - c.baseX) < 1); }"""


async def main():
    shots = []
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        for i, (name, v) in enumerate(VARIANTS):
            ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, device_scale_factor=1.5)
            await ctx.add_init_script(SEED)
            pg = await ctx.new_page()
            await pg.goto(BASE + '?q=high&pose=' + v, wait_until='load'); await pg.wait_for_timeout(2400)
            btn = pg.locator('#intro-overlay button')
            if await btn.count(): await btn.click(force=True)
            for _ in range(80):
                await pg.wait_for_timeout(400)
                if await pg.evaluate(READY): break
            await pg.evaluate('() => window.WM3D.scene.tweens.pauseAll()')
            await pg.wait_for_timeout(2600)
            words = await pg.evaluate('() => [...window.WM3D.scene.leftCards, ...window.WM3D.scene.rightCards].map(c => c.word).join(",")')
            if i == 0:
                # the 2D art of the same round: show Phaser's cards, hide the 3D ones
                await pg.evaluate("""() => { const c = window.WM3D.cards; c.isReady = () => false; c.group.visible = false; }""")
                await pg.wait_for_timeout(400)
                await pg.screenshot(path=f'{OUT}/{TAG}_2d.png'); shots.append(('2D 원본', f'{OUT}/{TAG}_2d.png'))
                await pg.evaluate("""() => { const c = window.WM3D.cards; delete c.isReady; c.group.visible = true; }""")
                await pg.wait_for_timeout(600)
            await pg.screenshot(path=f'{OUT}/{TAG}_{name}.png'); shots.append((name, f'{OUT}/{TAG}_{name}.png'))
            print(name, v, words)
            await ctx.close()
        await b.close()
    try: font = ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc', 30)
    except Exception: font = None
    for half, box in (('left', (20, 110, 460, 730)), ('right', (820, 110, 1260, 730))):
        bx = tuple(int(v * 1.5) for v in box)
        tiles = []
        for label, f in shots:
            c = Image.open(f).convert('RGB').crop(bx)
            t = Image.new('RGB', (c.width, c.height + 44), (24, 22, 32)); t.paste(c, (0, 44))
            ImageDraw.Draw(t).text((10, 6), label, fill=(255, 255, 255), font=font); tiles.append(t)
        W = sum(t.width for t in tiles) + 10 * (len(tiles) - 1)
        sheet = Image.new('RGB', (W, tiles[0].height), (24, 22, 32)); x = 0
        for t in tiles: sheet.paste(t, (x, 0)); x += t.width + 10
        sheet.save(f'{OUT}/{TAG}_{half}.png')
    print('sheets', f'{TAG}_left.png', f'{TAG}_right.png')

asyncio.run(main())
