"""Word Mashup 3D on phonics-api (gl/apiSR.ts): the game's Mic button and Glee's "Say it with me!", end to end.
Headless Chrome, never the user's browser. getUserMedia is replaced by a stream the test plays clips into (phonics-api
TTS, child voice); the rest is real: Mic → record → /v1/speech/transcribe → text → the cards snap → match → Glee asks
"Say it with me!" → record → transcribe → praise. Also shoots the Settings popup with its 발음 인식 서버 키 row.
usage: uv run --with playwright==1.62.0 python tools/qa/api_sr.py [api|device] [base] [out dir]
  api (default): ~/.config/phonics-api/key goes into this browser's localStorage (never printed);
  device: no key → the browser's recogniser (headless has none: nothing is heard — only the flow is checked).
"""
import json
import pathlib
import sys
import time
import urllib.parse

from playwright.sync_api import sync_playwright

MODE = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in ('api', 'device') else 'api'
BASE = next((a for a in sys.argv[1:] if a.startswith('http')), 'http://127.0.0.1:5183/')
OUT = pathlib.Path(next((a for a in sys.argv[1:] if a.startswith('/')), '/tmp/wm3d'))
OUT.mkdir(parents=True, exist_ok=True)
KIT = pathlib.Path.home() / 'Documents/Jini/2026/Phonics/phonics-kit'
sys.path.insert(0, str(KIT / 'tools'))
import papi  # noqa: E402

CLIPS = KIT / 'cache' / 'qa' / 'mashup'
CLIPS.mkdir(parents=True, exist_ok=True)
KEY = (pathlib.Path.home() / '.config/phonics-api/key').read_text().strip() if MODE == 'api' else ''


def tts(text, voice='en-US-AnaNeural'):
    f = CLIPS / f"{voice}_{text.replace(' ', '_')}.wav"
    if not f.exists():
        f.write_bytes(papi.tts(text, voice))
    return f.name


INIT = '''(() => {
  let ctx = null, dest = null;
  const live = () => { if (!ctx) { ctx = new AudioContext(); dest = ctx.createMediaStreamDestination(); } return ctx; };
  navigator.mediaDevices.getUserMedia = async () => { live(); await ctx.resume(); dest = ctx.createMediaStreamDestination(); return dest.stream; };
  window.__qaPlay = async (url) => {
    live(); await ctx.resume();
    const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(dest); s.start();
    return buf.duration;
  };
  localStorage.%s;
})()''' % (f"setItem('phonics_api_key', {json.dumps(KEY)})" if KEY else "removeItem('phonics_api_key')")
TRACE = '() => (window.WM3D.tutor ? window.WM3D.tutor.trace.map(e => [e.ev, e.id || ""]) : [])'

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    logs, errors = [], []
    pg.on('console', lambda m: logs.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.route('**/qa-clip/**', lambda route: route.fulfill(body=(CLIPS / urllib.parse.unquote(route.request.url.split('/qa-clip/')[1])).read_bytes(), content_type='audio/wav'))
    pg.add_init_script(INIT)
    pg.goto(BASE + '?q=high&log=1', wait_until='load')
    time.sleep(2.4)
    if pg.locator('#intro-overlay button').count():      # the intro film's start button
        pg.locator('#intro-overlay button').first.click(force=True)
    pg.wait_for_function('() => window.WM3D && window.WM3D.scene && window.WM3D.tutor && window.PhonicsAPI && PhonicsAPI.status() !== "unknown"', timeout=120000)
    print('phonics-api:', pg.evaluate('PhonicsAPI.status()'), f'({MODE})', flush=True)
    time.sleep(3)
    # Settings popup with the key row
    pg.evaluate('() => WM3D.scene.showSettings()')
    time.sleep(0.8)
    pg.screenshot(path=str(OUT / f'api_settings_{MODE}.png'))
    pg.evaluate('() => WM3D.scene.settingsPanel.setVisible(false)')
    # 1 · the Mic button: say the two words → the two cards go in
    pair = pg.evaluate('() => { const s = WM3D.scene, q = s.queue[s.roundIndex]; return [q.word1, q.word2, q.result]; }')
    print('pair', pair, flush=True)
    n0 = len(logs)
    pg.evaluate('() => WM3D.scene.startMic()')
    time.sleep(0.9)
    pg.evaluate(f"__qaPlay('./qa-clip/{urllib.parse.quote(tts(pair[0] + ' ' + pair[1]))}')")
    t0 = time.time()
    while time.time() - t0 < 20 and pg.evaluate('() => !!WM3D.scene.micRecognition'):
        time.sleep(0.3)
    time.sleep(0.8)
    snap = pg.evaluate('() => { const s = WM3D.scene; return [s.selectedLeft && s.selectedLeft.word, s.selectedRight && s.selectedRight.word, s.busy]; }')
    said = [l for l in logs[n0:] if l.startswith('phonics-api transcribe')]
    print('mic   |', said[-1][23:] if said else 'no transcribe', '| cards in:', snap[:2], flush=True)
    # 2 · Glee: "Say it with me!" → the compound
    t0, fed = time.time(), False
    while time.time() - t0 < 60:
        tr = pg.evaluate(TRACE)
        evs = [e for e, _ in tr]
        if not fed and evs and evs[-1] == 'listen' and 'say_' + pair[2] in [i for _, i in tr]:
            time.sleep(0.9)
            pg.evaluate(f"__qaPlay('./qa-clip/{urllib.parse.quote(tts(pair[2]))}')")
            fed = True
        if fed and any(e == 'heard' for e, _ in tr[[i for i, (e, _) in enumerate(tr) if e == 'listen'][-1]:]):
            time.sleep(3.5)
            break
        time.sleep(0.25)
    tr = pg.evaluate('() => WM3D.tutor.trace.map(e => [e.ev, e.id || "", e.text || ""])')
    li = max(i for i, (e, _, _) in enumerate(tr) if e == 'listen') if any(e == 'listen' for e, _, _ in tr) else 0
    print('glee  |', ' · '.join(f'{e} {i or t}'.strip() for e, i, t in tr[li:li + 4]), flush=True)
    said = [l for l in logs if l.startswith('phonics-api transcribe')]
    print('texts |', ' / '.join(s[23:] for s in said), flush=True)
    b.close()
print('errors:', errors or 'none')
