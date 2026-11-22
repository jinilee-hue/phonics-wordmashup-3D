// Glee leads the game and talks with the child (user request: "튜터가 게임을 이끌어가게 해줘. 아이와 실시간
// 대화하면서 하는거 처럼"). Agreed with the user: short English lines, voice only (no speech bubbles; an ear icon
// shows while she listens), and she listens through phonics-api, else the on-device recogniser (apiSR.ts; never the
// browser's own, which sends the voice to Google) - the microphone opens by itself when she asks something. No AI chat:
// fixed lines and fixed answers.
//
// One speaker at a time: she never listens while she talks, and the child's actions cut her short
// (grab a card -> she stops and reads that card). Priorities: 0 poke/spin < 1 round intro, idle help
// < 2 reading a card, wrong answer, hint < 3 the match and its follow-up.
//
// Flow per round: "Which two go together?" -> listen (say the word -> she puts the cards in; one word -> "What
// goes with pan?") ... grab -> reads the card; first card in the zone -> "What goes with pan?" -> listen;
// match -> "Pan and cake make... pancake!" -> "Say it with me! Pancake!" -> listen (missed: "Listen! Pan! Cake!
// Pancake! Your turn!" once more) -> praise -> "Ready? Let's go!" - and only then the next round starts (she holds
// GameScene's 2.4 s timer). Quiet for 15 s -> she points at a card; 28 s -> the hint.
// Wrong answers are guided by voice, never by text (user: "틀렸을때도 튜터가 가이드 해줘야지 ... 텍스트로 나오는게
// 아니라"): she names the two cards ("Sun! Cake! That's not a word!"); if one was right she puts it back ("Pan is
// right!") and asks for its partner, pointing at the other column; otherwise 1st miss "Let's try again!", 2nd she
// shows and places the first card and asks for the partner, 3rd the hint. Spoken misses go the same way, and the
// game's Mic button feedback (Korean toasts) becomes her voice too.
//
// The say-it turn after a match follows the phonics games' common rule (phonics-kit README, user 2026-11-22): a JUMP
// button on the result card skips it; two wrong tries end it ("Good try!"); quiet -> she reads it again and waits once
// more (about 20 s in all; on the first quiet turn of a game she shows the JUMP button); nothing can judge -> no turn.
// Only a said word earns its reward (stars, coins, gems, its Compound Book card: index.ts holds them until then).
import type { Glee } from './glee';
import { GLEE_VOICE, type VoiceLine } from './gleeVoice';
import type { JumpButton } from './jump';
import { lang } from './lang';
import { canHear, hearText } from './apiSR';
import { apiReady, canJudge, hearSay, type SayVerdict } from './sayJudge';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Pt = { x: number; y: number };
type Pair = { word1: string; word2: string; result: string };
type Job = { prio: number; cancelled: boolean; name: string };
export type TraceEv = { t: number; ev: string; id?: string; prio?: number };

/** What index.ts lends the tutor (it owns the scene hooks). */
export type TutorHooks = {
  /** cards: one glow on a single card (3D hint) */
  glow: (card: Any) => void;
  /** GameScene's full hint (3D version) */
  showHint: () => void;
  /** the game's BGM element (ducked while Glee talks or listens) */
  bgm: () => HTMLAudioElement | null;
  /** the say-it turn of `round` ended: ok = the child said the word (its reward is paid), else no reward */
  said: (round: number, ok: boolean, why: SayEnd) => void;
  /** the JUMP button (shown during the say-it turn) */
  jump: JumpButton | null;
};
/** how a say-it turn ended */
export type SayEnd = 'ok' | 'jump' | 'tries' | 'quiet' | 'nojudge' | 'cut';

