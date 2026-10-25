"""Quick still of the game screen after the cards settle (for zone / card look checks)."""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, sys
from playwright.async_api import async_playwright
URL = sys.argv[1]; OUT = sys.argv[2]
W, H = (int(v) for v in (sys.argv[3] if len(sys.argv) > 3 else '1280x800').split('x'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': W, 'height': H}, device_scale_factor=float(sys.argv[4]) if len(sys.argv) > 4 else 1)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and '404' not in m.text else None)
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        for _ in range(60):
            await pg.wait_for_timeout(400)
            ok = await pg.evaluate("() => { const s = window.WM3D, sc = s && s.scene; if (!sc || !s.cards) return false; const cs = [...sc.leftCards, ...sc.rightCards]; return cs.length === 6 && cs.every(c => s.cards.isReady(c) && c.x > 0 && c.x < sc.gw); }")
            if ok: break
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=OUT)
        print('errors:', errs[:5])
        await b.close()
asyncio.run(main())
