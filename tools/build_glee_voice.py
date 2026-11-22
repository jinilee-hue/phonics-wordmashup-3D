"""Glee's voice: every tutor line pre-made, so all devices sound the same (no speechSynthesis).

Voice: Microsoft neural 'Ana' (en-US-AnaNeural, a young girl), +10Hz, -5% - the same young voice the user
approved for the Halli Galli bell tutor (+55Hz was "too babyish").
Tried and reverted: 'Jenny' (en-US-JennyNeural +15Hz) after "튜터가 자꾸 니하오 중국말 하는거 같은데" - Whisper
language ID on the 80 one-word clips: Ana 65/80 English (4 Chinese, 9 Japanese; no better with +0Hz, slower or '.'),
Jenny 80/80 - but the user prefers Ana's voice ("목소리는 Ana가 나아", "목소리부터 다시 바꿔. Ana로"). Let the user
hear a voice before switching to it. One voice for every line.
Tool (2026-11-19, the user's pick "C"): the company phonics-api TTS (Azure neural voices) — the same Ana, with the
pitch / speed applied by ffmpeg (phonics-kit/tools/tts_voice.py: ×1.035 pitch ≈ +10Hz, tempo 0.95 = -5%), word times
from whisper (phonics-kit/tools/word_marks.py). `--engine edge` = the old edge-tts build (prototype voice).

Output
  public/gl/voice/<id>.mp3   one file per line: the downloaded mp3, stream-copied (no re-encode), cut 120 ms after speech
  src/gl/gleeVoice.ts        GLEE_VOICE.lines[id] = { text, start, dur, gain, mouth, words }
                               start: s of lead-in to skip, gain: speech at about -18 dBFS (peaks <= -1 dBFS)
                               mouth: one digit 0-9 per 60 ms (how wide the mouth opens), words: [word, t0, t1] from `start`
Lines are short English (user choice). Per card word: '<Word>!' and 'What goes with <word>?'; per compound:
'<W1> and <w2> make... <compound>!', 'Say it with me! <Compound>!', '<Compound>!' and 'Look! <W1>... and <w2>!'.
Edit LINES / the templates below and rerun; downloads are cached in ~/.cache/phonics-wordmashup/voice/.

Korean (the EN | KO toggle on the title, src/gl/lang.ts; user 2026-11-22): every line again in Korean, same tutor voice
with its Korean shape (tts_voice.tutor(text, 'ko')), into public/gl/voice/ko/<id>.mp3 and GLEE_VOICE.lines_ko. The card
words stay English inside a Korean line ('같이 말해 보자! Pancake!'); a line that is only a card word ('Pan!',
'Pancake!') has no Korean take - the game plays the English one. Lines without a card word are read back with the kit
(tutor_takes.best). With a card word the kit's check can't pass (whisper in Korean writes 'pancake' as 팬케이크), so those
are read back here twice - in Korean (the Korean words must be heard as Korean: a line that opens with an English word
can come out all in English, 'Pan, cake, 둘이 만나면' -> 'Pancake Strix Mana') and in English (the card words) - and
retaken with the kit's Korean wordings until heard right.

Run: /Users/jini/.local/bin/uv run --quiet --with numpy python tools/build_glee_voice.py      (key: ~/.config/phonics-api/key)
     old prototype voice: … --with edge-tts … build_glee_voice.py --engine edge
"""
import asyncio
import difflib
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np