const SPEAK = { bgm: 0.16, listen: 0.05 };
const IDLE_POINT = 15, IDLE_HINT = 28;
const HOLD_MAX = 14;
/** while the say-it turn runs the result card waits for it (a silent turn is about 20 s); this only stops a hang */
const HOLD_SAY_MAX = 60;

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z]+/g, ' ').trim()} `;
function lev(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}
/** the word (or its plural) as a whole word in any of the transcripts */
export const heardWord = (texts: string[], w: string) => texts.some(t => { const n = norm(t); return n.includes(` ${w} `) || n.includes(` ${w}s `); });
/** the compound: as one word, as its two parts, or close enough (children's speech, recogniser slips) */
export function heardCompound(texts: string[], p: Pair) {
  const L = p.result.length, tol = L >= 8 ? 2 : 1;
  return texts.some(t => {
    const n = norm(t), flat = n.replace(/ /g, '');
    if (flat.includes(p.result) || (n.includes(` ${p.word1}`) && n.includes(`${p.word2} `) && n.indexOf(p.word1) < n.lastIndexOf(p.word2))) return true;
    for (let i = 0; i + L - 1 <= flat.length; i++) {
      for (const len of [L - 1, L, L + 1]) if (len > 0 && i + len <= flat.length && lev(flat.slice(i, i + len), p.result) <= tol) return true;
    }
    return false;
  });
}

/** Glee's line in the language picked on the title (gl/lang.ts): the Korean take when there is one, else English (a
 *  card word alone - 'Pan!', 'Pancake!' - has no Korean take) */
function clip(id: string): { line: VoiceLine; url: string; key: string } | null {
  const ko = lang.get() === 'ko' ? GLEE_VOICE.lines_ko[id] : undefined;
  if (ko) return { line: ko, url: `./gl/voice/ko/${id}.mp3`, key: `ko/${id}` };
  const en = GLEE_VOICE.lines[id];
  return en ? { line: en, url: `./gl/voice/${id}.mp3`, key: id } : null;
}
const lineOf = (id: string) => clip(id)?.line;

/** Clips: fetched and decoded once, played through Web Audio with the baked trim and gain. */
class Voice {
  private ctx: AudioContext | null = null;
  private bufs = new Map<string, Promise<AudioBuffer | null>>();
  private src: AudioBufferSourceNode | null = null;
  private now: { line: VoiceLine; t0: number } | null = null;

  context() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as Any).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  load(id: string) {
    const c = clip(id);
    if (!c) return Promise.resolve(null);
    let p = this.bufs.get(c.key);
    if (!p) {
      // ?v=<voice>: a new voice gets new URLs, so no browser plays a cached clip of the old one (Pages caches 10 min)
      p = fetch(`${c.url}?v=${GLEE_VOICE.voice}`)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${c.key}: ${r.status}`))))
        .then(b => this.context()!.decodeAudioData(b))
        .catch(err => { console.warn('[tutor] voice', err); return null; });
      this.bufs.set(c.key, p);
    }
    return p;
  }

  /** Resolves true when the line has played to the end, false if it was cut or could not play. */
  async play(id: string, cut: () => boolean) {
    const line = lineOf(id);
    if (!line) { console.warn('[tutor] no line', id); return false; }
    const buf = await this.load(id);
    const ctx = this.context();
    if (!buf || !ctx || cut()) return false;
    if (ctx.state !== 'running') return false;
    this.stop();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = line.gain;
    src.connect(g).connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    src.start(t0, line.start);
    this.src = src;
    this.now = { line, t0 };
    return new Promise<boolean>(res => {
      const end = () => { if (this.src === src) { this.src = null; this.now = null; } res(!cut()); };
      src.onended = end;
      // a cut stops the source: onended fires; the guard covers a context that never ends it
      setTimeout(() => { if (this.src === src) { try { src.stop(); } catch { /* ended */ } } }, (line.dur + 0.6) * 1000);
    });
  }

  stop() {
    const s = this.src;
    this.src = null; this.now = null;
    if (s) { try { s.stop(); } catch { /* ended */ } }
  }

  get speaking() { return !!this.now; }

  /** 0..1 mouth opening for the current line (null when silent) */
  mouth() {
    if (!this.now || !this.ctx) return null;
    const t = this.ctx.currentTime - this.now.t0;
    if (t < 0) return 0;
    const m = this.now.line.mouth, k = Math.floor((t * 1000) / GLEE_VOICE.mouthMs);
    if (k >= m.length) return 0;
    const a = +m[k] / 9, b = k + 1 < m.length ? +m[k + 1] / 9 : 0, f = (t * 1000) / GLEE_VOICE.mouthMs - k;
    return a + (b - a) * f;
  }

  /** time (s) of the n-th spoken word that matches `w`, from the start of the line */
  wordAt(id: string, w: string, from = 0) {
    const words = lineOf(id)?.words ?? [];
    const hit = words.slice(from).find(x => x[0].toLowerCase() === w.toLowerCase());
    return hit ? hit[1] : null;
  }
}

/** Glee's ears: one utterance from the microphone as text (apiSR.hearText: phonics-api, else the on-device recogniser),
 *  one at a time. Only when something can read it right now: while the on-device model still loads she does not
 *  listen, and the child answers with the cards (as when nothing is heard). */
