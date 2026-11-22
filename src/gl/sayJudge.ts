// The say-it turn's judge (phonics-kit common rule, user 2026-11-22: F3). "Say it with me! Pancake!" passes only when the
// whole compound was heard - never on any sound or a loose spelling match.
//   1. phonics-api (this device has a key): one take from the microphone -> /v1/speech/analyze (the sounds it HEARD) ->
//      PhonicsAPI.judge against the compound's expected sounds, with its two parts as the rivals: "pan" alone, or "cake"
//      alone, is heard (almost) exactly as a part and blocks the pass (src/data/phonemes.ts, tools/build_phonemes.py).
//   2. Otherwise the browser's speech recognition (text): the compound as one word (or its plural), or its two parts
//      back to back ("pan cake"; a part's exact sound-alike counts: "see shell"). No near spellings.
//   3. Nothing can judge (no key and no recogniser, the microphone refused, the recogniser fails): 'nojudge' - the turn
//      is skipped without a reward (rule 5: "넘어가되 보상 없음").
import '../vendor/phonics-api.js';
import { PHONEMES } from '../data/phonemes';
import { recordTake } from './apiSR';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Pair = { word1: string; word2: string; result: string };
/** ok = said it · miss = said something else · silence = nothing · retry = the server failed on this take (ask once
 *  more: the browser's recogniser takes over) · nojudge = nothing can judge · aborted = the turn was left (JUMP) */
export type SayVerdict = 'ok' | 'miss' | 'silence' | 'retry' | 'nojudge' | 'aborted';

const PA = () => (window as Any).PhonicsAPI as PhonicsAPIType | undefined;
let micRefused = false;

/** phonics-api can judge this turn (key, server up, analyze on) */
export const apiReady = () => !micRefused && !!PA()?.usable();

/** "pan cake" / "see shell" for seashell: exact sound-alikes of a part only (what a recogniser writes for the same sound) */
const SOUND_ALIKE: Record<string, string[]> = {
  sea: ['see'], sun: ['son'], week: ['weak'], mail: ['male'], eye: ['i', 'aye'], tea: ['tee'], pea: ['pee'],
  rain: ['reign', 'rein'], flower: ['flour'], shoe: ['shoo'], board: ['bored'], bell: ['belle'],
};
const forms = (w: string) => [w, ...(SOUND_ALIKE[w] ?? [])];

/** strict text check: the whole compound in one of the transcripts */
export function saidCompound(texts: string[], p: Pair) {
  return texts.some(t => {
    const tok = t.toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ');
    for (let i = 0; i < tok.length; i++) {
      if (tok[i] === p.result || tok[i] === `${p.result}s`) return true;
      if (i + 1 < tok.length && forms(p.word1).includes(tok[i]) && (forms(p.word2).includes(tok[i + 1]) || tok[i + 1] === `${p.word2}s`)) return true;
    }
    return false;
  });
}

/** the last try, for ?log / tests */
export const sayLog: { by: string; verdict: SayVerdict; heard?: string; d?: Record<string, number>; ms?: number }[] = [];
const note = (e: (typeof sayLog)[number]) => {
  sayLog.push(e); if (sayLog.length > 40) sayLog.shift();
  if ((window as Any).__wmLog) console.log('[say]', JSON.stringify(e));
  return e.verdict;
};