VOICE, RATE, PITCH = 'en-US-AnaNeural', '-5%', '+10Hz'
SR = 24000
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'gl' / 'voice'
TS = ROOT / 'src' / 'gl' / 'gleeVoice.ts'
# 'tutor' (default since 2026-11-22, user: "word mashup tts도 바꿔야지?") = the one tutor voice of the phonics games
# (phonics-kit tts_voice.tutor: Ava Multilingual shaped to the old 'aiden', user 2026-11-20 "Ava Multilingual · aiden 높이·빠르기
# 이걸로 통일"), every take read back with whisper and retaken with another wording until heard right (kit tutor_takes).
# 'phonics-api' = the old Ana build, 'edge' = the prototype edge-tts build.
ENGINE = sys.argv[sys.argv.index('--engine') + 1] if '--engine' in sys.argv else 'tutor'
PITCH_K = 1.035                       # phonics-api: '+10Hz' on Ana as a pitch factor (tts_voice.py)
CACHE = pathlib.Path.home() / '.cache' / 'phonics-wordmashup' / 'voice' / (
    f'{VOICE}_{RATE.replace("%", "pct")}_{PITCH}' if ENGINE == 'edge' else 'tutor_ava_aiden' if ENGINE == 'tutor'
    else f'phonics-api_{VOICE}_p{PITCH_K}')
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
    # the say turn's JUMP guide (phonics-kit README rule 2; the same line as Phonics Match / Magic Block / Croco / Eye Catch)
    'jump': 'Want to skip? Tap the jump button!',
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

# Korean: short and friendly for a 5-year-old (the meanings in WordMashup_튜터대사_상황별.xlsx). No particle after a card
# word (pan이랑 / cake랑 depends on how it ends), and a Korean word first where the line could open with an English one.
LINES_KO = {
    'hi': '안녕! 나는 글리야!',
    'intro': '같이 새 단어를 만들어 보자!',
    'how1': '여기서 카드 한 장,',
    'how2': '그리고 여기서도 한 장!',
    'ask1': '어떤 두 개가 짝일까?',
    'ask2': '어떤 단어를 만들 수 있을까?',
    'ask3': '새 단어를 찾아볼까?',
    'tell': '말해 줘!',
    'new1': '봐! 새 카드야!',
    'new2': '자, 간다!',
    'new3': '와! 새 카드가 왔어!',
    'again': '한 번 더 놀자!',
    'no1': '음, 그건 단어가 아니야. 다시 해 봐!',
    'no2': '앗! 다른 걸 해 봐!',
    'no3': '아깝다! 다시 해 봐!',
    'help1': '도와줄까? 이걸 봐!',
    'help2': '내가 도와줄게!',
    'yes': '맞아!',
    'praise1': '해냈어!',
    'praise2': '정말 잘했어!',
    'praise3': '완벽해!',
    'praise4': '최고야!',
    'nice1': '잘 해 봤어!',
    'nice2': '좋아, 잘했어!',
    'go1': '준비됐니? 가자!',
    'go2': '다음 거 하자!',
    'go3': '더 찾아보자!',
    'poke1': '히히! 간지러워!',
    'poke2': '안녕!',
    'poke3': '같이 놀자!',
    'spin1': '야호!',
    'spin2': '으악! 어지러워!',
    'end1': '우와! 새 단어를 여섯 개나 만들었어!',
    'end2': '너는 단어 박사야!',
    'nw': '그건 단어가 아니야!',
    'tryagain': '다시 해 보자!',
    'notquite': '음, 그건 아니야!',
    'lookcards': '카드를 잘 봐!',
    'listenup': '잘 들어 봐!',
    'yourturn': '이제 말해 봐!',              # not 네 차례: 네 and 내 (my) sound the same
    'tryit': '한번 넣어 보자!',
    'jump': '넘어가고 싶으면 점프 버튼을 눌러!',   # the same line as Magic Block / Eye Catch / Phonics Match
}
assert set(LINES_KO) == {i for i in LINES if not re.match(r'(w|wg|ok|mk|say|r|hint)_', i)}, set(LINES_KO) ^ set(LINES)
for w in words:
    LINES_KO[f'wg_{w}'] = f'{cap(say(w))}! 뭐랑 어울릴까?'
    LINES_KO[f'ok_{w}'] = f'{cap(say(w))}! 맞았어!'
