// Word Mashup 3D layer: boots a three.js stage under the transparent Phaser canvas and mirrors the
// Game scene into it.  Phaser keeps all rules, input, HUD, popups and effects; the backdrop, the six
// word cards and the Gravity Zone are drawn here instead.  Any failure falls back to the 2D game.
import Phaser from 'phaser';
import { WordCard } from '../objects/WordCard';
import { CARD_FACES } from './cardFaces';
import { Cards3D, type LiveCard } from './cards3d';
import { gameAudio } from '../audio';
import { Glee } from './glee';
import { Mashup } from './mashup';
import { Reward, type Gain, type Kind } from './reward';
import { Tutor } from './tutor';
import { GATE_UV, Stage, type Quality } from './stage';
import { ARRIVE_AT, Travel } from './travel';
import { Zone3D } from './zone3d';

type Mode = Quality | '2d';
// v2: v1 remembered '2d' for 7 days after one slow window (a 30 fps Energy-Saver cap was enough),
// so a capable Mac stayed 2D for a week. Old v1 values are ignored on purpose.
const STORE = 'wm3d-quality-v2';
const SESSION_2D = 'wm3d-2d';            // give-up lasts for this tab session only
const REMEMBER_MS = 24 * 3600 * 1000;    // a remembered 'mid'/'low' is re-checked (and can step up)
const ORDER: Mode[] = ['high', 'mid', 'low', '2d'];
const SLOW = 0.042;                      // median frame > 42 ms (< ~24 fps): step down
const TOO_SLOW = 0.06;                   // > 60 ms (< ~17 fps): jump to low; at low: give up
const FAST = 0.02;                       // < 20 ms (> 50 fps) for 3 windows: step back up

/** Pure quality rule (exposed for tests). A steady 30 fps (33 ms) is fine: no change. */
export function decideQuality(mode: Mode, med: number): Mode | null {
  if (med <= SLOW) return null;
  if (mode === 'low') return med > TOO_SLOW ? '2d' : null;
  if (med > TOO_SLOW) return 'low';
  return mode === 'high' ? 'mid' : 'low';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const state = {
  on: false,
  mode: '2d' as Mode,
  forced: false,
  stage: null as Stage | null,
  cards: null as Cards3D | null,
  zone: null as Zone3D | null,
  travel: null as Travel | null,
  /** the tutor character (off with ?glee=off) */
  glee: null as Glee | null,
  /** the card collision (fight cloud, pop, reveal) */
  mashup: null as Mashup | null,
  /** Glee leading the game: voice lines, listening, pacing (off with ?tutor=off) */
  tutor: null as Tutor | null,
  /** stars, coins and gems flying from the result card into the HUD (Phaser layer) */
  reward: null as Reward | null,
  /** while set, GameScene's countUp/bumpBadge are held back for the reward to replay when its icons arrive */
  rewardHold: null as null | { calls: [Any, number, number][] },
  game: null as Phaser.Game | null,
  /** a press that landed on Glee: GameScene must not pick a card with it */
  gleePress: false,
  /** hide Phaser's cards while the camera is in flight (they wait at their slots) */
  travelHide: false,
  scene: null as Any,
  hidden: new Set<Any>(),
  t0: performance.now(),
  last: 0,
  /** tests: a fixed 3D time step (s) for frame-by-frame capture with game.loop asleep + game.step() */
  fixedDt: null as number | null,
  tFixed: 0,
  frames: [] as number[],
  sinceSwitch: 0,
  /** a remembered mid/low may climb back up; any step down in this session stops that */
  canStepUp: false,
  upWindows: 0,
  decide: decideQuality,
};

function pickMode(): { mode: Mode; forced: boolean } {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'high' || q === 'mid' || q === 'low' || q === '2d') return { mode: q, forced: true };
  try {
    if (sessionStorage.getItem(SESSION_2D)) return { mode: '2d', forced: false };
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && saved.until > Date.now() && (saved.mode === 'mid' || saved.mode === 'low')) {
      state.canStepUp = true;
      return { mode: saved.mode, forced: false };
    }
  } catch { /* ignore */ }
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return { mode: '2d', forced: false };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return { mode: '2d', forced: false };
  if (/mali|adreno|powervr|intel\(r\) (hd|uhd) graphics [2-6]\d\d\b/.test(gpu)) return { mode: 'mid', forced: false };
  return { mode: 'high', forced: false };
}

