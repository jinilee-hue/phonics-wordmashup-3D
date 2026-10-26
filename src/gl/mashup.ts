// The card collision ("mashup") in 3D, after the game's intro video:
//   1. contact: the two cards crash into a cartoon fight cloud - white puffs churning around them,
//      candy-coloured streaks shooting out, spinning 3D stars and confetti - while they scuffle;
//   2. the cloud breaks up and drifts away, the two cards still pushing against each other;
//   3. a second pop swallows them and the cloud ring blows outward;
//   4. the compound word's card grows out of the middle (Phaser draws it) over a golden glow and
//      turning god rays, with confetti raining down until the card leaves.
// Everything runs on this module's own clock (update(dt)), so fixed-step captures are exact.
import * as THREE from 'three';
import type { Quality, Stage } from './stage';

const PALETTE = [0xffd23f, 0xff4fa3, 0xff5a5a, 0x3fa7ff, 0xff9a2e, 0x6bd66b, 0x9b6bff, 0x37d6ff];
const STAR_COLS = [0xffd23f, 0xffd23f, 0xffd23f, 0xffc21f, 0x4db8ff, 0xff7ac0];
const AMOUNT: Record<Quality, number> = { high: 1, mid: 0.8, low: 0.55 };
const CAP = { lobe: 260, trail: 44, streak: 64, star: 32, conf: 320 };
// a puff is a little cauliflower of lobes (unit radius 1): x, y, z, r - flatter underneath
const LOBES: [number, number, number, number][] = [
  [0, 0.06, 0, 0.62], [-0.5, -0.1, 0.08, 0.46], [0.52, -0.08, 0.06, 0.48],
  [-0.2, 0.44, 0.02, 0.42], [0.26, 0.38, 0.1, 0.4], [0.02, -0.32, 0.2, 0.44],
];

const CLOUD_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = mat3(instanceMatrix) * n;
#endif
  vec4 mv = modelViewMatrix * p;
  vN = normalize(normalMatrix * n);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