/** One take judged by phonics-api. `listening(on)` shows the ear while the microphone is open. */
export async function hearByApi(p: Pair, o: { waitMs: number; aborted: () => boolean; listening: (on: boolean) => void }): Promise<SayVerdict> {
  const api = PA()!;
  o.listening(true);
  const take = await recordTake({ waitMs: o.waitMs, capMs: o.waitMs + 6500, stop: o.aborted });
  o.listening(false);
  if (o.aborted()) return 'aborted';
  if (take.kind === 'nomic') { micRefused = true; return note({ by: 'mic', verdict: 'nojudge' }); }
  if (take.kind === 'silence') return note({ by: 'phonics-api', verdict: 'silence' });
  const call = api.analyze(api.encodeWav(await api.to16k(take.pcm, take.sr), 16000), p.result);
  // JUMP while the server works: the turn ends at once (the answer is dropped)
  const gone = new Promise<null>(res => { const k = setInterval(() => { if (o.aborted()) { clearInterval(k); res(null); } }, 50); void call.finally(() => clearInterval(k)); });
  const r = await Promise.race([call, gone]);
  if (!r || o.aborted()) return 'aborted';
  if (!r.ok || !r.data) return note({ by: `phonics-api ${r.reason ?? 'failed'}`, verdict: 'retry', ms: r.ms });
  const table: Record<string, string[]> = { ...PHONEMES };
  if (!table[p.result]?.length && r.data.expected_phonemes?.length) table[p.result] = r.data.expected_phonemes;   // a card added without a rebuild
  const j = api.judge(r.data, p.result, [p.word1, p.word2], table);
  let verdict: SayVerdict = j.verdict === 'ok' ? 'ok' : j.verdict === 'silence' ? 'silence' : 'miss', by = 'phonics-api';
  if (verdict === 'miss' && wholeHeard(api, r.data, p, table)) { verdict = 'ok'; by = 'phonics-api (both parts)'; }
  return note({ by, verdict, heard: j.heard, d: j.d, ms: r.ms });
}

/** The kit's judge takes "f uh t b aa" (football with a soft end l) for the part "foot" said alone: sounds after a word
 *  cost little there (around a single word they are usually noise). In a compound they are its second part, so a second
 *  look: the whole word within the kit's limit per sound, at most one extra sound, and it fits clearly better (0.6+)
 *  than either part with every other sound counted as extra. Measured on 494 recordings (phonics-api TTS voices + Glee's
 *  clips, analyze): child voices 80 -> 90 % passed; a part alone (0/172), "pan and cake" (39.5 %, unchanged), non-words
 *  (0/344) as before. */
function wholeHeard(api: PhonicsAPIType, data: PhonicsAnalyze, p: Pair, table: Record<string, string[]>) {
  const A = api as Any, h = api.norm(data.detected_phonemes), exp = api.norm(table[p.result] ?? []);
  if (!h.length || !exp.length || (data.confidence != null && data.confidence < (A.minConf ?? 0.4))) return false;
  const dt = api.distance(h, exp);
  if (dt / exp.length > (A.okMax ?? 0.5) || h.length > exp.length + 1) return false;
  return [p.word1, p.word2].every(w => alone(api, h, api.norm(table[w] ?? [])) - dt >= 0.6);
}
/** edit distance of the whole take against one part (each sound it lacks or adds costs 1; a swapped sound costs what
 *  the kit's distance gives two single sounds: near sounds 0.4) */
const pairCost = new Map<string, number>();
function alone(api: PhonicsAPIType, h: string[], e: string[]) {
  if (!e.length) return Infinity;
  const sub = (a: string, b: string) => {
    if (a === b) return 0;
    const k = `${a} ${b}`;
    let c = pairCost.get(k);
    if (c == null) { c = api.distance([a], [b]); pairCost.set(k, c); }
    return c;
  };
  let prev = Array.from({ length: e.length + 1 }, (_, j) => j);
  for (let i = 1; i <= h.length; i++) {
    const cur = [i];
    for (let j = 1; j <= e.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub(h[i - 1], e[j - 1]));
    prev = cur;
  }
  return prev[e.length];
}

/** A browser-recogniser result (texts, or null = nothing heard; `failed` = it could not run) judged strictly. */
export function judgeText(p: Pair, texts: string[] | null, failed: boolean): SayVerdict {
  if (failed) return note({ by: 'browser', verdict: 'nojudge' });
  if (!texts || !texts.some(t => t.trim())) return note({ by: 'browser', verdict: 'silence' });
  return note({ by: 'browser', verdict: saidCompound(texts, p) ? 'ok' : 'miss', heard: texts.join(' | ') });
}