function remember(mode: Mode) {
  try {
    if (mode === 'high') localStorage.removeItem(STORE);
    else localStorage.setItem(STORE, JSON.stringify({ mode, until: Date.now() + REMEMBER_MS }));
  } catch { /* ignore */ }
}

function hide(o: Any) {
  if (!o || state.hidden.has(o)) return;
  o.willRender = () => false;
  state.hidden.add(o);
}

function unhideAll() {
  for (const o of state.hidden) delete o.willRender;
  state.hidden.clear();
}

// Phaser skips a card only once its 3D twin is on screen, so nothing ever blinks out.
const containerWillRender = Phaser.GameObjects.Container.prototype.willRender;
(WordCard.prototype as Any).willRender = function (this: WordCard, cam: Phaser.Cameras.Scene2D.Camera) {
  if (state.on && (state.travelHide || state.cards?.isReady(this))) return false;
  return containerWillRender.call(this, cam);
};

// Glee reacts to the player: grabbing a card, dropping it into the zone.
const cardStartDrag = WordCard.prototype.startDrag;
(WordCard.prototype as Any).startDrag = function (this: WordCard, ...args: Any[]) {
  if (state.on) { state.glee?.react('grab'); state.tutor?.onGrab(this); }
  return (cardStartDrag as Any).apply(this, args);
};
const cardSnap = WordCard.prototype.snapToZone;
(WordCard.prototype as Any).snapToZone = function (this: WordCard, ...args: Any[]) {
  if (state.on) { state.glee?.react('snap'); state.tutor?.onSnap(this); }
  return (cardSnap as Any).apply(this, args);
};

/** Run `before` ahead of a scene method (once per scene instance; restarts reuse the instance). */
function wrapOnce(scene: Any, name: string, before: () => void) {
  const orig = scene[name];
  if (typeof orig !== 'function' || orig.__wm3d) return;
  const wrapped = function (...args: Any[]) {
    try { if (state.on) before(); } catch (err) { console.warn('[wm3d]', err); }
    return orig.apply(scene, args);
  };
  (wrapped as Any).__wm3d = true;
  scene[name] = wrapped;
}

