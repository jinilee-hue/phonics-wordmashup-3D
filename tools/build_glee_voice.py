"""Glee's voice: every tutor line pre-made, so all devices sound the same (no speechSynthesis).

Voice: Microsoft neural 'Ana' (en-US-AnaNeural, a young girl), +10Hz, -5% - the same young voice the user
approved for the Halli Galli bell tutor (+55Hz was "too babyish").
Tried and reverted: 'Jenny' (en-US-JennyNeural +15Hz) after "튜터가 자꾸 니하오 중국말 하는거 같은데" - Whisper
language ID on the 80 one-word clips: Ana 65/80 English (4 Chinese, 9 Japanese; no better with +0Hz, slower or '.'),
Jenny 80/80 - but the user prefers Ana's voice ("목소리는 Ana가 나아", "목소리부터 다시 바꿔. Ana로"). Let the user
hear a voice before switching to it. One voice for every line.
Tool: edge-tts (free, prototype only). For a release use Azure Speech (paid) or a voice actor.

Output
  public/gl/voice/<id>.mp3   one file per line: the downloaded mp3, stream-copied (no re-encode), cut 120 ms after speech
  src/gl/gleeVoice.ts        GLEE_VOICE.lines[id] = { text, start, dur, gain, mouth, words }
                               start: s of lead-in to skip, gain: speech at about -18 dBFS (peaks <= -1 dBFS)
                               mouth: one digit 0-9 per 60 ms (how wide the mouth opens), words: [word, t0, t1] from `start`
Lines are short English (user choice). Per card word: '<Word>!' and 'What goes with <word>?'; per compound:
'<W1> and <w2> make... <compound>!', 'Say it with me! <Compound>!', '<Compound>!' and 'Look! <W1>... and <w2>!'.
Edit LINES / the templates below and rerun; downloads are cached in ~/.cache/phonics-wordmashup/voice/.

Run: /Users/jini/.hermes/bin/uv run --quiet --with edge-tts --with numpy python tools/build_glee_voice.py
"""
import asyncio
import hashlib
import json
import pathlib
import re
import subprocess

import numpy as np

VOICE, RATE, PITCH = 'en-US-AnaNeural', '-5%', '+10Hz'
SR = 24000
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'gl' / 'voice'
TS = ROOT / 'src' / 'gl' / 'gleeVoice.ts'
CACHE = pathlib.Path.home() / '.cache' / 'phonics-wordmashup' / 'voice' / f'{VOICE}_{RATE.replace("%", "pct")}_{PITCH}'
# spelled for the TTS only: the card 'bow' is a ribbon bow (rhymes with 'go'), never the bow you take
SAY = {'bow': 'bo'}

LINES = {
    'hi': "Hi! I'm Glee!",
    'intro': "Let's make new words together!",
    'how1': 'Take one card from here,',
    'how2': 'and one card from here!',
    'ask1': 'Which two go together?',
    'ask2': 'What word can you make?',
    'ask3': 'Can you find a new word?',
    'tell': 'Tell me!',
    'new1': 'Look! New cards!',
    'new2': 'Here we go!',
    'new3': 'Ooh, new cards!',
    'again': "Let's play again!",
    'no1': "Hmm, that's not a word. Try again!",
    'no2': 'Oops! Try another one!',
    'no3': 'Almost! Try again!',
    'help1': 'Need help? Look at this one!',
    'help2': 'Let me help you!',
    'yes': 'Yes!',
    'praise1': 'You did it!',
    'praise2': 'Great job!',
    'praise3': 'Perfect!',
    'praise4': 'Awesome!',
    'nice1': 'Nice try!',
    'nice2': 'Good try!',
    'go1': "Ready? Let's go!",
    'go2': 'Next one!',
    'go3': "Let's find more!",
    'poke1': 'Hee-hee! That tickles!',
    'poke2': 'Hi there!',
    'poke3': "Let's play!",
    'spin1': 'Wheee!',
    'spin2': "Whoa! I'm dizzy!",
    'end1': 'Wow! You made six new words!',
    'end2': "You're a word master!",
    # guidance when it goes wrong (spoken, never shown as text - user: "틀렸을때도 튜터가 가이드 해줘야지, 텍스트로 나오는게 아니라")
    'nw': "That's not a word!",
    'tryagain': "Let's try again!",
    'notquite': 'Hmm, not quite!',
    'lookcards': 'Look at the cards!',
    'listenup': 'Listen!',
    'yourturn': 'Your turn!',
    'tryit': "Let's try it!",
}

