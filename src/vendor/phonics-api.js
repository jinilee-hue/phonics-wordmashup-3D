/* COPY of ~/Documents/Jini/2026/Phonics/phonics-kit/phonics-api.js — edit the kit, then copy it here again. */
/* phonics-kit · phonics-api.js — the company phonics-api for every phonics game.
 * Guide https://phonics-api.polarislabs.ai.kr/guide · test page /play · this file: ~/Documents/Jini/2026/Phonics/phonics-kit
 * Load it as a classic <script> (vanilla games) or `import './phonics-api.js'` (Vite games); it sets window.PhonicsAPI.
 *
 * Key: entered once per browser (localStorage 'phonics_api_key' — the same name /play and /samples use), never in code:
 * the game repos are public. A teacher types it in PhonicsAPI.keyDialog().
 *
 * Reading a word: analyze() sends one 16 kHz WAV to /v1/speech/analyze (Wav2Vec2 on the company server; the audio is
 * not stored) and gets the phonemes it HEARD. Its own `success` is not used: it lets "moon" pass as "mop" and fails an
 * official "meat" for a released t ("t eu"). judge() instead compares the heard phonemes with the expected phonemes of
 * every word on screen. Any failure (no key, offline, 401/403, busy, timeout) returns ok:false — the game then uses its
 * on-device recogniser.
 *
 * ?debug in a game's address shows every try on screen (what was asked, expected, heard, verdict, time, recording level).
 */
