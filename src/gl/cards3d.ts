// 3D clay cards that mirror Phaser's WordCard objects.
//
// Phaser keeps every card (position, float tween, drag, zone snap, alpha fades); this file reads
// them each frame and draws a thick slab with the straightened face art.  Only the look changes:
// depth (lift on hover/drag), real yaw toward the centre, sway, tilt toward the pointer, drag
// inertia and a soft shadow behind.
import * as THREE from 'three';
import type { WordCard } from '../objects/WordCard';
import { CARD_FACES, FACE_ASPECT, FACE_RADIUS } from './cardFaces';
import type { Stage } from './stage';
import { cardShadowTexture, dotTexture, hazeTexture } from './textures';

// Slab size in 2D-card units (Phaser draws the card 200 x 268 before its scale).
const FW = 184;
const FH = FW / FACE_ASPECT;          // 245
const D2R = Math.PI / 180;
/**
 * Card pose, measured against the line of sight from the resting camera (not world axes), so every
 * card shows the same pose wherever it sits on screen - like the art, where all left cards show the
 * same left wall.  yaw: turn toward the screen centre; pitch: top leans back (bottom wall shows);
 * roll: share of the 2D layout's tilt, applied in SCREEN space like the 2D game rotates its images.
 * Test hook: ?pose=yaw,pitch,roll  and  WM3D.cards.pose (live).
 */
export const pose = (() => {
  // fitted to the baked art (tools/qa/pose_fit.py): visible near wall 0.16 of the face width, bottom wall
  // 0.05 of its height, edges leaning ~5.5 deg, face aspect 0.69 - the art: 0.152 / 0.048 / 6.7 / 0.681
  const p = { yaw: 28, pitch: 10, roll: 1, thick: 30, world: false };
  const q = new URLSearchParams(location.search).get('pose');
  if (q) {
    const [y, pi, r, th] = q.split(',').map(Number);
    if (Number.isFinite(y)) p.yaw = y;
    if (Number.isFinite(pi)) p.pitch = pi;
    if (Number.isFinite(r)) p.roll = r;
    if (Number.isFinite(th) && th >= 12 && th <= 80) p.thick = th;
  }
  return p;
})();
const THICK = pose.thick;                      // slab thickness in card units (face 184 wide)
const BEV = Math.round(THICK * 0.17);
// legacy world-axis pose (first slice), kept only to compare in tests: WM3D.cards.pose.world = true
const YAW_W = 24 * D2R, PITCH_W = -8 * D2R;

export type Side = 'left' | 'right';
/** Test hook: ?cal turns every card square to the camera (light calibration against the art). */
export const debug = { front: new URLSearchParams(location.search).has('cal') };
export interface LiveCard { card: WordCard; side: Side }
type Pointer = { x: number; y: number; down: boolean } | null;
/** Travel arrival: fly from `from` (world) to the card's slot, starting at travel-clock `at` (s). */
type Arrival = { from: THREE.Vector3; at: number; dur: number };
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
/**
 * Material settings for things that sit BEHIND a card (drop shadow, hint halo): blended, but drawn in
 * the opaque pass (renderOrder -1: after the backdrop, before every card). A card turned away from the
 * camera reaches behind these planes; drawn in the transparent pass they then painted over the card's
 * far side (a translucent band / cut-off corner). Custom blending keeps the alpha (no OPAQUE define).
 */
const BEHIND_CARDS = {
  transparent: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
} as const;

/** Rounded rectangle with CIRCULAR corners - the same outline as the face texture (unwarp_cards.py
 *  draws circular arcs), so the textured face, the slab cap and the bevel all share one corner. */
function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2, q = Math.PI / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -q, 0, false);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, q, false);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, q, 2 * q, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, 2 * q, 3 * q, false);
  return s;
}

