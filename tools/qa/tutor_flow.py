"""Glee leads the game: real-time run with a scripted 'child' (fake speech recognition + mouse drags).

Round 1: she greets, points at the two columns, asks -> the child says the first word -> "What goes with pan?"
-> the child says the second word -> "Yes! Pancake!" and she puts the cards in -> "Pan and cake make... pancake!"
-> "Say it with me!" -> the child says it -> praise -> "Let's go!" -> travel.
Round 2: she asks -> silence -> the child grabs a wrong card (she reads it), drops it ("What goes with sun?",
silence), drops a wrong partner -> "Try again!".
Prints the tutor trace (what she said / heard), checks one-speaker-at-a-time and saves screenshots
(tag_greet / _point / _listen / _say / _wrong .png) plus the trace JSON.

usage: uv run --with playwright python tools/qa/tutor_flow.py [url] [tag]
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, json, sys, time
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'tf'
SEED = '''(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();'''
# a stand-in for the browser's speech recognition (shared with tutor_guide.py): each start() 'hears' the next queued phrase ('' = silence)
FAKE_SR = '''(() => {
  window.__heard = []; window.__srLog = [];
  class FakeSR {
    start() {
      const said = window.__heard.length ? window.__heard.shift() : '';
      window.__srLog.push({ t: performance.now(), said });
      this._t = setTimeout(() => {
        if (said) { const r = [{ transcript: said, confidence: 0.9 }]; r.isFinal = true; this.onresult && this.onresult({ resultIndex: 0, results: [r] }); }
        this.onend && this.onend();
      }, said ? 900 : 3500);
    }
    stop() { clearTimeout(this._t); setTimeout(() => this.onend && this.onend(), 60); }
    abort() { clearTimeout(this._t); setTimeout(() => this.onend && this.onend(), 10); }
  }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
})();'''
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
STATE = '''() => { const s = window.WM3D, sc = s && s.scene; if (!sc) return null;
  const pair = sc.queue[sc.roundIndex];
  const cs = [...sc.leftCards.map(c => ['L', c]), ...sc.rightCards.map(c => ['R', c])].filter(([, c]) => c && c.active)
    .map(([side, c]) => ({ side, word: c.word, x: Math.round(c.x), y: Math.round(c.y), bx: Math.round(c.baseX), z: c.inZone }));
  return { round: sc.roundIndex, busy: sc.busy, pair: pair && [pair.word1, pair.word2, pair.result], cx: sc.cx, cy: sc.cy, cards: cs,
    travel: s.travel.phase }; }'''
TRACE = '() => (window.WM3D.tutor ? window.WM3D.tutor.trace.map(e => [Math.round(e.t), e.ev, e.id || "", e.prio ?? null]) : [])'


async def wait_ev(pg, pred, timeout=60, poll=0.15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        tr = await pg.evaluate(TRACE)
        hit = pred(tr)
        if hit:
            return tr
        await pg.wait_for_timeout(int(poll * 1000))
    raise SystemExit(f'timeout waiting; trace tail: {(await pg.evaluate(TRACE))[-8:]}')


def says(tr):
    return [e[2] for e in tr if e[1] == 'say']


async def drag(pg, x0, y0, x1, y1, n=12):
    await pg.mouse.move(x0, y0); await pg.mouse.down()
    for i in range(1, n + 1):
        await pg.mouse.move(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)
        await pg.wait_for_timeout(16)
    await pg.mouse.up()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
        await ctx.add_init_script(SEED)
        await ctx.add_init_script(FAKE_SR)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'favicon' not in (m.location or {}).get('url', '') else None)
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        await pg.wait_for_function('() => window.WM3D && window.WM3D.scene && window.WM3D.tutor', timeout=30000)
        st = await pg.evaluate(STATE)
        w1, w2, res = st['pair']
        print('round 1 pair', w1, w2, res)
        # the child: first word, then the second, then repeats the compound
        await pg.evaluate(f'() => {{ window.__heard.push({json.dumps(w1)}, {json.dumps(w2)}, {json.dumps(res)}); }}')
        await wait_ev(pg, lambda tr: 'how1' in says(tr), 40)
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=f'{OUT}/{TAG}_point.png')
        await wait_ev(pg, lambda tr: any(e[1] == 'listen' for e in tr), 40)
        await pg.wait_for_timeout(350)
        await pg.screenshot(path=f'{OUT}/{TAG}_listen.png')
        await wait_ev(pg, lambda tr: f'say_{res}' in says(tr), 60)
        await pg.wait_for_timeout(700)
        await pg.screenshot(path=f'{OUT}/{TAG}_say.png')
        await wait_ev(pg, lambda tr: any(e[1] == 'release' for e in tr), 60)
        t_rel = time.time()
        # round 2
        for _ in range(200):
            st2 = await pg.evaluate(STATE)
            if st2['round'] == 1 and st2['travel'] == 'idle' and not st2['busy'] and len(st2['cards']) == 6 and all(abs(c['x'] - c['bx']) < 2 for c in st2['cards']):
                break
            await pg.wait_for_timeout(200)
        print(f'round 2 ready {time.time() - t_rel:.1f}s after release', st2['pair'])
        await wait_ev(pg, lambda tr: sum(1 for e in tr if e[1] == 'listen') >= 4, 40)     # her open question
        W1, W2, _ = st2['pair']
        Ld = next(c for c in st2['cards'] if c['side'] == 'L' and c['word'] != W1)
        Rd = next(c for c in st2['cards'] if c['side'] == 'R' and c['word'] != W2)
        await drag(pg, Ld['x'], Ld['y'], st2['cx'] - 10, st2['cy'])
        await wait_ev(pg, lambda tr: f'wg_{Ld["word"]}' in says(tr), 20)
        await pg.wait_for_timeout(300)
        await drag(pg, Rd['x'], Rd['y'], st2['cx'] + 10, st2['cy'])
        await wait_ev(pg, lambda tr: 'nw' in says(tr), 20)
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=f'{OUT}/{TAG}_wrong.png')
        await pg.wait_for_timeout(2500)
        tr = await pg.evaluate(TRACE)
        sr = await pg.evaluate('() => window.__srLog.map(e => e.said)')
        await b.close()
    json.dump(tr, open(f'{OUT}/{TAG}_trace.json', 'w'))
    t0 = tr[0][0] if tr else 0
    for e in tr:
        if e[1] in ('say', 'listen', 'heard', 'cut', 'hold', 'release', 'job'):
            print(f'{(e[0] - t0) / 1000:7.2f}s  {e[1]:7s} {e[2]}  (p{e[3]})')
    print('recogniser was given:', sr)
    print('errors:', errs[:5] or 'none')


if __name__ == '__main__':
    asyncio.run(main())
