// On-device speech recognition (the phonics games' second judge after phonics-api, user 2026-11-22: no child's voice
// goes to a third-party server). whisper tiny.en (8-bit) runs in a worker (sttWorker.ts); model + runtime files are
// served from this site (public/stt, copied from Phonics-Jenga). It loads in the background from the first tap
// (apiSR.ts); until it is ready, a say-it turn waits a little (sayJudge.ts) and Glee's other questions fall back to touch.
export const STT_MODEL = 'onnx-community/whisper-tiny.en';

type State = 'off' | 'loading' | 'ready' | 'error';
let worker: Worker | null = null;
let state: State = 'off';
let seq = 0;
const waiters = new Map<number, (r: { text: string; ms: number } | null) => void>();
let readyWaiters: ((ok: boolean) => void)[] = [];

export const sttState = () => state;

function settle(ok: boolean) { const w = readyWaiters; readyWaiters = []; w.forEach((f) => f(ok)); }

/** Start downloading + compiling the model in a worker (idempotent). */
export function sttPreload(model = STT_MODEL) {
  if (worker || state === 'error') return;
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') { state = 'error'; return; }
  try {
    worker = new Worker(new URL('./sttWorker.ts', import.meta.url), { type: 'module' });
  } catch (e) { console.warn('stt: no worker', e); state = 'error'; return; }
  state = 'loading';
  worker.onmessage = (e: MessageEvent) => {
    const d = e.data as { type: string; id?: number; text?: string; ms?: number; error?: string };
    if (d.type === 'ready') { state = 'ready'; settle(true); }
    else if (d.type === 'error') { state = 'error'; console.warn('stt: load failed', d.error); settle(false); }
    else if (d.type === 'result') {
      const f = waiters.get(d.id!); waiters.delete(d.id!);
      if (d.error) console.warn('stt: run failed', d.error);
      f?.(d.error ? null : { text: d.text ?? '', ms: d.ms ?? 0 });
    }
  };
  worker.onerror = (e) => { console.warn('stt: worker error', e.message); state = 'error'; settle(false); };
  worker.postMessage({ type: 'load', base: new URL('./', location.href).href, model });
}

/** Resolves true once the model is ready (false on error, after `ms`, or when `stop()` turns true). */
export function sttWhenReady(ms: number, stop?: () => boolean): Promise<boolean> {
  if (state === 'off') sttPreload();
  if (state === 'ready') return Promise.resolve(true);
  if (state !== 'loading') return Promise.resolve(false);
  return new Promise((res) => {
    const end = (ok: boolean) => { clearTimeout(t); clearInterval(poll); readyWaiters = readyWaiters.filter((f) => f !== end); res(ok); };
    const t = setTimeout(() => end(false), ms);
    const poll = setInterval(() => { if (stop?.()) end(false); }, 100);
    readyWaiters.push(end);
  });
}

/** 16 kHz mono PCM -> text, or null if the model isn't ready / the run failed / it took longer than `ms`. */
export function transcribe(audio16k: Float32Array, ms = 12000): Promise<{ text: string; ms: number } | null> {
  if (!worker || state !== 'ready') return Promise.resolve(null);
  const id = ++seq;
  const a = forStt(audio16k); // own buffer, so it can be transferred
  return new Promise((res) => {
    waiters.set(id, res);
    worker!.postMessage({ type: 'run', id, audio: a }, [a.buffer]);
    setTimeout(() => { if (waiters.delete(id)) res(null); }, ms);
  });
}

/** peak-normalised, with a little silence on both ends (what the recogniser likes; Phonics-Jenga prepareForStt) */
function forStt(pcm: Float32Array) {
  let peak = 0; for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  const g = peak > 0.001 ? Math.min(8, 0.9 / peak) : 1;
  const pad = 4000; // 0.25 s
  const r = new Float32Array(pcm.length + pad * 2);
  for (let i = 0; i < pcm.length; i++) r[pad + i] = pcm[i] * g;
  return r;
}