class Ears {
  private done: (() => void) | null = null;
  get available() { return canHear(); }
  get on() { return !!this.done; }

  /** Listen for up to `ms` (no voice by then = nothing heard); stop() ends it at once with nothing. */
  async listen(ms: number): Promise<string[] | null> {
    this.stop();
    let stopped = false;
    const me = () => { stopped = true; };
    this.done = me;
    const text = await hearText({ waitMs: ms, capMs: ms + 3000, stop: () => stopped || this.done !== me });
    if (this.done === me) this.done = null;
    return stopped || !text ? null : [text];
  }

  stop() {
    const d = this.done;
    this.done = null;
    d?.();
  }
}

export class Tutor {
  private voice = new Voice();
  private ears = new Ears();
  private scene: Any = null;
  private job: Job | null = null;
  private rot: Record<string, number> = {};
  private idle = 0;
  private idleStage = 0;
  private wrongs = 0;
  private lastRead = { w: '', t: -1e9 };
  private greeted = false;
  /** the JUMP button's guide was shown in this game */
  private jumpTold = false;
  private readyRound = -1;
  private hold: (() => void) | null = null;
  private holdAt = 0;
  private holdWaiters: (() => void)[] = [];
  private placing = false;
  private bgmK = 1;
  private bgmBase: number | null = null;
  trace: TraceEv[] = [];
  enabled = true;

  constructor(private glee: Glee, private hooks: TutorHooks) {
    // decode the lines every round uses ahead of time
    for (const id of Object.keys(GLEE_VOICE.lines)) if (!/^(w|wg|mk|say|r|hint)_/.test(id)) void this.voice.load(id);
  }

  private log(ev: string, id?: string) {
    this.trace.push({ t: performance.now(), ev, id, prio: this.job?.prio });
    if (this.trace.length > 400) this.trace.splice(0, 100);
  }

  /** a new scene (first start or Replay) */
  attach(scene: Any) {
    this.cancel();
    this.releaseHold();
    this.scene = scene;
    this.readyRound = -1;
    this.idle = 0; this.idleStage = 0; this.wrongs = 0;
    this.placing = false;
    this.jumpTold = false;
    this.hooks.jump?.hide();
  }

  // ── jobs: one at a time; a more (or equally) important one cuts the current one ──
  private run(prio: number, name: string, fn: (j: Job) => Promise<void>) {
    if (!this.enabled || !this.scene) return false;
    if (this.job && this.job.prio > prio) return false;
    this.cancel();
    const j: Job = { prio, cancelled: false, name };
    this.job = j;
    this.log('job', name);
    fn(j).catch(err => console.warn('[tutor]', err)).finally(() => {
      if (this.job === j) { this.job = null; this.glee.mode = null; this.idle = 0; }
    });
    return true;
  }

  private cancel() {
    const j = this.job;
    if (!j) return;
    j.cancelled = true;
    this.job = null;
    this.voice.stop();
    this.ears.stop();
    this.glee.mode = null;
    this.log('cut', j.name);
  }

  /** Say the lines in order; false if cut. `at(id)` runs when a line starts. */
  private async say(j: Job, ids: string[], at?: (id: string) => void) {
    for (const id of ids) {
      if (j.cancelled) return false;
      void this.voice.load(id);
    }
    for (const id of ids) {
      if (j.cancelled) return false;
      this.log('say', id);
      at?.(id);
      const ok = await this.voice.play(id, () => j.cancelled);
      if (!ok || j.cancelled) return false;
      await this.wait(j, 0.12);
    }
    return !j.cancelled;
  }

  private wait(j: Job, s: number) {
    return new Promise<boolean>(res => setTimeout(() => res(!j.cancelled), s * 1000));
  }

  /** Open the microphone (ear icon, hand at the ear) for one answer (no voice within `ms` = nothing). */
  private async listen(j: Job, ms: number) {
    if (j.cancelled || !this.ears.available || this.scene?.micRecognition) return null;
    this.glee.mode = 'listen';
    this.log('listen');
    const h = await this.ears.listen(ms);
    if (this.job === j) this.glee.mode = null;
    this.log('heard', h ? h.join(' | ') : '-');
    return j.cancelled ? null : h;
  }

  stopListening() { if (this.ears.on) this.cancel(); }

  /** the game's Mic button starts its own recogniser: stop talking so it does not hear her */
  quiet() { if (!this.scene?.busy) this.cancel(); }