pairs = re.findall(r"word1:'(\w+)',\s*word2:'(\w+)',\s*result:'(\w+)'", (ROOT / 'src' / 'data' / 'compounds.ts').read_text())
assert len(pairs) >= 30, pairs
say = lambda w: SAY.get(w, w)
cap = lambda w: w[:1].upper() + w[1:]
words = sorted({w for a, b, _ in pairs for w in (a, b)})
for w in words:
    LINES[f'w_{w}'] = f'{cap(say(w))}!'
    LINES[f'wg_{w}'] = f'What goes with {say(w)}?'
    LINES[f'ok_{w}'] = f'{cap(say(w))} is right!'
for a, b, c in pairs:
    LINES[f'mk_{c}'] = f'{cap(say(a))} and {say(b)} make... {c}!'
    LINES[f'say_{c}'] = f'Say it with me! {cap(c)}!'
    LINES[f'r_{c}'] = f'{cap(c)}!'
    LINES[f'hint_{c}'] = f'Look! {cap(say(a))}... and {say(b)}!'

# Spoken differently from the written line, for clarity only (the line's text stays as written), per voice: what
# one voice garbles another says fine. Jenny: with the plain text Whisper (medium) heard 'Cellball', 'Self Lake',
# 'smell and ball make, smell ball', 'I am ball make' and 'Melt is right'; with these, the intended words.
SPOKEN_BY_VOICE = {
    'en-US-JennyNeural': {
        'r_snowball': 'Snow-ball!',
        'r_snowflake': 'Snow-flake!',
        'mk_snowball': 'Snow... and ball make... snow-ball!',
        'mk_eyeball': 'Eye, and ball, make... eyeball!',
        'ok_note': 'Note, is right!',
    },
}
SPOKEN = SPOKEN_BY_VOICE.get(VOICE, {})
assert set(SPOKEN) <= set(LINES), set(SPOKEN) - set(LINES)
spoken = lambda i, t: SPOKEN.get(i, t)

FR = int(SR * .01)            # 10 ms frames
MOUTH_MS = 60


def key(i, t):
    return f'{i}_{hashlib.md5(t.encode()).hexdigest()[:8]}'


async def fetch_all():
    import edge_tts
    CACHE.mkdir(parents=True, exist_ok=True)
    todo = [(i, spoken(i, t)) for i, t in LINES.items() if not (CACHE / f'{key(i, spoken(i, t))}.mp3').exists()]

    async def one(i, t):
        for attempt in range(5):
            try:
                try:
                    comm = edge_tts.Communicate(t, VOICE, rate=RATE, pitch=PITCH, boundary='WordBoundary')
                except TypeError:                                   # older edge-tts: word boundaries by default
                    comm = edge_tts.Communicate(t, VOICE, rate=RATE, pitch=PITCH)
                audio, marks = bytearray(), []
                async for ch in comm.stream():
                    if ch['type'] == 'audio':
                        audio += ch['data']
                    elif ch['type'] == 'WordBoundary':
                        marks.append([ch['text'], ch['offset'] / 1e7, (ch['offset'] + ch['duration']) / 1e7])
                if not audio:
                    raise RuntimeError('no audio')
                (CACHE / f'{key(i, t)}.json').write_text(json.dumps(marks))
                tmp = CACHE / f'{key(i, t)}.part'
                tmp.write_bytes(bytes(audio))
                tmp.rename(CACHE / f'{key(i, t)}.mp3')
                return
            except Exception as e:                                   # noqa: BLE001 - network hiccups: retry
                if attempt == 4:
                    raise RuntimeError(f'{i}: {e}')
                await asyncio.sleep(1.5 * (attempt + 1))
    sem = asyncio.Semaphore(6)

    async def guarded(i, t):
        async with sem:
            await one(i, t)
    await asyncio.gather(*(guarded(i, t) for i, t in todo))
    return len(todo)