for a, b, c in pairs:
    LINES_KO[f'mk_{c}'] = f'합쳐 보자! {cap(say(a))}, {say(b)}... {c}!'
    LINES_KO[f'say_{c}'] = f'같이 말해 보자! {cap(c)}!'
    LINES_KO[f'hint_{c}'] = f'잘 봐! {cap(say(a))}... 그리고 {say(b)}!'
assert set(LINES_KO) <= set(LINES), set(LINES_KO) - set(LINES)
if ENGINE != 'tutor':
    LINES_KO = {}                                   # Korean only in the tutor voice
OUT_KO = OUT / 'ko'

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
    # 2026-10-27 card words, Whisper medium on the clip as shipped (cut): 'Ship!' -> 'Shit', 'Pop!' -> 'Pah!',
    # 'Chair is right!' -> 'Cher is right'. Back/Pack/Mill/Wheel came out wrong in all 26 variants tried
    # (scratch wm/voice_fix_ana2.py): left as is - Ana's short one-word lines, the voice the user chose.
    'en-US-AnaNeural': {
        'w_ship': 'Ship.',
        'w_pop': 'Pop...',
        'ok_chair': 'Chair, is right!',
    },
}
SPOKEN = SPOKEN_BY_VOICE.get(VOICE, {}) if ENGINE != 'tutor' else {}   # the tutor build retakes by itself
assert set(SPOKEN) <= set(LINES), set(SPOKEN) - set(LINES)
spoken = lambda i, t: SPOKEN.get(i, t)
# Slower for single lines (same voice) when no spelling fixes them: Ana's 'Chair!' -> 'Share', 'Corn!' -> 'C.O.N.' at -5%.
# Lines at the default rate keep their old cache keys, so their clips stay byte-identical.
RATE_BY_VOICE = {'en-US-AnaNeural': {'w_chair': '-20%', 'w_corn': '-20%'}}
LINE_RATE = RATE_BY_VOICE.get(VOICE, {}) if ENGINE != 'tutor' else {}
assert set(LINE_RATE) <= set(LINES), set(LINE_RATE) - set(LINES)
rate_of = lambda i: LINE_RATE.get(i, RATE)

FR = int(SR * .01)            # 10 ms frames
MOUTH_MS = 60


def key(i, t):
    r = rate_of(i)
    return f'{i}_{hashlib.md5((t if r == RATE else f"{t}@{r}").encode()).hexdigest()[:8]}'


async def fetch_all():
    import edge_tts
    CACHE.mkdir(parents=True, exist_ok=True)
    todo = [(i, spoken(i, t)) for i, t in LINES.items() if not (CACHE / f'{key(i, spoken(i, t))}.mp3').exists()]

    async def one(i, t):
        for attempt in range(5):
            try:
                try:
                    comm = edge_tts.Communicate(t, VOICE, rate=rate_of(i), pitch=PITCH, boundary='WordBoundary')
                except TypeError:                                   # older edge-tts: word boundaries by default
                    comm = edge_tts.Communicate(t, VOICE, rate=rate_of(i), pitch=PITCH)
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