function attach(scene: Any) {
  state.scene = scene;
  for (const o of [...state.hidden]) if (!o.scene) state.hidden.delete(o);
  const stage = state.stage!;
  // backdrop: reuse Phaser's loaded game_bg (one download)
  const bgObj = scene.children.list.find((o: Any) => o.texture?.key === 'game_bg');
  if (bgObj) {
    stage.setBackdrop(scene.textures.get('game_bg').getSourceImage());
    hide(bgObj);
  }
  // Gravity Zone visuals (logic stays in Phaser: cx, cy, zoneR)
  hide(scene.zoneGfx); hide(scene.zoneGlowGfx); hide(scene.zoneSpinContainer);
  for (const t of scene.neonCores ?? []) if (t.active) hide(t);
  state.zone!.place(scene.cx, scene.cy, scene.zoneR, stage.quality);
  state.zone!.reform();                                   // the badge rises out of the floor, as in the intro
  state.cards!.clear();
  state.travel?.cancel();
  state.travelHide = false;
  // between rounds: fly to the next place instead of sliding the new cards in
  const startRound = scene.startRound;
  if (!startRound.__wm3d) {
    const wrapped = function (this: Any) {
      const afterWin = scene.roundIndex > 0;          // create() resets it to 0 before round 1
      startRound.call(scene);
      if (afterWin && state.on && state.travel && !reducedMotion()) beginTravel(scene);   // Glee runs along (travel clock)
    };
    (wrapped as Any).__wm3d = true;
    scene.startRound = wrapped;
  }
  // the 2D hint draws its glow over the cards; redo it with a 3D glow behind them
  scene.showHint = () => showHint3D(scene);
  const impact = scene.playImpact;
  if (!impact.__wm3d) {
    const wrapped = function (this: Any) {
      if (!state.on) return impact.call(scene);
      state.zone?.pulse(); state.glee?.react('cheer');
      return state.mashup ? crash3D(scene) : impact.call(scene);
    };
    (wrapped as Any).__wm3d = true;
    scene.playImpact = wrapped;
  }
  const showResult = scene.showResultCard;
  if (!showResult.__wm3d) {
    const wrapped = function (this: Any, pair: Any) {
      return state.on && state.mashup ? resultGrows(scene, showResult, pair) : showResult.call(scene, pair);
    };
    (wrapped as Any).__wm3d = true;
    scene.showResultCard = wrapped;
  }
  const reveal = scene.playCardReveal;
  if (!reveal.__wm3d) {
    const wrapped = function (this: Any, rx: number, ry: number, w: number, h: number) {
      if (state.on && state.mashup) state.mashup.startReveal(rx, ry, w, h);
      else reveal.call(scene, rx, ry, w, h);
    };
    (wrapped as Any).__wm3d = true;
    scene.playCardReveal = wrapped;
  }
  // the result card leaves 2.4 s after the win (GameScene.onRoundWin): the rays and the rain stop with it.
  // With the tutor, Glee decides when: after "Say it with me!" and "Let's go!" (she holds that timer).
  const roundWin = scene.onRoundWin;
  if (!roundWin.__wm3d) {
    const wrapped = function (this: Any, cont: Any) {
      const time = scene.time, delayed = time.delayedCall;
      time.delayedCall = function (delay: number, cb: Any, args?: Any, scope?: Any) {
        if (delay === 2400 && typeof cb === 'function') {
          const fire = () => { state.mashup?.stopReveal(); cb.apply(scope ?? scene, args ?? []); };
          if (state.on && state.tutor) { state.tutor.afterWin(fire); return null; }
          return delayed.call(time, delay, fire, args, scope);
        }
        return delayed.call(time, delay, cb, args, scope);
      };
      try { return roundWin.call(scene, cont); } finally { delete time.delayedCall; }
    };
    (wrapped as Any).__wm3d = true;
    scene.onRoundWin = wrapped;
  }
  // score reward as in the intro: icons burst from the result card into "+N" chips, then up into the HUD
  // (wraps the wrapper above, so the reveal still stops and Glee still holds the result card)
  wireReward(scene);
  // a press on Glee pokes or spins her; it must not also grab the nearest card (GameScene picks by distance)
  const inp = scene.input;
  for (const fn of [...(inp.listeners('pointerdown') as Any[])]) {
    if (fn.__wm3d) continue;
    inp.off('pointerdown', fn);
    const guarded = (...a: Any[]) => (state.gleePress ? undefined : fn(...a));
    (guarded as Any).__wm3d = true;
    inp.on('pointerdown', guarded);
  }
  wrapOnce(scene, 'startMic', () => state.tutor?.quiet());
  // the Mic's feedback toasts (Korean text) become Glee's voice
  const toast = scene.showToast;
  if (!toast.__wm3d) {
    const wrapped = function (this: Any, msg: string) {
      if (state.on && state.tutor?.toast(msg)) return;
      return toast.call(scene, msg);
    };
    (wrapped as Any).__wm3d = true;
    scene.showToast = wrapped;
  }
  wrapOnce(scene, 'onWrongMatch', () => { state.glee?.react('wrong'); state.tutor?.onWrong(); });
  wrapOnce(scene, 'triggerCollision', () => {
    state.glee?.react('match');
    state.tutor?.onMatch();
    for (const c of [scene.selectedLeft, scene.selectedRight]) if (c?.active) state.cards?.meet(c, scene.cx);
  });
  wrapOnce(scene, 'showFinale', () => { state.glee?.react('finale'); state.tutor?.onFinale(); });
  state.mashup?.clear();
  if (state.glee) {
    state.glee.reset();
    state.glee.reduced = reducedMotion();
    if (!state.tutor) state.glee.react('hello');          // the tutor waves as she says hi
  }
  state.tutor?.attach(scene);
}

