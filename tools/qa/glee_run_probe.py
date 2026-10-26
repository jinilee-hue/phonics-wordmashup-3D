"""Debug/inspect Glee's run: win round 1, freeze the travel clock at given times, print Glee's frame
and the dust puffs, save crops around her.

usage: uv run --with playwright --with pillow python tools/qa/glee_run_probe.py [url] [tag] [t1,t2,...]
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, io, json, sys
from PIL import Image
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'probe'
TIMES = [float(v) for v in sys.argv[3].split(',')] if len(sys.argv) > 3 else [0.33, 0.4, 0.5, 1.5, 1.6]
SEED = '''(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();'''
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
STATE = '''() => { const s = window.WM3D, sc = s && s.scene; if (!sc) return null;
  const pair = sc.queue[sc.roundIndex];
  const cs = [...sc.leftCards.map(c => ['L', c]), ...sc.rightCards.map(c => ['R', c])].filter(([, c]) => c && c.active)
    .map(([side, c]) => ({ side, word: c.word, x: Math.round(c.x), y: Math.round(c.y), bx: Math.round(c.baseX), ready: s.cards.isReady(c) }));
  return { round: sc.roundIndex, busy: sc.busy, pair: pair && [pair.word1, pair.word2], cx: sc.cx, cy: sc.cy, cards: cs }; }'''
PROBE = '''() => { const W = window.WM3D, g = W.glee, st = W.stage, F = g.F;
  const dbg = { phase: W.travel.phase, freeze: W.travel.freezeAt, clock: g.runClock(), reduced: g.reduced, vis: g.visible, act: g.act && g.act.kind, gt: +g.t.toFixed(2) };
  const scr = v => { const p = v.clone().project(st.overlayCam); return [Math.round((p.x + 1) / 2 * st.W), Math.round((1 - p.y) / 2 * st.H)]; };
  return { dbg, running: g.running, frame: { gx: Math.round(F.gx), gy: Math.round(F.gy), scale: +F.scale.toFixed(3), jump: +F.jump.toFixed(3),
      yaw: +F.yaw.toFixed(2), op: +F.opacity.toFixed(2) },
    feet: scr(g.root.position),
    puffs: g.puffs.filter(p => p.visible).map(p => ({ at: scr(p.position), op: +p.material.opacity.toFixed(2), size: Math.round(p.scale.x), order: p.renderOrder })) }; }'''


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
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, device_scale_factor=2)
        await ctx.add_init_script(SEED)
        pg = await ctx.new_page()
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        st = await settle(pg)
        L = next(c for c in st['cards'] if c['side'] == 'L' and c['word'] == st['pair'][0])
        R = next(c for c in st['cards'] if c['side'] == 'R' and c['word'] == st['pair'][1])
        await drag(pg, L['x'], L['y'], st['cx'] - 10, st['cy']); await pg.wait_for_timeout(500)
        await drag(pg, R['x'], R['y'], st['cx'] + 10, st['cy'])
        # at DPR 2 SwiftShader runs a few fps and Phaser's clock (result card, 2.7 s) slows down with it:
        # wait on the travel itself, not a fixed number of polls
        import time
        deadline = time.time() + 120
        while time.time() < deadline:
            if await pg.evaluate("() => window.WM3D.travel.phase !== 'idle'"): break
            await pg.wait_for_timeout(50)
        else:
            raise SystemExit('travel never started')
        for t in TIMES:
            await pg.evaluate(f'() => {{ window.WM3D.travel.freezeAt = {t}; }}')
            # SwiftShader at DPR 2 needs well over 500 ms a frame: wait for two real frames
            await pg.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
            info = await pg.evaluate(PROBE)
            print(f't={t:.2f}', json.dumps(info))
            png = await pg.screenshot()
            im = Image.open(io.BytesIO(png)).convert('RGB')
            fx, fy = info['feet']
            im.crop((2 * (fx - 130), 2 * (fy - 190), 2 * (fx + 130), 2 * (fy + 50))).save(f'{OUT}/{TAG}_{t:.2f}.png')
        await b.close()

asyncio.run(main())
