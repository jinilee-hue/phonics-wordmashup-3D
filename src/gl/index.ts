// Word Mashup 3D layer: boots a three.js stage under the transparent Phaser canvas and mirrors the
// Game scene into it.  Phaser keeps all rules, input, HUD, popups and effects; the backdrop, the six
// word cards and the Gravity Zone are drawn here instead.  Any failure falls back to the 2D game.
import Phaser from 'phaser';
import { WordCard } from '../objects/WordCard';
import { CARD_FACES } from './cardFaces';
import { Cards3D, type LiveCard } from './cards3d';
import { GATE_UV, Stage, type Quality } from './stage';
import { DEPART, Travel } from './travel';
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
  /** hide Phaser's cards while the camera is in flight (they wait at their slots) */
  travelHide: false,
  scene: null as Any,
  hidden: new Set<Any>(),
  t0: performance.now(),
  last: 0,
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
  state.cards!.clear();
  state.travel?.cancel();
  state.travelHide = false;
  // between rounds: fly to the next place instead of sliding the new cards in
  const startRound = scene.startRound;
  if (!startRound.__wm3d) {
    const wrapped = function (this: Any) {
      const afterWin = scene.roundIndex > 0;          // create() resets it to 0 before round 1
      startRound.call(scene);
      if (afterWin && state.on && state.travel && !reducedMotion()) beginTravel(scene);
    };
    (wrapped as Any).__wm3d = true;
    scene.startRound = wrapped;
  }
  // the 2D hint draws its glow over the cards; redo it with a 3D glow behind them
  scene.showHint = () => showHint3D(scene);
  const impact = scene.playImpact;
  if (!impact.__wm3d) {
    const wrapped = function (this: Any) { state.zone?.pulse(); return impact.call(scene); };
    (wrapped as Any).__wm3d = true;
    scene.playImpact = wrapped;
  }
}

function reducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
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
  order.forEach((c: Any, i: number) => cards.arrive(c, gate, DEPART + 0.05 + i * 0.075, 0.8));
  travel.start({
    gate: () => gate,
    onArrive: () => { state.travelHide = false; state.zone?.reform(); },
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
}

function frame(game: Phaser.Game) {
  const s = state.scene;
  if (!state.on || !s || !s.sys?.isActive()) return;
  const now = performance.now();
  const t = (now - state.t0) / 1000;
  const dt = state.last ? Math.min(0.1, (now - state.last) / 1000) : 1 / 60;
  state.last = now;
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

export function start3D(game: Phaser.Game) {
  const { mode, forced } = pickMode();
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
