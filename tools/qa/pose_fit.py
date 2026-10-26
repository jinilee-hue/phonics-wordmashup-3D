"""Fit the 3D card pose to the baked card art: measure the same pose metrics the art has
(visible near wall, bottom wall, edge lean, apparent face aspect) on the live 3D cards for a grid
of yaw / pitch / thickness, and rank them against the art's medians (tools: art metrics come from
unwarp_cards.detect, see README).

usage: uv run --with playwright python tools/qa/pose_fit.py [base-url] [yaws] [pitches] [thicks]   (comma lists)
"""
import asyncio, json, math, sys
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/'
# medians over the 22 left cards whose walls were detected confidently (LEFT-type orientation)
ART = dict(near=0.152, bottom=0.048, lean=-6.7, aspect=0.681, top=6.1, bot=-3.97)
SEED = '''(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();'''
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']

MEASURE = '''(T) => {
  const s = window.WM3D, st = s.stage, cam = st.camera, cards = s.cards;
  const FW = 184, FH = 245, BS = Math.round(T * 0.17) * 0.85, BEV = Math.round(T * 0.17);
  st.scene.updateMatrixWorld(true);
  const out = [];
  for (const [card, c] of cards.cards) {
    const M = c.spin.matrixWorld;
    const P = (x, y, z) => { const v = c.spin.position.clone().set(x, y, z).applyMatrix4(M).project(cam);
      return [(v.x + 1) / 2 * st.W, (1 - v.y) / 2 * st.H]; };
    // face corners (sharp) on the front, LEFT-type order
    let TL = P(-FW / 2, FH / 2, T / 2), TR = P(FW / 2, FH / 2, T / 2), BL = P(-FW / 2, -FH / 2, T / 2), BR = P(FW / 2, -FH / 2, T / 2);
    const pts = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      for (const z of [T / 2 - BEV, -(T / 2 - BEV)]) pts.push(P(sx * (FW / 2 + BS), sy * (FH / 2 + BS), z));
      for (const z of [T / 2, -T / 2]) pts.push(P(sx * FW / 2, sy * FH / 2, z));
    }
    let xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    if (c.side === 'right') {            // mirror to LEFT-type
      const m = p => [-p[0], p[1]];
      [TL, TR, BL, BR] = [m(TR), m(TL), m(BR), m(BL)];
      xs = xs.map(x => -x);
    }
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const fw = (d(TL, TR) + d(BL, BR)) / 2, fh = (d(TL, BL) + d(TR, BR)) / 2;
    const deg = r => r * 180 / Math.PI;
    out.push({
      side: c.side,
      near: ((TL[0] + BL[0]) / 2 - Math.min(...xs)) / fw,
      bottom: (Math.max(...ys) - (BL[1] + BR[1]) / 2) / fh,
      lean: (deg(Math.atan2(TL[0] - BL[0], BL[1] - TL[1])) + deg(Math.atan2(TR[0] - BR[0], BR[1] - TR[1]))) / 2,
      aspect: fw / fh,
      top: deg(Math.atan2(TR[1] - TL[1], TR[0] - TL[0])),
      bot: deg(Math.atan2(BR[1] - BL[1], BR[0] - BL[0])),
      persp: d(TR, BR) / d(TL, BL),
    });
  }
  return out;
}'''


def med(v):
    v = sorted(v); n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
        await ctx.add_init_script(SEED)
        pg = await ctx.new_page()
        await pg.goto(BASE + '?q=low', wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        for _ in range(80):
            await pg.wait_for_timeout(400)
            ok = await pg.evaluate('''() => { const s = window.WM3D, sc = s && s.scene; if (!sc || !s.cards) return false;
              const cs = [...sc.leftCards, ...sc.rightCards]; return cs.length === 6 && cs.every(c => s.cards.isReady(c) && Math.abs(c.x - c.baseX) < 1); }''')
            if ok: break
        await pg.evaluate('() => window.WM3D.scene.tweens.pauseAll()')
        results = []
        YAWS = [int(v) for v in sys.argv[2].split(',')] if len(sys.argv) > 2 else [18, 22, 26, 30]
        PITCHES = [int(v) for v in sys.argv[3].split(',')] if len(sys.argv) > 3 else [7, 10, 13, 16]
        THICKS = [int(v) for v in sys.argv[4].split(',')] if len(sys.argv) > 4 else [30, 38, 46, 54]
        for yaw in YAWS:
            for pitch in PITCHES:
                await pg.evaluate(f'() => Object.assign(window.WM3D.cards.pose, {{ yaw: {yaw}, pitch: {pitch}, roll: 0, world: false }})')
                # settle the springs quickly: freeze the sway by sampling twice and averaging
                await pg.wait_for_timeout(1800)
                for T in THICKS:
                    m = await pg.evaluate(MEASURE, T)
                    agg = {k: med([r[k] for r in m]) for k in ('near', 'bottom', 'lean', 'aspect', 'top', 'bot', 'persp')}
                    err = (abs(agg['near'] - ART['near']) / 0.02 + abs(agg['bottom'] - ART['bottom']) / 0.01
                           + abs(agg['lean'] - ART['lean']) / 1.5 + abs(agg['aspect'] - ART['aspect']) / 0.02)
                    results.append((err, yaw, pitch, T, agg))
        await b.close()
    results.sort(key=lambda r: r[0])
    print('art   near %.3f bottom %.3f lean %.1f aspect %.3f top %.1f bot %.1f' % (ART['near'], ART['bottom'], ART['lean'], ART['aspect'], ART['top'], ART['bot']))
    for err, yaw, pitch, T, a in results[:8]:
        print(f'err {err:5.2f}  yaw {yaw:2d} pitch {pitch:2d} thick {T:2d} | near {a["near"]:.3f} bottom {a["bottom"]:.3f} '
              f'lean {a["lean"]:5.1f} aspect {a["aspect"]:.3f} top {a["top"]:4.1f} bot {a["bot"]:4.1f} persp {a["persp"]:.3f}')
    for err, yaw, pitch, T, a in results:
        if (yaw, pitch, T) in ((18, 7, 46),):
            print(f'(current) err {err:5.2f}  yaw {yaw} pitch {pitch} thick {T} | near {a["near"]:.3f} bottom {a["bottom"]:.3f} lean {a["lean"]:.1f} aspect {a["aspect"]:.3f}')

asyncio.run(main())