def fetch_api():
    """phonics-api TTS, shaped (pitch + speed), into the build cache with whisper word marks"""
    sys.path.insert(0, str(pathlib.Path.home() / 'Documents/Jini/2026/Phonics/phonics-kit/tools'))
    import tts_voice  # noqa: E402
    CACHE.mkdir(parents=True, exist_ok=True)
    todo = [(i, spoken(i, t)) for i, t in LINES.items() if not (CACHE / f'{key(i, spoken(i, t))}.mp3').exists()]

    def one(it):
        i, t = it
        src = tts_voice.clip(t, VOICE, pitch=PITCH_K, tempo=tts_voice.rate(rate_of(i)))
        shutil.copy2(src, CACHE / f'{key(i, t)}.mp3')
    with ThreadPoolExecutor(4) as ex:
        list(ex.map(one, todo))
    need = [(i, t) for i, t in LINES.items() if not (CACHE / f'{key(i, spoken(i, t))}.json').exists()]
    if need:
        with tempfile.TemporaryDirectory() as td:
            items = [{'file': str(CACHE / f'{key(i, spoken(i, t))}.mp3'), 'text': spoken(i, t)} for i, t in need]
            pathlib.Path(td, 'in.json').write_text(json.dumps(items))
            subprocess.run([str(pathlib.Path.home() / '.claude/skills/video-vision/.venv/bin/python'),
                            str(pathlib.Path.home() / 'Documents/Jini/2026/Phonics/phonics-kit/tools/word_marks.py'),
                            f'{td}/in.json', f'{td}/out.json'], check=True)
            marks = json.loads(pathlib.Path(td, 'out.json').read_text())
            for it in items:
                pathlib.Path(it['file']).with_suffix('.json').write_text(json.dumps(marks.get(it['file'], [])))
    return len(todo)


def fetch_tutor():
    """the unified tutor voice: kit tutor_takes reads every take back (whisper) and retakes with another wording"""
    sys.path.insert(0, str(pathlib.Path.home() / 'Documents/Jini/2026/Phonics/phonics-kit/tools'))
    import tts_voice  # noqa: E402
    import tutor_takes  # noqa: E402
    CACHE.mkdir(parents=True, exist_ok=True)
    todo = [(i, t) for i, t in LINES.items() if not (CACHE / f'{key(i, t)}.mp3').exists()]
    one_word = lambda t: re.fullmatch(r"[A-Za-z]+[.!?]*", t.strip()) is not None
    jk = lambda i, t: ('w:' if one_word(t) else '') + i
    with ThreadPoolExecutor(4) as ex:                  # warm the TTS cache: the first wording of every line, 4 at a time
        list(ex.map(lambda it: tts_voice.tutor(tutor_takes.variants(jk(*it), it[1], 'en')[0], 'en'), todo))
    chosen, never = tutor_takes.best([(jk(i, t), t, 'en') for i, t in todo])
    for i, t in todo:
        shutil.copy2(chosen[jk(i, t)], CACHE / f'{key(i, t)}.mp3')
    if never:
        print('never heard right (first take kept, check by ear):', [(k, t, h) for k, t, h in never])
    need = [(i, t) for i, t in LINES.items() if not (CACHE / f'{key(i, t)}.json').exists()]
    if need:
        with tempfile.TemporaryDirectory() as td:
            items = [{'file': str(CACHE / f'{key(i, t)}.mp3'), 'text': t} for i, t in need]
            pathlib.Path(td, 'in.json').write_text(json.dumps(items))
            subprocess.run([str(pathlib.Path.home() / '.claude/skills/video-vision/.venv/bin/python'),
                            str(pathlib.Path.home() / 'Documents/Jini/2026/Phonics/phonics-kit/tools/word_marks.py'),
                            f'{td}/in.json', f'{td}/out.json'], check=True)
            marks = json.loads(pathlib.Path(td, 'out.json').read_text())
            for it in items:
                pathlib.Path(it['file']).with_suffix('.json').write_text(json.dumps(marks.get(it['file'], [])))
    return len(todo)


def ko_key(i, t):
    return 'ko_' + key(i, t)


def ko_heard(text, ko, en):
    """a Korean line with card words: the Korean words heard as Korean (whisper small) and the card words heard - in
    English (whisper small.en), or, failing that, as something in their place in the Korean transcript (whisper writes
    them in Hangul)"""
    import tutor_takes  # noqa: E402  (phonics-kit/tools is on the path: fetch_tutor_ko)
    a, b = re.sub(r'[^가-힣]', '', text), re.sub(r'[^가-힣]', '', ko)
    got = sum(m.size for m in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks())
    if got < .85 * len(a):
        return False
    ws = [w.lower() for w in re.findall(r'[A-Za-z]+', text)]
    pool = f'{en} {ko}'.lower()
    flat = re.sub(r'[^a-z]', '', pool)
    if all(w in flat or set(re.findall(r'[a-z0-9]+', pool)) & tutor_takes.SAME.get(w, set()) for w in ws):
        return True
    return len(re.sub(r'[^가-힣a-z]', '', ko.lower())) - got >= len(ws)


