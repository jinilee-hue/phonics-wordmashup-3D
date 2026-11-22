// The phonics games' shared progress record (phonics-kit phonics-progress.js, launcher F1, user 2026-11-22): when a game
// ends (the Compound Book after round 6) one line goes into localStorage 'phonics.progress' under 'word-mashup' - the
// words made, the words said in Glee's say-it turns, the stars / coins / gems, the time and the wrong pairs. Records only:
// no level select (user: "기록 저장만"). Hooked on GameScene's prototype, so the 2D game records too (no say-it turns there).
import './vendor/phonics-progress.js';
import { GameScene } from './scenes/GameScene';

/** this game's counts (index.ts adds the say-it turns) */
export const run = { t0: 0, misses: 0, said: 0, sayTurns: 0 };

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const P = GameScene.prototype as Any;
const create = P.create, wrong = P.onWrongMatch, finale = P.showFinale;
P.create = function (this: Any, ...a: Any[]) {
  Object.assign(run, { t0: performance.now(), misses: 0, said: 0, sayTurns: 0 });
  return create.apply(this, a);
};
P.onWrongMatch = function (this: Any, ...a: Any[]) {
  run.misses++;
  return wrong.apply(this, a);
};
P.showFinale = function (this: Any, ...a: Any[]) {
  try {
    window.PhonicsProgress?.played('word-mashup', {
      words: Math.min(this.queue?.length ?? 0, this.roundIndex ?? 0),
      said: run.said, sayTurns: run.sayTurns,
      score: this.score, coins: this.coins, gems: this.gems,
      time: Math.round((performance.now() - run.t0) / 100) / 10,
      misses: run.misses, won: true,
    }, { higher: ['said', 'gems'] });
  } catch (err) { console.warn('[progress]', err); }
  return finale.apply(this, a);
};
