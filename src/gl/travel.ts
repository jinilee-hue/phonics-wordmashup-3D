// Round-to-round "space travel" (3D only), as in the game's intro video
// (user: "배경 이동도 인트로 영상처럼 공간이 이동하는거처럼 해줘").
//
// DEPART: the camera glides forward through the Gravity Zone toward the gate in the backdrop painting (the
// painting is a depth relief, so near platforms slide past faster than the far islands), Glee runs ahead and
// leaps into the portal, a soft white flash.
// ARRIVE: the intro's own fly-over (intro 1.0-2.4 s: the camera sweeps low over the floating platforms and
// settles into the play view) plays as the backdrop - the intro's last frame IS the game's backdrop (measured:
// correlation 0.95), so it hands over to the painting with a short cross-fade, graded to the painting's
// colours and nudged onto it while it settles. Then the zone rises out of the floor, the next cards fly in
// from the sides (intro 2.4-2.7 s) and Glee pops out of the portal and runs home.
// If the footage can't play (not loaded, blocked), the camera settles back from the gate instead.
// Phaser keeps the round logic; input is blocked until the cards have landed.
import * as THREE from 'three';
import { gameAudio } from '../audio';
import type { Stage } from './stage';

export const DEPART = 1.05;      // s, camera glide to the flash
/** the intro footage used for the arrival (intro seconds) */
const CLIP = { src: './videos/intro.mp4', from: 1.0, to: 2.4, fade: 2.2, rate: 1.0 };
export const CLIP_DUR = (CLIP.to - CLIP.from) / CLIP.rate;
/** travel time when the world is back at rest (the footage has handed over to the painting) */
export const ARRIVE_AT = DEPART + CLIP_DUR;
const LAND = 0.55;               // s after ARRIVE_AT: the cards have landed, input opens
export const ARRIVE = CLIP_DUR + LAND;
const RISE = 0.35;               // s before ARRIVE_AT: the zone starts rising out of the floor
const FLASH_IN = 0.18;           // s before the end of DEPART
const FLASH_OUT = 0.3;           // s into ARRIVE
const FLASH_MAX = 0.78;
// intro px (1280x720, its settled frame) -> painting coords: x = (u - 11) / 1241.6, y = (v - 17) / 698.4
// (best match of the intro's last frame against game_bg: scale 0.97, offset (9, -6) px)
const CLIP_RECT = { x0: -11 / 1241.6, x1: 1269 / 1241.6, y0: -17 / 698.4, y1: 703 / 698.4 };
// while it settles the footage is still a little off the settled view (intro px, scale): [t, dx, dy, scale]
const SETTLE: [number, number, number, number][] = [[1.6, 0, 0, 1], [2.0, 24, 8, 1.01], [2.25, 12, 8, 1.01], [2.33, 6, 4, 1.01], [2.42, 0, 4, 1.01]];
// the intro is warmer and flatter than game_bg: per-channel gain/offset (sRGB), from the two images' stats
const GRADE = { gain: [1.144, 1.046, 0.953] as [number, number, number], offs: [-0.173, 0.029, 0.129] as [number, number, number] };

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export type TravelHooks = {
  /** world point the camera glides toward */
  gate: () => THREE.Vector3;
  /** the flash: the footage takes over (the next cards are placed, still hidden) */
  onArrive: () => void;
  /** the footage is settling: the zone rises out of the floor */
  onRest: () => void;
  onDone: () => void;
};

export class Travel {
  phase: 'idle' | 'depart' | 'arrive' = 'idle';
  /** test hook: freeze the travel clock at this many seconds after start */
  freezeAt: number | null = null;
  /** tests: false while the footage is seeking to the frozen time */
  clipReady = true;
  private t0 = 0;
  private hooks: TravelHooks | null = null;
  private gate = new THREE.Vector3();
  private from = new THREE.Vector3();
  private flash: THREE.Mesh;
  private flashMat: THREE.MeshBasicMaterial;
  private arrived = false;
  private rested = false;
  private video: HTMLVideoElement | null = null;
  private vtex: THREE.VideoTexture | null = null;
  private clipOk = false;
  private playing = false;
  private p0 = new THREE.Vector3();
  private p1 = new THREE.Vector3();

