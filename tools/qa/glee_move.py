"""Glee placement by long press (user: "튜터 위치 사용자가 조절할수 있게 해줘").

Checks, mouse at 1280x720 (fresh profile, then a reload) and CDP touch at 1180x820:
  tap -> poke (not moved) | short drag -> spin (not moved) | long press -> held, follows, drop -> stays + saved
  reload -> same spot | clamps: under the HUD, above the button row | dropped on a card -> steps to the nearest
  free place | a round still plays and the travel run starts and ends at her spot (right of the zone: mirrored).
  Stills in $WM3D_OUT (default .): gleemove_*.png

usage: uv run --with playwright --with pillow python tools/qa/glee_move.py [base_url]
"""
import asyncio, io, json, os, sys, time
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/'
URL = BASE + '?q=high'
OUT = os.environ.get('WM3D_OUT', '.')
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
SEED = '''(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();'''
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  {info}' if info else ''))


GEO = '''() => { const s = window.WM3D, sc = s.scene, g = s.glee, c = s.game.canvas.getBoundingClientRect();
  const b = g.screenBox(); return { gw: sc.gw, gh: sc.gh, k: c.width / sc.gw, left: c.left, top: c.top,
    home: g.home, box: b, held: g.held, spot: s.gleeSpot, poke: g.pokeT0, spin: g.spin.angle + g.spin.vel,
    saved: localStorage.getItem('wm3d-glee-spot-v1'), round: sc.roundIndex, busy: sc.busy,
    phase: s.travel && s.travel.phase, running: g.running }; }'''


def client(geo, x, y):
    return geo['left'] + x * geo['k'], geo['top'] + y * geo['k']


def bounds(geo):
    """the clamp in index.ts, in game px: (xmin, xmax, ytop, ybottom_over_nav, ybottom_free)"""
    sx, sy = geo['gw'] / 1280, geo['gh'] / 720
    su = min(sx, sy); h = 125 * su
    return dict(h=h, xmin=0.5 * h, xmax=geo['gw'] - 0.5 * h, top=13 * sy + 72 * su + 1.22 * h,
                nav=648 * sy, free=geo['gh'] - 0.08 * h, sx=sx, sy=sy)


async def boot(pg):
    await pg.goto(URL + f'&nc={int(time.time() * 1000)}', wait_until='load'); await pg.wait_for_timeout(2400)
    btn = pg.locator('#intro-overlay button')
    if await btn.count(): await btn.click(force=True)
    await pg.wait_for_function('() => window.WM3D && window.WM3D.scene && window.WM3D.glee && window.WM3D.scene.leftCards.length === 3', timeout=60000)
    await pg.wait_for_timeout(3500)                 # cards fly in, Glee says hello


async def long_drag(pg, geo, fx, fy, steps=14):
    """long press on Glee's body, then move so her FEET go to game px (fx, fy)"""
    b = geo['box']; px, py = geo['home']['x'], (b['t'] + b['b']) / 2
    cx, cy = client(geo, px, py)
    await pg.mouse.move(cx, cy); await pg.mouse.down()
    await pg.wait_for_timeout(700)
    held = (await pg.evaluate(GEO))['held']
    tx, ty = client(geo, px + (fx - geo['home']['x']), py + (fy - geo['home']['y']))
    for i in range(1, steps + 1):
        await pg.mouse.move(cx + (tx - cx) * i / steps, cy + (ty - cy) * i / steps)
        await pg.wait_for_timeout(30)
    mid = await pg.screenshot()
    await pg.mouse.up(); await pg.wait_for_timeout(600)
    return held, mid


async def drag(pg, x0, y0, x1, y1, n=12):
    await pg.mouse.move(x0, y0); await pg.mouse.down()
    for i in range(1, n + 1):
        await pg.mouse.move(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)
        await pg.wait_for_timeout(16)
    await pg.mouse.up()


