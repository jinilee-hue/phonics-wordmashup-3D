// Types for phonics-api.js (copy next to it in a TypeScript game; `import './phonics-api.js'` sets window.PhonicsAPI).
export {};
declare global {
  type PhonicsStatus = 'on' | 'nokey' | 'off' | 'down' | 'unknown';
  interface PhonicsJudge { verdict: 'ok' | 'wrong' | 'unclear' | 'silence'; heard: string; best: string | null; d: Record<string, number>; rel: number }
  interface PhonicsCall<T = any> { ok: boolean; status?: number; reason?: string; detail?: string; data?: T; ms?: number } // eslint-disable-line @typescript-eslint/no-explicit-any
  interface PhonicsAnalyze { detected_phonemes: string[]; expected_phonemes: string[]; confidence?: number; [k: string]: unknown }
  interface PhonicsAPIType {
    base: string; timeoutMs: number; key: string | null;
    init(): Promise<PhonicsStatus>;
    status(): PhonicsStatus;
    usable(): boolean;
    health(force?: boolean): Promise<{ status: string; auth: 'open' | 'key'; disabled?: string[] } | null>;
    getKey(): string; setKey(k: string): void; clearKey(): void;
    verifyKey(k?: string): Promise<{ ok: boolean; reason?: string; prefix?: string; status?: number }>;
    encodeWav(pcm: Float32Array, sr: number): Blob;
    to16k(pcm: Float32Array, sr: number): Promise<Float32Array>;
    analyze(wav: Blob, word: string, ms?: number): Promise<PhonicsCall<PhonicsAnalyze>>;
    analyzePcm(pcm: Float32Array, sr: number, word: string, ms?: number): Promise<PhonicsCall<PhonicsAnalyze>>;
    azureScore(wav: Blob, word: string, ms?: number): Promise<PhonicsCall>;
    polyScore(wav: Blob, sentence: string, ms?: number): Promise<PhonicsCall>;
    transcribe(wav: Blob, language?: string, ms?: number): Promise<PhonicsCall>;
    tts(text: string, voice?: string, ms?: number): Promise<PhonicsCall<Blob>>;
    norm(list: string[]): string[];
    distance(heard: string[], exp: string[]): number;
    judge(data: PhonicsAnalyze | undefined, target: string, words: string[], table: Record<string, string[]>): PhonicsJudge;
    keyDialog(): Promise<PhonicsStatus>;
  }
  interface Window { PhonicsAPI: PhonicsAPIType }
}