  /** GameScene.showToast from its Mic: say it instead of showing the text (true = handled) */
  toast(msg: string) {
    const pair = this.pair();
    if (!this.enabled || !pair || !this.scene) return false;
    const m = msg.match(/^"(\w+)" /);
    if (m && (m[1] === pair.word1 || m[1] === pair.word2)) {
      const w = m[1], side: 'L' | 'R' = w === pair.word1 ? 'L' : 'R', c = this.card(w, side);
      this.run(2, 'mic-part', async j => {
        if (!await this.say(j, [`w_${w}`], () => { if (c && !c.inZone) this.placeOne(c, side); })) return;
        await this.askPartner(j, pair, w, side === 'L' ? 'R' : 'L');
      });
      return true;
    }
    if (msg.startsWith('Try saying')) {
      this.run(2, 'mic-miss', async j => { await this.guideMiss(j, pair); });
      return true;
    }
    return false;
  }

  private pick(key: string, ids: string[]) {
    const k = this.rot[key] ?? 0;
    this.rot[key] = k + 1;
    return ids[k % ids.length];
  }

  // ── scene reading ──
  private pair(): Pair | null { const s = this.scene; return s?.queue?.[s.roundIndex] ?? null; }
  private cards(side: 'L' | 'R'): Any[] { const s = this.scene; return ((side === 'L' ? s?.leftCards : s?.rightCards) ?? []).filter((c: Any) => c?.active); }
  private card(w: string, side: 'L' | 'R') { return this.cards(side).find(c => c.word === w) ?? null; }
  private column(side: 'L' | 'R'): Pt | null {
    const cs = this.cards(side).filter(c => !c.inZone);
    if (!cs.length) return null;
    return { x: cs.reduce((a, c) => a + c.x, 0) / cs.length, y: cs.reduce((a, c) => a + c.y, 0) / cs.length };
  }

  /** Put both answer cards in the zone, as GameScene's own Mic does when it hears both words. */
  private place(pair: Pair) {
    const s = this.scene, L = this.card(pair.word1, 'L'), R = this.card(pair.word2, 'R');
    if (!s || !L || !R || s.busy || s.dragCard) return;
    this.placing = true;
    try {
      if (s.selectedLeft && s.selectedLeft !== L) s.selectedLeft.shakeBack();
      if (s.selectedRight && s.selectedRight !== R) s.selectedRight.shakeBack();
      s.selectedLeft = L; s.selectedRight = R;
      if (!L.inZone) L.snapToZone(s.cx - s.snapOff, s.cy);
      if (!R.inZone) R.snapToZone(s.cx + s.snapOff, s.cy);
      s.time.delayedCall(400, () => s.checkMatch());
    } finally { this.placing = false; }
  }

  /** Put one card in the zone next to the one already there (the child said its word). */
  private placeOne(card: Any, side: 'L' | 'R') {
    const s = this.scene;
    if (!s || !card?.active || s.busy || s.dragCard) return;
    this.placing = true;
    try {
      const key = side === 'L' ? 'selectedLeft' : 'selectedRight';
      if (s[key] && s[key] !== card) s[key].shakeBack();
      s[key] = card;
      card.snapToZone(s.cx + (side === 'L' ? -s.snapOff : s.snapOff), s.cy);
      if (s.selectedLeft?.inZone && s.selectedRight?.inZone) s.time.delayedCall(400, () => s.checkMatch());
    } finally { this.placing = false; }
  }

  // ── the round ──
  private roundReady(r: number) {
    const pair = this.pair();
    if (!pair) return;
    this.wrongs = 0; this.idle = 0; this.idleStage = 0;
    this.run(1, `round${r}`, async j => {
      if (r === 0 && !this.greeted) {
        this.greeted = true;
        if (!await this.say(j, ['hi'], () => this.glee.wave(1.4))) return;
        if (!await this.say(j, ['intro'])) return;
        const L = this.column('L'), R = this.column('R');
        if (!await this.say(j, ['how1'], () => { if (L) this.glee.pointAt([L], lineOf('how1')!.dur + 0.2); })) return;
        if (!await this.say(j, ['how2'], () => { if (R) this.glee.pointAt([R], lineOf('how2')!.dur + 0.2); })) return;
        if (!await this.say(j, ['ask1', 'tell'], () => { this.glee.mode = 'ask'; })) return;
      } else {
        const lead = r === 0 ? ['again'] : r <= 3 ? [this.pick('new', ['new1', 'new2', 'new3'])] : [];
        if (!await this.say(j, [...lead, this.pick('ask', ['ask2', 'ask3', 'ask1'])], id => { if (id.startsWith('ask')) this.glee.mode = 'ask'; })) return;
      }
      await this.converse(j, pair, 6500);
    });
  }

