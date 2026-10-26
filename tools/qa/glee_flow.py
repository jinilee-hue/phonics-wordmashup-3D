"""Glee in a real round: idle, looking at a grabbed card, pointing on Hint, sad on a wrong pair,
cheering on the right pair (with the result card), flying along on the travel.  Full frames, plus
a contact sheet of crops around Glee.

usage: uv run --with playwright --with pillow python tools/qa/glee_flow.py [url] [tag]
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, io, sys
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'gf'
W, H, DPR = 1280, 800, 1.5
SEED = '''(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();'''
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
STATE = '''() => { const s = window.WM3D, sc = s && s.scene; if (!sc) return null;
  const pair = sc.queue[sc.roundIndex];
  const cs = [...sc.leftCards.map(c => ['L', c]), ...sc.rightCards.map(c => ['R', c])].filter(([, c]) => c && c.active)
    .map(([side, c]) => ({ side, word: c.word, x: Math.round(c.x), y: Math.round(c.y), bx: Math.round(c.baseX), ready: s.cards.isReady(c) }));
  return { round: sc.roundIndex, busy: sc.busy, pair: pair && [pair.word1, pair.word2], cx: sc.cx, cy: sc.cy, cards: cs,
           act: s.glee && s.glee.act && s.glee.act.kind, phase: s.travel && s.travel.phase }; }'''
FONT = ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc', 24)


async def settle(pg):
    prev = None
    for _ in range(80):
        await pg.wait_for_timeout(400)
        st = await pg.evaluate(STATE)
        if st and len(st['cards']) == 6 and all(c['ready'] for c in st['cards']) and not st['busy']:
            xs = [c['x'] for c in st['cards']]
            if xs == prev and all(abs(c['x'] - c['bx']) < 2 for c in st['cards']):
                return st
            prev = xs
    return await pg.evaluate(STATE)


async def drag(pg, x0, y0, x1, y1, n=12, release=True):
    await pg.mouse.move(x0, y0); await pg.mouse.down()
    for i in range(1, n + 1):
        await pg.mouse.move(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)
        await pg.wait_for_timeout(16)
    if release: await pg.mouse.up()


async def main():
    shots = []
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=DPR)
        await ctx.add_init_script(SEED)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        st = await settle(pg)

        async def shot(label):
            png = await pg.screenshot()
            act = await pg.evaluate('() => window.WM3D.glee && window.WM3D.glee.act && window.WM3D.glee.act.kind')
            shots.append((label, Image.open(io.BytesIO(png)).convert('RGB')))
            print(f'{label:12s} act={act}')

        await shot('idle')
        # grab a right card and hold it up and to the left: Glee looks at it
        R0 = next(c for c in st['cards'] if c['side'] == 'R' and c['word'] != st['pair'][1])
        await drag(pg, R0['x'], R0['y'], R0['x'] - 260, R0['y'] - 90, release=False)
        await pg.wait_for_timeout(500)
        await shot('grab')
        await pg.mouse.up()
        await pg.wait_for_timeout(1200)
        st = await settle(pg)
        # hint: Glee points at the left answer, then the right one
        await pg.evaluate('() => window.WM3D.scene.showHint()')
        await pg.wait_for_timeout(700)
        await shot('hint A')
        await pg.wait_for_timeout(1300)
        await shot('hint B')
        await pg.wait_for_timeout(2600)
        st = await settle(pg)
        # wrong pair
        L = next(c for c in st['cards'] if c['side'] == 'L' and c['word'] != st['pair'][0])
        R = next(c for c in st['cards'] if c['side'] == 'R' and c['word'] != st['pair'][1])
        await drag(pg, L['x'], L['y'], st['cx'] - 10, st['cy']); await pg.wait_for_timeout(400)
        await drag(pg, R['x'], R['y'], st['cx'] + 10, st['cy'])
        await pg.wait_for_timeout(1000)
        await shot('wrong')
        await pg.wait_for_timeout(1500)
        await shot('cheer up')
        st = await settle(pg)
        # right pair
        L = next(c for c in st['cards'] if c['side'] == 'L' and c['word'] == st['pair'][0])
        R = next(c for c in st['cards'] if c['side'] == 'R' and c['word'] == st['pair'][1])
        await drag(pg, L['x'], L['y'], st['cx'] - 10, st['cy']); await pg.wait_for_timeout(400)
        await drag(pg, R['x'], R['y'], st['cx'] + 10, st['cy'])
        for _ in range(40):
            await pg.wait_for_timeout(100)
            if await pg.evaluate("() => window.WM3D.glee.act && window.WM3D.glee.act.kind === 'cheer'"): break
        await pg.wait_for_timeout(300)
        await shot('cheer')
        await pg.wait_for_timeout(1300)
        await shot('result')
        for _ in range(80):
            await pg.wait_for_timeout(100)
            if await pg.evaluate("() => window.WM3D.travel.phase !== 'idle'"): break
        await pg.wait_for_timeout(300)
        await shot('travel')
        st = await settle(pg)
        await shot('round 2')
        print('round', st['round'], 'busy', st['busy'], 'errors', errs[:4] or 'none')
        await b.close()
    # full frames + a crop sheet around Glee
    for i, (label, im) in enumerate(shots):
        im.save(f'{OUT}/{TAG}_{i:02d}.png')
    k = DPR
    box = (int(150 * k), int(330 * k), int(1130 * k), int(790 * k))
    tiles = []
    for label, im in shots:
        c = im.crop(box).resize((int((box[2] - box[0]) / k * 0.5), int((box[3] - box[1]) / k * 0.5)), Image.LANCZOS)
        t = Image.new('RGB', (c.width, c.height + 34), (24, 22, 32)); t.paste(c, (0, 34))
        ImageDraw.Draw(t).text((8, 4), label, fill=(255, 255, 255), font=FONT)
        tiles.append(t)
    cols = 3
    tw, th = tiles[0].size
    sheet = Image.new('RGB', (cols * (tw + 6), ((len(tiles) + cols - 1) // cols) * (th + 6)), (10, 10, 14))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * (tw + 6), (i // cols) * (th + 6)))
    sheet.save(f'{OUT}/{TAG}_sheet.png')
    print('sheet', sheet.size)

asyncio.run(main())
