"""Render the round-to-round travel as a smooth preview video (frozen travel clock, 30 fps).

usage: uv run --with playwright python tools/qa/travel_video.py [url] [out.mp4]
needs ffmpeg on PATH. Audio is not recorded.
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, shutil, subprocess, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
MP4 = sys.argv[2] if len(sys.argv) > 2 else os.path.join(OUT, 'travel.mp4')
FPS = 30
END = 1.05 + 1.25 + 0.2          # DEPART + ARRIVE + a short hold
FRAMES = os.path.join(OUT, 'travel_frames')

STATE = '''() => { const s = window.WM3D, sc = s && s.scene; if (!sc) return null;
  const pair = sc.queue[sc.roundIndex];
  const cs = [...sc.leftCards.map(c => ['L', c]), ...sc.rightCards.map(c => ['R', c])].filter(([, c]) => c && c.active)
    .map(([side, c]) => ({ side, word: c.word, x: Math.round(c.x), y: Math.round(c.y), bx: Math.round(c.baseX), ready: s.cards.isReady(c) }));
  return { round: sc.roundIndex, busy: sc.busy, pair: pair && [pair.word1, pair.word2], cx: sc.cx, cy: sc.cy, cards: cs }; }'''
TWO_FRAMES = '() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'


async def settle(pg):
    prev = None
    for _ in range(80):
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
    shutil.rmtree(FRAMES, ignore_errors=True)
    os.makedirs(FRAMES)
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 800})
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        st = await settle(pg)
        L = next(c for c in st['cards'] if c['side'] == 'L' and c['word'] == st['pair'][0])
        R = next(c for c in st['cards'] if c['side'] == 'R' and c['word'] == st['pair'][1])
        await drag(pg, L['x'], L['y'], st['cx'] - 10, st['cy'])
        await pg.wait_for_timeout(500)
        await drag(pg, R['x'], R['y'], st['cx'] + 10, st['cy'])
        for _ in range(150):
            await pg.wait_for_timeout(50)
            if await pg.evaluate('() => window.WM3D.travel.phase') != 'idle':
                break
        n = int(END * FPS)
        for f in range(n + 1):
            await pg.evaluate(f'() => {{ window.WM3D.travel.freezeAt = {f / FPS:.4f}; }}')
            await pg.evaluate(TWO_FRAMES)
            await pg.screenshot(path=os.path.join(FRAMES, f'f_{f:03d}.png'))
        await pg.evaluate('() => { window.WM3D.travel.freezeAt = null; }')
        await b.close()
    # hold the first frame 0.4 s, then the run
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(FRAMES, 'f_%03d.png'),
                    '-vf', f'tpad=start_mode=clone:start_duration=0.4:stop_mode=clone:stop_duration=0.5,scale=1280:-2',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', MP4], check=True)
    print('wrote', MP4, f'({n + 1} frames)')

asyncio.run(main())
