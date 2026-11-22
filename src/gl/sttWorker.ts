// On-device speech recognition (transformers.js on ONNX Runtime WASM; Phonics-Jenga's sttWorker.ts, text only). The
// child's audio only ever lives in this worker's memory for one utterance: nothing is stored or sent anywhere. Model +
// runtime files come from our own site (public/stt), never from the model hub or a CDN.
import { env, pipeline } from '@huggingface/transformers';

type Load = { type: 'load'; base: string; model: string };
type Run = { type: 'run'; id: number; audio: Float32Array };
type Asr = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>;

let asr: Promise<Asr> | null = null;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<Load | Run>) => {
  const m = e.data;
  if (m.type === 'load') {
    if (!asr) {
      env.allowRemoteModels = false; // never fetch from the model hub at runtime
      env.allowLocalModels = true;
      // a path, not a full URL: transformers.js only checks which optional files (tokenizer, preprocessor) exist
      // for local paths, and would silently skip them for an http(s) URL
      env.localModelPath = `${new URL(m.base).pathname}stt/models/`;
      env.useBrowserCache = true; // the model downloads once, then comes from Cache Storage
      const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
      if (onnx.wasm) {
        // the plain SIMD build: smallest, and enough for the WASM backend on every browser
        onnx.wasm.wasmPaths = { mjs: `${m.base}stt/ort/ort-wasm-simd-threaded.mjs`, wasm: `${m.base}stt/ort/ort-wasm-simd-threaded.wasm` };
        onnx.wasm.numThreads = 1; // GitHub Pages has no cross-origin isolation, so no threads anyway
      }
      asr = pipeline('automatic-speech-recognition', m.model, { device: 'wasm', dtype: 'q8' }) as unknown as Promise<Asr>;
    }
    try {
      const p = await asr;
      await p(new Float32Array(8000)); // warm-up: the first run compiles the kernels
      post({ type: 'ready' });
    } catch (err) {
      asr = null;
      post({ type: 'error', error: `${String(err)} ${(err as Error)?.stack ?? ''}`.slice(0, 1500) });
    }
    return;
  }
  if (m.type === 'run') {
    try {
      if (!asr) throw new Error('not loaded');
      const p = await asr;
      const t0 = performance.now();
      const out = await p(m.audio);
      const text = (Array.isArray(out) ? out.map((o) => o.text ?? '').join(' ') : out.text ?? '').trim();
      post({ type: 'result', id: m.id, text, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      post({ type: 'result', id: m.id, text: '', ms: 0, error: String(err) });
    }
  }
};