function wireReward(scene: Any) {
  state.reward?.stop();
  state.reward = new Reward(scene);
  const countUp = scene.countUp, bump = scene.bumpBadge, win = scene.onRoundWin;
  // a Replay restarts the scene and runs attach() again on the same scene object: wrap only once
  if (win.__wm3dReward) return;
  const cu = function (this: Any, txt: Any, from: number, to: number) {
    if (state.rewardHold) { state.rewardHold.calls.push([txt, from, to]); txt.setText(`${from}`); return; }
    return countUp.call(scene, txt, from, to);
  };
  const bb = function (this: Any, txt: Any) {
    if (state.rewardHold) return;
    return bump.call(scene, txt);
  };
  const rw = function (this: Any, card: Any) {
    if (!state.on || reducedMotion() || !state.reward) return win.call(scene, card);
    const hold = { calls: [] as [Any, number, number][] };
    state.rewardHold = hold;
    try { win.call(scene, card); } catch (err) { state.rewardHold = null; throw err; }
    // GameScene bumps the other two badges 80 / 160 ms later: keep holding past that
    scene.time.delayedCall(220, () => { if (state.rewardHold === hold) state.rewardHold = null; });
    const kinds: [Kind, Any][] = [['score', scene.scoreText], ['coin', scene.coinText], ['gem', scene.gemText]];
    const gains: Gain[] = [];
    for (const [kind, txt] of kinds) {
      const c = hold.calls.find(c => c[0] === txt);
      if (!c) continue;
      const k = parseFloat(String(txt.style?.fontSize ?? '22')) / 22;      // the HUD's sz() scale
      gains.push({
        kind, amount: c[2] - c[1],
        hud: txt.active ? { x: txt.x - 76 * k, y: txt.y, size: 46 * k } : null,
        arrive: () => {
          if (!txt.active || !scene.sys.isActive()) return;
          countUp.call(scene, txt, c[1], c[2]); bump.call(scene, txt);
        },
      });
    }
    try {
      state.reward.play(card, gains, state.glee?.screenBox() ?? null);
    } catch (err) {
      console.warn('[wm3d] reward', err);
      for (const g of gains) g.arrive();
    }
  };
  for (const [name, f] of [['countUp', cu], ['bumpBadge', bb], ['onRoundWin', rw]] as const) {
    // __wm3d too: on every attach the stopReveal/hold wrapper checks it, and must not wrap this one again
    // (it did after a Replay: every win then played the reward twice, the outer play broke the inner one)
    (f as Any).__wm3d = true;
    (f as Any).__wm3dReward = true;
    scene[name] = f;
  }
}

function reducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// The card collision, after the intro video (replaces GameScene.playImpact's flash, 2D rays, poof,
// ring and confetti). Phaser keeps the timing, the score and the result card; 3D draws the rest.
//   0.00 s  contact: fight cloud, streaks, stars, confetti; the cards scuffle inside it
//   ~0.9 s  the cloud breaks up: the two cards still pushing against each other
//   1.10 s  a second pop swallows them (and they vanish under it), the cloud ring blows outward
//   1.28 s  the compound card grows out of the middle (resultGrows) over glow, rays and confetti rain
const CRASH = { pop: 1.1, out: 1.15, result: 1.28 };
function crash3D(scene: Any) {
  const CX = scene.cx, CY = scene.cy;
  const pair = scene.queue[scene.roundIndex];
  const L = scene.selectedLeft, R = scene.selectedRight;
  const m = state.mashup!;
  m.setQuality(state.stage!.quality, reducedMotion());
  scene.cameras.main.shake(300, 0.007);
  gameAudio.playBurst();
  m.fight(CX, CY, Math.min(scene.gw, scene.gh));
  for (const c of [L, R]) if (c?.active) state.cards?.scuffle(c);
  scene.time.delayedCall(CRASH.pop * 1000, () => {
    m.pop();
    scene.cameras.main.shake(220, 0.005);
    gameAudio.playBurst();
  });
  // gone while the heap covers them (GameScene's 350 ms pulseOut would still show when it opens)
  scene.time.delayedCall(CRASH.out * 1000, () => {
    for (const c of [L, R]) {
      if (c?.active) scene.tweens.add({ targets: c, alpha: 0, duration: 70, onComplete: () => c.destroy() });
    }
  });
  scene.time.delayedCall(CRASH.result * 1000, () => scene.showResultCard(pair));
}

// GameScene.showResultCard flips the card in edge-on from above; in the intro it grows out of the
// middle of the cloud. Same card, same tween (and its onComplete -> onRoundWin), different start.
function resultGrows(scene: Any, show: Any, pair: Any) {
  const add = scene.add, tweens = scene.tweens;
  const makeContainer = add.container, addTween = tweens.add;
  let cont: Any = null;
  add.container = function (...a: Any[]) {
    const c = makeContainer.apply(add, a);
    if (!cont) cont = c;
    return c;
  };
  tweens.add = function (cfg: Any) {
    if (cont && cfg && cfg.targets === cont && cfg.onComplete && cfg.scaleX === 1) {
      cont.y = cfg.y;
      cont.scaleX = cont.scaleY = 0.06;
      cont.alpha = 1;
      cfg.duration = 640;
      cfg.ease = 'Back.easeOut';
    }
    return addTween.call(tweens, cfg);
  };
  try {
    return show.call(scene, pair);
  } finally {
    delete add.container;
    delete tweens.add;
  }
}

