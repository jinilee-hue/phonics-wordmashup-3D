"""DPR-2 close-ups of 3D card corners (seeded round), for checking holes / jaggies / seams.

usage: uv run --with playwright python tools/qa/corner_zoom.py [url] [tag]
writes {tag}_full.png and {tag}_corners.png (each card's four corners, 3x)
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, io, sys
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'cz'
SEED = '''(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();'''
DPR = 2
# projected corner points of each 3D face (screen px), from the live meshes
JS = '''() => {
  const s = window.WM3D, st = s.stage, cam = st.camera, out = [];
  st.scene.updateMatrixWorld(true);
  s.cards.group.children.forEach(root => {
    const spin = root.children.find(o => o.type === 'Group'); if (!spin) return;
    const face = spin.children[1];
    const geo = face.geometry; geo.computeBoundingBox();
    const b = geo.boundingBox, V = window.__THREE_V || (window.__THREE_V = face.position.clone());
    const pts = [[b.min.x, b.max.y], [b.max.x, b.max.y], [b.min.x, b.min.y], [b.max.x, b.min.y]].map(([x, y]) => {
      const v = face.position.clone().set(x, y, 0); face.localToWorld(v); v.project(cam);
      return [(v.x + 1) / 2 * st.W, (1 - v.y) / 2 * st.H];
    });
    out.push(pts);
  });
  return out;
}'''


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, device_scale_factor=DPR)
        await ctx.add_init_script(SEED)
        pg = await ctx.new_page()
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        for _ in range(80):
            await pg.wait_for_timeout(400)
            ok = await pg.evaluate('''() => { const s = window.WM3D, sc = s && s.scene; if (!sc || !s.cards) return false;
              const cs = [...sc.leftCards, ...sc.rightCards]; return cs.length === 6 && cs.every(c => s.cards.isReady(c) && Math.abs(c.x - c.baseX) < 1); }''')
            if ok: break
        await pg.evaluate('() => window.WM3D.scene.tweens.pauseAll()')
        await pg.wait_for_timeout(2500)
        corners = await pg.evaluate(JS)
        png = await pg.screenshot()
        await b.close()
    im = Image.open(io.BytesIO(png)).convert('RGB')
    im.save(f'{OUT}/{TAG}_full.png')
    R, K = 22, 3
    tiles = []
    for card in corners:
        for (x, y) in card:
            X, Y = int(x * DPR), int(y * DPR)
            c = im.crop((X - R * DPR, Y - R * DPR, X + R * DPR, Y + R * DPR)).resize((2 * R * DPR * K, 2 * R * DPR * K), Image.LANCZOS)
            tiles.append(c)
    n = len(tiles)
    tw = tiles[0].width
    sheet = Image.new('RGB', (4 * (tw + 6), (n // 4) * (tw + 6)), (0, 0, 0))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 4) * (tw + 6), (i // 4) * (tw + 6)))
    sheet.save(f'{OUT}/{TAG}_corners.png')
    print('cards', len(corners), 'sheet', sheet.size)

asyncio.run(main())
