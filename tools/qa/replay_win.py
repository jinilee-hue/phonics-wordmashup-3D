"""Replay, then win again - the way the user's tab hit "Cannot read properties of null (reading 'fill')"
(reward.ts, trail.start). A Replay restarts GameScene, which runs attach() again; the reward wrapper had hidden
the hold wrapper's __wm3d marker, so onRoundWin got wrapped a second time and every later win played the reward
twice - the outer play stopped the inner one mid-burst and its pending icons hit destroyed emitters.

Plays like the user (tutor on): win round 1 -> Replay (the scene's own restart) -> win again.
PASS = no page errors, one reward play per win with all three gains, HUD 10 / 15 / 3 after each win.

usage: uv run --with playwright python tools/qa/replay_win.py [url]
"""
import asyncio, json, sys, time
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
SEED = '''(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();'''
STATE = '''() => { const s = window.WM3D, sc = s && s.scene; if (!sc || !sc.leftCards) return null;
  const pair = sc.queue && sc.queue[sc.roundIndex];
  const cs = [...sc.leftCards.map(c => ['L', c]), ...sc.rightCards.map(c => ['R', c])].filter(([, c]) => c && c.active)
    .map(([side, c]) => ({ side, word: c.word, x: Math.round(c.x), y: Math.round(c.y), bx: Math.round(c.baseX) }));
  return { round: sc.roundIndex, busy: sc.busy, pair: pair && [pair.word1, pair.word2], cx: sc.cx, cy: sc.cy, cards: cs,
    phase: s.travel && s.travel.phase,
    hud: [sc.scoreText && sc.scoreText.text, sc.coinText && sc.coinText.text, sc.gemText && sc.gemText.text],
    plays: window.__plays || [] }; }'''
# count reward plays (and how many gains each got) on the current Reward instance
HOOK = '''() => { const r = window.WM3D.reward; if (!r || r.__counted) return !!r;
  const play = r.play.bind(r);
  r.play = (card, gains, avoid) => { (window.__plays = window.__plays || []).push(gains.length); return play(card, gains, avoid); };
  r.__counted = true; return true; }'''
results = []


def check(name, ok, info=''):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + name + (f'  {info}' if info else ''))


async def drag(pg, x0, y0, x1, y1, n=12):
    await pg.mouse.move(x0, y0); await pg.mouse.down()
    for i in range(1, n + 1):
        await pg.mouse.move(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)
        await pg.wait_for_timeout(16)
    await pg.mouse.up()


async def until(pg, pred, timeout):
    t0 = time.time(); st = None
    while time.time() - t0 < timeout:
        st = await pg.evaluate(STATE)
        if st and pred(st):
            return st
        await pg.wait_for_timeout(250)
    return None


def settled(r):
    return lambda s: (s['round'] == r and not s['busy'] and s['phase'] == 'idle' and len(s['cards']) == 6
                      and all(abs(c['x'] - c['bx']) < 2 for c in s['cards']))


async def win(pg, tag, errs):
    st = await until(pg, settled(0), 60)
    if not st:
        check(f'{tag}: round 1 ready', False); return
    await pg.evaluate(HOOK)
    await pg.evaluate('() => { window.__plays = []; }')
    e0 = len(errs)
    L = next(c for c in st['cards'] if c['side'] == 'L' and c['word'] == st['pair'][0])
    R = next(c for c in st['cards'] if c['side'] == 'R' and c['word'] == st['pair'][1])
    await drag(pg, L['x'], L['y'], st['cx'] - 10, st['cy']); await pg.wait_for_timeout(400)
    await drag(pg, R['x'], R['y'], st['cx'] + 10, st['cy'])
    st = await until(pg, lambda s: s['hud'] == ['10', '15', '3'], 60)
    await pg.wait_for_timeout(2500)                     # let the whole reward run out
    st = await pg.evaluate(STATE)
    check(f'{tag}: HUD 10 / 15 / 3', st['hud'] == ['10', '15', '3'], str(st['hud']))
    check(f'{tag}: one reward play with 3 gains', st['plays'] == [3], f'plays {st["plays"]}')
    check(f'{tag}: no page errors', len(errs) == e0, '; '.join(errs[e0:e0 + 3]))
    await until(pg, settled(1), 60)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
        await ctx.add_init_script(SEED)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        await pg.wait_for_function('() => window.WM3D && window.WM3D.scene && window.WM3D.reward', timeout=30000)
        await win(pg, 'first game', errs)
        # Replay: the scene's own restart (GameScene runs it after its fade-out)
        await pg.evaluate('() => window.WM3D.scene.scene.restart()')
        await pg.wait_for_timeout(1500)
        await until(pg, lambda s: s['hud'] == ['0', '0', '0'], 30)
        await win(pg, 'after Replay', errs)
        await b.close()
    print('errors:', errs[:5] or 'none')
    print(f'{sum(results)}/{len(results)} passed')


asyncio.run(main())
