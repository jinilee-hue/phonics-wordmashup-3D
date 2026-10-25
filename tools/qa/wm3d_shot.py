"""Headless check of Word Mashup 3D: boot, skip intro, screenshots of idle / hover / drag / match.

usage: uv run --with playwright python wm3d_shot.py [url] [tag] [WxH]
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, json, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'a'
W, H = (int(v) for v in (sys.argv[3] if len(sys.argv) > 3 else '1280x800').split('x'))

STATE_JS = '''() => {
  const s = window.WM3D, sc = s && s.scene;
  if (!sc) return { on: s && s.on, mode: s && s.mode, scene: false };
  const pair = sc.queue[sc.roundIndex];
  const cards = [...sc.leftCards.map(c => ['L', c]), ...sc.rightCards.map(c => ['R', c])]
    .filter(([, c]) => c && c.active)
    .map(([side, c]) => ({ side, word: c.word, x: Math.round(c.x), y: Math.round(c.y), ready: s.cards ? s.cards.isReady(c) : false, depth: c.depth, inZone: c.inZone, alpha: +c.alpha.toFixed(2) }));
  return { on: s.on, mode: s.mode, round: sc.roundIndex, pair: pair && [pair.word1, pair.word2], cx: sc.cx, cy: sc.cy, zoneR: sc.zoneR, cards, busy: sc.busy,
           canvases: [...document.querySelectorAll('canvas')].map(c => [c.className, c.width, c.height, getComputedStyle(c).zIndex]) };
}'''


async def settle(pg):
    prev, st = None, None
    for _ in range(80):
        await pg.wait_for_timeout(400)
        st = await pg.evaluate(STATE_JS)
        cards = st.get('cards') or []
        if len(cards) == 6 and all(c['ready'] for c in cards):
            xs = [c['x'] for c in cards]
            if prev == xs and all(0 < x < 4000 for x in xs) and all(abs(c['x'] - 640) < 2000 for c in cards):
                return st
            prev = xs
    return st


async def drag(pg, x0, y0, x1, y1, steps=12, frac=1.0, release=True):
    await pg.mouse.move(x0, y0)
    await pg.mouse.down()
    for i in range(1, steps + 1):
        f = i / steps * frac
        await pg.mouse.move(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f)
        await pg.wait_for_timeout(16)
    if release:
        await pg.mouse.up()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
            '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': W, 'height': H})
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'[:300]))
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'[:400]))
        pg.on('response', lambda r: logs.append(f'error: HTTP {r.status} {r.url}') if r.status >= 400 else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count():
            await btn.click(force=True)
        st = await settle(pg)
        await pg.wait_for_timeout(800)
        print(json.dumps(st))
        await pg.screenshot(path=f'{OUT}/{TAG}_idle.png')
        if not st or not st.get('cards'):
            print('\n'.join(logs[-20:])); await b.close(); return
        L = next(c for c in st['cards'] if c['side'] == 'L' and c['word'] == st['pair'][0])
        R = next(c for c in st['cards'] if c['side'] == 'R' and c['word'] == st['pair'][1])
        WL = next(c for c in st['cards'] if c['side'] == 'L' and c['word'] != st['pair'][0])
        # hover
        await pg.mouse.move(L['x'] + 30, L['y'] - 40)
        await pg.wait_for_timeout(1000)
        await pg.screenshot(path=f'{OUT}/{TAG}_hover.png')
        # drag the correct left card 60% of the way and hold
        await drag(pg, L['x'], L['y'], st['cx'] - 10, st['cy'], frac=0.6, release=False)
        await pg.screenshot(path=f'{OUT}/{TAG}_drag.png')
        for i in range(8):
            await pg.mouse.move(L['x'] + (st['cx'] - 10 - L['x']) * (0.6 + 0.05 * (i + 1)), L['y'] + (st['cy'] - L['y']) * (0.6 + 0.05 * (i + 1)))
            await pg.wait_for_timeout(16)
        await pg.mouse.up()
        await pg.wait_for_timeout(1000)
        await pg.screenshot(path=f'{OUT}/{TAG}_zone1.png')
        # hint
        await pg.evaluate('() => window.WM3D.scene.showHint()')
        await pg.wait_for_timeout(450)
        await pg.screenshot(path=f'{OUT}/{TAG}_hint.png')
        await pg.wait_for_timeout(2600)
        # right card in -> collision -> result
        await drag(pg, R['x'], R['y'], st['cx'] + 10, st['cy'])
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{OUT}/{TAG}_zone2.png')
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=f'{OUT}/{TAG}_impact.png')
        await pg.wait_for_timeout(1400)
        await pg.screenshot(path=f'{OUT}/{TAG}_result.png')
        st2 = await settle(pg)
        print(json.dumps({k: st2.get(k) for k in ('round', 'busy', 'on', 'mode')}), 'cards', len(st2.get('cards') or []))
        await pg.screenshot(path=f'{OUT}/{TAG}_round2.png')
        errs = [l for l in logs if ('error' in l.lower() or 'warn' in l.lower()) and 'GPU stall' not in l]
        print('\n'.join(errs[-15:]) or 'no console errors/warnings')
        await b.close()

asyncio.run(main())
