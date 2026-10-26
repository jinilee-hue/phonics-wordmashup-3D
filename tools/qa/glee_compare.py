"""Character sheet vs the 3D model: the sheet's front / 3/4 / sad / cheering drawings next to the
same poses rendered on a plain lavender backdrop.

usage: uv run --with playwright --with pillow python tools/qa/glee_compare.py SHEET.png [base-url] [tag]
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, io, sys
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

SHEET = sys.argv[1]
BASE = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:5183/'
TAG = sys.argv[3] if len(sys.argv) > 3 else 'gc'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
FONT = ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc', 24)
# (label, sheet crop box on the 1024x765 sheet, act, seconds into the act, yaw)
ROWS = [
    ('정면', (40, 175, 300, 415), None, 0.0, 0.0),
    ('3/4', (305, 440, 500, 700), 'hello', 0.5, 0.55),
    ('슬픔', (835, 320, 1000, 470), 'wrong', 0.9, 0.0),
    ('환호', (705, 485, 870, 690), 'cheer', 0.25, 0.0),
]


async def main():
    sheet = Image.open(SHEET).convert('RGB')
    if sheet.width != 1024:
        sheet = sheet.resize((1024, round(sheet.height * 1024 / sheet.width)), Image.LANCZOS)
    tiles = []
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        await pg.goto(BASE + '?q=high', wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        for _ in range(60):
            await pg.wait_for_timeout(400)
            if await pg.evaluate('() => !!(window.WM3D && window.WM3D.glee && window.WM3D.scene)'): break
        await pg.wait_for_timeout(1500)
        await pg.evaluate("""() => { const W = window.WM3D; W.stage.scene.visible = false;
            W.stage.renderer.setClearColor(0xdcd6f7, 1); W.scene.tweens.pauseAll(); }""")
        for label, box, act, u, yaw in ROWS:
            await pg.evaluate("""([act, u, yaw]) => { const g = window.WM3D.glee;
                g.override = { x: 640, y: 690, h: 520, yaw }; g.freezeAt = null; g.reset();
                if (act) g.react(act); g.freezeAt = g.t + u + 1e-4; }""", [act, u, yaw])
            await pg.wait_for_timeout(800)
            png = await pg.screenshot(clip={'x': 640 - 330, 'y': 690 - 600, 'width': 660, 'height': 650})
            ours = Image.open(io.BytesIO(png)).convert('RGB')
            ref = sheet.crop(box)
            hh = 360
            ref = ref.resize((round(ref.width * hh / ref.height), hh), Image.LANCZOS)
            ours = ours.resize((round(ours.width * hh / ours.height), hh), Image.LANCZOS)
            t = Image.new('RGB', (ref.width + ours.width + 12, hh + 36), (24, 22, 32))
            t.paste(ref, (0, 36)); t.paste(ours, (ref.width + 12, 36))
            d = ImageDraw.Draw(t)
            d.text((8, 4), f'{label} - 시트', fill=(255, 255, 255), font=FONT)
            d.text((ref.width + 20, 4), '3D 모델', fill=(255, 255, 255), font=FONT)
            tiles.append(t)
        await b.close()
    W = max(t.width for t in tiles) * 2 + 10
    rows = [tiles[i:i + 2] for i in range(0, len(tiles), 2)]
    H = sum(max(t.height for t in r) for r in rows) + 10 * (len(rows) - 1)
    out = Image.new('RGB', (W, H), (10, 10, 14))
    y = 0
    for r in rows:
        x = 0
        for t in r:
            out.paste(t, (x, y)); x += t.width + 10
        y += max(t.height for t in r) + 10
    out.save(f'{OUT}/{TAG}_compare.png')
    print('compare', out.size)

asyncio.run(main())
