"""Glee (tutor character) stills: in-game placement at several screen sizes, and a pose sheet.

usage: uv run --with playwright --with pillow python tools/qa/glee_shot.py [base-url] [tag] [--sizes WxH,...] [--poses]
writes {tag}_game_<W>x<H>.png (full) + {tag}_game_<W>x<H>_crop.png, {tag}_poses.png
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, io, sys
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

args = [a for a in sys.argv[1:] if not a.startswith('--')]
BASE = args[0] if args else 'http://127.0.0.1:5183/'
TAG = args[1] if len(args) > 1 else 'glee'
SIZES = ['1280x800']
for i, a in enumerate(sys.argv):
    if a == '--sizes': SIZES = sys.argv[i + 1].split(',')
POSES = '--poses' in sys.argv
SEED = '''(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();'''
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
READY = '''() => { const s = window.WM3D, sc = s && s.scene; if (!sc || !s.cards) return false;
  const cs = [...sc.leftCards, ...sc.rightCards];
  return cs.length === 6 && cs.every(c => s.cards.isReady(c) && Math.abs(c.x - c.baseX) < 1); }'''
FONT = ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc', 26)

# (label, act, seconds into the act, extra)
POSE_LIST = [
    ('기본(idle)', None, 0.0, {}),
    ('인사(hello)', 'hello', 0.55, {}),
    ('카드 잡음(look)', 'grab', 0.3, {'drag': 'upleft'}),
    ('오답(sad)', 'wrong', 0.9, {}),
    ('격려(cheer up)', 'wrong', 2.2, {}),
    ('정답(cheer)', 'cheer', 0.25, {}),
    ('힌트(point)', 'hint', 0.6, {'targets': 'up'}),
    ('한 바퀴(twirl)', 'twirl', 0.27, {}),
]


async def boot(b, w, h, dpr, url):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr)
    await ctx.add_init_script(SEED)
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'favicon' not in m.text and 'Failed to load resource' not in m.text else None)
    await pg.goto(url, wait_until='load'); await pg.wait_for_timeout(2400)
    btn = pg.locator('#intro-overlay button')
    if await btn.count(): await btn.click(force=True)
    for _ in range(80):
        await pg.wait_for_timeout(400)
        if await pg.evaluate(READY): break
    await pg.evaluate('() => window.WM3D.scene.tweens.pauseAll()')
    return ctx, pg, errs


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        for size in SIZES:
            w, h = (int(v) for v in size.split('x'))
            ctx, pg, errs = await boot(b, w, h, 2, BASE + '?q=high')
            await pg.wait_for_timeout(2600)
            await pg.evaluate('() => { const g = window.WM3D.glee; g.reset(); g.freezeAt = g.t; }')
            await pg.wait_for_timeout(500)
            png = await pg.screenshot()
            im = Image.open(io.BytesIO(png)).convert('RGB')
            im.save(f'{OUT}/{TAG}_game_{size}.png')
            box = await pg.evaluate('''() => { const g = window.WM3D.glee, s = window.WM3D.scene; const H = g.home;
                return [H.x, H.y, H.h, s.gw, s.gh]; }''')
            fx, fy, gh = box[0], box[1], box[2]
            crop = im.crop((int((fx - 2.2 * gh) * 2), int((fy - 2.0 * gh) * 2), int((fx + 2.2 * gh) * 2), int((fy + 0.45 * gh) * 2)))
            crop.save(f'{OUT}/{TAG}_game_{size}_crop.png')
            print(size, 'glee feet', [round(v) for v in box[:2]], 'h', round(gh), 'errors', errs[:3] or 'none')
            await ctx.close()
        if POSES:
            ctx, pg, errs = await boot(b, 1280, 800, 2, BASE + '?q=high')
            await pg.evaluate('''() => { const W = window.WM3D; W.cards.group.visible = false; }''')
            tiles = []
            for label, act, u, extra in POSE_LIST:
                await pg.evaluate('''([act, u, extra]) => {
                    const W = window.WM3D, g = W.glee, s = W.scene;
                    g.override = { x: 640, y: 700, h: 430 };
                    g.freezeAt = null; g.reset();
                    s.dragCard = extra.drag ? { active: true, x: 250, y: 120 } : null;
                    const targets = extra.targets ? [{ x: 230, y: 160 }, { x: 1050, y: 160 }] : undefined;
                    if (act === 'twirl') { g.twirlFrom = -0.5; g.play([{ kind: 'twirl', t0: g.t, dur: 0.6 }]); }
                    else if (act) g.react(act, targets);
                    g.freezeAt = g.t + u + 1e-4;
                }''', [act, u, extra])
                await pg.wait_for_timeout(700)
                png = await pg.screenshot(clip={'x': 640 - 300, 'y': 700 - 520, 'width': 600, 'height': 560})
                t = Image.open(io.BytesIO(png)).convert('RGB').resize((450, 420), Image.LANCZOS)
                tile = Image.new('RGB', (450, 460), (24, 22, 32)); tile.paste(t, (0, 40))
                ImageDraw.Draw(tile).text((10, 6), label, fill=(255, 255, 255), font=FONT)
                tiles.append(tile)
            await pg.evaluate('() => { window.WM3D.scene.dragCard = null; }')
            cols = 4
            sheet = Image.new('RGB', (cols * 456, ((len(tiles) + cols - 1) // cols) * 466), (10, 10, 14))
            for i, t in enumerate(tiles):
                sheet.paste(t, ((i % cols) * 456, (i // cols) * 466))
            sheet.save(f'{OUT}/{TAG}_poses.png')
            print('poses', len(tiles), 'errors', errs[:3] or 'none')
            await ctx.close()
        await b.close()

asyncio.run(main())