  constructor(private stage: Stage) {
    const cam = stage.camera;
    // a veil, not an additive burn: the world stays faintly visible through the flash
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xfff6fc, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.flashMat);
    this.flash.position.z = -60;
    this.flash.renderOrder = 1000;
    this.flash.visible = false;
    this.flash.frustumCulled = false;
    cam.add(this.flash);
    this.ensureVideo();
  }

  get active() { return this.phase !== 'idle'; }

  /** the footage: a muted inline video of the intro, parked on its first frame */
  private ensureVideo() {
    if (this.video || typeof document === 'undefined') return;
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('muted', '');
    let blob = false;
    // a host without byte ranges can't seek (the time snaps back to 0): then load the whole clip as a blob
    const toBlob = () => {
      if (blob) return;
      blob = true;
      fetch(CLIP.src).then(r => r.blob()).then(b => { v.src = URL.createObjectURL(b); v.load(); }).catch(() => { /* no footage */ });
    };
    v.addEventListener('loadedmetadata', () => {
      if (this.playing) return;
      v.currentTime = CLIP.from;
      setTimeout(() => { if (!this.playing && v.currentTime < CLIP.from - 0.05) toBlob(); }, 2500);
    });
    v.addEventListener('seeked', () => {
      this.clipReady = true;
      if (this.vtex) this.vtex.needsUpdate = true;
      if (!this.playing && this.freezeAt === null && v.currentTime < CLIP.from - 0.05) toBlob();
    });
    v.addEventListener('error', () => { this.clipOk = false; });
    v.src = CLIP.src;
    v.load();
    const t = new THREE.VideoTexture(v);
    t.colorSpace = THREE.NoColorSpace;         // graded + linearised in the backdrop shader
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    this.video = v; this.vtex = t;
  }

  start(hooks: TravelHooks) {
    this.hooks = hooks;
    this.phase = 'depart';
    this.t0 = performance.now();
    this.arrived = false; this.rested = false;
    this.gate.copy(hooks.gate());
    this.from.set(0, 0, this.stage.dist);
    this.ensureVideo();
    const v = this.video;
    if (v) {
      this.playing = false;
      try { v.pause(); if (v.readyState >= 1 && Math.abs(v.currentTime - CLIP.from) > 0.01) v.currentTime = CLIP.from; } catch { /* not ready */ }
    }
    whoosh();
  }

  /** seconds since start (frozen in tests) */
  elapsed() {
    if (this.freezeAt !== null) return this.freezeAt;
    return (performance.now() - this.t0) / 1000;
  }

  /** the footage's rect on screen (CSS px): the intro's settled frame laid over the painting, nudged while settling */
  private clipRect(clipT: number) {
    const st = this.stage;
    const a = st.paintingPoint(0, 0, this.p0).project(st.overlayCam), b = st.paintingPoint(1, 1, this.p1).project(st.overlayCam);
    const px0 = ((a.x + 1) / 2) * st.W, py0 = ((1 - a.y) / 2) * st.H, px1 = ((b.x + 1) / 2) * st.W, py1 = ((1 - b.y) / 2) * st.H;
    const pw = px1 - px0, ph = py1 - py0;
    let x = px0 + CLIP_RECT.x0 * pw, y = py0 + CLIP_RECT.y0 * ph;
    let w = (CLIP_RECT.x1 - CLIP_RECT.x0) * pw, h = (CLIP_RECT.y1 - CLIP_RECT.y0) * ph;
    // settling: the footage's content is still (dx, dy) intro px off and 1/scale smaller than the settled frame
    let k = SETTLE.length - 1;
    while (k > 0 && SETTLE[k - 1][0] > clipT) k--;
    const A = SETTLE[Math.max(0, k - 1)], B = SETTLE[k];
    const f = B[0] === A[0] ? 1 : Math.min(1, Math.max(0, (clipT - A[0]) / (B[0] - A[0])));
    const dx = A[1] + (B[1] - A[1]) * f, dy = A[2] + (B[2] - A[2]) * f, sc = A[3] + (B[3] - A[3]) * f;
    const ux = w / 1280, uy = h / 720;
    const cx = x + w / 2 - dx * ux, cy = y + h / 2 - dy * uy;
    w *= sc; h *= sc;
    x = cx - w / 2; y = cy - h / 2;
    return { x, y, w, h };
  }

  update(_dt: number) {
    const st = this.stage;
    if (this.phase === 'idle') { st.travel.w = 0; return; }
    const t = this.elapsed();
    const cam = st.camera;
    // size the camera-space flash to the current view
    const fovNow = st.travel.w > 0 ? Math.max(st.baseFov, st.travel.fov) : st.baseFov;
    const hh = Math.tan(THREE.MathUtils.degToRad(fovNow / 2));
    this.flash.scale.set(2 * 60 * hh * cam.aspect * 1.2, 2 * 60 * hh * 1.2, 1);

    let flash = 0;
    if (t < DEPART) {
      const p = t / DEPART;
      // a glide: eases in, keeps going (the flash cuts it), low over the platforms toward the gate
      const e = p * p * (1.6 - 0.6 * p);
      st.travel.pos.copy(this.from).lerp(this.gate, 0.6 * e);
      st.travel.pos.y -= Math.sin(p * Math.PI * 0.5) * st.H * 0.025;
      st.travel.look.copy(this.gate);
      st.travel.fov = st.baseFov + 3 * e;
      st.travel.w = smooth(0, 0.18, p);
      flash = smooth(DEPART - FLASH_IN, DEPART, t);
      st.setClip(null, 0);
    } else {
      const a = t - DEPART;
      if (!this.arrived) {
        this.arrived = true;
        this.phase = 'arrive';
        this.startClip();
        this.hooks?.onArrive();
      }
      if (!this.rested && a >= CLIP_DUR - RISE) {
        this.rested = true;
        this.hooks?.onRest();
      }
      const clipT = Math.min(CLIP.to, CLIP.from + a * CLIP.rate);
      this.driveClip(clipT);
      if (this.clipOk) {
        // the footage is the camera move: the 3D camera is at rest under it
        st.travel.w = 0;
        const mix = 1 - smooth(CLIP.fade, CLIP.to, clipT);
        st.setClip(mix > 0.001 ? this.vtex : null, mix, this.clipRect(clipT), GRADE);
      } else {
        // fallback: we came out of the gate - start a little forward and settle back into the play view
        const p = Math.min(1, a / CLIP_DUR), e = easeOutCubic(p);
        st.travel.pos.copy(this.from).lerp(this.gate, 0.12 * (1 - e));
        st.travel.look.set(0, 0, 0).lerp(this.gate, 0.15 * (1 - e));
        st.travel.fov = st.baseFov + 4 * (1 - e);
        st.travel.w = 1 - smooth(0.4, 1, p);
        st.setClip(null, 0);
      }
      flash = 1 - smooth(0, FLASH_OUT, a);
      if (a >= ARRIVE) {
        this.finish();
        return;
      }
    }
    this.flashMat.opacity = FLASH_MAX * flash;
    this.flash.visible = flash > 0.002;
  }

  private startClip() {
    const v = this.video;
    this.clipOk = !!v && v.readyState >= 2 && !v.error;
    if (!v || !this.clipOk) return;
    if (this.freezeAt !== null) return;                 // tests seek frame by frame
    this.playing = true;
    v.playbackRate = CLIP.rate;
    v.play().catch(() => { this.clipOk = false; });
  }

  /** tests (frozen clock): seek the footage to the frame for clip time `clipT` */
  private driveClip(clipT: number) {
    const v = this.video;
    if (!v || !this.clipOk) { this.clipReady = true; return; }
    if (this.freezeAt === null) return;
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - clipT) > 0.004) { this.clipReady = false; v.currentTime = clipT; }
  }

  private finish() {
    const st = this.stage;
    this.phase = 'idle';
    st.travel.w = 0;
    st.setClip(null, 0);
    this.flash.visible = false;
    this.parkVideo();
    const h = this.hooks;
    this.hooks = null;
    h?.onDone();
  }

  private parkVideo() {
    const v = this.video;
    this.playing = false;
    if (!v) return;
    try { v.pause(); v.currentTime = CLIP.from; } catch { /* not ready */ }
  }

  cancel() {
    this.phase = 'idle';
    this.hooks = null;
    this.stage.travel.w = 0;
    this.stage.setClip(null, 0);
    this.flash.visible = false;
    this.parkVideo();
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