  /** Listen for the answer: the whole word -> she puts the cards in; a card's word -> she puts that card in and
   *  asks for its partner; something else -> "Hmm, not quite!" and help */
  private async converse(j: Job, pair: Pair, ms: number) {
    const board = (side: 'L' | 'R') => this.cards(side).filter(c => !c.inZone).map(c => c.word as string);
    const h = await this.listen(j, ms);
    if (!h || j.cancelled || this.scene?.busy) return;                  // silence: the child is playing with the cards
    if (heardCompound(h, pair)) {
      if (!await this.say(j, ['yes', `r_${pair.result}`], id => { if (id === 'yes') this.glee.react('snap'); })) return;
      this.place(pair);
      return;
    }
    const lw = board('L').find(w => heardWord(h, w)), rw = board('R').find(w => heardWord(h, w));
    const w = lw ?? rw;
    if (!w) { await this.guideMiss(j, pair); return; }
    const side: 'L' | 'R' = lw ? 'L' : 'R';
    const c = this.card(w, side);
    const right = w === (side === 'L' ? pair.word1 : pair.word2);
    if (!await this.say(j, right ? [`w_${w}`] : [`w_${w}`, 'tryit'], () => { if (c) this.placeOne(c, side); })) return;
    await this.askPartner(j, pair, w, side === 'L' ? 'R' : 'L');
  }

  /** "What goes with pan?" pointing at the other column, then listen: the partner (or any card there) goes in */
  private async askPartner(j: Job, pair: Pair, w: string, side: 'L' | 'R') {
    const col = this.column(side);
    if (!await this.say(j, [`wg_${w}`], () => { this.glee.mode = 'ask'; if (col) this.glee.pointAt([col], lineOf(`wg_${w}`)!.dur + 0.4); })) return;
    const partner = side === 'R' ? pair.word2 : pair.word1;
    const words = this.cards(side).filter(c => !c.inZone).map(c => c.word as string);
    const h = await this.listen(j, 5000);
    if (!h || j.cancelled || this.scene?.busy) return;
    const target = heardCompound(h, pair) ? partner : words.find(x => heardWord(h, x));
    if (!target) { await this.guideMiss(j, pair); return; }
    const c = this.card(target, side);
    if (!c) return;
    if (!await this.say(j, target === partner ? ['yes'] : [`w_${target}`, 'tryit'])) return;
    this.placeOne(c, side);
  }

  /** she heard something that is not on the cards: "Hmm, not quite!" + help that grows with each miss */
  private async guideMiss(j: Job, pair: Pair) {
    this.wrongs++;
    if (!await this.say(j, ['notquite'])) return;
    if (this.wrongs < 2) {
      const L = this.column('L'), R = this.column('R');
      const dur = lineOf('lookcards')!.dur;
      await this.say(j, ['lookcards'], () => { if (L && R) this.glee.pointAt([L, R], dur + 0.6, 0.5); });
      return;
    }
    if (this.wrongs === 2) { await this.pointHelp(j, pair, true); return; }
    this.hooks.showHint();
  }

  /** the child picked up a card: she reads it (phonics) */
  onGrab(card: Any) {
    this.idle = 0; this.idleStage = 0;
    const w = card?.word as string;
    if (!w) return;
    const now = performance.now() / 1000;
    if (w === this.lastRead.w && now - this.lastRead.t < 4) { if (this.ears.on) this.cancel(); return; }
    this.lastRead = { w, t: now };
    this.run(2, `read:${w}`, async j => { await this.say(j, [`w_${w}`]); });
  }

  /** a card landed in the zone: first one -> "What goes with pan?" and she listens for the partner */
  onSnap(card: Any) {
    this.idle = 0;
    if (this.placing) return;
    setTimeout(() => this.snapped(card), 0);
  }