// The new round's cards already exist (Phaser made them); park them on their slots, block input,
// fly the camera through the zone to the gate, then let the cards fly out of the gate.
function beginTravel(scene: Any) {
  const stage = state.stage!, travel = state.travel!, cards = state.cards!;
  const order = [0, 1, 2].flatMap(i => [scene.leftCards[i], scene.rightCards[i]]).filter(Boolean);
  for (const c of order) {
    for (const tw of scene.tweens.getTweensOf(c)) {
      if (tw.data?.some((d: Any) => d?.key === 'x')) tw.stop();      // the 2D slide-in
    }
    c.x = c.baseX;
  }
  scene.busy = true;
  state.travelHide = true;
  const round = scene.roundIndex;
  const gate = stage.paintingPoint(GATE_UV.u, GATE_UV.v);
  // once the footage has settled, the next cards fly in from the sides (intro 2.4-2.7 s)
  order.forEach((c: Any, i: number) => {
    const left = scene.leftCards.includes(c);
    const from = stage.toWorld(left ? -0.22 * stage.W : 1.22 * stage.W, c.baseY, 0);
    cards.arrive(c, from, ARRIVE_AT - 0.06 + Math.floor(i / 2) * 0.07 + (left ? 0 : 0.03), 0.42, 'side');
  });
  travel.start({
    gate: () => gate,
    onArrive: () => { state.travelHide = false; state.zone?.hide(); },
    onRest: () => state.zone?.reform(),
    onDone: () => { if (scene.roundIndex === round && scene.sys.isActive()) scene.busy = false; },
  });
}

// Same rules as GameScene.showHint, with the glow in 3D.
function showHint3D(scene: Any) {
  if (scene.busy) return;
  const pair = scene.queue[scene.roundIndex];
  const correctL = scene.leftCards.find((c: Any) => c?.active && c.word === pair.word1);
  const correctR = scene.rightCards.find((c: Any) => c?.active && c.word === pair.word2);
  [...scene.leftCards, ...scene.rightCards].forEach((c: Any) => {
    if (!c?.active || c === correctL || c === correctR) return;
    scene.tweens.add({ targets: c, alpha: 0.25, duration: 220 });
    scene.time.delayedCall(2200, () => { if (c?.active) scene.tweens.add({ targets: c, alpha: 1, duration: 300 }); });
  });
  [correctL, correctR].forEach((card: Any) => {
    if (!card?.active) return;
    const sx = card.scaleX, sy = card.scaleY;
    state.cards?.hint(card);
    scene.tweens.add({ targets: card, scaleX: sx * 1.14, scaleY: sy * 1.14, duration: 200, ease: 'Back.easeOut', yoyo: true, repeat: 2 });
  });
  const targets = [correctL, correctR].filter((c: Any) => c?.active).map((c: Any) => ({ x: c.x, y: c.y }));
  if (targets.length && !state.tutor?.hint(targets)) state.glee?.react('hint', targets);
}

/** Glee's spot: the left front of the round stage, under the week/base cards and left of the
 *  result card, just above the Replay/Mic buttons (design canvas 1280x720, like GameScene). */
function placeGlee(s: Any) {
  const sx = s.gw / 1280, sy = s.gh / 720, su = Math.min(sx, sy);
  state.glee!.place(445 * sx, 640 * sy, 125 * su, 0.36);
}