/** Second-order spring toward `target` (slightly under-damped, for a toy-like settle). */
class Spring {
  v = 0;
  constructor(public x = 0, public k = 170, public zeta = 0.72) {}
  step(target: number, dt: number) {
    const c = 2 * Math.sqrt(this.k) * this.zeta;
    const a = this.k * (target - this.x) - c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

class Card3D {
  readonly root = new THREE.Group();
  readonly spin = new THREE.Group();
  readonly faceMat: THREE.MeshStandardMaterial;
  readonly bodyMat: THREE.MeshStandardMaterial;
  readonly shadowMat: THREE.MeshBasicMaterial;
  readonly shadow: THREE.Mesh;
  ready = false;
  z = new Spring(0, 120, 0.8);
  // springs hold the pose RELATIVE to the line of sight (rotation.y / rotation.x terms) + screen roll
  yaw: Spring; pitch = new Spring(-pose.pitch * D2R); roll = new Spring(0, 200, 0.8);
  px = NaN; py = NaN; vx = 0; vy = 0;
  phase = Math.random() * 100;
  /** time (sync clock) the crash started, see Cards3D.scuffle */
  fight: number | null = null;
  /** the matched pair sliding together, see Cards3D.meet */
  meet: { cx: number; from: number } | null = null;
  hintUntil = 0; hintStart = 0;
  hint?: THREE.Group;
  arr: Arrival | null = null;

  constructor(readonly side: Side, readonly word: string,
    geo: { body: THREE.BufferGeometry; face: THREE.BufferGeometry; plane: THREE.BufferGeometry },
    tex: THREE.Texture | null, shadow: { tex: THREE.Texture; sx: number; sy: number }) {
    const key = `${side}_${word}`;
    const rim = CARD_FACES[key]?.rim ?? '#e8e0f0';
    this.bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(rim).multiplyScalar(0.9), roughness: 0.7, metalness: 0 });
    // the face texture is opaque (rim colour carried past the outline); the rounded face geometry is
    // the cut-out, so the corners are antialiased geometry edges, not aliased alphaTest steps
    this.faceMat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.78, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    });
    const body = new THREE.Mesh(geo.body, this.bodyMat);
    const face = new THREE.Mesh(geo.face, this.faceMat);
    face.position.z = THICK / 2 + 0.05;
    this.spin.add(body, face);
    // soft drop shadow on the 'air' behind the card: light comes from the upper right
    this.shadowMat = new THREE.MeshBasicMaterial({ map: shadow.tex, color: 0x24104a, opacity: 0.3, depthWrite: false, toneMapped: false, ...BEHIND_CARDS });
    this.shadow = new THREE.Mesh(geo.plane, this.shadowMat);
    this.shadow.scale.set(FW * shadow.sx, FH * shadow.sy, 1);
    this.shadow.renderOrder = -1;
    this.root.add(this.shadow, this.spin);
    this.yaw = new Spring((side === 'left' ? 1 : -1) * pose.yaw * D2R);
  }

  setOpacity(a: number) {
    const tr = a < 0.999;
    for (const m of [this.faceMat, this.bodyMat]) {
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.opacity = a;
      m.depthWrite = !tr;
    }
  }

  dispose() {
    this.faceMat.dispose();
    this.bodyMat.dispose();
    this.shadowMat.dispose();
    this.root.removeFromParent();
    this.hint?.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; m?.dispose(); });
  }
}

export class Cards3D {
  readonly group = new THREE.Group();
  private cards = new Map<WordCard, Card3D>();
  private tex = new Map<string, { t: THREE.Texture; ready: boolean; used: number }>();
  private loader = new THREE.TextureLoader();
  private geo: { body: THREE.BufferGeometry; face: THREE.BufferGeometry; plane: THREE.BufferGeometry };
  private shadowTex = cardShadowTexture(FACE_ASPECT, FACE_RADIUS);
  private dot = dotTexture(64);
  private haze = hazeTexture(256);
  private anisotropy = 4;
  private frame = 0;
  private pending = new Map<WordCard, Arrival>();
  /** travel clock (s) and whether a travel is running; set by the 3D bootstrap */
  clock: () => number = () => 0;
  traveling: () => boolean = () => false;
  private ctrl = new THREE.Vector3();
  private to = new THREE.Vector3();
  private now = 0;
  readonly pose = pose;
  private eul = new THREE.Euler(0, 0, 0, 'YXZ');
  private qBase = new THREE.Quaternion();
  private qRoll = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  private yAxis = new THREE.Vector3(0, 1, 0);

