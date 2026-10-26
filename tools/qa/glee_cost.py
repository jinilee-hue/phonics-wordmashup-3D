"""Glee's GPU cost: time st.render() (+ a readPixels sync) with Glee at its game size, huge, and hidden.
If the 'huge' number is not clearly larger, the timer is not measuring GPU work.

usage: uv run --with playwright python tools/qa/glee_cost.py [url] [WxH] [dpr]
"""
import asyncio, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
W, H = (int(v) for v in (sys.argv[2] if len(sys.argv) > 2 else '1440x900').split('x'))
DPR = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0

JS = '''async () => {
  const s = window.WM3D, st = s.stage, g = s.glee, gl = st.renderer.getContext();
  // gl.finish() does not wait for the GPU in Chrome; reading a pixel back does
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const time = (n) => { for (let i = 0; i < 8; i++) st.render(1 + i / 60, 1 / 60); sync();
    const t0 = performance.now(); for (let i = 0; i < n; i++) st.render(2 + i / 60, 1 / 60); sync();
    return +((performance.now() - t0) / n).toFixed(3); };
  const out = {};
  g.update(0); out.game = time(120);
  g.override = { x: st.W / 2, y: st.H * 0.95, h: st.H * 0.85 }; g.update(0); out.huge = time(60);
  g.override = null; g.visible = false; g.update(0); out.hidden = time(120);
  g.visible = true; g.update(0);
  return out;
}'''


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': W, 'height': H}, device_scale_factor=DPR)
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        for _ in range(60):
            await pg.wait_for_timeout(400)
            if await pg.evaluate('() => !!(window.WM3D && window.WM3D.on && window.WM3D.glee && window.WM3D.scene && window.WM3D.scene.leftCards.length === 3)'):
                break
        await pg.wait_for_timeout(2000)
        gpu = await pg.evaluate('''() => { const c = document.createElement('canvas').getContext('webgl2');
            const e = c && c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }''')
        print('GPU:', gpu[:80])
        print('ms per frame (render + readPixels sync):', await pg.evaluate(JS))
        await b.close()

asyncio.run(main())