// soft toon cumulus: white top, lavender-blue underside, a bright backlit rim
const CLOUD_FS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 n = normalize(vN);
  float ndl = dot(n, normalize(vec3(-0.35, 0.8, 0.5)));
  vec3 c = mix(vec3(0.70, 0.70, 0.90), vec3(0.89, 0.89, 0.97), smoothstep(-0.6, -0.05, ndl));
  c = mix(c, vec3(1.0, 0.996, 0.985), smoothstep(0.0, 0.5, ndl));
  float rim = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 3.0);
  c = mix(c, vec3(1.0), rim * 0.3);
  gl_FragColor = vec4(c, 1.0);
}`;

const easeOutBack = (x: number) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lin = (a: number, b: number, x: number) => clamp01((x - a) / (b - a));
const smooth = (a: number, b: number, x: number) => { const t = lin(a, b, x); return t * t * (3 - 2 * t); };
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** a candy stroke: thin tail on the left, a fat round head on the right, glossy stripe (tinted per instance) */
const streakTex = () => canvasTex(256, 64, g => {
  const body = (inset: number) => {
    g.beginPath();
    g.moveTo(4, 32);
    g.quadraticCurveTo(120, 32 - 10 + inset, 222, 32 - 24 + inset);
    g.arc(222, 32, 24 - inset, -Math.PI / 2, Math.PI / 2);
    g.quadraticCurveTo(120, 32 + 10 - inset, 4, 32);
    g.closePath();
  };
  body(0); g.fillStyle = '#d9d9d9'; g.fill();
  g.save(); body(0); g.clip();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.ellipse(170, 20, 70, 6, -0.08, 0, Math.PI * 2); g.fill();
  g.restore();
});
/** the smoke a flying puff leaves behind: faint tail on the left, thick soft head on the right */
const trailTex = () => canvasTex(256, 64, g => {
  const gr = g.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(250,250,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(0, 32);
  g.quadraticCurveTo(140, 32 - 12, 226, 32 - 28);
  g.arc(226, 32, 28, -Math.PI / 2, Math.PI / 2);
  g.quadraticCurveTo(140, 32 + 12, 0, 32);
  g.closePath();
  g.filter = 'blur(3px)';
  g.fill();
});
const raysTex = () => canvasTex(512, 512, g => {
  const c = 256;
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, w = (i % 2 ? 0.07 : 0.12);
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,248,215,0.95)'); gr.addColorStop(0.35, 'rgba(255,236,170,0.55)'); gr.addColorStop(1, 'rgba(255,226,140,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(c, c);
    g.arc(c, c, c, a - w, a + w); g.closePath(); g.fill();
  }
});
const glowTex = () => canvasTex(256, 256, g => {
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,246,205,1)'); gr.addColorStop(0.3, 'rgba(255,224,130,0.75)'); gr.addColorStop(0.65, 'rgba(255,200,90,0.25)'); gr.addColorStop(1, 'rgba(255,190,80,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
});

function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.46 : 1, a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.28, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.1, bevelSegments: 3 });
  g.center();
  g.computeVertexNormals();
  return g;
}

type Puff = {
  t0: number; kind: 'fight' | 'pop'; ang: number; r0: number; r1: number; ey: number; z0: number; z1: number;
  size: number; spin: number; drop: number; rot: number; flip: number; lobe: number[]; ph: number[];
};
type Streak = { t0: number; life: number; ang: number; r0: number; v: number; len: number; w: number; z: number; col: THREE.Color };
type Star = { t0: number; life: number; p: THREE.Vector3; v: THREE.Vector3; size: number; axis: THREE.Vector3; spin: number; col: THREE.Color };
type Conf = { t0: number; life: number; p: THREE.Vector3; v: THREE.Vector3; size: number; col: THREE.Color; rain: boolean; fl: number; ph: number };

export class Mashup {
  readonly group = new THREE.Group();
  private t = 0;
  private amount = 1;
  private puffs: Puff[] = [];
  private streaks: Streak[] = [];
  private stars: Star[] = [];
  private confs: Conf[] = [];
  private puffMesh: THREE.InstancedMesh;
  private trailMesh: THREE.InstancedMesh;
  private streakMesh: THREE.InstancedMesh;
  private starMesh: THREE.InstancedMesh;
  private confMesh: THREE.InstancedMesh;
  private rays: THREE.Mesh;
  private glow: THREE.Mesh;
  private centre = new THREE.Vector3();     // world: the contact point
  private base = 600;                       // px: min(W, H)
  private reveal: { t0: number; tEnd: number; x: number; y: number; w: number; h: number; rainAcc: number } | null = null;
  private rainFade = Infinity;              // when the card leaves, the dots still falling shrink away (before the travel)
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private zAxis = new THREE.Vector3(0, 0, 1);
  private pa = new THREE.Vector3();
  private pb = new THREE.Vector3();

  constructor(private stage: Stage) {
    this.puffMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 16),
      new THREE.ShaderMaterial({ vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS }), CAP.lobe);
    this.trailMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: trailTex(), transparent: true, depthWrite: false, toneMapped: false,
    }), CAP.trail);
    this.streakMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: streakTex(), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    }), CAP.streak);
    this.starMesh = new THREE.InstancedMesh(starGeometry(), new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.35, metalness: 0, emissive: 0x2a1a00,
    }), CAP.star);
    // confetti = glossy candy dots (as in the intro), not paper
    this.confMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.32, metalness: 0, emissive: 0x111111,
    }), CAP.conf);
    for (const m of [this.puffMesh, this.trailMesh, this.streakMesh, this.starMesh, this.confMesh]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    // instance colours (allocate up front so the shader variant never changes)
    for (const [m, n] of [[this.streakMesh, CAP.streak], [this.starMesh, CAP.star], [this.confMesh, CAP.conf]] as const) {
      for (let i = 0; i < n; i++) m.setColorAt(i, this.c.set(0xffffff));
      m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    }
    this.streakMesh.renderOrder = 6;
    this.rays = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: raysTex(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    }));
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: glowTex(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    }));
    this.rays.renderOrder = 4; this.glow.renderOrder = 5;
    this.rays.visible = this.glow.visible = false;
    this.trailMesh.renderOrder = 3;
    this.group.add(this.puffMesh, this.trailMesh, this.streakMesh, this.starMesh, this.confMesh, this.rays, this.glow);
    stage.scene.add(this.group);
  }

  setQuality(q: Quality, reduced = false) { this.amount = AMOUNT[q] * (reduced ? 0.5 : 1); }

  private n(k: number) { return Math.max(1, Math.round(k * this.amount)); }

  private newPuff(kind: Puff['kind'], t0: number, ang: number, r0: number, r1: number, ey: number, z0: number, z1: number, size: number, drop: number): Puff {
    return {
      t0, kind, ang, r0, r1, ey, z0, z1, size, drop,
      spin: rnd(0.25, 0.55) * (Math.random() < 0.5 ? -1 : 1), rot: rnd(-0.6, 0.6), flip: Math.random() < 0.5 ? -1 : 1,
      lobe: LOBES.map(() => rnd(0.86, 1.14)), ph: LOBES.map(() => rnd(0, 6.28)),
    };
  }

  /** 1) the crash: puffs burst out of the contact point to a ring around the two cards (leaving trails),
   *  candy streaks shoot out, 3D stars and confetti dots fly; the cloud sinks and melts away by ~1 s. */
  fight(x: number, y: number, base: number) {
    this.base = base;
    this.stage.toWorld(x, y, 0, this.centre);
    const t = this.t;
    // separate clusters (not a wreath), mostly to the sides and below, shooting out like jets
    const N = this.n(13);
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 + rnd(-0.18, 0.18) + 0.2;
      if (Math.sin(ang) > 0.6 && i % 2) continue;                // fewer on top
      const low = Math.sin(ang) < -0.25;                          // the lower ones sink and linger
      this.puffs.push(this.newPuff('fight', t + rnd(0, 0.06), ang, base * rnd(0.02, 0.07), base * rnd(0.28, 0.4), rnd(0.7, 0.8),
        rnd(130, 210), rnd(-20, 110), base * rnd(0.07, 0.095), low ? rnd(0.04, 0.08) : rnd(-0.03, 0.02)));
    }
    this.burstStreaks(this.n(40), 0.03, [1.8, 2.8], [0.55, 0.85]);
    this.burstStars(this.n(16), [0.6, 1.3]);
    this.burstConfetti(this.n(80), [0.5, 1.6]);
  }

  /** 3) the merge: a second pop - a heap of puffs swallows the cards, then blows outward. */
  pop() {
    const t = this.t, base = this.base;
    const N = this.n(11);
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 + rnd(-0.2, 0.2);
      this.puffs.push(this.newPuff('pop', t + rnd(0, 0.04), ang, base * rnd(0.07, 0.16), base * rnd(0.5, 0.66), 0.8,
        rnd(170, 260), rnd(40, 160), base * rnd(0.1, 0.13), 0));
    }
    this.burstStreaks(this.n(36), 0.08, [1.9, 2.9], [0.5, 0.8], PALETTE, [60, 320]);
    this.burstStars(this.n(10), [0.7, 1.35]);
    this.burstConfetti(this.n(60), [0.6, 1.7]);
  }

  /** where puff p is `a` s after it started (world, relative to the centre) and how big (0 = gone) */
  private puffAt(p: Puff, a: number, out: THREE.Vector3) {
    if (a < 0) return 0;
    let r: number, size: number, z: number, sink = 0;
    if (p.kind === 'fight') {
      const grow = easeOutBack(lin(0, 0.14, a));
      const go = easeOutCubic(lin(0.03, 0.42, a));               // out to the ring
      const drift = lin(0.42, 1.0, a);                            // drifting on
      r = (p.r0 + (p.r1 - p.r0) * go) * (1 + 0.16 * drift);
      z = p.z0 + (p.z1 - p.z0) * go;
      sink = p.drop * this.base * drift;
      size = p.size * grow * (1 - smooth(0.6, 0.98, a));
    } else {
      const grow = easeOutBack(lin(0, 0.12, a));
      const go = easeOutCubic(lin(0.15, 0.6, a));                // blown outward
      r = p.r0 + (p.r1 - p.r0) * go;
      z = p.z0 + (p.z1 - p.z0) * go;
      size = p.size * grow * (1 - smooth(0.28, 0.62, a));
    }
    const ang = p.ang + p.spin * a * 0.35;
    out.set(Math.cos(ang) * r, Math.sin(ang) * r * p.ey - sink, z);
    return size;
  }

  /** 4) behind the result card (game px centre and size): glow, turning rays, confetti rain. */
  startReveal(x: number, y: number, w: number, h: number) {
    this.reveal = { t0: this.t, tEnd: Infinity, x, y, w, h, rainAcc: 0 };
    this.rainFade = Infinity;
  }

  stopReveal() {
    if (this.reveal && this.reveal.tEnd === Infinity) this.reveal.tEnd = this.t;
    this.rainFade = this.t;
  }

  private burstStreaks(n: number, r0: number, v: [number, number], life: [number, number], cols = PALETTE, zr: [number, number] = [20, 170]) {
    const t = this.t, base = this.base;
    for (let i = 0; i < n; i++) {
      this.streaks.push({
        t0: t + rnd(0, 0.06), life: rnd(life[0], life[1]), ang: (i / n) * Math.PI * 2 + rnd(-0.25, 0.25),
        r0: base * r0, v: base * rnd(v[0], v[1]), len: base * rnd(0.18, 0.32), w: base * rnd(0.02, 0.034),
        z: rnd(zr[0], zr[1]), col: new THREE.Color(cols[i % cols.length]),
      });
    }
  }

  private burstStars(n: number, v: [number, number]) {
    const t = this.t, base = this.base;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = base * rnd(v[0], v[1]);
      this.stars.push({
        t0: t + rnd(0, 0.08), life: rnd(0.9, 1.3),
        p: this.centre.clone().add(this.v.set(rnd(-0.04, 0.04) * base, rnd(-0.04, 0.04) * base, rnd(60, 190))),
        v: new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp * 0.85 + base * 0.35, rnd(-40, 120)),
        size: base * rnd(0.03, 0.055), axis: new THREE.Vector3(rnd(-0.4, 0.4), rnd(-0.4, 0.4), 1).normalize(),
        spin: rnd(4, 9) * (Math.random() < 0.5 ? -1 : 1), col: new THREE.Color(STAR_COLS[i % STAR_COLS.length]),
      });
    }
  }

  private burstConfetti(n: number, v: [number, number]) {
    const t = this.t, base = this.base;
    for (let i = 0; i < n && this.confs.length < CAP.conf; i++) {
      const a = rnd(0, Math.PI * 2), sp = base * rnd(v[0], v[1]);
      this.confs.push({
        t0: t, life: rnd(1.3, 2.1), rain: false, fl: 0, ph: 0,
        p: this.centre.clone().add(this.v.set(0, 0, rnd(40, 200))),
        v: new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp + base * 0.45, rnd(-100, 140)),
        size: base * rnd(0.006, 0.011), col: new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]),
      });
    }
  }

  get busy() { return this.puffs.length + this.streaks.length + this.stars.length + this.confs.length > 0 || !!this.reveal; }

  update(dt: number) {
    this.t += dt;
    const t = this.t, base = this.base, C = this.centre;
    // ---- cloud puffs: opaque lobe clusters (depth-tested against the cards), smoke trails while they fly
    let n = 0, nt = 0;
    this.puffs = this.puffs.filter(p => {
      const a = t - p.t0;
      if (a > (p.kind === 'fight' ? 1.0 : 0.64)) return false;
      const size = this.puffAt(p, a, this.pa);
      if (size < 0.5) return true;
      const cr = Math.cos(p.rot), sr = Math.sin(p.rot);
      for (let i = 0; i < LOBES.length && n < CAP.lobe; i++) {
        const [lx, ly, lz, lr] = LOBES[i];
        const x = lx * p.flip, rr = lr * p.lobe[i] * (1 + 0.06 * Math.sin(a * 9 + p.ph[i]));
        this.v.set(C.x + this.pa.x + (x * cr - ly * sr) * size, C.y + this.pa.y + (x * sr + ly * cr) * size, this.pa.z + lz * size);
        this.m4.compose(this.v, this.q.identity(), this.s.setScalar(rr * size));
        this.puffMesh.setMatrixAt(n++, this.m4);
      }
      // jet trail (as in the intro): smoke pointing back to where it was shot from, thinning out
      const k = p.kind === 'fight' ? 1 - smooth(0.3, 0.85, a) : smooth(0.12, 0.2, a) * (1 - smooth(0.4, 0.6, a));
      const r = Math.hypot(this.pa.x, this.pa.y);
      if (k > 0.02 && r > size * 0.8 && nt < CAP.trail) {
        this.puffAt(p, Math.max(0, a - 0.22), this.pb);
        const lag = Math.hypot(this.pa.x - this.pb.x, this.pa.y - this.pb.y);
        const len = THREE.MathUtils.clamp(lag * 1.3, size * 1.3, size * 3.6) * (0.5 + 0.5 * k);
        const ux = this.pa.x / r, uy = this.pa.y / r;
        this.q.setFromAxisAngle(this.zAxis, Math.atan2(uy, ux));
        this.m4.compose(this.v.set(C.x + this.pa.x - ux * (len / 2 - size * 0.35), C.y + this.pa.y - uy * (len / 2 - size * 0.35), this.pa.z - size * 0.4),
          this.q, this.s.set(len, size * 1.3 * Math.sqrt(k), 1));
        this.trailMesh.setMatrixAt(nt++, this.m4);
      }
      return true;
    });
    this.puffMesh.count = n;
    this.puffMesh.instanceMatrix.needsUpdate = true;
    this.trailMesh.count = nt;
    this.trailMesh.instanceMatrix.needsUpdate = true;
    // ---- streaks: fly out from the middle, decelerate, thin out
    n = 0;
    this.streaks = this.streaks.filter(s => {
      const a = t - s.t0;
      if (a > s.life) return false;
      if (a < 0) return true;
      const u = a / s.life;
      const head = s.r0 + s.v * a * (1 - 0.45 * u);
      const len = s.len * Math.min(1, a / 0.07) * (1 - 0.35 * u);
      const w = s.w * (1 - smooth(0.6, 1, u));
      const mid = head - len / 2;
      this.q.setFromAxisAngle(this.zAxis, s.ang);
      this.m4.compose(this.v.set(C.x + Math.cos(s.ang) * mid, C.y + Math.sin(s.ang) * mid, s.z), this.q, this.s.set(len, w, 1));
      this.streakMesh.setMatrixAt(n, this.m4);
      this.streakMesh.setColorAt(n, s.col);
      n++;
      return true;
    });
    this.streakMesh.count = n;
    this.streakMesh.instanceMatrix.needsUpdate = true;
    if (this.streakMesh.instanceColor) this.streakMesh.instanceColor.needsUpdate = true;
    // ---- 3D stars: ballistic, spinning, pop in / shrink out
    n = 0;
    const g = base * 0.95;
    this.stars = this.stars.filter(s => {
      const a = t - s.t0;
      if (a > s.life) return false;
      if (a < 0) return true;
      const sc = s.size * easeOutBack(lin(0, 0.12, a)) * (1 - smooth(0.72, 1, a / s.life));
      this.v.copy(s.p).addScaledVector(s.v, a);
      this.v.y -= 0.5 * g * a * a;
      this.q.setFromAxisAngle(s.axis, s.spin * a);
      this.m4.compose(this.v, this.q, this.s.setScalar(Math.max(sc, 1e-3)));
      this.starMesh.setMatrixAt(n, this.m4);
      this.starMesh.setColorAt(n, s.col);
      n++;
      return true;
    });
    this.starMesh.count = n;
    this.starMesh.instanceMatrix.needsUpdate = true;
    if (this.starMesh.instanceColor) this.starMesh.instanceColor.needsUpdate = true;
    // ---- reveal: glow + rays behind the card, confetti rain while it stays
    const R = this.reveal;
    if (R) {
      const W = this.stage.W, H = this.stage.H;
      // (tEnd is Infinity until the card leaves: Infinity - Infinity would be NaN)
      const on = smooth(0, 0.3, t - R.t0) * (R.tEnd === Infinity ? 1 : 1 - smooth(R.tEnd, R.tEnd + 0.35, t));
      if (t > R.tEnd + 0.4) this.reveal = null;
      else {
        this.stage.toWorld(R.x, R.y, -30, this.rays.position);
        this.glow.position.copy(this.rays.position).setZ(-28);
        this.rays.scale.setScalar(R.w * 3.3 * (0.85 + 0.15 * on));
        this.rays.rotation.z = -0.22 * (t - R.t0);
        this.glow.scale.setScalar(R.w * 2.5 * (1 + 0.04 * Math.sin((t - R.t0) * 3)));
        (this.rays.material as THREE.MeshBasicMaterial).opacity = 0.62 * on;
        (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.85 * on;
        this.rays.visible = this.glow.visible = on > 0.002;
        // rain: from above the screen, across the play area, while the card is up
        if (t < R.tEnd && t - R.t0 > 0.1) {
          R.rainAcc += dt * 60 * this.amount;
          while (R.rainAcc >= 1 && this.confs.length < CAP.conf) {
            R.rainAcc -= 1;
            const wx = rnd(-0.55, 0.55) * W, wy = H / 2 + rnd(0.02, 0.12) * H;
            this.confs.push({
              t0: t, life: rnd(2.2, 3.2), rain: true, fl: rnd(8, 22), ph: rnd(0, 6.28),
              p: new THREE.Vector3(wx, wy, rnd(-80, 160)), v: new THREE.Vector3(0, -rnd(0.22, 0.4) * H, 0),
              size: base * rnd(0.005, 0.01), col: new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]),
            });
          }
        }
      }
    } else {
      this.rays.visible = this.glow.visible = false;
    }
    // ---- confetti: burst (linear drag + gravity) or rain (fall + flutter); tumbling shade
    n = 0;
    const gc = base * 1.1, drag = 1.6;
    const bottom = -this.stage.H / 2 - 40;
    this.confs = this.confs.filter(f => {
      const a = t - f.t0;
      if (a > f.life) return false;
      if (f.rain) {
        this.v.set(f.p.x + Math.sin(f.ph + a * 3.2) * f.fl, f.p.y + f.v.y * a, f.p.z);
      } else {
        const e = (1 - Math.exp(-drag * a)) / drag;
        this.v.set(f.p.x + f.v.x * e, f.p.y + (f.v.y + gc / drag) * e - (gc / drag) * a, f.p.z + f.v.z * e);
      }
      if (this.v.y < bottom) return false;
      let sc = f.size * easeOutBack(lin(0, 0.12, a)) * (1 - smooth(0.8, 1, a / f.life));
      if (f.rain && t > this.rainFade) {
        const k = 1 - smooth(this.rainFade, this.rainFade + 0.45, t);
        if (k <= 0) return false;
        sc *= k;
      }
      this.m4.compose(this.v, this.q.identity(), this.s.setScalar(Math.max(sc, 1e-3)));
      this.confMesh.setMatrixAt(n, this.m4);
      this.confMesh.setColorAt(n, f.col);
      n++;
      return true;
    });
    this.confMesh.count = n;
    this.confMesh.instanceMatrix.needsUpdate = true;
    if (this.confMesh.instanceColor) this.confMesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.puffs = []; this.streaks = []; this.stars = []; this.confs = [];
    this.reveal = null;
    this.rainFade = Infinity;
    for (const m of [this.puffMesh, this.trailMesh, this.streakMesh, this.starMesh, this.confMesh]) m.count = 0;
    this.rays.visible = this.glow.visible = false;
  }

  dispose() {
    this.clear();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material & { map?: THREE.Texture } | undefined;
      if (mat) { mat.map?.dispose(); mat.dispose(); }
    });
    this.group.removeFromParent();
  }
}
