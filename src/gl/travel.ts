// Round-to-round "space travel" (3D only).
//
// After a correct match the camera flies forward through the Gravity Zone toward the gate in the
// backdrop painting (the painting is a depth relief, so it parallaxes), speed lines build up,
// a flash at the gate, then the next round's cards fly out of the gate to their slots while the
// zone re-forms.  Phaser keeps the round logic; input is blocked until the cards have landed.
import * as THREE from 'three';
import { gameAudio } from '../audio';
import type { Stage } from './stage';

export const DEPART = 1.05;      // s, camera flight to the flash
export const ARRIVE = 1.25;      // s, settle + cards landing
const FLASH_IN = 0.16;           // s before the end of DEPART
const FLASH_OUT = 0.26;          // s into ARRIVE
const FLASH_MAX = 0.7;
const STREAKS = { high: 140, mid: 100, low: 60 } as const;

const easeInCubic = (x: number) => x * x * x;
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function gradientTex() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 8;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 8);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export type TravelHooks = {
  /** world point the camera flies toward and the next cards come from */
  gate: () => THREE.Vector3;
  onArrive: () => void;
  onDone: () => void;
};

export class Travel {
  phase: 'idle' | 'depart' | 'arrive' = 'idle';
  /** test hook: freeze the travel clock at this many seconds after start */
  freezeAt: number | null = null;
  private t0 = 0;
  private hooks: TravelHooks | null = null;
  private gate = new THREE.Vector3();
  private from = new THREE.Vector3();
  private flash: THREE.Mesh;
  private flashMat: THREE.MeshBasicMaterial;
  private streaks: THREE.InstancedMesh;
  private streakMat: THREE.MeshBasicMaterial;
  private seeds: { th: number; r0: number; sp: number; w: number }[] = [];
  private cols: THREE.Color[] = [];
  private tmpC = new THREE.Color();
  private n = 0;
  private arrived = false;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private zAxis = new THREE.Vector3(0, 0, 1);

  constructor(private stage: Stage) {
    const cam = stage.camera;
    // a veil, not an additive burn: the world stays faintly visible through the flash
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xfff4fb, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.flashMat);
    this.flash.position.z = -60;
    this.flash.renderOrder = 1000;
    this.flash.visible = false;
    this.flash.frustumCulled = false;
    this.streakMat = new THREE.MeshBasicMaterial({
      alphaMap: gradientTex(), transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.streaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.streakMat, STREAKS.high);
    this.streaks.renderOrder = 999;
    this.streaks.visible = false;
    this.streaks.frustumCulled = false;
    const palette = [0xff5bfd, 0x7fe9ff, 0xffffff, 0xffd34d, 0xff8fcf];
    const col = new THREE.Color();
    for (let i = 0; i < STREAKS.high; i++) {
      this.seeds.push({ th: Math.random() * Math.PI * 2, r0: Math.random(), sp: 0.7 + Math.random() * 0.6, w: 0.18 + Math.random() * 0.3 });
      this.cols.push(new THREE.Color(palette[i % palette.length]));
      this.streaks.setColorAt(i, col.setHex(palette[i % palette.length]));
    }
    cam.add(this.flash, this.streaks);
  }

  get active() { return this.phase !== 'idle'; }

  start(hooks: TravelHooks) {
    this.hooks = hooks;
    this.phase = 'depart';
    this.t0 = performance.now();
    this.arrived = false;
    this.gate.copy(hooks.gate());
    this.from.set(0, 0, this.stage.dist);
    this.n = STREAKS[this.stage.quality];
    whoosh();
  }

  /** seconds since start (frozen in tests) */
  elapsed() {
    if (this.freezeAt !== null) return this.freezeAt;
    return (performance.now() - this.t0) / 1000;
  }