async def mouse_part(b, errs):
    ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
    await ctx.add_init_script(SEED)
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await boot(pg)
    g0 = await pg.evaluate(GEO)
    B = bounds(g0)
    check('default spot unchanged (445, 640)', abs(g0['home']['x'] - 445 * B['sx']) < 0.5 and abs(g0['home']['y'] - 640 * B['sy']) < 0.5
          and g0['spot'] is None and abs(g0['home']['yaw'] - 0.36) < 1e-6, str(g0['home']))
    open(f'{OUT}/gleemove_0_default.png', 'wb').write(await pg.screenshot())
    # tap -> poke
    b = g0['box']; cx, cy = client(g0, g0['home']['x'], (b['t'] + b['b']) / 2)
    await pg.mouse.click(cx, cy); await pg.wait_for_timeout(150)
    g1 = await pg.evaluate(GEO)
    check('tap pokes, does not move', g1['poke'] != g0['poke'] and g1['spot'] is None)
    await pg.wait_for_timeout(900)
    # short drag -> spin
    await pg.mouse.move(cx, cy); await pg.mouse.down()
    for i in range(1, 7):
        await pg.mouse.move(cx + 25 * i, cy); await pg.wait_for_timeout(20)
    g2 = await pg.evaluate(GEO)
    await pg.mouse.up()
    check('short drag spins, does not move', abs(g2['spin']) > 0.05 and g2['spot'] is None and not g2['held'], f"spin {g2['spin']:.2f}")
    await pg.wait_for_timeout(2500)
    # long press -> move to the right of the zone
    g3 = await pg.evaluate(GEO)
    target = (835 * B['sx'], 640 * B['sy'])                    # the default spot mirrored: right of the zone
    held, mid = await long_drag(pg, g3, *target)
    open(f'{OUT}/gleemove_1_held.png', 'wb').write(mid)
    g4 = await pg.evaluate(GEO)
    check('long press picks her up', held)
    check('dropped where put', abs(g4['home']['x'] - target[0]) < 2 and abs(g4['home']['y'] - target[1]) < 2 and not g4['held'],
          f"home ({g4['home']['x']:.0f}, {g4['home']['y']:.0f}) want ({target[0]:.0f}, {target[1]:.0f})")
    check('turned toward the middle', g4['home']['yaw'] < 0, f"yaw {g4['home']['yaw']:.2f}")
    sv = json.loads(g4['saved'] or 'null')
    check('spot saved', sv and abs(sv['x'] - 835) < 1 and abs(sv['y'] - 640) < 1, str(sv))
    await pg.wait_for_timeout(800)
    open(f'{OUT}/gleemove_2_moved.png', 'wb').write(await pg.screenshot())
    # clamps
    for name, (fx, fy), want in [
        ('top: head stays under the HUD', (640 * B['sx'], -200), lambda h: abs(h['y'] - B['top']) < 1.5),
        ('bottom middle: stays above the buttons', (640 * B['sx'], g0['gh'] + 200), lambda h: abs(h['y'] - B['nav']) < 1.5),
    ]:
        gg = await pg.evaluate(GEO)
        await long_drag(pg, gg, fx, fy)
        h = (await pg.evaluate(GEO))['home']
        check(f'clamp - {name}', want(h), f"home ({h['x']:.0f}, {h['y']:.0f})")
    # dropped on a card (the moon/left-middle slot, and the bottom-left corner under the week slot): she steps off
    for name, (fx, fy) in [('on the left middle card', (359 * B['sx'], 420 * B['sy'])), ('bottom-left corner (under a card)', (-300, g0['gh'] + 200))]:
        gg = await pg.evaluate(GEO)
        await long_drag(pg, gg, fx, fy)
        await pg.wait_for_timeout(400)
        h = (await pg.evaluate(GEO))['home']
        on = await pg.evaluate(f"() => window.WM3D.gleeBlockedAt({h['x']}, {h['y']})")
        moved = ((h['x'] - max(B['xmin'], fx)) ** 2 + (h['y'] - min(B['free'], max(B['top'], fy))) ** 2) ** 0.5
        check(f'dropped {name}: steps off the card', not on and moved < 300 * B['sx'], f"home ({h['x']:.0f}, {h['y']:.0f}), {moved:.0f} px away")
        open(f"{OUT}/gleemove_3_{'card' if 'middle' in name else 'corner'}.png", 'wb').write(await pg.screenshot())
    # back to the right of the zone, then reload
    gg = await pg.evaluate(GEO)
    await long_drag(pg, gg, *target)
    await pg.reload(wait_until='load'); await pg.wait_for_timeout(2400)
    btn = pg.locator('#intro-overlay button')
    if await btn.count(): await btn.click(force=True)
    await pg.wait_for_function('() => window.WM3D && window.WM3D.scene && window.WM3D.glee && window.WM3D.scene.leftCards.length === 3', timeout=60000)
    await pg.wait_for_timeout(3500)
    g5 = await pg.evaluate(GEO)
    check('reload keeps the spot', abs(g5['home']['x'] - target[0]) < 2 and abs(g5['home']['y'] - target[1]) < 2,
          f"home ({g5['home']['x']:.0f}, {g5['home']['y']:.0f})")
    # a round still plays; the travel run leaves from and returns to her spot
    st = await pg.evaluate('''() => { const sc = window.WM3D.scene, p = sc.queue[sc.roundIndex];
      const f = (cs, w) => { const c = cs.find(c => c && c.active && c.word === w); return c && { x: c.x, y: c.y }; };
      return { L: f(sc.leftCards, p.word1), R: f(sc.rightCards, p.word2), cx: sc.cx, cy: sc.cy }; }''')
    L, R = st['L'], st['R']
    await drag(pg, *client(g5, L['x'], L['y']), *client(g5, st['cx'] - 10, st['cy'])); await pg.wait_for_timeout(400)
    await drag(pg, *client(g5, R['x'], R['y']), *client(g5, st['cx'] + 10, st['cy']))
    frames, ran = [], False
    t0 = time.time()
    while time.time() - t0 < 50:                    # crash, then Glee's lines (mk_, say_, praise, go) before the travel
        gg = await pg.evaluate(GEO)
        if gg['running']:
            ran = True
            frames.append(await pg.screenshot())
            await pg.wait_for_timeout(180)
        elif ran:
            break
        else:
            await pg.wait_for_timeout(120)
    await pg.wait_for_timeout(1500)
    g6 = await pg.evaluate(GEO)
    check('round won and the next one started', g6['round'] == 1, f"round {g6['round']}")
    check('the run happened and she is back at her spot', ran and abs(g6['home']['x'] - target[0]) < 2 and not g6['running'], f'{len(frames)} run frames')
    if frames:
        from PIL import Image
        pick = [frames[int(i * (len(frames) - 1) / 5)] for i in range(6)]
        ims = [Image.open(io.BytesIO(f)).convert('RGB').resize((640, 360)) for f in pick]
        sheet = Image.new('RGB', (1280 + 6, 3 * 360 + 12), (18, 18, 22))
        for i, im in enumerate(ims):
            sheet.paste(im, ((i % 2) * 646, (i // 2) * 366))
        sheet.save(f'{OUT}/gleemove_4_run.png')
    await ctx.close()


async def touch_part(b, errs):
    ctx = await b.new_context(viewport={'width': 1180, 'height': 820}, has_touch=True, is_mobile=False)
    await ctx.add_init_script(SEED)
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await boot(pg)
    cdp = await ctx.new_cdp_session(pg)
    g0 = await pg.evaluate(GEO)
    B = bounds(g0)
    b = g0['box']; cx, cy = client(g0, g0['home']['x'], (b['t'] + b['b']) / 2)
    T = lambda kind, x, y: cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if kind == 'touchEnd' else [{'x': x, 'y': y, 'id': 1}]})
    await T('touchStart', cx, cy); await pg.wait_for_timeout(700)
    held = (await pg.evaluate(GEO))['held']
    fx, fy = 640 * B['sx'], 250 * B['sy']                      # up above the zone (no card there)
    tx, ty = client(g0, g0['home']['x'] + fx - g0['home']['x'], (b['t'] + b['b']) / 2 + fy - g0['home']['y'])
    for i in range(1, 13):
        await T('touchMove', cx + (tx - cx) * i / 12, cy + (ty - cy) * i / 12); await pg.wait_for_timeout(30)
    await T('touchEnd', 0, 0)
    # software rendering in headless Chrome delivers the touch pointerup up to a few seconds late
    await pg.wait_for_function('() => !window.WM3D.glee.held', timeout=15000); await pg.wait_for_timeout(600)
    g1 = await pg.evaluate(GEO)
    check('touch: long press picks her up', held)
    check('touch: dropped where put', abs(g1['home']['x'] - fx) < 2 and abs(g1['home']['y'] - fy) < 2,
          f"home ({g1['home']['x']:.0f}, {g1['home']['y']:.0f}) want ({fx:.0f}, {fy:.0f})")
    open(f'{OUT}/gleemove_5_touch.png', 'wb').write(await pg.screenshot())
    # a quick touch tap still pokes
    p0 = g1['poke']; b = g1['box']; cx, cy = client(g1, g1['home']['x'], (b['t'] + b['b']) / 2)
    await T('touchStart', cx, cy); await pg.wait_for_timeout(80); await T('touchEnd', 0, 0)
    try:
        await pg.wait_for_function(f'() => window.WM3D.glee.pokeT0 !== {p0}', timeout=15000)
    except Exception:
        pass
    g2 = await pg.evaluate(GEO)
    check('touch: tap still pokes', g2['poke'] != p0 and abs(g2['home']['x'] - fx) < 2)
    await ctx.close()


async def main():
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        await mouse_part(b, errs)
        await touch_part(b, errs)
        await b.close()
    check('no page errors', not errs, '; '.join(errs[:3]))
    print(f'{sum(results)}/{len(results)} passed')


asyncio.run(main())
