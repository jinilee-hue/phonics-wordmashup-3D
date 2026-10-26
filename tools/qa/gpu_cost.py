"""Real GPU cost of one 3D frame (Metal, headless): render N frames back to back, then read one
pixel back (that waits for the GPU; gl.finish() does not in Chrome).
Headless rAF intervals are compositor-bound and say nothing about speed; this does.

usage: uv run --with playwright python tools/qa/gpu_cost.py [url] [WxH] [dpr]
"""
import asyncio, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
W, H = (int(v) for v in (sys.argv[2] if len(sys.argv) > 2 else '1440x900').split('x'))
DPR = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0

JS = '''async () => {
  const s = window.WM3D, st = s.stage, gl = st.renderer.getContext();
  // gl.finish() returns before the GPU is done in Chrome (it measured only command submission);
  // reading one pixel back waits for every queued frame
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const out = {};
  for (const q of ['high', 'mid', 'low']) {
    st.setQuality(q);
    for (let i = 0; i < 10; i++) st.render(1 + i / 60, 1 / 60);     // warm-up / shader compile
    sync();
    const N = 60, t0 = performance.now();
    for (let i = 0; i < N; i++) st.render(2 + i / 60, 1 / 60);
    sync();
    out[q] = +((performance.now() - t0) / N).toFixed(2);
  }
  st.setQuality('high');
  const c = st.renderer.domElement;
  out.buffer = c.width + 'x' + c.height;
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
            if await pg.evaluate('() => !!(window.WM3D && window.WM3D.on && window.WM3D.scene && window.WM3D.scene.leftCards.length === 3)'):
                break
        await pg.wait_for_timeout(2500)
        print('ms per 3D frame (render + readPixels sync):', await pg.evaluate(JS))
        await b.close()

asyncio.run(main())