  update(dt: number) {
    const st = this.stage;
    if (this.phase === 'idle') { st.travel.w = 0; return; }
    const t = this.elapsed();
    const cam = st.camera;
    // size the camera-space layers to the current view
    const fovNow = st.travel.w > 0 ? Math.max(st.baseFov, st.travel.fov) : st.baseFov;
    const hh = Math.tan(THREE.MathUtils.degToRad(fovNow / 2));
    this.flash.scale.set(2 * 60 * hh * cam.aspect * 1.2, 2 * 60 * hh * 1.2, 1);

    let speed = 0, flash = 0;
    if (t < DEPART) {
      const p = t / DEPART;
      const e = easeInCubic(p);
      // fly along the base-camera ray to the gate; stop well before it (the relief is near there)
      st.travel.pos.copy(this.from).lerp(this.gate, 0.64 * e);
      st.travel.pos.y += Math.sin(p * Math.PI) * st.H * 0.03;
      st.travel.look.copy(this.gate);
      st.travel.fov = st.baseFov + 9 * e;
      st.travel.w = smooth(0, 0.18, p);
      speed = smooth(0.15, 1, p);
      flash = smooth(DEPART - FLASH_IN, DEPART, t);
    } else {
      if (!this.arrived) {
        this.arrived = true;
        this.phase = 'arrive';
        this.hooks?.onArrive();
      }
      const a = t - DEPART;
      const p = Math.min(1, a / ARRIVE);
      const e = easeOutCubic(p);
      // we came out of the gate: start a little forward and settle back into the play view
      st.travel.pos.copy(this.from).lerp(this.gate, 0.05 * (1 - e));
      st.travel.look.set(0, 0, 0).lerp(this.gate, 0.15 * (1 - e));
      st.travel.fov = st.baseFov + 7 * (1 - e);
      st.travel.w = 1 - smooth(0.25, 1, p);
      speed = 1 - smooth(0, 0.45, p);
      flash = 1 - smooth(0, FLASH_OUT, a);
      if (p >= 1) {
        this.phase = 'idle';
        st.travel.w = 0;
        this.flash.visible = false;
        this.streaks.visible = false;
        const h = this.hooks;
        this.hooks = null;
        h?.onDone();
        return;
      }
    }
    this.flashMat.opacity = FLASH_MAX * flash;
    this.flash.visible = flash > 0.002;
    this.drawStreaks(t, dt, speed, hh, cam.aspect);
  }

  private drawStreaks(t: number, _dt: number, speed: number, hh: number, aspect: number) {
    const on = speed > 0.01;
    this.streaks.visible = on;
    if (!on) return;
    const Z = 200;
    const halfH = Z * hh, halfW = halfH * aspect;
    const rMax = Math.hypot(halfW, halfH) * 1.15;
    this.streakMat.opacity = Math.min(0.85, speed);
    for (let i = 0; i < this.n; i++) {
      const sd = this.seeds[i];
      // radius cycles outward; faster when we're faster
      const life = (sd.r0 + t * sd.sp * (0.35 + 1.6 * speed)) % 1;
      const r = rMax * (0.2 + 0.8 * life * life);
      const len = rMax * (0.04 + 0.3 * speed) * (0.35 + life);
      // born dim near the centre, brightest on the way out (additive: colour = opacity)
      const fade = Math.min(1, life / 0.35);
      this.streaks.setColorAt(i, this.tmpC.copy(this.cols[i]).multiplyScalar(fade * fade));
      const th = sd.th;
      this.q.setFromAxisAngle(this.zAxis, th);
      this.v.set(Math.cos(th) * (r - len / 2), Math.sin(th) * (r - len / 2), -Z);
      this.s.set(len, sd.w * (1 + life), 1);
      this.m4.compose(this.v, this.q, this.s);
      this.streaks.setMatrixAt(i, this.m4);
    }
    this.streaks.count = this.n;
    this.streaks.instanceMatrix.needsUpdate = true;
    if (this.streaks.instanceColor) this.streaks.instanceColor.needsUpdate = true;
  }

  cancel() {
    this.phase = 'idle';
    this.hooks = null;
    this.stage.travel.w = 0;
    this.flash.visible = false;
    this.streaks.visible = false;
  }
}

// Soft rising whoosh (filtered noise), through the game's own SFX bus so the SFX toggle applies.
function whoosh() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ga = gameAudio as any;
  if (!ga.sfxOn) return;
  try {
    ga.ensureCtx?.();
    const ctx: AudioContext | null = ga.ctx, master: GainNode | null = ga.master;
    if (!ctx || !master || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(220, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + DEPART);
    bp.frequency.exponentialRampToValueAtTime(700, t + DEPART + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + DEPART * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + DEPART + 0.45);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + DEPART + 0.5);
  } catch { /* audio is optional */ }
}
