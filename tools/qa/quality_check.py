"""Auto-quality checks (no ?q): quality rule table, stale v1 '2d' value ignored, and a real-GPU run
(headless Chrome on Metal) that must stay in 3D.

usage: uv run --with playwright python tools/qa/quality_check.py [base-url]
"""
import asyncio, json, sys, time
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/'

RULES = [  # (mode, median s, expected)
    ('high', 0.0167, None), ('high', 0.033, None), ('high', 0.040, None),   # 60 / 30 / 25 fps: keep
    ('high', 0.050, 'mid'), ('mid', 0.050, 'low'), ('low', 0.050, None),    # ~20 fps: step down, low holds
    ('high', 0.070, 'low'), ('mid', 0.070, 'low'), ('low', 0.070, '2d'),    # ~14 fps: low, then give up
]


async def boot(b, url, init=None):
    ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
    if init:
        await ctx.add_init_script(init)
    pg = await ctx.new_page()
    logs = []
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if 'wm3d' in m.text or m.type == 'error' and 'Failed to load' not in m.text else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
    await pg.goto(url, wait_until='load'); await pg.wait_for_timeout(2400)
    btn = pg.locator('#intro-overlay button')
    if await btn.count(): await btn.click(force=True)
    return ctx, pg, logs


async def main():
    async with async_playwright() as p:
        # 1) rule table + stale v1 value, on the real GPU (Metal), no ?q
        b = await p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'])
        stale = "localStorage.setItem('wm3d-quality', JSON.stringify({mode: '2d', until: Date.now() + 6 * 864e5}));"
        ctx, pg, logs = await boot(b, BASE, stale)
        await pg.wait_for_timeout(1500)
        gpu = await pg.evaluate('''() => { const c = document.createElement('canvas').getContext('webgl2');
            const e = c && c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }''')
        print('GPU:', gpu[:90])
        bad = []
        for mode, med, exp in RULES:
            got = await pg.evaluate(f"() => window.WM3D.decide('{mode}', {med})")
            if got != exp:
                bad.append((mode, med, exp, got))
        print('quality rules:', 'all', len(RULES), 'ok' if not bad else f'FAIL {bad}')
        # 2) stale v1 '2d' must not keep it 2D; then run ~25 s and make sure the monitor keeps 3D
        t0 = time.time()
        samples = []
        while time.time() - t0 < 25:
            await pg.wait_for_timeout(5000)
            samples.append(await pg.evaluate('() => [window.WM3D.mode, window.WM3D.on, document.querySelectorAll("canvas").length]'))
        print('mode over 25 s (mode, 3D on, canvases):', samples)
        store = await pg.evaluate("() => [localStorage.getItem('wm3d-quality-v2'), sessionStorage.getItem('wm3d-2d')]")
        print('stored v2 / session-2d:', store)
        print('console:', logs[-6:] or 'clean')
        await ctx.close(); await b.close()

asyncio.run(main())