def fetch_tutor_ko():
    """the Korean takes (same voice, Korean shape): kit tutor_takes.best for the all-Korean lines, the read-back above
    (ko_heard) with the kit's Korean wordings for the lines with card words. Returns (new, per-round log, never)."""
    sys.path.insert(0, str(pathlib.Path.home() / 'Documents/Jini/2026/Phonics/phonics-kit/tools'))
    import tts_voice  # noqa: E402
    import tutor_takes  # noqa: E402
    CACHE.mkdir(parents=True, exist_ok=True)
    todo = [(i, t) for i, t in LINES_KO.items() if not (CACHE / f'{ko_key(i, t)}.mp3').exists()]
    plain = [(i, t) for i, t in todo if not re.search(r'[A-Za-z]', t)]
    mixed = [(i, t) for i, t in todo if re.search(r'[A-Za-z]', t)]
    log, never = [], []
    if plain:
        with ThreadPoolExecutor(4) as ex:
            list(ex.map(lambda it: tts_voice.tutor(it[1], 'ko'), plain))
        chosen, nv = tutor_takes.best([(f'k:{i}', t, 'ko') for i, t in plain], log=lambda m: log.append('plain' + m))
        for i, t in plain:
            shutil.copy2(chosen[f'k:{i}'], CACHE / f'{ko_key(i, t)}.mp3')
        never += [(k, t, h) for k, t, h in nv]
    cands = {i: tutor_takes.variants(f'k:{i}', t, 'ko') for i, t in mixed}
    first, pending, rnd = {}, [i for i, _ in mixed], 0
    text = dict(mixed)
    while pending:
        with ThreadPoolExecutor(4) as ex:
            files = dict(zip(pending, ex.map(lambda i: tts_voice.tutor(cands[i][rnd], 'ko'), pending)))
        heard = tutor_takes.read_back([(files[i], 'ko') for i in pending] + [(files[i], 'en') for i in pending])
        n = len(pending)
        still = []
        for k, i in enumerate(pending):
            hk, he = heard[k], heard[n + k]
            first.setdefault(i, (files[i], hk, he))
            if ko_heard(cands[i][rnd], hk, he):
                shutil.copy2(files[i], CACHE / f'{ko_key(i, text[i])}.mp3')
            else:
                still.append(i)
        log.append(f'with card words, take {rnd + 1}: {n - len(still)}/{n} heard right')
        print(log[-1], flush=True)
        rnd += 1
        pending = [i for i in still if rnd < len(cands[i])]
        for i in still:
            if rnd >= len(cands[i]):                   # out of wordings: keep the first take (check it by ear)
                f, hk, he = first[i]
                shutil.copy2(f, CACHE / f'{ko_key(i, text[i])}.mp3')
                never.append((f'k:{i}', text[i], f'{hk} | {he}'))
    return len(todo), log, never


got = asyncio.run(fetch_all()) if ENGINE == 'edge' else fetch_tutor() if ENGINE == 'tutor' else fetch_api()
print(f'downloaded {got} new · cache {CACHE}')
got_ko, ko_log, ko_never = fetch_tutor_ko() if LINES_KO else (0, [], [])
print(f'Korean: {got_ko} new takes', *ko_log, sep='\n  ')
if ko_never:
    print('Korean never heard right (first take kept, check by ear):', *ko_never, sep='\n  ')
