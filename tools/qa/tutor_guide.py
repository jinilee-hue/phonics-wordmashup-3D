"""Glee guides wrong answers by voice (user: "틀렸을때도 튜터가 가이드 해줘야지 ... 텍스트로 나오는게 아니라").

Scripted child (fake speech recognition + mouse), real time, three rounds:
  R1 voice play : says the first word -> she reads and places it, "What goes with X?" -> says the partner -> match
                  -> "Say it with me!" -> says it -> praise -> "Let's go!"
  R2 half right : drags the right first card + a wrong second card -> "A! B! That's not a word!" -> "A is right!"
                  (placed back) -> "What goes with A?" -> says the partner -> match -> repeat: silence ->
                  "Listen! A! B! AB! Your turn!" -> says it -> praise
  R3 all wrong  : wrong pair -> names them + "Let's try again!"; wrong pair again -> "Need help? Look at this one!"
                  + reads and places the first card + "What goes with A?" -> says a word that is no card ->
                  "Hmm, not quite!" -> the hint ("Look! A... and B!")
  Mic toasts    : GameScene.showToast from its Mic becomes her voice (no Korean text on screen).
Prints PASS/FAIL per step and the full trace; screenshots tag_r2_ok.png, tag_r3_help.png.

usage: uv run --with playwright python tools/qa/tutor_guide.py [url] [tag]
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, json, sys, time
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(__file__))
from tutor_flow import SEED, FAKE_SR, ARGS, STATE, TRACE, says, drag  # noqa: E402

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'tg'
results = []


def check(name, ok, info=''):
    results.append((name, ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  {info}' if info else ''))


async def until(pg, pred, timeout=60, poll=0.15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        tr = await pg.evaluate(TRACE)
        if pred(tr):
            return tr
        await pg.wait_for_timeout(int(poll * 1000))
    return None


def n_ev(tr, ev):
    return sum(1 for e in tr if e[1] == ev)


def seq_after(tr, start_idx):
    return [e[2] for e in tr[start_idx:] if e[1] == 'say']


async def settled_round(pg, r, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = await pg.evaluate(STATE)
        if st['round'] == r and st['travel'] == 'idle' and not st['busy'] and len(st['cards']) == 6 and all(abs(c['x'] - c['bx']) < 2 and not c['z'] for c in st['cards']):
            return st
        await pg.wait_for_timeout(200)
    raise SystemExit(f'round {r} never settled')


async def hear(pg, *phrases):
    await pg.evaluate(f'() => {{ window.__heard.push(...{json.dumps(list(phrases))}); }}')


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
        await ctx.add_init_script(SEED)
        await ctx.add_init_script(FAKE_SR)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        await pg.wait_for_function('() => window.WM3D && window.WM3D.scene && window.WM3D.tutor', timeout=30000)

        # ── R1: voice play ──
        st = await settled_round(pg, 0)
        w1, w2, res = st['pair']
        await hear(pg, w1, w2, res)
        tr = await until(pg, lambda tr: n_ev(tr, 'release') >= 1, 90)
        got = seq_after(tr or [], 0)
        want = ['hi', 'intro', 'how1', 'how2', 'ask1', 'tell', f'w_{w1}', f'wg_{w1}', 'yes', f'mk_{res}', f'say_{res}']
        check('R1 voice play', got[:len(want)] == want and any(x.startswith('praise') for x in got), ' '.join(got))

        # ── R2: half right ──
        st = await settled_round(pg, 1)
        W1, W2, RES = st['pair']
        i0 = len(await pg.evaluate(TRACE))
        await until(pg, lambda tr: n_ev(tr[i0:], 'listen') >= 1, 30)          # her open question is listening
        L = next(c for c in st['cards'] if c['side'] == 'L' and c['word'] == W1)
        Rw = next(c for c in st['cards'] if c['side'] == 'R' and c['word'] != W2)
        await hear(pg, W2, '', RES)                                           # partner; repeat: silence, then right
        await drag(pg, L['x'], L['y'], st['cx'] - 10, st['cy']); await pg.wait_for_timeout(250)
        await drag(pg, Rw['x'], Rw['y'], st['cx'] + 10, st['cy'])
        tr = await until(pg, lambda tr: f'wg_{W1}' in seq_after(tr, i0) and n_ev(tr[i0:], 'release') >= 1, 90)
        got = seq_after(tr or [], i0)
        k = got.index(f'w_{W1}', got.index(f'w_{Rw["word"]}') - 1) if f'w_{Rw["word"]}' in got else -1
        part = got[k:k + 5] if k >= 0 else []
        check('R2 names the pair, keeps the right card, asks for its partner',
              part == [f'w_{W1}', f'w_{Rw["word"]}', 'nw', f'ok_{W1}', f'wg_{W1}'], ' '.join(got))
        check('R2 partner by voice -> match', 'yes' in got and f'mk_{RES}' in got)
        check('R2 repeat missed -> parts + your turn', ['listenup', f'w_{W1}', f'w_{W2}', f'r_{RES}', 'yourturn'] == got[got.index('listenup'):got.index('listenup') + 5] if 'listenup' in got else False)
        await pg.screenshot(path=f'{OUT}/{TAG}_r2_ok.png')

        # ── R3: all wrong, twice ──
        st = await settled_round(pg, 2)
        A1, A2, ARES = st['pair']
        i0 = len(await pg.evaluate(TRACE))
        await until(pg, lambda tr: n_ev(tr[i0:], 'listen') >= 1, 30)
        Lx = [c for c in st['cards'] if c['side'] == 'L' and c['word'] != A1]
        Rx = [c for c in st['cards'] if c['side'] == 'R' and c['word'] != A2]
        await drag(pg, Lx[0]['x'], Lx[0]['y'], st['cx'] - 10, st['cy']); await pg.wait_for_timeout(250)
        await drag(pg, Rx[0]['x'], Rx[0]['y'], st['cx'] + 10, st['cy'])
        tr = await until(pg, lambda tr: 'tryagain' in seq_after(tr, i0), 30)
        got = seq_after(tr or [], i0)
        check('R3 1st wrong: names the pair + try again', got[-4:] == [f'w_{Lx[0]["word"]}', f'w_{Rx[0]["word"]}', 'nw', 'tryagain'], ' '.join(got))
        await pg.wait_for_timeout(1200)
        await hear(pg, 'banana')
        i1 = len(await pg.evaluate(TRACE))
        st = await pg.evaluate(STATE)
        Lx = [c for c in st['cards'] if c['side'] == 'L' and c['word'] != A1]
        Rx = [c for c in st['cards'] if c['side'] == 'R' and c['word'] != A2]
        await drag(pg, Lx[1]['x'], Lx[1]['y'], st['cx'] - 10, st['cy']); await pg.wait_for_timeout(250)
        await drag(pg, Rx[1]['x'], Rx[1]['y'], st['cx'] + 10, st['cy'])
        tr = await until(pg, lambda tr: f'wg_{A1}' in seq_after(tr, i1), 40)
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=f'{OUT}/{TAG}_r3_help.png')
        tr = await until(pg, lambda tr: f'hint_{ARES}' in seq_after(tr, i1), 40)
        got = seq_after(tr or [], i1)
        want = [f'w_{Lx[1]["word"]}', f'w_{Rx[1]["word"]}', 'nw', 'help1', f'w_{A1}', f'wg_{A1}', 'notquite', f'hint_{ARES}']
        sub = any(got[i:i + len(want)] == want for i in range(len(got)))    # after her reading the grabbed cards
        check('R3 2nd wrong: shows + places the first card, asks; a miss -> not quite -> hint', sub, ' '.join(got))
        inzone = await pg.evaluate(f'() => {{ const c = window.WM3D.scene.leftCards.find(c => c && c.word === {json.dumps(A1)}); return !!(c && c.inZone); }}')
        check('R3 she put the first answer card in the zone', inzone)

        # ── Mic toasts become her voice ──
        await pg.wait_for_timeout(4000)
        i2 = len(await pg.evaluate(TRACE))
        texts0 = await pg.evaluate('() => window.WM3D.scene.children.list.filter(o => o.type === "Text").length')
        await pg.evaluate(f'() => window.WM3D.scene.showToast(\'"{A2}" 들었어요! 다른 단어도 말해봐요\')')
        tr = await until(pg, lambda tr: f'w_{A2}' in seq_after(tr, i2), 15)
        texts1 = await pg.evaluate('() => window.WM3D.scene.children.list.filter(o => o.type === "Text").length')
        check('Mic toast -> voice, no text', bool(tr) and texts1 == texts0, f'texts {texts0}->{texts1} said {seq_after(tr or [], i2)}')

        tr = await pg.evaluate(TRACE)
        await b.close()
    json.dump(tr, open(f'{OUT}/{TAG}_trace.json', 'w'))
    t0 = tr[0][0] if tr else 0
    print('--- trace')
    for e in tr:
        if e[1] in ('say', 'listen', 'heard', 'cut', 'release'):
            print(f'{(e[0] - t0) / 1000:7.2f}s  {e[1]:7s} {e[2]}')
    print('errors:', errs[:5] or 'none')
    print(f'{sum(ok for _, ok in results)}/{len(results)} passed')


asyncio.run(main())