(function (root) {
  'use strict';
  const PROD = 'https://phonics-api.polarislabs.ai.kr';
  const LS = 'phonics_api_key';
  const PA = { base: PROD, timeoutMs: 6000, key: null, last: null };
  let health = null, healthAt = 0, keyOk = null;   // keyOk: true | false | null (not checked yet)
  let restUntil = 0;   // after a timeout / network error / busy server: skip the server for a while (no wait per turn)

  // ---------- key ----------
  const ls = {
    get() { try { return (root.localStorage && root.localStorage.getItem(LS) || '').trim(); } catch (e) { return ''; } },
    set(v) { try { root.localStorage.setItem(LS, v); } catch (e) { /* private mode: this page only */ } },
    del() { try { root.localStorage.removeItem(LS); } catch (e) { /* ignore */ } },
  };
  let memKey = '';
  PA.getKey = () => (PA.key || ls.get() || memKey).trim();
  PA.setKey = (k) => { memKey = String(k || '').trim(); ls.set(memKey); keyOk = null; emit(); };
  PA.clearKey = () => { memKey = ''; ls.del(); keyOk = null; emit(); };
  const authHeaders = () => { const k = PA.getKey(); return k ? { Authorization: 'Bearer ' + k } : {}; };

  function emit() {
    if (root.dispatchEvent && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('phonicsapi:status', { detail: PA.status() }));
  }

  async function fetchT(url, opt, ms) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ac && setTimeout(() => ac.abort(), ms);
    try { return await fetch(url, Object.assign({}, opt, ac ? { signal: ac.signal } : {})); }
    finally { if (t) clearTimeout(t); }
  }

  // ---------- server state ----------
  /** GET /health (cached 60 s): {status, auth: 'open'|'key', disabled: [...]} or null when unreachable */
  PA.health = async function (force) {
    if (!force && healthAt && Date.now() - healthAt < 60000) return health;
    try { const r = await fetchT(PA.base + '/health', {}, 5000); health = r.ok ? await r.json() : null; }
    catch (e) { health = null; }
    healthAt = Date.now(); emit();
    return health;
  };
  /** 'on' = analyze can be called · 'nokey' = the server needs a key we don't have (or it was refused) · 'off' = analyze
   *  is turned off on this server · 'down' = unreachable · 'unknown' = init() not run yet */
  PA.status = function () {
    if (Date.now() < restUntil) return 'down';
    if (!healthAt) return 'unknown';
    if (!health) return 'down';
    if ((health.disabled || []).includes('analyze')) return 'off';
    if (health.auth === 'open') return 'on';
    return PA.getKey() && keyOk !== false ? 'on' : 'nokey';
  };
  PA.usable = () => { if (!healthAt && restUntil && Date.now() >= restUntil) { restUntil = 0; PA.health(true); } return PA.status() === 'on'; };
  /** call once at start (no await needed); checks the server and the stored key */
  PA.init = async function () {
    await PA.health(true);
    if (health && health.auth === 'key' && PA.getKey() && keyOk === null) await PA.verifyKey();
    return PA.status();
  };
  /** GET /v1/usage/me: {ok, prefix} | {ok:false, reason: 'badkey'|'suspended'|'network'} */
  PA.verifyKey = async function (k) {
    const key = (k == null ? PA.getKey() : String(k)).trim();
    const stored = key === PA.getKey();
    if (!key) return { ok: false, reason: 'badkey' };
    let res;
    try {
      const r = await fetchT(PA.base + '/v1/usage/me', { headers: { Authorization: 'Bearer ' + key } }, 8000);
      if (r.ok) { const j = await r.json(); res = { ok: true, prefix: j.key_prefix || key.slice(0, 12) }; }
      else res = { ok: false, reason: r.status === 403 ? 'suspended' : r.status === 401 ? 'badkey' : 'network', status: r.status };
    } catch (e) { res = { ok: false, reason: 'network' }; }
    if (stored && res.reason !== 'network') { keyOk = res.ok; emit(); }
    return res;
  };

  // ---------- audio ----------
  /** mono Float32 PCM -> 16-bit WAV Blob */
  PA.encodeWav = function (samples, sr) {
    const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE');
    ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  };
  /** any-rate mono PCM -> 16 kHz (the rate the server works in) */
  PA.to16k = async function (pcm, sr) {
    if (sr === 16000) return pcm;
    const len = Math.max(1, Math.ceil(pcm.length * 16000 / sr));
    const oc = new OfflineAudioContext(1, len, 16000);
    const b = oc.createBuffer(1, pcm.length, sr); b.copyToChannel(new Float32Array(pcm), 0);
    const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start();
    return (await oc.startRendering()).getChannelData(0);
  };

  // ---------- calls ----------
  const REASON = { 400: 'bad', 401: 'nokey', 403: 'suspended', 404: 'bad', 413: 'toolong', 422: 'bad', 503: 'busy' };
  async function post(path, form, ms, asBlob) {
    const st = PA.status();
    if (PA.debug) await dbgCall(path, form);
    if (st === 'nokey' || st === 'down' || st === 'off') return dbgDone({ ok: false, reason: st });
    const t0 = Date.now();
    try {
      const r = await fetchT(PA.base + path, { method: 'POST', headers: authHeaders(), body: form }, ms || PA.timeoutMs);
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) { keyOk = false; emit(); }
        if (r.status === 503 || r.status >= 500) { restUntil = Date.now() + 15000; emit(); }
        let detail = ''; try { detail = (await r.json()).detail; } catch (e) { /* not json */ }
        return dbgDone({ ok: false, status: r.status, reason: REASON[r.status] || 'server', detail, ms: Date.now() - t0 });
      }
      if (keyOk === null && PA.getKey()) { keyOk = true; emit(); }
      return dbgDone({ ok: true, status: r.status, data: asBlob ? await r.blob() : await r.json(), ms: Date.now() - t0 });
    } catch (e) {
      restUntil = Date.now() + 60000; healthAt = 0; emit();   // offline or hanging: the device judges for a minute
      return dbgDone({ ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network', ms: Date.now() - t0 });
    }
  }
  const form = (fields, wav) => { const f = new FormData(); if (wav) f.append('audio', wav, 'rec.wav'); for (const k in fields) if (fields[k] != null) f.append(k, fields[k]); return f; };

  /** /v1/speech/analyze — {ok, data:{detected_phonemes, expected_phonemes, confidence, ...}} | {ok:false, reason} */
  PA.analyze = (wav, word, ms) => post('/v1/speech/analyze', form({ word }, wav), ms);
  PA.analyzePcm = async (pcm, sr, word, ms) => PA.analyze(PA.encodeWav(await PA.to16k(pcm, sr), 16000), word, ms);
  /** /v1/speech/azure-score — 0~100 scores (Azure cloud, billed) */
  PA.azureScore = (wav, word, ms) => post('/v1/speech/azure-score', form({ word }, wav), ms);
  /** /v1/speech/poly-score — a sentence read aloud */
  PA.polyScore = (wav, sentence, ms) => post('/v1/speech/poly-score', form({ sentence }, wav), ms || 15000);
  /** /v1/speech/transcribe — speech -> text (Azure) */
  PA.transcribe = (wav, language, ms) => post('/v1/speech/transcribe', form({ language }, wav), ms);
  /** /v1/speech/tts — {ok, data: Blob (16 kHz WAV)}; for build tools mostly (games play pre-made files) */
  PA.tts = (text, voice, ms) => post('/v1/speech/tts', form({ text, voice }), ms || 15000, true);

  // ---------- judging among the words on screen ----------
  const UNRELEASED = { td: 't', dd: 'd', kd: 'k', gd: 'g', pd: 'p', bd: 'b' };
  // dx (the flap) stays itself: a Korean 미러's ㄹ is a flap, which is an r there, while an American "water"'s flap is a t —
  // near both (NEAR below)
  const RENAME = { axr: 'er', ax: 'ah', ix: 'ih', nx: 'n', el: 'l', em: 'm', en: 'n' };
  /** server phoneme symbols -> plain ARPABET; the Korean "eu" insertions are dropped (feedback, not a different word) */
  PA.norm = function (list) {
    const out = [];
    for (let p of list || []) {
      p = String(p).toLowerCase().replace(/[0-9]/g, '');
      const m = p.match(/^([a-z]+)_eu$/); if (m) p = m[1];
      if (!p || p === 'eu' || p === 'sil' || p === 'sp') continue;
      out.push(UNRELEASED[p] || RENAME[p] || p);
    }
    return out;
  };
  const VOWELS = new Set('aa ae ah ao aw ay eh er ey ih iy ow oy uh uw'.split(' '));
  // sounds a 5-year-old (and the recogniser) easily swaps: cost 0.4 instead of 1. m/n: the server hears a child voice's
  // m as n (en-US-Ana "map" -> "n ae p", mirror, mitt, moon) — near, so a rhyme like "nap" doesn't beat "map"
  // g/k, b/p, d/t: a word's end stop loses its voice in a child's or a Korean speaker's mouth ("mug" -> "m aa k", which
  // then sat nearer to "mop" — Eye Catch, user: "머그도 잘 안되는데"); 12 words x 8 voices: right 89.6 -> 90.6 %, others
  // passed unchanged at 5.2 %. m/b, n/d: a Korean word-initial m / n comes out half like b / d ("mitt" -> "bit"); p/m: a
  // Korean unreleased end p is heard as m ("맵" -> "m ae m", which sat nearer to "man")
  const NEAR = new Set(['ih iy', 'ih eh', 'iy ey', 'ah aa', 'ah ao', 'aa ao', 'ah uh', 'uw uh', 'eh ae', 'eh ey', 'ow ao', 'er r', 'n ng', 'm n',
    'g k', 'b p', 'd t', 'm b', 'n d', 'p m',
    // Korean-accented r (user 2026-11-22: "eyecatch 거울 발화인식 잘 못하는거 같아"): 미러 is heard 'm iy dx ao' — the r a flap, the
    // -er an open 어 vowel (ah/ao/aa) — and was judged 'meat'. The flap is near r, t and d; the r-coloured er near those vowels
    // (not dx~t: 미트 'meat' and 미러 'mirror' differ exactly there)
    'dx r', 'dx d', 'er ah', 'er ao', 'er aa']
    .flatMap(s => { const [a, b] = s.split(' '); return [a + ' ' + b, b + ' ' + a]; }));
  // a different vowel changes the word (meat / mop) more than a misheard end consonant (map / "mak"): 1.3
  const sub = (a, b) => a === b ? 0 : NEAR.has(a + ' ' + b) ? 0.4 : VOWELS.has(a) && VOWELS.has(b) ? 1.3 : 1;
  const LEAD = 0.5, TAIL = 0.25, TAIL_VOWEL = 0.1;   // extra sounds around the word ("the moon", Korean "mug-uh") cost little; before it a bit more (banana ⊃ "nan")
  /** weighted edit distance of the expected word inside what was heard. Sounds before it cost LEAD each — except the
   *  word's own first sound said again ("/m/ /m/ monkey", "eh eh egg": the phonics chant), which costs CHANT */
  const CHANT = 0.1;
  PA.distance = function (heard, exp) {
    const n = heard.length, m = exp.length;
    const tail = new Array(n + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) tail[i] = tail[i + 1] + (VOWELS.has(heard[i]) ? TAIL_VOWEL : TAIL);
    const lead = new Array(n + 1).fill(0);
    for (let i = 1; i <= n; i++) lead[i] = lead[i - 1] + (m && sub(heard[i - 1], exp[0]) < 1 ? CHANT : LEAD);
    let prev = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    let best = prev[m] + tail[0];
    for (let i = 1; i <= n; i++) {
      const cur = new Array(m + 1); cur[0] = lead[i];
      // an extra schwa right after a vowel (미러 heard 'm iy ah dx ao') is a glide, not a sound of its own: half price
      const extra = heard[i - 1] === 'ah' && i >= 2 && VOWELS.has(heard[i - 2]) ? 0.5 : 1;
      for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + extra, cur[j - 1] + 1, prev[j - 1] + sub(heard[i - 1], exp[j - 1]));
      prev = cur;
      best = Math.min(best, cur[m] + tail[i]);
    }
    return Math.round(best * 100) / 100;
  };
  /**
   * data = an analyze() result; target = the word asked for; words = the other words on screen; table = {word: [phonemes]}.
   * -> {verdict: 'ok' | 'wrong' | 'unclear' | 'silence', heard, best, d, rel}
   *   ok      = within PA.okMax per sound of the target, and no other word on screen was heard (almost) exactly and
   *             clearly closer (by 0.6+).
   *             Lenient on purpose: ih/iy, a misheard end consonant and a Korean end vowel still pass.
   *   wrong   = another word on screen was heard (almost) exactly and clearly closer than the target
   *   unclear = speech, but neither
   */
  // 2026-11-20 (user: "기준을 너무 높게 둔거 아냐?" → "응 배포해"): 0.4 → 0.5 and the near-exact rival rule. Measured on 121
  // readings of 12 words (tools/qa_sweep.mjs: official, official + room noise, adult, child, 5 Korean-accent voices):
  // right words passed 79 → 88 % (Korean accent 65 → 78 %, child 75 → 92 %); another card word passing 2.6 → 4.4 %;
  // hello / Korean talk / silence / noise still never pass (the new ones: sound-alike m-words mat/mice/mail, apple → map)
  PA.okMax = 0.5;      // 'ok' up to this much difference per sound (0.5 ≈ one wrong vowel in a 3-sound word)
  PA.minConf = 0.4;    // below this server confidence: no verdict ('unclear')
  PA.firstWithin = 4; // the target's first sound must be among the first N sounds heard (chant / "the" / Korean 'eu' before it)
  const END_ONLY = new Set(['p m', 'm p']);   // near only at a word's END (Korean unreleased p heard as m), not as its first sound
  PA.rivalMax = 0.34;  // another word blocks an 'ok' only when IT was heard within this much per sound (≈ exactly)
  PA.judge = function (data, target, words, table) {
    const heard = PA.norm(data && data.detected_phonemes);
    const res = { verdict: 'unclear', heard: heard.join(' '), best: null, d: {}, rel: Infinity };
    if (!heard.length) { res.verdict = 'silence'; return dbgJudge(res, data, target, table); }
    const cand = [...new Set([target, ...(words || [])])].filter(w => table[w] && table[w].length);
    for (const w of cand) res.d[w] = PA.distance(heard, PA.norm(table[w]));
    const others = cand.filter(w => w !== target).sort((a, b) => res.d[a] - res.d[b]);
    const dt = res.d[target], rival = others[0], dr = rival == null ? Infinity : res.d[rival];
    res.best = dt <= dr ? target : rival;
    if (dt == null || (data.confidence != null && data.confidence < PA.minConf)) return dbgJudge(res, data, target, table);
    const len = PA.norm(table[target]).length || 1;
    res.rel = Math.round(dt / len * 100) / 100;   // how far from the target, per sound (a game may call ≤ 0.7 "a try at it")
    // another word blocks an 'ok' only when IT was heard (almost) exactly and clearly closer — a short word matching the
    // start of a long one cheaply ("mug" inside a Korean-accented "mushroom") no longer blocks it
    const rivalExact = rival != null && dr / (PA.norm(table[rival]).length || 1) <= PA.rivalMax;
    // a word has a vowel: with none heard at all it was a hum / "mmm" / a click — never 'ok' (user 2026-11-22: "잘못말해도
    // 카드가 획득되는데?"; a 220 Hz hum came back 'm m m', 1.4 from moon 'm uw n' = inside 0.5 × 3, and won the card)
    const voiced = heard.some(p => VOWELS.has(p)) || !PA.norm(table[target]).some(p => VOWELS.has(p));
    // and the word's FIRST sound must be heard near the start (these are phonics games: /m/ is the lesson) — "apple" heard
    // 'ae p ah l' was 1.35 from map 'm ae p' and passed; "the moon", a Korean 'eu' and the /m/ /m/ chant still pass
    const exp0 = PA.norm(table[target])[0];
    const firstHeard = !exp0 || heard.slice(0, PA.firstWithin).some(p => p === exp0 || (NEAR.has(p + ' ' + exp0) && !END_ONLY.has(p + ' ' + exp0)));
    if (voiced && firstHeard && dt / len <= PA.okMax && !(rivalExact && dt - dr >= 0.6)) res.verdict = 'ok';
    else if (dr <= 0.5 && dt - dr >= 0.6) res.verdict = 'wrong';
    return dbgJudge(res, data, target, table);
  };

  // ---------- ?debug: what the server heard, on screen (user 2026-11-20: "전체적으로 음성 인식이 잘 안되는거 같은데") ----------
  // Add ?debug to a game's address: a small panel (bottom left, never takes a tap) lists the last 6 tries — the word
  // asked for, its expected sounds, what the server heard, the verdict, confidence, time, and the recording's length and
  // loudness — or why the server wasn't used (no key / resting after a failure / busy / timeout: then the game's
  // on-device recogniser judged). Nothing is stored or sent anywhere else.
  PA.debug = (() => { try { return /[?&]debug(=[^&]*)?(&|$)/.test(root.location.search); } catch (e) { return false; } })();
  let dbgLast = null;
  const dbgRows = [];
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function dbgCall(path, form) {
    dbgLast = null;
    if (!/analyze|transcribe/.test(path)) return;
    const a = form.get('audio'), info = { path, word: form.get('word') || '', sec: null, peak: null, rms: null };
    try {
      const pcm = new Int16Array((await a.arrayBuffer()).slice(44));
      let pk = 0, ss = 0;
      for (let i = 0; i < pcm.length; i++) { const v = Math.abs(pcm[i]) / 32768; if (v > pk) pk = v; ss += v * v; }
      info.sec = pcm.length / 16000;
      info.peak = Math.round(20 * Math.log10(pk + 1e-9));
      info.rms = Math.round(20 * Math.log10(Math.sqrt(ss / Math.max(1, pcm.length)) + 1e-9));
    } catch (e) { /* not a 16 kHz WAV */ }
    dbgLast = info;
  }
  const WHY = { nokey: '키 없음', down: '서버 쉬는 중(앞서 실패)', off: '발음 분석 꺼짐', busy: '서버 바쁨(503)', timeout: '시간 초과',
    network: '연결 안 됨', suspended: '키 정지', bad: '잘못된 요청', toolong: '녹음이 너무 김', server: '서버 오류' };
  function dbgDone(r) {
    if (!PA.debug || !dbgLast) return r;
    dbgLast.ms = r.ms; dbgLast.ok = r.ok;
    if (!r.ok) dbgAdd(`<b>${esc(dbgLast.word || '받아쓰기')}</b> <span style="color:#ffb86b">서버 판정 못 함 · ${esc(WHY[r.reason] || r.reason)}${r.ms != null ? ' · ' + (r.ms / 1000).toFixed(1) + '초' : ''}</span><br>→ 이번엔 기기 안 인식기가 판정해요${dbgRec()}`);
    else if (/transcribe/.test(dbgLast.path)) dbgAdd(`<b>받아쓰기</b> "${esc(r.data && r.data.text)}" · ${(r.ms / 1000).toFixed(1)}초${dbgRec()}`);
    return r;
  }
  const dbgRec = () => dbgLast && dbgLast.sec != null ? `<br><span style="opacity:.75">녹음 ${dbgLast.sec.toFixed(1)}초 · 최대 ${dbgLast.peak} dB · 평균 ${dbgLast.rms} dB</span>` : '';
  function dbgJudge(res, data, target, table) {
    if (!PA.debug) return res;
    const V = { ok: ['맞음', '#7cf29c'], wrong: ['다른 낱말로 들림', '#ff8f8f'], unclear: ['다시 (애매함)', '#ffb86b'], silence: ['소리 못 들음', '#ffb86b'] }[res.verdict] || [res.verdict, '#fff'];
    const conf = data && data.confidence != null ? data.confidence : null;
    const exp = PA.norm(table && table[target]).join(' ');
    const near = res.best && res.best !== target ? ` · 가장 가까운 낱말 <b>${esc(res.best)}</b>` : '';
    dbgAdd(`<b>${esc(target)}</b> <span style="color:${V[1]}">${V[0]}</span>${isFinite(res.rel) ? ` · 차이 ${res.rel}/소리` : ''}${near}` +
      `<br>기대 <b>${esc(exp)}</b><br>들림 <b>${esc(res.heard || '—')}</b>${conf != null ? ` · 확신 ${conf.toFixed(2)}${conf < 0.4 ? ' (낮아서 판정 안 함)' : ''}` : ''}` +
      `${dbgLast && dbgLast.ms != null ? ' · ' + (dbgLast.ms / 1000).toFixed(1) + '초' : ''}${dbgRec()}`);
    return res;
  }
  function dbgAdd(html) {
    if (!root.document) return;
    const d = root.document;
    dbgRows.unshift(`<div style="padding:6px 0;border-top:1px solid rgba(255,255,255,.15)">${html}</div>`);
    dbgRows.length = Math.min(dbgRows.length, 6);
    let box = d.getElementById('pa-debug');
    if (!box) {
      box = d.createElement('div'); box.id = 'pa-debug';
      box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483600;max-width:min(460px,92vw);max-height:70vh;overflow:hidden;' +
        'padding:6px 10px;border-radius:10px;background:rgba(16,20,34,.88);color:#fff;font:12px/1.45 ui-monospace,Menlo,monospace;pointer-events:none';
      (d.body || d.documentElement).appendChild(box);
    }
    box.innerHTML = '<div style="font-weight:700;opacity:.8">발음 인식 (?debug)</div>' + dbgRows.join('');
  }

  // ---------- key dialog (teacher-facing, Korean) ----------
  const MSG = { badkey: '키가 맞지 않아요.', suspended: '정지된 키예요. AI Engineering팀에 문의해 주세요.', network: '서버에 연결할 수 없어요.' };
  /** opens a small dialog; resolves to PA.status() when closed */
  PA.keyDialog = function () {
    if (!root.document) return Promise.resolve(PA.status());
    const d = root.document;
    return new Promise((done) => {
      const wrap = d.createElement('div');
      wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', 'phonics-api 키');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(20,24,40,.45);font:16px/1.45 system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif';
      const has = !!PA.getKey();
      wrap.innerHTML =
        '<div style="width:min(420px,calc(100vw - 32px));background:#fff;color:#1d2233;border-radius:16px;padding:22px 22px 18px;box-shadow:0 18px 50px rgba(0,0,0,.25)">' +
        '<div style="font-weight:700;font-size:18px;margin-bottom:4px">발음 인식 서버 키</div>' +
        '<div data-s style="font-size:14px;color:#5b6276;margin-bottom:14px"></div>' +
        '<input data-k type="password" autocomplete="off" spellcheck="false" placeholder="poly_..." style="box-sizing:border-box;width:100%;height:44px;border:1.5px solid #c9cedb;border-radius:10px;padding:0 12px;font:15px ui-monospace,Menlo,monospace">' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' +
        (has ? '<button data-c style="height:40px;padding:0 14px;border-radius:10px;border:1.5px solid #c9cedb;background:#f3f4f8;color:#1d2233;font:inherit">키 지우기</button>' : '') +
        '<button data-x style="height:40px;padding:0 14px;border-radius:10px;border:1.5px solid #c9cedb;background:#f3f4f8;color:#1d2233;font:inherit">닫기</button>' +
        '<button data-o style="height:40px;padding:0 16px;border-radius:10px;border:0;background:#1d2233;color:#fff;font:inherit;font-weight:600">저장</button></div></div>';
      d.body.appendChild(wrap);
      const $ = (s) => wrap.querySelector(s), st = $('[data-s]'), inp = $('[data-k]');
      const show = () => {
        const s = PA.status();
        st.textContent = s === 'on' ? (health && health.auth === 'open' ? '이 서버는 키 없이 열려 있어요.' : '연결됨 · ' + PA.getKey().slice(0, 12) + '…')
          : s === 'down' ? MSG.network : s === 'off' ? '이 서버는 발음 분석이 꺼져 있어요.' : '키를 넣으면 회사 서버로 발음을 판정해요. 없으면 기기 안에서 판정해요.';
      };
      show();
      const close = () => { wrap.remove(); d.removeEventListener('keydown', onKey, true); done(PA.status()); };
      const save = async () => {
        const k = inp.value.trim(); if (!k) return;
        st.textContent = '확인하는 중…';
        const r = await PA.verifyKey(k);
        if (r.ok) { PA.setKey(k); keyOk = true; emit(); close(); }
        else st.textContent = MSG[r.reason] || MSG.network;
      };
      const onKey = (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') save(); };
      d.addEventListener('keydown', onKey, true);
      wrap.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === wrap) close(); }, true);
      $('[data-o]').onclick = save; $('[data-x]').onclick = close;
      if (has) $('[data-c]').onclick = () => { PA.clearKey(); show(); };
      setTimeout(() => inp.focus(), 30);
    });
  };

  root.PhonicsAPI = PA;
})(typeof window !== 'undefined' ? window : globalThis);
