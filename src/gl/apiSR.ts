// The microphone and its text, for every listening moment (phonics-kit rule, user 2026-11-22: phonics-api first, the
// on-device whisper second; no child's voice goes to a third-party server, so the browser's own recogniser - which
// sends the voice to Google - is not used at all).
// recordTake records one utterance here (voice detector: 150 ms over the room's level starts it, 0.7 s of quiet ends it).
// Glee's questions ("Which two go together? Tell me!", "What goes with pan?": tutor.ts Ears) read its TEXT (hearText):
// with a phonics-api key on this device (Settings › 발음 인식 서버 키) /v1/speech/transcribe (Azure speech-to-text on the
// company account; the server keeps no audio), else - or when the server fails - the on-device recogniser (stt.ts).
// Glee's say-it turn is judged by /v1/speech/analyze instead, with the same device fallback (sayJudge.ts).
import '../vendor/phonics-api.js';
import { sttPreload, sttState, sttWhenReady, transcribe } from './stt';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const W = window as Any;

export type Take = { kind: 'speech'; pcm: Float32Array; sr: number } | { kind: 'silence' } | { kind: 'nomic' };

/** how long the microphone may take to open: an unanswered permission prompt = no microphone (nothing can judge) */
const MIC_WAIT_MS = 15000;
/** the on-device recogniser is still loading when a take is in: wait this long for it, then nothing judges this take */
export const MODEL_WAIT_MS = 8000;

let micRefused = false;
/** the microphone was refused (or its permission prompt went unanswered): nothing listens again in this visit */
export const micOff = () => micRefused;
/** something can read the microphone now: phonics-api (a key on this device) or the on-device recogniser when it is
 *  ready (`loading`: or still loading) */
export const canHear = (loading = false) =>
  !micRefused && (!!W.PhonicsAPI?.usable() || sttState() === 'ready' || (loading && sttState() !== 'error'));

/** One utterance from the microphone (voice detector: 150 ms over the room's level starts it, 0.7 s of quiet ends it).
 *  `waitMs`: no voice by then = silence; `capMs`: the whole take ends there; `stop()`: end now (keep what was said).
 *  Opening the microphone races MIC_WAIT_MS and `stop()` (JUMP): a permission prompt nobody answers can't hold the turn. */
export async function recordTake(o: { waitMs?: number; capMs?: number; stop?: () => boolean; onStart?: () => void } = {}): Promise<Take> {
  const waitMs = o.waitMs ?? 8000, capMs = o.capMs ?? 8000;
  let stream: MediaStream;
  try {
    const gum = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    let poll = 0, timer = 0;
    const got = await Promise.race([
      gum,
      new Promise<'timeout'>(res => { timer = window.setTimeout(() => res('timeout'), MIC_WAIT_MS); }),
      new Promise<'stop'>(res => { poll = window.setInterval(() => { if (o.stop?.()) res('stop'); }, 100); }),
    ]).finally(() => { clearTimeout(timer); clearInterval(poll); });
    if (got === 'timeout' || got === 'stop') {
      void gum.then(s => s.getTracks().forEach(t => t.stop()), () => {});   // answered later: close it again
      if (got === 'stop') return { kind: 'silence' };
      if (W.__wmLog) console.log('[mic] no answer to the permission prompt in', MIC_WAIT_MS, 'ms');
      micRefused = true;
      return { kind: 'nomic' };
    }
    stream = got;
  } catch {
    micRefused = true;
    return { kind: 'nomic' };
  }
  const ctx = new AudioContext();
  try { await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 1000))]); } catch { /* stays suspended → the safety time-out below */ }
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1), sink = ctx.createGain();
  sink.gain.value = 0;
  src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
  o.onStart?.();
  const chunks: Float32Array[] = [];
  const t0 = performance.now();
  let floor = 0, nCal = 0, run = 0, voiceAt = -1, lastVoice = -1;
  await new Promise<void>((resolve) => {
    // stop() is also checked here: a suspended context never calls onaudioprocess
    const poll = setInterval(() => { if (o.stop?.()) done(); }, 100);
    const done = () => { clearTimeout(safety); clearInterval(poll); resolve(); };
    const safety = setTimeout(done, capMs + 1000);
    proc.onaudioprocess = (e) => {
      const f = new Float32Array(e.inputBuffer.getChannelData(0));
      chunks.push(f);
      let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i];
      const lv = Math.sqrt(s / f.length), now = performance.now(), dt = (f.length / ctx.sampleRate) * 1000;
      if (now - t0 < 250) { floor += lv; nCal++; }
      else {
        const thr = Math.max(0.015, (floor / Math.max(1, nCal)) * 3.2);
        if (lv > thr) { run += dt; lastVoice = now; if (voiceAt < 0 && run >= 150) voiceAt = now; }
        else if (now - lastVoice > 160) run = 0;
      }
      const quiet = voiceAt >= 0 && now - lastVoice > 700;
      if (o.stop?.() || quiet || now - t0 > capMs || (voiceAt < 0 && now - t0 > waitMs) || (voiceAt >= 0 && now - voiceAt > 6000)) done();
    };
  });
  proc.onaudioprocess = null;
  try { proc.disconnect(); src.disconnect(); } catch { /* gone */ }
  stream.getTracks().forEach((t) => t.stop());
  const sr = ctx.sampleRate;
  void ctx.close();
  if (voiceAt < 0) return { kind: 'silence' };
  const n = chunks.reduce((k, c) => k + c.length, 0), pcm = new Float32Array(n);
  let o2 = 0; for (const c of chunks) { pcm.set(c, o2); o2 += c.length; }
  return { kind: 'speech', pcm, sr };
}

