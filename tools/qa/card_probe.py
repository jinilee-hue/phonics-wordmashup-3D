"""Debug: which part of a 3D card is a given region?  Paint body green / face red, print material state.

usage: uv run --with playwright python tools/qa/card_probe.py [url] [tag]
"""
import os
OUT = os.environ.get('WM3D_OUT', '/tmp/wm3d')
os.makedirs(OUT, exist_ok=True)
import asyncio, json, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5183/?q=high&pose=30,10,1,26'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'probe'
SEED = '''(() => { let s = 1234567; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();'''
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, device_scale_factor=1.5)
        await ctx.add_init_script(SEED)
        pg = await ctx.new_page()
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(2400)
        btn = pg.locator('#intro-overlay button')
        if await btn.count(): await btn.click(force=True)
        for _ in range(80):
            await pg.wait_for_timeout(400)
            if await pg.evaluate('''() => { const s = window.WM3D, sc = s && s.scene; if (!sc || !s.cards) return false;
              const cs = [...sc.leftCards, ...sc.rightCards]; return cs.length === 6 && cs.every(c => s.cards.isReady(c) && Math.abs(c.x - c.baseX) < 1); }'''):
                break
        await pg.evaluate('() => window.WM3D.scene.tweens.pauseAll()')
        await pg.wait_for_timeout(2500)
        info = await pg.evaluate('''() => [...window.WM3D.cards.cards].map(([card, c]) => ({
            word: card.word, alpha: +card.alpha.toFixed(3), depth: card.depth,
            face: [c.faceMat.transparent, +c.faceMat.opacity.toFixed(3), c.faceMat.depthWrite],
            body: [c.bodyMat.transparent, +c.bodyMat.opacity.toFixed(3), c.bodyMat.depthWrite],
            kids: c.spin.children.map(o => o.type + (o.visible ? '' : '(hidden)')).join(','),
            rootKids: c.root.children.map(o => o.type + ':' + (o.material && o.material.type) + (o.visible ? '' : '(hidden)')).join(','),
        }))''')
        for r in info: print(json.dumps(r))
        await pg.screenshot(path=f'{OUT}/{TAG}_a.png')
        # toggles: which object makes the band?
        await pg.evaluate('() => { for (const [, c] of window.WM3D.cards.cards) c.shadow.visible = false; }')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=f'{OUT}/{TAG}_noshadow.png')
        await pg.evaluate('() => { for (const [, c] of window.WM3D.cards.cards) c.shadow.visible = true; }')
        names = await pg.evaluate("() => window.WM3D.stage.scene.children.map((o, i) => i + ':' + o.type + ':' + (o.name || '') + ':' + o.children.length)")
        print('scene children', names)
        await pg.evaluate('''() => { const sc = window.WM3D.stage.scene; const cg = window.WM3D.cards.group;
            for (const o of sc.children) if (o !== cg && o.type !== 'AmbientLight' && !o.isLight) o.visible = false; }''')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=f'{OUT}/{TAG}_cardsonly.png')
        # hide the Phaser canvas too: is the band in the 3D canvas?
        cv = await pg.evaluate('''() => [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height + ' z' + getComputedStyle(c).zIndex + ' ' + (c === window.WM3D.stage.renderer.domElement ? '3D' : 'phaser'))''')
        print('canvases', cv)
        await pg.evaluate('''() => { for (const c of document.querySelectorAll('canvas')) if (c !== window.WM3D.stage.renderer.domElement) c.style.visibility = 'hidden'; }''')
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{OUT}/{TAG}_3donly.png')
        # one card's mesh list with world-space bounds
        dump = await pg.evaluate('''() => { const out = []; for (const [card, c] of window.WM3D.cards.cards) { if (card.word !== 'base') continue;
            c.root.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox;
              out.push([o.type, o.material.type, o.visible, o.material.transparent, o.material.opacity, o.material.side, o.material.alphaTest,
                        [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(v => Math.round(v)), o.position.z, o.renderOrder]); } }); } return out; }''')
        for d in dump: print('mesh', d)
        await b.close()

asyncio.run(main())
