"""Glee follows the mouse (like Halli Galli's pink bell), a tap pokes her, a drag spins / flips her.

Saves DPR-2 crops: tag_follow.png (pointer at 6 places + resting), tag_poke.png, tag_spin.png, tag_flip.png,
and prints her yaw / pitch / eyes per pointer spot, the spin and flip angles over time, and checks that a press
on Glee never grabs a card.

usage: uv run --with playwright --with pillow python tools/qa/glee_pointer.py [url] [tag]
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, io, json, sys
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high&tutor=off'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'gp'
SEED = '''(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();'''
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
GLEE = '''() => { const W = window.WM3D, g = W.glee, c = g.cur, sc = W.scene;
  return { yaw: +c.yaw.toFixed(2), pitch: +c.pitch.toFixed(2), lookX: +c.lookX.toFixed(2), lookY: +c.lookY.toFixed(2),
    spin: +g.spin.angle.toFixed(2), flip: +g.flip.angle.toFixed(2), follow: +g.follow.toFixed(2),
    home: g.home, drag: !!sc.dragCard, press: W.gleePress,
    cards: [...sc.leftCards, ...sc.rightCards].filter(c => c && c.active).map(c => Math.round(c.x) + ',' + Math.round(c.y)).join(' ') }; }'''
FONT = ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc', 26)


async def frames(pg, n=2):
    for _ in range(n):
        await pg.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


async def crop(pg, home, label):
    png = await pg.screenshot()
    im = Image.open(io.BytesIO(png)).convert('RGB')
    x, y, h = home['x'], home['y'], home['h']
    box = (int(2 * (x - 1.1 * h)), int(2 * (y - 1.6 * h)), int(2 * (x + 1.1 * h)), int(2 * (y + 0.25 * h)))
    c = im.crop(box).resize((330, int(330 * (box[3] - box[1]) / (box[2] - box[0]))), Image.LANCZOS)
    t = Image.new('RGB', (c.width, c.height + 34), (20, 20, 24)); t.paste(c, (0, 34))
    ImageDraw.Draw(t).text((6, 3), label, fill=(255, 255, 255), font=FONT)
    return t


def sheet(tiles, path, cols=4):
    w, h = tiles[0].size
    s = Image.new('RGB', (cols * (w + 4), ((len(tiles) + cols - 1) // cols) * (h + 4)), (0, 0, 0))
    for i, t in enumerate(tiles):
        s.paste(t, ((i % cols) * (w + 4), (i // cols) * (h + 4)))
    s.save(path)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        ctx = await b.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=2)
        await ctx.add_init_script(SEED)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        await pg.wait_for_function('() => window.WM3D && window.WM3D.glee && window.WM3D.scene', timeout=30000)
        await pg.wait_for_timeout(6000)
        await pg.evaluate('() => { const g = window.WM3D.glee; g.nextWave = 1e9; g.act = null; g.queue = []; }')
        st = await pg.evaluate(GLEE)
        home = st['home']
        print('home', home)
        # 1) follow
        tiles = []
        spots = [('왼쪽', 60, 420), ('오른쪽', 1220, 420), ('위', 445, 40), ('아래 오른쪽', 1150, 700), ('가운데 카드', 640, 360), ('바로 앞', home['x'] + 10, home['y'] - home['h'] * 0.6)]
        for name, x, y in spots:
            await pg.mouse.move(x, y, steps=6)
            await pg.wait_for_timeout(1500); await frames(pg)
            g = await pg.evaluate(GLEE)
            print(f'{name:8s} yaw {g["yaw"]:5.2f} pitch {g["pitch"]:5.2f} eyes {g["lookX"]:5.2f},{g["lookY"]:5.2f} follow {g["follow"]}')
            tiles.append(await crop(pg, home, name))
        await pg.wait_for_timeout(6000); await frames(pg)
        g = await pg.evaluate(GLEE)
        print(f'rest (still 6 s) yaw {g["yaw"]} pitch {g["pitch"]} eyes {g["lookX"]},{g["lookY"]} follow {g["follow"]}')
        tiles.append(await crop(pg, home, '멈춤 6초 뒤'))
        sheet(tiles, f'{OUT}/{TAG}_follow.png')
        cards0 = (await pg.evaluate(GLEE))['cards']
        # 2) poke
        cx, cy = home['x'], home['y'] - home['h'] * 0.5
        await pg.mouse.move(cx, cy); await pg.mouse.down()
        g = await pg.evaluate(GLEE)
        print('press on Glee: gleePress', g['press'], 'card drag', g['drag'])
        await pg.mouse.up()
        tiles = []
        for k in range(4):
            await frames(pg, 1)
            tiles.append(await crop(pg, home, f'콕 {k + 1}'))
        sheet(tiles, f'{OUT}/{TAG}_poke.png')
        await pg.wait_for_timeout(1500)
        # 3) spin: drag right fast
        await pg.mouse.move(cx, cy); await pg.mouse.down()
        for i in range(1, 9):
            await pg.mouse.move(cx + i * 40, cy); await pg.wait_for_timeout(16)
        g = await pg.evaluate(GLEE)
        print('spin while held', g['spin'], 'card drag', g['drag'])
        tiles = [await crop(pg, home, f'돌리는 중 {g["spin"]}')]
        await pg.mouse.up()
        log = []
        for k in range(10):
            await pg.wait_for_timeout(250); await frames(pg, 1)
            g = await pg.evaluate(GLEE); log.append(g['spin'])
            if k in (0, 2, 5, 9): tiles.append(await crop(pg, home, f'놓고 {0.25 * (k + 1):.2f}s {g["spin"]}'))
        print('spin after release', log)
        sheet(tiles, f'{OUT}/{TAG}_spin.png', cols=5)
        await pg.wait_for_timeout(2500)
        # 4) flip: drag down
        await pg.mouse.move(cx, cy - 30); await pg.mouse.down()
        for i in range(1, 7):
            await pg.mouse.move(cx, cy - 30 + i * 30); await pg.wait_for_timeout(16)
        g = await pg.evaluate(GLEE)
        tiles = [await crop(pg, home, f'뒤집는 중 {g["flip"]}')]
        await pg.mouse.up()
        log = []
        for k in range(10):
            await pg.wait_for_timeout(250); await frames(pg, 1)
            g = await pg.evaluate(GLEE); log.append(g['flip'])
            if k in (0, 2, 5, 9): tiles.append(await crop(pg, home, f'놓고 {0.25 * (k + 1):.2f}s {g["flip"]}'))
        print('flip after release', log)
        sheet(tiles, f'{OUT}/{TAG}_flip.png', cols=5)
        cards1 = (await pg.evaluate(GLEE))['cards']
        print('cards unchanged by presses on Glee:', cards0 == cards1)
        print('errors:', errs[:3] or 'none')
        await b.close()

asyncio.run(main())
