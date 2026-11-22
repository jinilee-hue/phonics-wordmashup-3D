// SpeechRecognition on the company phonics-api (phonics-kit, the 2026-11-19 rule for every phonics game).
// The game's Mic button (GameScene.startMic: say the two words → the cards snap) and Glee's "Say it with me!" (tutor.ts
// Ears) both read TEXT from the browser's SpeechRecognition, which sends the voice to Google. With a phonics-api key on
// this device (Settings › 발음 인식 서버 키) the same interface is served by phonics-api instead: the mic is recorded
// here (voice detector: 150 ms over the room's level starts it, 0.7 s of quiet ends it), sent once to
// /v1/speech/transcribe (Azure speech-to-text on the company account; the server keeps no audio) and the text comes
// back as one final result — the game's logic stays as it is. No key / offline → the browser's own recogniser, as before.
// The recorder (recordTake) also serves Glee's say-it turn, which is judged by /v1/speech/analyze instead (sayJudge.ts).
import '../vendor/phonics-api.js';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const W = window as Any;
const Native = W.SpeechRecognition || W.webkitSpeechRecognition;

export type Take = { kind: 'speech'; pcm: Float32Array; sr: number } | { kind: 'silence' } | { kind: 'nomic' };

/** One utterance from the microphone (voice detector: 150 ms over the room's level starts it, 0.7 s of quiet ends it).
 *  `waitMs`: no voice by then = silence; `capMs`: the whole take ends there; `stop()`: end now (keep what was said). */
export async function recordTake(o: { waitMs?: number; capMs?: number; stop?: () => boolean; onStart?: () => void } = {}): Promise<Take> {
  const waitMs = o.waitMs ?? 8000, capMs = o.capMs ?? 8000;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    return { kind: 'nomic' };
  }
  const ctx = new AudioContext();
  try { await ctx.resume(); } catch { /* stays suspended → the safety time-out below */ }
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1), sink = ctx.createGain();
  sink.gain.value = 0;
  src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
  o.onStart?.();
  const chunks: Float32Array[] = [];
  const t0 = performance.now();
  let floor = 0, nCal = 0, run = 0, voiceAt = -1, lastVoice = -1;
  await new Promise<void>((done) => {
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
      if (o.stop?.() || quiet || now - t0 > capMs || (voiceAt < 0 && now - t0 > waitMs) || (voiceAt >= 0 && now - voiceAt > 6000)) { clearTimeout(safety); done(); }
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

class PhonicsSR {
  lang = 'en-US'; interimResults = false; maxAlternatives = 1; continuous = false;
  onresult: ((e: Any) => void) | null = null;
  onerror: ((e: Any) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  /** tutor.ts waits longer for a final result: the text comes after the recording */
  readonly phonics = true;
  private stopReq = false;
  private abortReq = false;
  private started = false;

  start() { if (this.started) throw new Error('already started'); this.started = true; void this.run(); }
  stop() { this.stopReq = true; }
  abort() { this.abortReq = true; this.stopReq = true; }

  private async run() {
    const take = await recordTake({ waitMs: 8000, capMs: 8000, stop: () => this.stopReq, onStart: () => this.onstart?.() });
    if (take.kind === 'nomic') { this.onerror?.({ error: 'not-allowed' }); this.onend?.(); return; }
    if (this.abortReq || take.kind !== 'speech') { this.onend?.(); return; }
    const { pcm, sr } = take;
    const PA = W.PhonicsAPI as PhonicsAPIType;
    const r = await PA.transcribe(PA.encodeWav(await PA.to16k(pcm, sr), 16000), 'en-US', 8000);
    const text = r.ok ? String((r.data as Any)?.text || '').trim() : '';
    if (W.__wmLog) console.log('phonics-api transcribe', JSON.stringify({ ok: r.ok, reason: r.reason, text, ms: r.ms }));
    if (!this.abortReq && text) {
      const alt = Object.assign([{ transcript: text, confidence: 1 }], { isFinal: true });
      this.onresult?.({ resultIndex: 0, results: [alt] });
    }
    this.onend?.();
  }
}

/** no recogniser at all (no key and a browser without one) */
class NoSR {
  onerror: ((e: Any) => void) | null = null; onend: (() => void) | null = null; onresult = null;
  lang = ''; interimResults = false; maxAlternatives = 1; continuous = false;
  start() { setTimeout(() => { this.onerror?.({ error: 'service-not-allowed' }); this.onend?.(); }, 0); }
  stop() { /* nothing */ } abort() { /* nothing */ }
}

/** `new SpeechRecognition()` picks the recogniser when it is made: phonics-api with a key, else the browser's */
function HybridSR(this: Any) {
  const PA = W.PhonicsAPI as PhonicsAPIType | undefined;
  if (PA && PA.usable()) return new PhonicsSR();
  return Native ? new Native() : new NoSR();
}
W.SpeechRecognition = W.webkitSpeechRecognition = HybridSR;
W.__wmLog = new URLSearchParams(location.search).has('log');
void W.PhonicsAPI?.init();