def decode(p):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(p), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def speech(x):
    n = len(x) // FR
    rms = np.sqrt((x[:n * FR].reshape(n, FR) ** 2).mean(1) + 1e-12)
    return rms, np.nonzero(rms > rms.max() * 10 ** (-50 / 20))[0]


got = asyncio.run(fetch_all())
print(f'downloaded {got} new · cache {CACHE}')
OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob('*.mp3'):
    f.unlink()
lines, total = {}, 0
for i, t in LINES.items():
    sk = key(i, spoken(i, t))                    # cache entry of what is actually spoken
    raw = CACHE / f'{sk}.mp3'
    _, act = speech(decode(raw))
    dst = OUT / f'{i}.mp3'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-t', f'{(act[-1] + 1) * FR / SR + .12:.3f}',
                    '-c:a', 'copy', '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '0', str(dst)], check=True)
    y = decode(dst)
    rms, act = speech(y)
    voiced = rms[act[0]:act[-1] + 1]
    loud = np.sqrt((voiced[voiced > voiced.max() * .1] ** 2).mean())
    g = min(10 ** (-18 / 20) / loud, 10 ** (-1 / 20) / np.abs(y).max())
    start = max(0., act[0] * FR / SR - .05)
    end = (act[-1] + 1) * FR / SR
    step = MOUTH_MS // 10
    seg = rms[int(start * 100):int(end * 100) + 1]
    m = [seg[k:k + step].mean() for k in range(0, len(seg), step)]
    top = max(m) if m else 1
    mouth = ''.join(str(min(9, int(round(9 * (v / top) ** .6)))) if v > top * .12 else '0' for v in m)
    marks = json.loads((CACHE / f'{sk}.json').read_text()) if (CACHE / f'{sk}.json').exists() else []
    lines[i] = {'text': t, 'start': round(start, 3), 'dur': round(end - start, 3), 'gain': round(float(g), 3), 'mouth': mouth,
                'words': [[w, round(max(0., a - start), 3), round(max(0., b - start), 3)] for w, a, b in marks]}
    total += dst.stat().st_size

TS.write_text(
    '// Generated by tools/build_glee_voice.py - do not edit. Glee\'s tutor lines (public/gl/voice/<id>.mp3).\n'
    f'// Voice: {VOICE} {PITCH} {RATE} via edge-tts (prototype only; use Azure Speech or a voice actor for a release).\n'
    'export type VoiceLine = { text: string; start: number; dur: number; gain: number; mouth: string; words: [string, number, number][] };\n'
    f'export const GLEE_VOICE: {{ voice: string; mouthMs: number; lines: Record<string, VoiceLine> }} = {{\n'
    f'  voice: {json.dumps(VOICE)}, mouthMs: {MOUTH_MS},\n'
    '  lines: {\n' + ',\n'.join(f'    {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}' for k, v in lines.items()) + ',\n  },\n};\n',
    encoding='utf-8')
no_marks = [k for k, v in lines.items() if not v['words']]
print(f'{len(lines)} lines · mp3 {total / 1024:.0f} KB · gleeVoice.ts {TS.stat().st_size / 1024:.0f} KB · without word marks: {len(no_marks)}')
print('longest:', sorted(((v['dur'], k) for k, v in lines.items()), reverse=True)[:5])