  private snapped(card: Any) {
    const s = this.scene, pair = this.pair();
    if (!s || !pair || !card?.active || !card.inZone || s.busy) return;
    const left = s.leftCards?.includes(card), other = left ? s.selectedRight : s.selectedLeft;
    if (other?.inZone) return;                          // both in: the match or the wrong answer will speak
    const w = card.word as string;
    this.run(2, `snap:${w}`, async j => {
      if (!await this.say(j, [`wg_${w}`], () => { this.glee.mode = 'ask'; })) return;
      const side: 'L' | 'R' = left ? 'R' : 'L';
      const words = this.cards(side).filter(c => !c.inZone).map(c => c.word as string);
      const h = await this.listen(j, 5000);
      if (!h || j.cancelled || s.busy) return;
      const target = heardCompound(h, pair) ? (left ? pair.word2 : pair.word1) : words.find(x => heardWord(h, x));
      const c = target ? this.card(target, side) : null;
      if (!c) return;
      if (target === (left ? pair.word2 : pair.word1)) await this.say(j, ['yes']);
      if (!j.cancelled) this.placeOne(c, side);
    });
  }

  /** a wrong pair (called before GameScene shakes the two cards back) */
  onWrong() {
    this.idle = 0;
    this.wrongs++;
    const s = this.scene, pair = this.pair();
    const L = s?.selectedLeft, R = s?.selectedRight;
    this.run(2, 'wrong', async j => {
      if (!pair || !L || !R) { await this.say(j, [this.pick('no', ['no1', 'no2', 'no3'])]); return; }
      // the child hears what was tried: "Sun! Cake! That's not a word!"
      if (!await this.say(j, [`w_${L.word}`, `w_${R.word}`, 'nw'])) return;
      const lOk = L.word === pair.word1, rOk = R.word === pair.word2;
      if (lOk || rOk) {
        const good = lOk ? L : R, side: 'L' | 'R' = lOk ? 'L' : 'R';
        if (!await this.backHome(j, good)) return;
        // "Pan is right!" - back into the zone it goes; then "What goes with pan?"
        if (!await this.say(j, [`ok_${good.word}`], () => this.placeOne(good, side))) return;
        await this.askPartner(j, pair, good.word, side === 'L' ? 'R' : 'L');
        return;
      }
      if (this.wrongs < 2) { await this.say(j, ['tryagain']); return; }
      if (this.wrongs === 2) { await this.pointHelp(j, pair, true); return; }
      this.hooks.showHint();
    });
  }

  /** wait until GameScene's shake-back has put the card on its slot again (about 1 s) */
  private async backHome(j: Job, card: Any) {
    for (let k = 0; k < 30; k++) {
      if (j.cancelled || !card?.active) return false;
      if (!card.inZone && Math.abs(card.x - card.baseX) < 3 && !this.scene?.tweens?.isTweening(card)) return true;
      await this.wait(j, 0.05);
    }
    return !j.cancelled;
  }

  /** "Need help? Look at this one!" - points at (and lights) the first answer card and reads it;
   *  with `lead`, she also puts it in the zone and asks for its partner */
  private async pointHelp(j: Job, pair: Pair, lead = false) {
    const c = this.card(pair.word1, 'L');
    if (!c || c.inZone) return;
    const line = lineOf('help1')!, look = this.voice.wordAt('help1', 'look') ?? line.dur * 0.5;
    if (!await this.say(j, ['help1'], () => setTimeout(() => {
      if (j.cancelled || !c.active) return;
      this.hooks.glow(c);
      this.glee.pointAt([{ x: c.x, y: c.y }], line.dur - look + 1.6);
    }, look * 1000))) return;
    if (!await this.say(j, [`w_${pair.word1}`], () => { if (lead) this.placeOne(c, 'L'); })) return;
    if (lead) await this.askPartner(j, pair, pair.word1, 'R');
  }

  /** The hint (button or idle): she points at the two cards as she names them. */
  hint(targets: Pt[]) {
    this.idle = 0;
    const pair = this.pair();
    if (!pair) return false;
    const id = `hint_${pair.result}`, line = lineOf(id);
    if (!line) return false;
    return this.run(2, 'hint', async j => {
      const t2 = this.voice.wordAt(id, line.words.length ? line.words[line.words.length - 1][0] : '') ?? line.dur * 0.6;
      await this.say(j, [id], () => this.glee.pointAt(targets, line.dur + 0.5, Math.min(0.9, (t2 - 0.1) / (line.dur + 0.5))));
    });
  }

