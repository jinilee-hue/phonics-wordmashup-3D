// The phonics games' shared progress record (phonics-kit phonics-progress.js, launcher F1, user 2026-11-22): when a game
// ends (the Compound Book after round 6, or earlier when the hearts run out: won false) one line goes into localStorage
// 'phonics.progress' under 'word-mashup' - the words made, the words said in Glee's say-it turns, the stars / coins / gems,
// the time, the wrong pairs, the hearts left and the coins spent on hints (user 2026-11-22: a cost). Records only:
// no level select (user: "기록 저장만"). Hooked on GameScene's prototype, so the 2D game records too (no say-it turns there).
// Gems stay on the device (GameScene 'wm.gems.v1'): the line keeps this game's gems earned, the gems spent on Compound Book
// '?' cards and the cards opened (user 2026-11-22). A card opened on the result screen, after the line, is added to it.
import './vendor/phonics-progress.js';
import { GameScene } from './scenes/GameScene';

/** this game's counts (index.ts adds the say-it turns); `at` = this game's line, once written */
export const run = { t0: 0, misses: 0, said: 0, sayTurns: 0, at: '' };

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const P = GameScene.prototype as Any;
const create = P.create, wrong = P.onWrongMatch, finale = P.showFinale, buyCard = P.buyCard;
P.create = function (this: Any, ...a: Any[]) {
  Object.assign(run, { t0: performance.now(), misses: 0, said: 0, sayTurns: 0, at: '' });
  return create.apply(this, a);
};
P.onWrongMatch = function (this: Any, ...a: Any[]) {
  run.misses++;
  return wrong.apply(this, a);
};
P.showFinale = function (this: Any, ...a: Any[]) {
  try {
    const rec = window.PhonicsProgress?.played('word-mashup', {
      words: Math.min(this.queue?.length ?? 0, this.roundIndex ?? 0),
      said: run.said, sayTurns: run.sayTurns,
      score: this.score, coins: this.coins, gems: this.gems - this.gemsAtStart + this.gemsSpent,
      time: Math.round((performance.now() - run.t0) / 100) / 10,
      misses: run.misses, won: this.hearts > 0,
      hearts: this.hearts, coinsSpent: this.coinsSpent,
      gemsSpent: this.gemsSpent, cardsOpened: this.cardsOpened.length,
    }, { higher: ['said', 'gems', 'hearts'] });
    run.at = rec?.history?.[0]?.at ?? '';
  } catch (err) { console.warn('[progress]', err); }
  return finale.apply(this, a);
};
P.buyCard = function (this: Any, ...a: Any[]) {
  const ok = buyCard.apply(this, a);
  if (ok && run.at) {
    try {
      const key = window.PhonicsProgress?.KEY ?? 'phonics.progress';
      const s = JSON.parse(localStorage.getItem(key) || 'null');
      const line = s?.games?.['word-mashup']?.history?.find((h: Any) => h.at === run.at);
      if (line) {
        Object.assign(line, { gemsSpent: this.gemsSpent, cardsOpened: this.cardsOpened.length });
        localStorage.setItem(key, JSON.stringify(s));
      }
    } catch (err) { console.warn('[progress]', err); }
  }
  return ok;
};
