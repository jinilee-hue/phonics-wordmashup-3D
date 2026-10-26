"""Round-to-round travel check: win round 1, freeze the travel clock at several moments for stills,
then let it finish and verify round 2 is playable (busy off, cards on their slots, drag works).

usage: uv run --with playwright python tools/qa/wm3d_travel.py [url] [tag] [--full] [--reduced]
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, json, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
TAG = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 'tr'
TIMES = [0.35, 0.7, 0.9, 1.0, 1.08, 1.3, 1.5, 1.75, 2.1]

STATE = '''() => { const s = window.WM3D, sc = s && s.scene; if (!sc) return null;
  const pair = sc.queue[sc.roundIndex];
  const cs = [...sc.leftCards.map(c => ['L', c]), ...sc.rightCards.map(c => ['R', c])].filter(([, c]) => c && c.active)
    .map(([side, c]) => ({ side, word: c.word, x: Math.round(c.x), y: Math.round(c.y), bx: Math.round(c.baseX), ready: s.cards.isReady(c) }));
  return { round: sc.roundIndex, busy: sc.busy, pair: pair && [pair.word1, pair.word2], cx: sc.cx, cy: sc.cy, cards: cs,
           phase: s.travel && s.travel.phase, hide: s.travelHide, mode: s.mode, on: s.on }; }'''


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


async def play_pair(pg, st):
    L = next(c for c in st['cards'] if c['side'] == 'L' and c['word'] == st['pair'][0])
    R = next(c for c in st['cards'] if c['side'] == 'R' and c['word'] == st['pair'][1])
    await drag(pg, L['x'], L['y'], st['cx'] - 10, st['cy'])
    await pg.wait_for_timeout(500)
    await drag(pg, R['x'], R['y'], st['cx'] + 10, st['cy'])


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        rm = 'reduce' if '--reduced' in sys.argv else 'no-preference'
        pg = await b.new_page(viewport={'width': 1280, 'height': 800}, reduced_motion=rm)
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type in ('error', 'warning') and 'Failed to load resource' not in m.text and 'GPU stall' not in m.text else None)
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        st = await settle(pg)
        print('round 1:', st['round'], st['pair'], 'busy', st['busy'])
        await play_pair(pg, st)
        # wait for the travel to begin (result card shows ~3 s first), then freeze its clock
        for _ in range(120):
            await pg.wait_for_timeout(100)
            ph = await pg.evaluate('() => window.WM3D.travel.phase')
            if ph != 'idle':
                break
        if '--reduced' in sys.argv:
            st2 = await settle(pg)
            print('reduced motion: travel phase', await pg.evaluate('() => window.WM3D.travel.phase'), '| round', st2['round'], 'busy', st2['busy'])
            await pg.screenshot(path=f'{OUT}/{TAG}_reduced_round2.png')
            print('errors:', errs[:6] or 'none')
            await b.close(); return
        await pg.evaluate('() => { window.WM3D.travel.freezeAt = 0.05; }')
        s1 = await pg.evaluate(STATE)
        print('travel started: phase', s1['phase'], 'round', s1['round'], 'busy', s1['busy'], 'hide', s1['hide'])
        for t in TIMES:
            await pg.evaluate(f'() => {{ window.WM3D.travel.freezeAt = {t}; }}')
            await pg.wait_for_timeout(900)
            await pg.screenshot(path=f'{OUT}/{TAG}_{int(t * 100):03d}.png')
        await pg.evaluate('() => { window.WM3D.travel.freezeAt = null; }')
        st2 = await settle(pg)
        print('round 2:', st2['round'], st2['pair'], 'busy', st2['busy'], 'phase', st2['phase'], 'hide', st2['hide'],
              'on slots', all(abs(c['x'] - c['bx']) < 2 for c in st2['cards']))
        await pg.screenshot(path=f'{OUT}/{TAG}_round2.png')
        await play_pair(pg, st2)
        for _ in range(120):
            await pg.wait_for_timeout(100)
            if await pg.evaluate('() => window.WM3D.travel.phase') != 'idle':
                break
        st3 = await settle(pg)
        print('round 3:', st3['round'], 'busy', st3['busy'], 'cards', len(st3['cards']))
        if '--full' in sys.argv:
            # play to the end: rounds 3..6, then the finale (Compound Book) must open with no travel
            for _ in range(4):
                st3 = await settle(pg)
                await play_pair(pg, st3)
                await pg.wait_for_timeout(4200)
            await pg.wait_for_timeout(2500)
            fin = await pg.evaluate('() => ({ round: window.WM3D.scene.roundIndex, phase: window.WM3D.travel.phase, busy: window.WM3D.scene.busy })')
            print('after round 6:', fin)
            await pg.screenshot(path=f'{OUT}/{TAG}_finale.png')
        print('errors:', errs[:6] or 'none')
        await b.close()

asyncio.run(main())