OUT.mkdir(parents=True, exist_ok=True)
OUT_KO.mkdir(parents=True, exist_ok=True)
for f in [*OUT.glob('*.mp3'), *OUT_KO.glob('*.mp3')]:
    f.unlink()


def cut(t, raw, dst, marks_file):
    """the clip cut 120 ms after speech, stream-copied -> its line entry (trim, gain, mouth, word marks)"""
    _, act = speech(decode(raw))
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
    marks = json.loads(marks_file.read_text()) if marks_file and marks_file.exists() else []
    return {'text': t, 'start': round(start, 3), 'dur': round(end - start, 3), 'gain': round(float(g), 3), 'mouth': mouth,
            'words': [[w, round(max(0., a - start), 3), round(max(0., b - start), 3)] for w, a, b in marks]}


lines, total = {}, 0
for i, t in LINES.items():
    sk = key(i, spoken(i, t))                    # cache entry of what is actually spoken
    lines[i] = cut(t, CACHE / f'{sk}.mp3', OUT / f'{i}.mp3', CACHE / f'{sk}.json')
    total += (OUT / f'{i}.mp3').stat().st_size
# Korean: no word marks (word_marks.py hears English only) - the game times her pointing by the line's length then
lines_ko, total_ko = {}, 0
for i, t in LINES_KO.items():
    lines_ko[i] = cut(t, CACHE / f'{ko_key(i, t)}.mp3', OUT_KO / f'{i}.mp3', None)
    total_ko += (OUT_KO / f'{i}.mp3').stat().st_size

entries = lambda d: ''.join(f'    {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},\n' for k, v in d.items())
TS.write_text(
    '// Generated by tools/build_glee_voice.py - do not edit. Glee\'s tutor lines (public/gl/voice/<id>.mp3).\n' +
    ('// Voice: the phonics games\' one tutor voice — Azure en-US-AvaMultilingualNeural via the company phonics-api, shaped to\n'
     '// the old aiden (pitch x1.109, speed x1.035; phonics-kit tts_voice.tutor), every take read back (user 2026-11-22).\n'
     '// lines_ko: the same voice in Korean (public/gl/voice/ko/<id>.mp3, tts_voice.tutor(text, \'ko\')); a line without one\n'
     '// (a card word alone) is played in English.\n'
     if ENGINE == 'tutor' else
     f'// Voice: {VOICE} {PITCH} {RATE} via edge-tts (prototype only).\n' if ENGINE == 'edge' else
     f'// Voice: {VOICE} via the company phonics-api TTS (Azure), pitch x{PITCH_K} + {RATE} applied by ffmpeg (user pick C, 2026-11-19).\n') +
    'export type VoiceLine = { text: string; start: number; dur: number; gain: number; mouth: string; words: [string, number, number][] };\n'
    f'export const GLEE_VOICE: {{ voice: string; mouthMs: number; lines: Record<string, VoiceLine>; lines_ko: Record<string, VoiceLine> }} = {{\n'
    f'  voice: {json.dumps("tutor-ava-aiden" if ENGINE == "tutor" else VOICE if ENGINE == "edge" else VOICE + "-api")}, mouthMs: {MOUTH_MS},\n'
    '  lines: {\n' + entries(lines) + '  },\n'
    '  lines_ko: {\n' + entries(lines_ko) + '  },\n};\n',
    encoding='utf-8')
no_marks = [k for k, v in lines.items() if not v['words']]
print(f'{len(lines)} lines · mp3 {total / 1024:.0f} KB · gleeVoice.ts {TS.stat().st_size / 1024:.0f} KB · without word marks: {len(no_marks)}')
print(f'{len(lines_ko)} Korean lines · mp3 {total_ko / 1024:.0f} KB')
print('longest:', sorted(((v['dur'], k) for k, v in lines.items()), reverse=True)[:5])
if lines_ko:
    print('longest Korean:', sorted(((v['dur'], k) for k, v in lines_ko.items()), reverse=True)[:5])