/** The on-device recogniser's text for a 16 kHz take: waits for the model up to `waitMs` (it loads in the background).
 *  null = it can't read this take (not ready in time, failed, or `stop()`); '' = no words in it. */
export async function deviceText(pcm16: Float32Array, waitMs: number, stop?: () => boolean): Promise<string | null> {
  if (!await sttWhenReady(waitMs, stop) || stop?.()) return null;
  const r = await transcribe(pcm16);
  if (W.__wmLog) console.log('[device] transcribe', JSON.stringify(r));
  // whisper writes sounds it can't read as "[BLANK_AUDIO]", "(music)", "*cough*": not words
  return r ? r.text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ').trim() : null;
}

/** One utterance as text: phonics-api /v1/speech/transcribe when this device has a key and the server answers, else
 *  the on-device recogniser (`modelWaitMs`: how long to wait for it if it is still loading). null = nothing heard, or
 *  nothing could read it (the caller falls back to touch). */
export async function hearText(o: { waitMs: number; capMs: number; stop: () => boolean; modelWaitMs?: number }): Promise<string | null> {
  const take = await recordTake({ waitMs: o.waitMs, capMs: o.capMs, stop: o.stop });
  if (take.kind !== 'speech' || o.stop()) return null;
  const PA = W.PhonicsAPI as PhonicsAPIType;
  const pcm16 = await PA.to16k(take.pcm, take.sr);
  if (PA.usable()) {
    const r = await PA.transcribe(PA.encodeWav(pcm16, 16000), 'en-US', 8000);
    const text = r.ok ? String((r.data as Any)?.text || '').trim() : '';
    if (W.__wmLog) console.log('phonics-api transcribe', JSON.stringify({ ok: r.ok, reason: r.reason, text, ms: r.ms }));
    if (r.ok) return text || null;
  }
  if (o.stop()) return null;
  return (await deviceText(pcm16, o.modelWaitMs ?? 0, o.stop)) || null;
}

/** The game's own Mic button (scenes/GameScene.ts startMic) makes `new SpeechRecognition()`: it gets this — the same take
 *  and text as Glee's questions (phonics-api, else the on-device recogniser), never the browser's own recogniser, which
 *  sends the voice to Google (user 2026-11-22: "브라우저 인식" → whisper). Pressing Mic again (stop) cancels the take. */
class LocalSR {
  lang = 'en-US'; interimResults = false; maxAlternatives = 1; continuous = false;
  onresult: ((e: Any) => void) | null = null;
  onerror: ((e: Any) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  private stopReq = false;
  private started = false;
  start() { if (this.started) throw new Error('already started'); this.started = true; void this.run(); }
  stop() { this.stopReq = true; }
  abort() { this.stopReq = true; }
  private async run() {
    let text: string | null = null;
    if (!micOff()) {
      try { text = await hearText({ waitMs: 8000, capMs: 8000, stop: () => this.stopReq, modelWaitMs: MODEL_WAIT_MS }); }
      catch { /* nothing could read the take */ }
    }
    if (micOff()) this.onerror?.({ error: 'not-allowed' });
    else if (text && !this.stopReq) this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: 1 }], { isFinal: true })] });
    this.onend?.();
  }
}
W.SpeechRecognition = W.webkitSpeechRecognition = LocalSR;

// the on-device recogniser loads in the background from the first tap or key (the intro and title go on as they are)
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (sttState() === 'off') sttPreload(); }, { once: true, capture: true, passive: true });
W.__wmLog = new URLSearchParams(location.search).has('log');
void W.PhonicsAPI?.init();