function frame(game: Phaser.Game) {
  const s = state.scene;
  if (!state.on || !s || !s.sys?.isActive()) return;
  const now = performance.now();
  let t = (now - state.t0) / 1000;
  let dt = state.last ? Math.min(0.1, (now - state.last) / 1000) : 1 / 60;
  state.last = now;
  if (state.fixedDt) { dt = state.fixedDt; t = state.tFixed += dt; }
  const stage = state.stage!;
  const W = game.scale.width, H = game.scale.height;
  stage.resize(W, H);
  const p = game.input.activePointer;
  const pointer = p ? { x: p.x, y: p.y, down: p.isDown } : null;
  stage.setPointer(pointer ? pointer.x : null, pointer ? pointer.y : null);
  const sh = s.cameras?.main?.shakeEffect;
  stage.setShake(sh?.isRunning ? sh._offsetX : 0, sh?.isRunning ? sh._offsetY : 0);
  const list: LiveCard[] = [];
  for (const c of s.leftCards ?? []) if (c?.active) list.push({ card: c, side: 'left' });
  for (const c of s.rightCards ?? []) if (c?.active) list.push({ card: c, side: 'right' });
  state.cards!.sync(list, pointer, t, dt);
  state.zone!.place(s.cx, s.cy, s.zoneR, stage.quality);
  const pxPerUnit = stage.renderer.domElement.height / 2 / Math.tan((stage.camera.fov * Math.PI) / 360);
  state.zone!.update(t, dt, s.zoneGfx?.alpha ?? 1, pxPerUnit);
  state.travel!.update(dt);
  if (state.glee) {
    placeGlee(s);
    state.glee.setPortal(s.cx, s.cy, s.zoneR);
    const d = s.dragCard;
    state.glee.dragTarget = d?.active ? { x: d.x, y: d.y } : null;
    // follow the mouse / finger while it moves (mouse 4 s, finger 2.5 s), like Halli Galli's pink bell
    const engaged = ptr.inside && now - ptr.t < (ptr.mouse ? 4000 : 2500) && !gleeDrag;
    state.glee.pointer = engaged ? { x: ptr.x, y: ptr.y } : null;
    if (!d && ptr.inside && (gleeDrag || state.glee.hitTest(ptr.x, ptr.y))) game.canvas.style.cursor = gleeDrag ? 'grabbing' : 'grab';
    state.glee.update(dt);
  }
  if (state.tutor) {
    const live = [...(s.leftCards ?? []), ...(s.rightCards ?? [])].filter((c: Any) => c?.active);
    const open = !s.busy && !state.travel!.active && live.length === 6 && !document.getElementById('intro-overlay');
    const settled = open && live.every((c: Any) => state.cards!.isReady(c) && Math.abs(c.x - c.baseX) < 2 && !c.inZone);
    state.tutor.update(dt, settled, open);
  }
  state.mashup?.update(dt);
  stage.render(t, dt);
  monitor(dt);
  fpsMeter(dt);
}

// Step quality down when frames are slow; give up to the 2D game as the last resort.
function monitor(dt: number) {
  if (state.forced) return;
  state.sinceSwitch += dt;
  // shader warm-up, hidden/occluded tab, wake from sleep: don't judge those frames
  if (state.sinceSwitch < 2.5 || dt > 0.25 || document.visibilityState !== 'visible') { if (dt > 0.25) state.frames = []; return; }
  state.frames.push(dt);
  const sum = state.frames.reduce((a, b) => a + b, 0);
  if (state.frames.length < 40 && sum < 1.5) return;
  const sorted = [...state.frames].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  state.frames = [];
  const next = decideQuality(state.mode, med);
  if (next) {
    state.canStepUp = false;
    state.upWindows = 0;
    if (next === '2d') { giveUp(`slow (median frame ${(med * 1000).toFixed(0)} ms at low)`); return; }
    state.mode = next;
    state.stage!.setQuality(next);
    state.glee?.setQuality(next);
    state.mashup?.setQuality(next, reducedMotion());
    state.sinceSwitch = 0;
    remember(next);
    console.info('[wm3d] quality ->', next, `(median frame ${(med * 1000).toFixed(0)} ms)`);
    return;
  }
  // a remembered lower tier that now runs fast climbs back up, one level per 3 fast windows
  if (state.canStepUp && state.mode !== 'high' && state.mode !== '2d' && med < FAST) {
    if (++state.upWindows >= 3) {
      const up: Mode = state.mode === 'low' ? 'mid' : 'high';
      state.mode = up;
      state.stage!.setQuality(up);
      state.glee?.setQuality(up);
      state.mashup?.setQuality(up, reducedMotion());
      state.sinceSwitch = 0;
      state.upWindows = 0;
      remember(up);
      console.info('[wm3d] quality ->', up, `(median frame ${(med * 1000).toFixed(0)} ms)`);
    }
  } else {
    state.upWindows = 0;
  }
}