  constructor(private stage: Stage) {
    stage.scene.add(this.group);
    const shape = roundedRect(FW, FH, FACE_RADIUS * FW);
    const depth = THICK - 2 * BEV;
    const body = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV * 0.85, bevelSegments: 5, curveSegments: 10,
    });
    body.translate(0, 0, -depth / 2);           // front cap sits at z = THICK / 2
    body.computeVertexNormals();
    const face = new THREE.ShapeGeometry(shape, 10);
    const pos = face.getAttribute('position');
    const uv = face.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / FW + 0.5, pos.getY(i) / FH + 0.5);
    uv.needsUpdate = true;
    this.geo = { body, face, plane: new THREE.PlaneGeometry(1, 1) };
    this.anisotropy = Math.min(8, stage.renderer.capabilities.getMaxAnisotropy());
  }

  private texture(side: Side, word: string, onReady: () => void) {
    const key = `${side}_${word}`;
    let e = this.tex.get(key);
    if (!e) {
      const t = this.loader.load(`./gl/cards/${key}.webp`, () => {
        const ent = this.tex.get(key);
        if (ent) ent.ready = true;
        onReady();
      }, undefined, () => { /* missing art: the Phaser card simply stays visible */ });
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.anisotropy;
      e = { t, ready: false, used: this.frame };
      this.tex.set(key, e);
    } else if (e.ready) {
      queueMicrotask(onReady);
    } else {
      const prev = e;
      const iv = setInterval(() => { if (prev.ready) { clearInterval(iv); onReady(); } }, 50);
    }
    e.used = this.frame;
    return e.t;
  }

  /** Queue a fly-in from `from` for this card (applied when its 3D twin exists). */
  arrive(card: WordCard, from: THREE.Vector3, at: number, dur: number) {
    const a = { from: from.clone(), at, dur };
    const c = this.cards.get(card);
    if (c) c.arr = a; else this.pending.set(card, a);
  }

  /** Is the 3D twin of this Phaser card on screen (so Phaser may skip drawing it)? */
  isReady(card: WordCard) { return !!this.cards.get(card)?.ready; }

  hint(card: WordCard, ms = 2600) {
    const c = this.cards.get(card);
    if (!c) return;
    const now = performance.now();
    c.hintStart = now; c.hintUntil = now + ms;
    if (!c.hint) {
      const g = new THREE.Group();
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        map: this.haze, color: 0xffee33, depthWrite: false, toneMapped: false, ...BEHIND_CARDS, blendDst: THREE.OneFactor,
      }));
      halo.position.z = -THICK;
      halo.renderOrder = -1;
      halo.scale.setScalar(Math.max(FW, FH) * 2.4);
      halo.name = 'halo';
      g.add(halo);
      const ringR = 268 * 0.7;                       // original: max(cW, cH) * 0.7 of the 2D card
      const dotMat = new THREE.MeshBasicMaterial({ map: this.dot, color: 0xffff40, transparent: true, depthWrite: false, toneMapped: false });
      const dotGeo = new THREE.PlaneGeometry(1, 1);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
        const d = new THREE.Mesh(dotGeo, dotMat);
        d.position.set(Math.cos(a) * ringR, -Math.sin(a) * ringR, THICK);
        d.scale.setScalar(22);
        g.add(d);
      }
      c.hint = g;
      c.root.add(g);
    }
  }

  sync(list: LiveCard[], pointer: Pointer, t: number, dt: number) {
    this.frame++;
    this.now = t;
    const live = new Set<WordCard>();
    for (const { card, side } of list) {
      live.add(card);
      let c = this.cards.get(card);
      if (!c) {
        const created = new Card3D(side, card.word, this.geo, null, this.shadowTex);
        c = created;
        created.faceMat.map = this.texture(side, card.word, () => {
          created.ready = true;
          created.faceMat.needsUpdate = true;
        });
        this.cards.set(card, created);
        this.group.add(created.root);
      }
      const pa = this.pending.get(card);
      if (pa) { c.arr = pa; this.pending.delete(card); }
      this.update(c, card, pointer, t, dt);
    }
    for (const [card, c] of this.cards) {
      if (!live.has(card) || !card.active) { c.dispose(); this.cards.delete(card); }
    }
    for (const card of this.pending.keys()) if (!card.active) this.pending.delete(card);
    // free GPU memory for faces not used for a while (each round shows 6 of 52)
    if (this.frame % 300 === 0) {
      for (const [k, e] of this.tex) {
        if (this.frame - e.used > 1800 && e.ready) { e.t.dispose(); this.tex.delete(k); }
      }
    }
  }

  private update(c: Card3D, card: WordCard, pointer: Pointer, t: number, dt: number) {
    const sdt = Math.min(dt, 1 / 30);
    const dragging = card.depth >= 20;
    const hovered = card.depth === 15 && !dragging;
    const inZone = card.inZone;
    // drag velocity (game px / s), smoothed
    if (!Number.isNaN(c.px)) {
      const k = 1 - Math.exp(-dt * 14);
      c.vx += ((card.x - c.px) / Math.max(dt, 1e-3) - c.vx) * k;
      c.vy += ((card.y - c.py) / Math.max(dt, 1e-3) - c.vy) * k;
    }
    c.px = card.x; c.py = card.y;
    const sign = c.side === 'left' ? 1 : -1;
    // relative pose targets: rotation.y (+ turns the face right), rotation.x (+ tilts the face down)
    let yawT = sign * (dragging ? 0 : inZone ? 8 : pose.yaw) * D2R;
    let pitchT = -(dragging ? 2 : inZone ? 0 : pose.pitch) * D2R;
    let rollT = inZone ? 0 : -card.rotation * pose.roll;
    if (!dragging) {
      yawT += Math.sin(t * 0.55 + c.phase) * 0.025;
      pitchT += Math.sin(t * 0.43 + c.phase * 1.3) * 0.02;
    }
    if (hovered && pointer) {
      const s = card.scaleX || 1;
      const dx = THREE.MathUtils.clamp((pointer.x - card.x) / (FW * 0.6 * s), -1, 1);
      const dy = THREE.MathUtils.clamp((pointer.y - card.y) / (FH * 0.6 * s), -1, 1);
      yawT += dx * 0.14;
      pitchT += dy * 0.1;
    }
    if (dragging) {
      yawT += THREE.MathUtils.clamp(-c.vx / 1800, -1, 1) * 0.35;
      pitchT += THREE.MathUtils.clamp(c.vy / 1800, -1, 1) * 0.3;
      rollT += THREE.MathUtils.clamp(-c.vx / 2400, -1, 1) * 0.12;
    }
    if (debug.front) { yawT = 0; pitchT = 0; rollT = 0; }
    const zT = dragging ? 120 : inZone ? 46 : hovered ? 30 : 0;
    const z = c.z.step(zT, sdt);
    let relY = c.yaw.step(yawT, sdt), roll = c.roll.step(rollT, sdt);
    const relX = c.pitch.step(pitchT, sdt);
    let jx = 0, jy = 0, jz = 0;
    if (c.meet) {
      // Phaser slides the pair to cx -/+ 18 (overlapping); in 3D they meet edge to edge and lean into a V
      const u = THREE.MathUtils.clamp(1 - (Math.abs(card.x - c.meet.cx) - 18) / Math.max(1, c.meet.from - 18), 0, 1);
      const touch = c.meet.cx - sign * (FW * 0.5 * card.scaleX * 0.9 - 4);
      jx = THREE.MathUtils.lerp(c.meet.cx - sign * c.meet.from, touch, u) - card.x;
      relY += sign * 0.3 * u;
    }
    if (c.fight !== null) {
      // the crash (intro video): a scuffle inside the fight cloud, then pushing against each other
      const a = t - c.fight;
      const w = 1 - THREE.MathUtils.smoothstep(a, 0.72, 0.95), push = THREE.MathUtils.smoothstep(a, 0.8, 1.0);
      const ph = c.phase;
      // bump into each other (anti-phase, toward the middle), rock and bob; then press and tremble
      jx += (sign * Math.abs(Math.sin(a * 17 + ph)) * 9 + Math.sin(a * 41 + ph) * 4) * w + sign * 4 * push;
      jy += Math.sin(a * 29 + ph * 2.3) * 7 * w;
      jz += Math.abs(Math.sin(a * 19 + ph)) * 30 * w;
      relY += Math.sin(a * 21 + ph) * 0.18 * w + sign * 0.06 * push;
      roll += Math.sin(a * 25 + ph * 1.3) * 0.16 * w + Math.sin(a * 70) * 0.012 * push;
      if (a > 3) c.fight = null;
    }
    this.stage.toWorld(card.x + jx, card.y + jy, z + jz, c.root.position);
    const P = c.root.position, D = this.stage.dist;
    if (pose.world && !debug.front) {
      c.spin.rotation.set(PITCH_W + (relX + pose.pitch * D2R), sign * YAW_W + (relY - sign * pose.yaw * D2R), roll, 'YXZ');
    } else {
      // line of sight from the resting camera (0, 0, D): parallax orbits must not re-aim the cards
      const viewY = Math.atan2(-P.x, D - P.z);
      const viewX = Math.atan2(P.y, Math.hypot(P.x, D - P.z));
      this.qBase.setFromEuler(this.eul.set(viewX + relX, viewY + relY, 0, 'YXZ'));
      this.axis.set(-P.x, -P.y, D - P.z).normalize();
      this.qRoll.setFromAxisAngle(this.axis, roll);
      c.spin.quaternion.multiplyQuaternions(this.qRoll, this.qBase);
    }
    const sc = (card.scaleX + card.scaleY) / 2 || 1;
    c.root.scale.set(card.scaleX, card.scaleY, sc);
    c.root.visible = card.visible && c.ready;
    const alpha = THREE.MathUtils.clamp(card.alpha, 0, 1);
    c.setOpacity(alpha);
    // shadow sits at a fixed depth behind the card plane; lifting the card pushes it away and softens it
    const lift = Math.max(0, z);
    c.shadow.position.set(-(12 + lift * 0.3) / sc, -(18 + lift * 0.38) / sc, (-42 - z) / sc);
    c.shadow.rotation.z = c.roll.x;
    c.shadow.scale.set(FW * this.shadowTex.sx * (1 + lift / 520), FH * this.shadowTex.sy * (1 + lift / 520), 1);
    c.shadowMat.opacity = 0.3 * alpha * alpha * (1 - Math.min(lift, 220) / 440);
    if (c.arr) this.flyIn(c);
    // hint glow: blink like the 2D one (260 ms yoyo x5)
    if (c.hint) {
      const now = performance.now();
      const on = now < c.hintUntil;
      c.hint.visible = on;
      if (on) {
        const k = 0.5 + 0.5 * Math.cos(Math.PI * (now - c.hintStart) / 260);
        c.hint.traverse(o => {
          const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          if (m) m.opacity = o.name === 'halo' ? 0.55 * k : k;
        });
      }
    }
  }

  // Out of the gate: a bezier arc toward the viewer, landing on the slot, with one flip.
  private flyIn(c: Card3D) {
    const a = c.arr!;
    const p = (this.clock() - a.at) / a.dur;
    if (!this.traveling() || p >= 1) { c.arr = null; return; }
    if (p < 0) { c.root.visible = false; return; }
    const e = easeOutCubic(p);
    const to = this.to.copy(c.root.position);
    const H = this.stage.H, dist = this.stage.dist;
    this.ctrl.copy(a.from).lerp(to, 0.55);
    this.ctrl.y += H * 0.16;
    this.ctrl.z = to.z + dist * 0.22;
    const u = 1 - e;
    c.root.position.set(
      u * u * a.from.x + 2 * u * e * this.ctrl.x + e * e * to.x,
      u * u * a.from.y + 2 * u * e * this.ctrl.y + e * e * to.y,
      u * u * a.from.z + 2 * u * e * this.ctrl.z + e * e * to.z,
    );
    this.qRoll.setFromAxisAngle(this.yAxis, u * Math.PI * 2 * (c.side === 'left' ? -1 : 1));
    c.spin.quaternion.multiply(this.qRoll);
    const fade = Math.min(1, p / 0.12);
    c.setOpacity(Math.min(c.faceMat.opacity, fade));
    c.shadowMat.opacity *= e * e;
  }

  /** The matched pair slides together (GameScene.triggerCollision): in 3D they meet edge to edge. */
  meet(card: WordCard, cx: number) {
    const c = this.cards.get(card);
    if (c) c.meet = { cx, from: Math.abs(card.x - cx) };
  }

  /** The crash (intro video): the card scuffles in the fight cloud, then pushes against the other one. */
  scuffle(card: WordCard) {
    const c = this.cards.get(card);
    if (c) c.fight = this.now;
  }

  clear() {
    for (const c of this.cards.values()) c.dispose();
    this.cards.clear();
    this.pending.clear();
  }
}
