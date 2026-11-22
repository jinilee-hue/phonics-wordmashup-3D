// Types for the vendored phonics-kit phonics-progress.js (window.PhonicsProgress, shared localStorage key 'phonics.progress').
export interface ProgressRecord {
  plays: number; firstAt: string | null; lastAt: string | null; level: number | null; maxLevel: number | null;
  best: Record<string, number>; history: Array<Record<string, unknown> & { at: string }>;
}
export interface PhonicsProgressAPI {
  KEY: string;
  get(id: string): ProgressRecord;
  all(): Record<string, ProgressRecord>;
  played(id: string, result?: Record<string, number | boolean | string>, opts?: { higher?: string[]; lower?: string[] }): ProgressRecord;
  setLevel(id: string, level: number): ProgressRecord;
  reset(id?: string): void;
}
declare global { interface Window { PhonicsProgress?: PhonicsProgressAPI } }