function giveUp(reason: string) {
  console.warn('[wm3d] falling back to 2D:', reason);
  state.on = false;
  state.travel?.cancel();
  state.travelHide = false;
  if (state.scene) state.scene.busy = false;
  unhideAll();
  state.cards?.clear();
  state.glee?.dispose();
  state.glee = null;
  state.mashup?.dispose();
  state.mashup = null;
  state.tutor?.dispose();
  state.tutor = null;
  state.stage?.dispose();
  state.stage = null;
  // 2D only for this tab session; the next visit tries 3D again (at low after a slow give-up)
  try { sessionStorage.setItem(SESSION_2D, '1'); } catch { /* ignore */ }
  if (reason.startsWith('slow')) remember('low');
}

let fpsEl: HTMLDivElement | null = null;
let fpsAcc = 0, fpsN = 0;
function fpsMeter(dt: number) {
  if (!fpsEl) return;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    fpsEl.textContent = `${Math.round(fpsN / fpsAcc)} fps · ${state.mode}`;
    fpsAcc = 0; fpsN = 0;
  }
}

// ── the mouse / finger: Glee follows it, a tap pokes her, a drag spins her round (left-right) or flips her
//    (up-down) and she springs back to face the front - like the pink bell in Halli Galli 3D ──
const ptr = { x: 0, y: 0, t: -1e9, mouse: true, inside: true };
type GleeDrag = { id: number; x0: number; y0: number; x: number; y: number; moved: boolean; axis: 'x' | 'y' | ''; hist: { t: number; dx: number; dy: number }[] };
let gleeDrag: GleeDrag | null = null;
function gamePoint(cx: number, cy: number) {
  const g = state.game, c = g?.canvas;
  if (!g || !c) return null;
  const r = c.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: ((cx - r.left) * g.scale.width) / r.width, y: ((cy - r.top) * g.scale.height) / r.height };
}
function dragGlee(x: number, y: number) {
  const d = gleeDrag!, g = state.glee, st = state.stage;
  if (!g || !st) return;
  const dx = x - d.x, dy = y - d.y, now = performance.now();
  d.x = x; d.y = y;
  if (!d.moved) {
    if (Math.hypot(x - d.x0, y - d.y0) < 9) return;
    d.moved = true;
    d.axis = Math.abs(x - d.x0) >= Math.abs(y - d.y0) ? 'x' : 'y';     // one axis per drag, so she doesn't wobble
    g.spin.held = g.flip.held = true;
  }
  if (d.axis === 'x') g.spin.angle += (dx * Math.PI * 2) / (st.W * 0.45);
  else g.flip.angle += (dy * Math.PI * 2) / (st.H * 0.7);                // down = forward roll
  d.hist.push({ t: now, dx, dy });
  while (d.hist.length && now - d.hist[0].t > 90) d.hist.shift();
}
function endGleeDrag(e: PointerEvent) {
  const d = gleeDrag;
  if (!d || e.pointerId !== d.id) return;
  gleeDrag = null;
  state.gleePress = false;
  const g = state.glee, st = state.stage;
  if (!g || !st) return;
  if (!d.moved) { g.poke(); state.tutor?.onPoke(); return; }
  const now = performance.now(), h = d.hist.filter(p => now - p.t < 90);
  const span = h.length ? Math.max(16, now - h[0].t) : 16;
  const vx = h.reduce((a, p) => a + p.dx, 0) / span, vy = h.reduce((a, p) => a + p.dy, 0) / span;   // game px per ms
  const cl = (v: number) => Math.max(-20, Math.min(20, v));
  g.spin.vel = d.axis === 'x' ? cl((vx * 1000 * Math.PI * 2) / (st.W * 0.45)) : 0;
  g.flip.vel = d.axis === 'y' ? cl((vy * 1000 * Math.PI * 2) / (st.H * 0.7)) : 0;
  g.spin.held = g.flip.held = false;
  const sp = d.axis === 'x' ? g.spin : g.flip;
  state.tutor?.onSpin(Math.abs(sp.angle + sp.vel * 0.42) / (Math.PI * 2));
}
function listenPointer() {
  addEventListener('pointermove', e => {
    const p = gamePoint(e.clientX, e.clientY);
    if (!p) return;
    ptr.x = p.x; ptr.y = p.y; ptr.t = performance.now(); ptr.mouse = e.pointerType === 'mouse'; ptr.inside = true;
    if (gleeDrag && e.pointerId === gleeDrag.id) dragGlee(p.x, p.y);
  }, { passive: true });
  addEventListener('pointerdown', e => {
    const p = gamePoint(e.clientX, e.clientY);
    if (!p) return;
    ptr.x = p.x; ptr.y = p.y; ptr.t = performance.now(); ptr.mouse = e.pointerType === 'mouse'; ptr.inside = true;
    state.tutor?.touched();
    const s = state.scene, g = state.glee;
    if (!state.on || !g || !s || e.button > 0 || gleeDrag || s.dragCard || s.collectionOpen) return;
    if (document.getElementById('intro-overlay') || !g.hitTest(p.x, p.y)) return;
    state.gleePress = true;
    gleeDrag = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, moved: false, axis: '', hist: [] };
  }, { capture: true, passive: true });
  addEventListener('pointerup', endGleeDrag, { capture: true, passive: true });
  addEventListener('pointercancel', endGleeDrag, { capture: true, passive: true });
  document.documentElement.addEventListener('mouseleave', () => { ptr.inside = false; });
  addEventListener('blur', () => { ptr.inside = false; });
}

