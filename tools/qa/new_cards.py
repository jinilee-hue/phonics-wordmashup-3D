"""Play rounds made of chosen compounds (default: the 2026-10-27 textbook batch) and check that their card art, 3D
faces, result cards and Glee's voice lines load. Forces the queue by wrapping startRound on the scene and restarting it.

PASS = no 4xx/5xx for images / gl/cards / gl/voice, the round shows the forced pair as 3D twins, a win shows the
result card, no page errors. Saves stills to $WM3D_OUT (default .) as newcards_<tag>_*.png.

Needs the Vite dev server (it imports /src/data/compounds.ts to get the pair objects). Works with ?q=2d too.
usage: uv run --with playwright python tools/qa/new_cards.py [url] [tag] [compound,compound,...]
"""
import asyncio, os, sys, time
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'high'
WORDS = (sys.argv[3] if len(sys.argv) > 3 else 'backpack,popcorn,spaceship,wheelchair,windmill,treetop').split(',')
OUT = os.environ.get('WM3D_OUT', '.')
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
SEED = '''(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();
// the Game scene in 3D (WM3D.scene) and in the 2D fallback (?q=2d never attaches; WM3D.game is still set)
window.__sc = () => window.WM3D && (window.WM3D.scene || (window.WM3D.game && window.WM3D.game.scene.getScene('Game')));'''
STATE = '''() => { const s = window.WM3D, sc = window.__sc && window.__sc(); if (!sc || !sc.leftCards) return null;
  const pair = sc.queue && sc.queue[sc.roundIndex];
  const cs = [...sc.leftCards.map(c => ['L', c]), ...sc.rightCards.map(c => ['R', c])].filter(([, c]) => c && c.active)
    .map(([side, c]) => ({ side, word: c.word, x: Math.round(c.x), y: Math.round(c.y), bx: Math.round(c.baseX),
   }));
  return { round: sc.roundIndex, busy: sc.busy, pair: pair && [pair.word1, pair.word2, pair.result], cx: sc.cx, cy: sc.cy,
    cards: cs, phase: (s.travel && s.travel.phase) || null }; }'''
# create() picks a random queue and calls startRound(): swap the queue in at the first startRound after the restart
FORCE = '''() => { const sc = window.__sc(); const cur = sc.startRound;
  sc.startRound = function () {
    if (this.roundIndex === 0 && !this.__forced) {         // forced pairs first, then the game's own picks (6 rounds)
      const f = window.__forcedPairs, n = this.queue.length;
      this.__forced = true;
      this.queue = f.concat(this.queue.filter(p => !f.some(q => q.result === p.result))).slice(0, Math.max(n, f.length));
    }
    return cur.apply(this, arguments);
  };
  return true; }'''
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
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = await pg.evaluate(STATE)
        if st and pred(st):
            return st
        await pg.wait_for_timeout(250)
    return None


def settled(r):
    return lambda s: (s['round'] == r and not s['busy'] and s['phase'] in ('idle', None) and len(s['cards']) == 6
                      and all(abs(c['x'] - c['bx']) < 2 for c in s['cards']))


async def main():
    bad, errs = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
        await ctx.add_init_script(SEED)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url.split("/")[-1]}') if r.status >= 400 and
              any(k in r.url for k in ('/images/', '/gl/cards/', '/gl/voice/')) else None)
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        await pg.wait_for_function('() => window.__sc && window.__sc() && window.__sc().leftCards', timeout=30000)
        ok = await pg.evaluate('''async (ws) => {
          const mod = await import('/src/data/compounds.ts').catch(() => null);
          if (!mod) return false;
          window.__forcedPairs = ws.map(w => mod.COMPOUND_PAIRS.find(p => p.result === w));
          return window.__forcedPairs.every(p => p && p.result); }''', WORDS)
        check('pairs found in compounds.ts', ok)
        if not ok:
            await b.close(); return
        await pg.evaluate(FORCE)
        await pg.evaluate('() => window.__sc().scene.restart()')
        await pg.wait_for_timeout(1500)
        for r in range(2):
            st = await until(pg, settled(r), 60)
            if not st:
                check(f'round {r + 1} ready', False); break
            w1, w2, res = st['pair']
            check(f'round {r + 1} is {res}', res == WORDS[r], f"cards: {' '.join(c['side'] + ':' + c['word'] for c in st['cards'])}")
            await pg.wait_for_timeout(1200)                  # 3D twins' textures
            await pg.screenshot(path=f'{OUT}/newcards_{TAG}_r{r + 1}_cards.png')
            L = next(c for c in st['cards'] if c['side'] == 'L' and c['word'] == w1)
            R = next(c for c in st['cards'] if c['side'] == 'R' and c['word'] == w2)
            await drag(pg, L['x'], L['y'], st['cx'] - 10, st['cy']); await pg.wait_for_timeout(400)
            await drag(pg, R['x'], R['y'], st['cx'] + 10, st['cy'])
            await pg.wait_for_timeout(2600)                  # the crash
            await pg.screenshot(path=f'{OUT}/newcards_{TAG}_r{r + 1}_crash.png')
            await pg.wait_for_timeout(1900)                  # the result card (Glee's line runs first)
            await pg.screenshot(path=f'{OUT}/newcards_{TAG}_r{r + 1}_result.png')
            has = await pg.evaluate(f'''() => !!window.__sc().textures.exists('card_{res}')''')
            check(f'result card texture card_{res} loaded', has)
        await pg.wait_for_timeout(1500)
        await b.close()
    check('no 4xx for images / faces / voice', not bad, '; '.join(bad[:6]))
    check('no page errors', not errs, '; '.join(errs[:3]))
    print(f'{sum(results)}/{len(results)} passed')


asyncio.run(main())