  /** the pair collided: name the new word as it appears, then the child's say-it turn. Its end is reported once
   *  (hooks.said): only 'ok' pays the word's reward. */
  onMatch() {
    const pair = this.pair();
    this.wrongs = 0; this.idle = 0;
    if (!pair) return;
    const round = this.scene?.roundIndex ?? 0;
    let ended = false;
    const end = (why: SayEnd) => {
      if (ended) return;
      ended = true;
      this.log('said', why);
      this.hooks.said(round, why === 'ok', why);
    };
    const started = this.run(3, 'match', async j => {
      try {
        if (!await this.say(j, [`mk_${pair.result}`])) return;
        await this.untilHold(j, 8);                 // the result card is up (a slow device takes longer)
        if (j.cancelled) return;
        const why = await this.sayTurn(j, pair);
        if (j.cancelled) return;
        end(why);
        if (why === 'ok') {
          this.glee.react('cheer');
          if (!await this.say(j, [this.pick('praise', ['praise1', 'praise2', 'praise3', 'praise4'])])) return;
        } else if (why === 'nojudge') {
          if (!await this.wait(j, 1)) return;       // nothing to judge with: no turn, a moment with the new word
        }
        // JUMP: on at once, as Match's board comes back at once
        const last = this.scene && this.scene.roundIndex >= (this.scene.queue?.length ?? 6) - 1;
        if (why !== 'jump' && !last && !await this.say(j, [this.pick('go', ['go1', 'go2', 'go3'])])) return;
        this.releaseHold();
      } finally { end('cut'); }
    });
    if (!started) end('cut');
  }

  /** "Say it with me! Pancake!" -> listen. Ends 'ok' (said), 'jump' (the JUMP button), 'tries' (two wrong tries: "Good
   *  try!"), 'quiet' (silent twice: she read it again in between - about 20 s in all), 'nojudge' (nothing can judge:
   *  the turn is skipped) or 'cut'. Phonics Match's sayItTurn is the model. */
  private async sayTurn(j: Job, pair: Pair): Promise<SayEnd> {
    if (!canJudge()) return 'nojudge';
    let jumped = false;
    // the turn's own job: JUMP ends the line or the listening at once, the match job goes on (go line, release)
    const t: Job = { prio: j.prio, name: 'sayturn', get cancelled() { return j.cancelled || jumped; }, set cancelled(_v: boolean) { /* via j / jumped */ } };
    const jb = this.hooks.jump;
    if (jb) {
      jb.onJump = () => { if (jumped) return; jumped = true; this.log('jump'); this.voice.stop(); this.ears.stop(); };
      jb.show();
    }
    let misses = 0, quiet = 0;
    let prompt = [`say_${pair.result}`];
    try {
      for (let k = 0; k < 8; k++) {
        await this.say(t, prompt, id => { if (id.startsWith('say_') || id === 'yourturn') this.glee.mode = 'ask'; });
        if (t.cancelled) break;                     // (a line that could not play still gets its listen)
        const v = await this.hear(t, pair, quiet ? 7500 : 6000);
        if (t.cancelled) break;
        if (v === 'ok') return 'ok';
        if (v === 'nojudge') return 'nojudge';
        if (v === 'miss') {
          if (++misses >= 2) { await this.say(t, ['nice2', `r_${pair.result}`]); return t.cancelled && jumped ? 'jump' : 'tries'; }   // "Good try! Pancake!"
          // "Listen! Pan! Cake! Pancake! Your turn!"
          prompt = ['listenup', `w_${pair.word1}`, `w_${pair.word2}`, `r_${pair.result}`, 'yourturn'];
        } else {
          // silence: she reads it again and waits once more; quiet again -> on, without the reward
          if (++quiet >= 2) return 'quiet';
          if (!this.jumpTold) { this.jumpTold = true; await this.jumpGuide(t); if (t.cancelled) break; }
          prompt = [`r_${pair.result}`, 'yourturn'];
        }
      }
      return jumped ? 'jump' : j.cancelled ? 'cut' : 'quiet';
    } finally {
      if (jb) { jb.onJump = null; jb.hide(); }
      if (this.job === j) this.glee.mode = null;
    }
  }

  /** one listen of the say-it turn: phonics-api (analyze + judge) when it can, else the on-device recogniser */
  private async hear(t: Job, pair: Pair, ms: number): Promise<SayVerdict> {
    if (t.cancelled) return 'aborted';
    const by = apiReady() ? 'phonics-api' : 'device';
    return hearSay(pair, {
      waitMs: ms, aborted: () => t.cancelled,
      listening: on => { this.glee.mode = on ? 'listen' : null; this.log(on ? 'listen' : 'heard', on ? undefined : by); },
    });
  }

