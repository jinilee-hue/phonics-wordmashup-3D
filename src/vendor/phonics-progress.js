/* COPY of ~/Documents/Jini/2026/Phonics/phonics-kit/phonics-progress.js — edit the kit, then copy it here again. */
/* phonics-kit · phonics-progress.js — one shared progress record for every phonics game (2026-11-22, launcher F1).
 * Every game is served from jinilee-hue.github.io, so they share localStorage: one key, 'phonics.progress', holds a
 * record per game — the launcher (and a later teacher view) can read all of them. Games keep their own keys for their
 * own state (Match's save, Puzzle's stickers …); this file is the common summary.
 * Load it as a classic <script> (vanilla games) or `import './phonics-progress.js'` (Vite games); it sets
 * window.PhonicsProgress. COPY it into each game (like phonics-api.js) — edit the kit, then copy again.
 *
 *   PhonicsProgress.played('croco', { level: 3, stars: 2, score: 9, time: 41.2, won: true })
 *        → plays + 1, history (last 20, newest first), best per field (`higher` / `lower` say which way is better)
 *   PhonicsProgress.setLevel('croco', 4)          → level to continue from; maxLevel = the highest reached
 *   PhonicsProgress.get('croco')                  → { plays, firstAt, lastAt, level, maxLevel, best, history }
 *   PhonicsProgress.all()                         → { [gameId]: record }
 * Game ids: eye-catch · magic-block · phonics-match · croco · word-mashup · toy-catch · ring-ding-dong · puzzle
 * Result fields are free-form numbers/booleans; by default score/stars/words/level count higher-is-better and
 * time/misses lower-is-better — pass { higher: [...], lower: [...] } to played() for other fields.
 * Private mode / storage blocked: everything still returns sensible values for this page; nothing throws.
 */
(function () {
  'use strict';
  var KEY = 'phonics.progress', MAX_HISTORY = 20;
  var HIGHER = ['score', 'stars', 'words', 'level', 'cards', 'tokens', 'coins'], LOWER = ['time', 'misses', 'avgTime'];
  var memory = null;   // fallback when localStorage is unavailable

  function read() {
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.games) return s; } catch (e) { /* blocked or broken */ }
    return memory || { v: 1, games: {} };
  }
  function write(s) {
    memory = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode: keep it for this page */ }
  }
  function fresh() { return { plays: 0, firstAt: null, lastAt: null, level: null, maxLevel: null, best: {}, history: [] }; }
  function rec(s, id) {
    var r = s.games[id];
    if (!r) r = s.games[id] = fresh();
    for (var k in fresh()) if (!(k in r)) r[k] = fresh()[k];
    return r;
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  var api = {
    KEY: KEY,
    get: function (id) { var r = read().games[id]; return r ? copy(r) : fresh(); },
    all: function () { return copy(read().games); },
    played: function (id, result, opts) {
      result = result || {}; opts = opts || {};
      var higher = HIGHER.concat(opts.higher || []), lower = LOWER.concat(opts.lower || []);
      var s = read(), r = rec(s, id), now = new Date().toISOString();
      r.plays += 1; r.lastAt = now; if (!r.firstAt) r.firstAt = now;
      var h = { at: now }; for (var k in result) h[k] = result[k];
      r.history.unshift(h); if (r.history.length > MAX_HISTORY) r.history.length = MAX_HISTORY;
      for (var f in result) {
        var v = result[f];
        if (typeof v !== 'number' || !isFinite(v)) continue;
        var b = r.best[f];
        if (higher.indexOf(f) >= 0) { if (b == null || v > b) r.best[f] = v; }
        else if (lower.indexOf(f) >= 0) { if (b == null || v < b) r.best[f] = v; }
      }
      if (typeof result.level === 'number') r.maxLevel = Math.max(r.maxLevel || 0, result.level);
      write(s);
      return copy(r);
    },
    setLevel: function (id, level) {
      var s = read(), r = rec(s, id);
      r.level = level; r.maxLevel = Math.max(r.maxLevel || 0, level); r.lastAt = new Date().toISOString();
      if (!r.firstAt) r.firstAt = r.lastAt;
      write(s);
      return copy(r);
    },
    reset: function (id) { var s = read(); if (id) delete s.games[id]; else s.games = {}; write(s); },
  };
  if (typeof window !== 'undefined') window.PhonicsProgress = api;
  if (typeof globalThis !== 'undefined') globalThis.PhonicsProgress = api;
})();
