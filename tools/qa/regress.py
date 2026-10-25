"""Regression checks for the 3D fork: 2D fallback, Compound Book popup over 3D, tablet size + touch drag."""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, json, sys
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']

READY = """() => { const s = window.WM3D, sc = s && s.scene; if (!s) return 'nostate';
  if (s.mode === '2d') { return document.querySelectorAll('canvas').length === 1 ? '2d' : 'x'; }
  if (!sc || !s.cards) return false; const cs = [...sc.leftCards, ...sc.rightCards];
  return cs.length === 6 && cs.every(c => s.cards.isReady(c) && c.x > 0 && c.x < sc.gw) ? 'ready' : false; }"""


async def boot(b, url, w=1280, h=800, touch=False):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=touch, is_mobile=touch)
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    await pg.goto(url, wait_until='load'); await pg.wait_for_timeout(2400)
    btn = pg.locator('#intro-overlay button')
    if await btn.count(): await btn.click(force=True)
    r = None
    for _ in range(60):
        await pg.wait_for_timeout(400)
        r = await pg.evaluate(READY)
        if r in ('ready', '2d'): break
    await pg.wait_for_timeout(1200)
    return ctx, pg, errs, r


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        # 1) forced 2D: one canvas, the original look
        ctx, pg, errs, r = await boot(b, BASE + '?q=2d')
        await pg.screenshot(path=f'{OUT}/r_2d.png')
        print('2d:', r, 'errors', errs[:3])
        await ctx.close()
        # 2) Compound Book popup over the 3D layer
        ctx, pg, errs, r = await boot(b, BASE + '?q=high')
        await pg.evaluate('() => window.WM3D.scene.showCollection()')
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=f'{OUT}/r_book.png')
        print('book:', r, 'errors', errs[:3])
        await ctx.close()
        # 3) tablet 1180x820 with touch: drag the right answer pair in
        ctx, pg, errs, r = await boot(b, BASE + '?q=high', 1180, 820, touch=True)
        st = await pg.evaluate("""() => { const sc = window.WM3D.scene, pair = sc.queue[sc.roundIndex];
          const f = (arr, w) => { const c = arr.find(c => c.word === w); return [c.x, c.y]; };
          return { L: f(sc.leftCards, pair.word1), R: f(sc.rightCards, pair.word2), cx: sc.cx, cy: sc.cy, round: sc.roundIndex }; }""")
        cdp = await ctx.new_cdp_session(pg)
        async def touch_drag(x0, y0, x1, y1, n=14):
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0}]})
            for i in range(1, n + 1):
                await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 + (x1 - x0) * i / n, 'y': y0 + (y1 - y0) * i / n}]})
                await pg.wait_for_timeout(20)
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        await touch_drag(*st['L'], st['cx'] - 10, st['cy'])
        await pg.wait_for_timeout(700)
        await touch_drag(*st['R'], st['cx'] + 10, st['cy'])
        await pg.wait_for_timeout(5500)
        r2 = await pg.evaluate('() => window.WM3D.scene.roundIndex')
        await pg.screenshot(path=f'{OUT}/r_tablet.png')
        print('tablet touch: round', st['round'], '->', r2, 'errors', errs[:3])
        await ctx.close()
        await b.close()

asyncio.run(main())