export function start3D(game: Phaser.Game) {
  const { mode, forced } = pickMode();
  state.game = game;
  state.mode = mode; state.forced = forced;
  (window as Any).WM3D = state;
  if (mode === '2d') return;
  const css = document.createElement('style');
  css.textContent = `
    .wm3d-canvas { position: fixed; left: 0; top: 0; z-index: 0; pointer-events: none; display: block; }
    #game-container > canvas:not(.wm3d-canvas) { position: relative; z-index: 1; }`;
  document.head.appendChild(css);
  const begin = () => {
    try {
      const parent = game.canvas.parentElement ?? document.body;
      const stage = new Stage(parent);
      stage.resize(game.scale.width, game.scale.height);
      stage.setQuality(mode);
      state.stage = stage;
      state.cards = new Cards3D(stage);
      state.zone = new Zone3D(stage);
      const travel = new Travel(stage);
      state.travel = travel;
      state.cards.clock = () => travel.elapsed();
      state.cards.traveling = () => travel.active;
      state.zone.clock = () => travel.elapsed();
      state.mashup = new Mashup(stage);
      state.mashup.setQuality(stage.quality, reducedMotion());
      const qs = new URLSearchParams(location.search);
      if (qs.get('glee') !== 'off') {
        state.glee = new Glee(stage);
        state.glee.runClock = () => (travel.active ? travel.elapsed() : null);
        if (qs.get('tutor') !== 'off') {
          state.tutor = new Tutor(state.glee, {
            glow: (card: Any) => state.cards?.hint(card),
            showHint: () => state.scene?.showHint(),
            bgm: () => (gameAudio as Any).bgmEl ?? null,
          });
        }
      }
      // depth relief for the backdrop (the flight parallax); flat until it loads
      const depth = new Image();
      depth.onload = () => state.stage?.setDepth(depth);
      depth.src = './gl/bg_depth.png';
      // warm the HTTP cache with every card face, so a new round's faces are ready mid-flight
      setTimeout(() => {
        for (const k of Object.keys(CARD_FACES)) { const im = new Image(); im.src = `./gl/cards/${k}.webp`; }
      }, 2500);
      stage.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); giveUp('context lost'); });
    } catch (err) {
      console.warn('[wm3d] WebGL init failed', err);
      try { sessionStorage.setItem(SESSION_2D, '1'); } catch { /* ignore */ }
      return;
    }
    state.on = true;
    listenPointer();
    const scene = game.scene.getScene('Game') as Any;
    scene.events.on(Phaser.Scenes.Events.CREATE, () => { if (state.on) attach(scene); });
    if (scene.sys.settings.status === Phaser.Scenes.RUNNING) attach(scene);
    game.events.on(Phaser.Core.Events.POST_RENDER, () => {
      try { frame(game); } catch (err) { console.error(err); giveUp('error'); }
    });
    if (new URLSearchParams(location.search).has('fps')) {
      fpsEl = document.createElement('div');
      fpsEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;font:600 12px/1.4 system-ui;color:#fff;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:8px;pointer-events:none';
      document.body.appendChild(fpsEl);
    }
  };
  if (game.isRunning) begin(); else game.events.once(Phaser.Core.Events.READY, begin);
}
