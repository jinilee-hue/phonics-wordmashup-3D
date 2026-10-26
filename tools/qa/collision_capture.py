"""Frame-exact capture of the card collision (match -> burst -> result card), 30 fps game time.

Drops the left answer card with the mouse, then puts Phaser's loop to sleep and drives the game
with game.step(t, 33.3 ms) (and a fixed 3D time step), dropping the right card exactly like
GameScene's pointerup does. Every frame is a screenshot -> a contact sheet and an mp4.

usage: uv run --with playwright --with pillow python tools/qa/collision_capture.py [url] [tag] [seconds]
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, io, shutil, subprocess, sys
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'col'
SECS = float(sys.argv[3]) if len(sys.argv) > 3 else 4.2
FPS = 30
W, H = 1280, 720
SEED = """(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();"""
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
STATE = """() => { const s = window.WM3D, sc = s && s.scene; if (!sc) return null;
  const pair = sc.queue[sc.roundIndex];
  const cs = [...sc.leftCards.map(c => ['L', c]), ...sc.rightCards.map(c => ['R', c])].filter(([, c]) => c && c.active)
    .map(([side, c]) => ({ side, word: c.word, x: Math.round(c.x), y: Math.round(c.y), bx: Math.round(c.baseX), ready: s.cards.isReady(c) }));
  return { round: sc.roundIndex, busy: sc.busy, pair: pair && [pair.word1, pair.word2], cx: sc.cx, cy: sc.cy, cards: cs }; }"""
DROP_RIGHT = """() => { const s = window.WM3D.scene, pair = s.queue[s.roundIndex];
  const R = s.rightCards.find(c => c.word === pair.word2);
  R.x = s.cx + 12; R.y = s.cy;
  if (s.selectedRight && s.selectedRight !== R) s.selectedRight.shakeBack();
  s.selectedRight = R; R.snapToZone(s.cx + s.snapOff, s.cy);
  if (s.selectedLeft && s.selectedLeft.inZone) s.time.delayedCall(260, () => s.checkMatch());
  return [R.word, !!(s.selectedLeft && s.selectedLeft.inZone)]; }"""


async def settle(pg):
    prev = None
    for _ in range(100):
        await pg.wait_for_timeout(400)
        st = await pg.evaluate(STATE)
        if st and len(st['cards']) == 6 and all(c['ready'] for c in st['cards']) and not st['busy']:
            xs = [c['x'] for c in st['cards']]
            if xs == prev and all(abs(c['x'] - c['bx']) < 2 for c in st['cards']):
                return st
            prev = xs
    return await pg.evaluate(STATE)


async def drag(pg, x0, y0, x1, y1, n=12):
    await pg.mouse.move(x0, y0); await pg.mouse.down()
    for i in range(1, n + 1):
        await pg.mouse.move(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)
        await pg.wait_for_timeout(16)
    await pg.mouse.up()


async def main():
    frames_dir = os.path.join(OUT, f'{TAG}_frames')
    shutil.rmtree(frames_dir, ignore_errors=True); os.makedirs(frames_dir)
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        ctx = await b.new_context(viewport={'width': W, 'height': H})
        await ctx.add_init_script(SEED)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        st = await settle(pg)
        L = next(c for c in st['cards'] if c['side'] == 'L' and c['word'] == st['pair'][0])
        await drag(pg, L['x'], L['y'], st['cx'] - 10, st['cy'])
        await pg.wait_for_timeout(900)
        # from here on: frame-exact
        # Phaser's TweenManager times itself with Date.now() (not the step delta): pin it to the step too
        await pg.evaluate("""() => { const W = window.WM3D; W.scene.game.loop.sleep(); W.fixedDt = 1 / 30; W.tFixed = (performance.now() - W.t0) / 1000;
            W.__gt = performance.now(); W.scene.tweens.getDelta = () => 1000 / 30; }""")
        print('drop', await pg.evaluate(DROP_RIGHT), 'pair', st['pair'])
        n = int(SECS * FPS)
        for f in range(n):
            await pg.evaluate("""() => { const W = window.WM3D, g = W.scene.game; W.__gt += 1000 / 30; g.step(W.__gt, 1000 / 30); }""")
            await pg.screenshot(path=os.path.join(frames_dir, f'f_{f:03d}.png'))
        await pg.evaluate('() => { const W = window.WM3D; W.fixedDt = null; delete W.scene.tweens.getDelta; W.scene.game.loop.wake(); }')
        await b.close()
    # sheet: every 3rd frame (0.1 s)
    font = ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc', 18)
    tiles = []
    for f in range(0, n, 3):
        im = Image.open(os.path.join(frames_dir, f'f_{f:03d}.png')).convert('RGB').resize((427, 240), Image.LANCZOS)
        t = Image.new('RGB', (427, 262), (20, 20, 24)); t.paste(im, (0, 22))
        ImageDraw.Draw(t).text((5, 1), f'{f / FPS:.2f}s', fill=(255, 255, 255), font=font)
        tiles.append(t)
    cols = 6
    for part in range(0, len(tiles), 18):
        chunk = tiles[part:part + 18]
        sheet = Image.new('RGB', (cols * 431, ((len(chunk) + cols - 1) // cols) * 266), (0, 0, 0))
        for i, t in enumerate(chunk):
            sheet.paste(t, ((i % cols) * 431, (i // cols) * 266))
        sheet.save(os.path.join(OUT, f'{TAG}_sheet{part // 18}.png'))
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(frames_dir, 'f_%03d.png'),
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', os.path.join(OUT, f'{TAG}.mp4')], check=True)
    print('frames', n, 'errors', errs[:3] or 'none')

asyncio.run(main())