  /** the first quiet turn of a game: Glee points at the JUMP button while the white glove taps it twice and she says
   *  "Want to skip? Tap the jump button!" (her voice is the phonics games' tutor voice since 2026-11-22) */
  private async jumpGuide(t: Job) {
    const jb = this.hooks.jump;
    if (!jb?.shown) return;
    this.log('jumpguide');
    this.glee.mode = null;
    if (jb.at) this.glee.pointAt([jb.at], 2.8);
    await Promise.all([jb.guide(() => t.cancelled), lineOf('jump') ? this.say(t, ['jump']) : Promise.resolve(true)]);
  }

  /** GameScene would clear the result card 2.4 s after the win; Glee lets it go when she has finished. */
  afterWin(fire: () => void) {
    this.hold = fire;
    this.holdAt = performance.now();
    this.log('hold');
    for (const w of this.holdWaiters.splice(0)) w();
    if (!this.job || this.job.name !== 'match') setTimeout(() => { if (this.hold === fire) this.releaseHold(); }, 2400);
  }

  private untilHold(j: Job, maxS: number) {
    if (this.hold) return Promise.resolve();
    return new Promise<void>(res => {
      this.holdWaiters.push(res);
      setTimeout(res, maxS * 1000);
    }).then(() => { void j; });
  }

  releaseHold() {
    const f = this.hold;
    this.hold = null;
    if (f) { this.log('release'); f(); }
  }

  onFinale() {
    this.run(3, 'finale', async j => { await this.say(j, ['end1', 'end2']); });
  }

  /** the game ended early (no hearts left): stop talking and listening, no more help */
  stop() { this.cancel(); }

  onPoke() {
    if (this.job) return;
    this.run(0, 'poke', async j => { await this.say(j, [this.pick('poke', ['poke1', 'poke2', 'poke3'])]); });
  }

  onSpin(turns: number) {
    if (this.job || turns < 0.75) return;
    this.run(0, 'spin', async j => { await this.say(j, [turns >= 2.5 ? 'spin2' : 'spin1']); });
  }

  /** any press on the game: the child is busy, no idle help */
  touched() { this.idle = 0; }

  /** every frame: mouth, BGM duck, the round start, idle help, the hold's safety net */
  update(dt: number, settled: boolean, playable: boolean) {
    const s = this.scene;
    this.glee.talk = this.voice.mouth();
    // BGM: lower while she talks, nearly off while she listens (the recogniser hears the room)
    const bgm = this.hooks.bgm();
    if (bgm) {
      if (this.bgmBase === null) this.bgmBase = bgm.volume;
      const want = this.glee.mode === 'listen' ? SPEAK.listen : this.voice.speaking ? SPEAK.bgm : 1;
      this.bgmK += (want - this.bgmK) * (1 - Math.exp(-dt * 6));
      if (Math.abs(want - this.bgmK) < 0.003) this.bgmK = want;
      bgm.volume = Math.max(0, Math.min(1, this.bgmBase * this.bgmK));
    }
    const holdMax = this.job?.name === 'match' ? HOLD_SAY_MAX : HOLD_MAX;
    if (this.hold && performance.now() - this.holdAt > holdMax * 1000) this.releaseHold();
    if (!s || !this.enabled) return;
    if (!this.job) this.glee.mode = s.micRecognition ? 'listen' : null;   // the game's Mic: her ear shows too
    // the round's intro waits for anything more important to end (it would be refused, and the round left without it)
    if (settled && s.roundIndex !== this.readyRound && !(this.job && this.job.prio > 1) && this.voice.context()?.state === 'running') {
      this.readyRound = s.roundIndex;
      this.roundReady(s.roundIndex);
    }
    // quiet for a while: point at a card, later the full hint
    if (playable && !this.job && !s.dragCard && !s.collectionOpen) {
      this.idle += dt;
      const pair = this.pair();
      if (pair && this.idleStage === 0 && this.idle > IDLE_POINT) {
        this.idleStage = 1;
        this.run(1, 'idle', async j => { await this.pointHelp(j, pair); });
      } else if (this.idleStage === 1 && this.idle > IDLE_HINT - IDLE_POINT) {
        this.idleStage = 2;
        this.hooks.showHint();
      }
    } else if (!playable) {
      this.idle = 0;
    }
  }

  dispose() {
    this.cancel();
    this.hooks.jump?.hide();
    this.releaseHold();
    this.glee.talk = null;
    const bgm = this.hooks.bgm();
    if (bgm && this.bgmBase !== null) bgm.volume = this.bgmBase;
    this.scene = null;
  }
}
