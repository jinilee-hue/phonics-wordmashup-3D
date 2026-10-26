// The Gravity Zone, as in the game's intro video (user: "gravityzone도 인트로와 같게 만들어줘"):
// an upright neon badge hovering over the stage - a deep violet disc you can faintly see through, a thick
// hot-pink neon ring with plasma wisps crackling round it, a thin lavender inner ring, "Gravity / Zone" in
// white rounded letters with a soft glow, twinkles on the ring, and sparkles rising from the neon floor rings
// that the backdrop painting already has under it. After a warp it rises up out of the floor (reform()).
// Gameplay keeps GameScene's zone (cx, cy, zoneR): the badge is drawn behind the cards that land in it.
import * as THREE from 'three';
import type { Quality, Stage } from './stage';
import { dotTexture } from './textures';

const PINK = '#FF4FD3';
const CYAN = '#5BE7FF';
/** the neon floor rings painted under the zone (painting coords, measured on game_bg.png) */
const FLOOR = { u: 0.5, v: 0.795, ru: 0.13, rv: 0.05 };
const BADGE = 0.86;                    // badge radius / zoneR
const INNER = 0.85;                    // thin inner ring radius / badge radius (intro: 93 / 113 px)

const POINT_VS = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uPx;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPx / -mv.z;
  vColor = aColor;
  vAlpha = aAlpha;
}`;
const POINT_FS = /* glsl */`
uniform sampler2D uTex;
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha * uOpacity);
}`;

const NOISE = /* glsl */`
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
`;
const LOCAL_VS = /* glsl */`
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// the disc: dark indigo glass - navy at the top, plum toward the bottom where the stage shows faintly through
// (sampled from the intro: top ~(50,58,111), bottom ~(86,45,83) over the stage)
const DISC_FS = /* glsl */`
uniform float uR;
uniform float uTime;
uniform float uOpacity;
uniform float uHeat;
varying vec2 vP;
${NOISE}
void main() {
  float r = length(vP) / uR;
  if (r > 1.0) discard;
  float th = atan(vP.y, vP.x);
  float v = vP.y / uR;                                          // +1 top .. -1 bottom
  vec3 top = vec3(0.10, 0.12, 0.36), bot = vec3(0.26, 0.11, 0.32);
  vec3 c = mix(bot, top, smoothstep(-0.9, 0.7, v));
  float swirl = fbm(vec2(th * 1.3 + uTime * 0.18 - r * 2.0, r * 2.4 - uTime * 0.25));
  c += vec3(0.16, 0.08, 0.26) * smoothstep(0.5, 0.9, swirl) * (0.4 + 0.6 * r) * (0.8 + 0.3 * uHeat);
  c = mix(c, vec3(0.55, 0.22, 0.62), smoothstep(0.80, 1.0, r) * 0.55);   // pink light bleeding in from the ring
  float a = mix(0.74, 0.93, smoothstep(-0.8, 0.5, v));         // more see-through low down
  a = mix(a, 0.95, smoothstep(0.85, 1.0, r)) * (1.0 - smoothstep(0.99, 1.0, r));
  gl_FragColor = vec4(c, a * uOpacity);
}`;
// the neon ring as in the intro: a thin white-hot tube with a pink glow, a thin lavender ring inside it and pink
// plasma arcs crackling round the outside. Composited front-to-back in premultiplied alpha (normal blending):
// an additive glow turned white over the bright sky.
const RING_FS = /* glsl */`
uniform float uR;
uniform float uRi;
uniform float uTime;
uniform float uOpacity;
uniform float uHeat;
varying vec2 vP;
${NOISE}
vec4 over(vec4 dst, vec3 c, float a) { return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a)); }
void main() {
  float r = length(vP);
  float th = atan(vP.y, vP.x);
  float d = (r - uR) / uR, di = (r - uRi) / uR;
  float heat = 0.85 + 0.3 * uHeat;
  float glow = d < 0.0 ? exp(-pow(d / 0.11, 2.0)) * 0.85
                       : exp(-pow(d / 0.17, 2.0)) * 0.82 + exp(-pow(d / 0.36, 2.0)) * 0.34;
  float core = exp(-pow(d / 0.042, 2.0));
  float iglow = exp(-pow(di / 0.06, 2.0)) * 0.6;
  float icore = exp(-pow(di / 0.02, 2.0)) * 0.8;
  float s = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float off = fbm(vec2(th * (2.2 + fk) + fk * 7.0, uTime * (0.8 + 0.3 * fk) + fk * 3.1)) * 0.3 - 0.04;
    float dd = abs(d - off);
    float w = 0.02 + 0.012 * fk;
    float gate = smoothstep(0.3, 0.62, noise(vec2(th * 2.6 + fk * 5.0, uTime * 0.6 + fk)));   // arcs come and go
    s += exp(-dd * dd / (w * w)) * gate * (0.95 - 0.2 * fk);
  }
  s = clamp(s, 0.0, 1.0);
  vec3 pink = vec3(1.0, 0.56, 0.9), haze = vec3(0.86, 0.58, 1.0), hot = vec3(1.0, 0.66, 0.94);
  vec3 lav = vec3(0.72, 0.5, 1.0), white = vec3(1.0, 0.95, 1.0);
  vec4 acc = vec4(0.0);
  acc = over(acc, mix(pink, haze, smoothstep(0.05, 0.3, abs(d))), clamp(glow * heat, 0.0, 1.0));
  acc = over(acc, mix(pink, white, s * 0.55), s * 0.8);
  acc = over(acc, lav, iglow);
  acc = over(acc, vec3(0.92, 0.84, 1.0), icore);
  acc = over(acc, mix(hot, white, smoothstep(0.35, 0.9, core)), clamp(core * 1.15, 0.0, 1.0));
  gl_FragColor = acc * uOpacity;                                  // premultiplied
}`;

/** A batch of soft additive points whose position/colour/size/alpha are written on the CPU. */
class GlowPoints {
  readonly points: THREE.Points;
  readonly pos: Float32Array; readonly col: Float32Array; readonly size: Float32Array; readonly alpha: Float32Array;
  readonly mat: THREE.ShaderMaterial;
  constructor(n: number, tex: THREE.Texture) {
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VS, fragmentShader: POINT_FS,
      uniforms: { uTex: { value: tex }, uPx: { value: 500 }, uOpacity: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }
  set(i: number, x: number, y: number, z: number, c: THREE.Color, size: number, alpha: number) {
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.size[i] = size; this.alpha[i] = alpha;
  }
  flush() {
    const g = this.points.geometry;
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha']) g.getAttribute(k).needsUpdate = true;
  }
}

// sRGB display colours: stored raw (the point shader writes them straight to the sRGB buffer)
const disp = (hex: string) => new THREE.Color().setRGB(
  parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255,
  THREE.LinearSRGBColorSpace,
);

/** "Gravity / Zone" as in the intro: heavy rounded letters, white with a cool cyan tint and a soft cyan glow */
function badgeTextTexture(px: number) {
  const lines = ['Gravity', 'Zone'];
  const font = `800 ${px}px "Baloo 2", "Fredoka", sans-serif`;
  const c = document.createElement('canvas');
  const g0 = c.getContext('2d')!;
  g0.font = font;
  const textW = Math.max(...lines.map(l => g0.measureText(l).width));
  const pad = Math.round(px * 0.5);
  const w = Math.ceil(textW + pad * 2);
  const lh = px * 0.92, h = Math.ceil(lh * lines.length + pad * 2);
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  const y0 = h / 2 - (lh * (lines.length - 1)) / 2 + px * 0.05;
  const draw = (fill: string, blur: number, color: string, dy = 0) => {
    g.save();
    g.shadowColor = color; g.shadowBlur = blur; g.shadowOffsetY = dy; g.fillStyle = fill;
    lines.forEach((l, i) => g.fillText(l, w / 2, y0 + i * lh));
    g.restore();
  };
  draw('rgba(120,215,255,0.55)', px * 0.42, 'rgba(110,210,255,0.95)');        // soft cyan glow
  draw('rgba(20,10,70,0.55)', px * 0.06, 'rgba(20,0,60,0.7)', px * 0.04);    // contact shadow
  draw('#EAFBFF', px * 0.08, 'rgba(190,240,255,0.9)');                        // the letters
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, w, h, textW };
}

type Floater = { th: number; r: number; ph: number; sp: number; c: THREE.Color; s: number };
type Riser = { u: number; ph: number; sp: number; rise: number; c: THREE.Color; s: number };

export class Zone3D {
  readonly group = new THREE.Group();
  private badge = new THREE.Group();
  private R = 0;
  private built = false;
  private quality: Quality = 'high';
  private dot = dotTexture(64);
  private mats: { m: THREE.Material & { opacity: number }; base: number; heat: number }[] = [];
  private shaders: THREE.ShaderMaterial[] = [];
  private text?: THREE.Mesh;
  private twinkles?: GlowPoints;
  private twSeed: Floater[] = [];
  private sparks?: GlowPoints;
  private spSeed: Riser[] = [];
  private floor = new THREE.Vector3();
  private floorR = { x: 150, y: 30 };
  private flare = 0;
  private reformT0 = -1;
  private v = new THREE.Vector3();
  /** clock (s) for the rise-up animation; the travel clock, so frozen test frames stay in sync */
  clock: () => number = () => performance.now() / 1000;

  constructor(private stage: Stage) {
    stage.scene.add(this.group);
    this.group.add(this.badge);
  }

  place(cx: number, cy: number, R: number, quality: Quality) {
    if (!this.built || Math.abs(R - this.R) > 0.5 || quality !== this.quality) {
      this.quality = quality;
      this.build(R);
    }
    this.stage.toWorld(cx, cy, -25, this.group.position);
    // the painted floor rings: where the painting puts them on screen (rest camera), relative to the badge
    const st = this.stage, p = st.paintingPoint(FLOOR.u, FLOOR.v, this.v).project(st.overlayCam);
    const fx = ((p.x + 1) / 2) * st.W, fy = ((1 - p.y) / 2) * st.H;
    this.floor.set(fx - cx, cy - fy, 0);
    const q = st.paintingPoint(FLOOR.u + FLOOR.ru, FLOOR.v + FLOOR.rv, this.v).project(st.overlayCam);
    this.floorR.x = Math.max(40, ((q.x + 1) / 2) * st.W - fx);
    this.floorR.y = Math.max(10, ((1 - q.y) / 2) * st.H - fy);
  }

  /** A short brighten when two cards crash together in the zone. */
  pulse() { this.flare = 1; }

  /** The badge rises up out of the floor (after a warp, and at the start). */
  reform() { this.reformT0 = this.clock(); this.flare = 1; this.group.visible = true; }

  /** Gone while the arrival footage plays (it rises again with reform()). */
  hide() { this.group.visible = false; }

  private track<T extends THREE.Material & { opacity: number }>(m: T, base: number, heat = 0) {
    this.mats.push({ m, base, heat });
    return m;
  }

  private build(R: number) {
    for (const c of [...this.badge.children, ...this.group.children.filter(c => c !== this.badge)]) {
      c.removeFromParent();
      c.traverse(o => { const mesh = o as THREE.Mesh; mesh.geometry?.dispose(); });
    }
    this.mats.forEach(e => e.m.dispose());
    this.shaders.forEach(m => m.dispose());
    this.mats = []; this.shaders = [];
    this.R = R;
    const Rb = R * BADGE, b = this.badge;

    // the disc
    const disc = new THREE.ShaderMaterial({
      vertexShader: LOCAL_VS, fragmentShader: DISC_FS, transparent: true, depthWrite: false,
      uniforms: { uR: { value: Rb }, uTime: { value: 0 }, uOpacity: { value: 1 }, uHeat: { value: 0 } },
    });
    this.shaders.push(disc);
    const discM = new THREE.Mesh(new THREE.CircleGeometry(Rb, 128), disc);
    discM.renderOrder = -1;
    b.add(discM);

    // the neon ring (outer tube + glow + inner thin ring + plasma arcs), one shader
    const ring = new THREE.ShaderMaterial({
      vertexShader: LOCAL_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, premultipliedAlpha: true,
      uniforms: { uR: { value: Rb }, uRi: { value: Rb * INNER }, uTime: { value: 0 }, uOpacity: { value: 1 }, uHeat: { value: 0 } },
    });
    this.shaders.push(ring);
    const ringM = new THREE.Mesh(new THREE.RingGeometry(Rb * (INNER - 0.12), Rb * 1.5, 256, 1), ring);
    ringM.position.z = 2;
    b.add(ringM);

    // "Gravity / Zone"
    const px = Math.round(Rb * 0.5) * 2;
    const make = () => {
      const { tex, w, h, textW } = badgeTextTexture(px);
      const scale = (Rb * 1.4) / textW;                          // "Gravity" spans ~1.4 x the ring radius (intro)
      return { tex, w: w * scale, h: h * scale };
    };
    const t0 = make();
    this.text = new THREE.Mesh(new THREE.PlaneGeometry(t0.w, t0.h), this.track(new THREE.MeshBasicMaterial({
      map: t0.tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    }), 1, 0));
    this.text.position.set(0, Rb * 0.03, 4);
    b.add(this.text);
    document.fonts?.load(`800 ${px}px "Baloo 2"`).then(() => {
      if (!this.text) return;
      const mat = this.text.material as THREE.MeshBasicMaterial;
      mat.map?.dispose(); mat.map = make().tex; mat.needsUpdate = true;
    }).catch(() => {});

    // twinkles riding the ring
    const NT = this.quality === 'low' ? 14 : 26;
    this.twinkles = new GlowPoints(NT, this.dot);
    this.twSeed = [];
    const tw = [disp('#ffffff'), disp('#ffc6f1'), disp(PINK), disp('#d7b8ff')];
    for (let i = 0; i < NT; i++) {
      this.twSeed.push({ th: Math.random() * Math.PI * 2, r: Rb * (0.98 + Math.random() * 0.3), ph: Math.random(), sp: 0.5 + Math.random() * 1.1, c: tw[i % tw.length], s: 4 + Math.random() * 6 });
    }
    b.add(this.twinkles.points);

    // sparkles rising from the painted floor rings
    const NS = this.quality === 'high' ? 70 : this.quality === 'mid' ? 46 : 24;
    this.sparks = new GlowPoints(NS, this.dot);
    this.spSeed = [];
    const sc = [disp(PINK), disp(CYAN), disp('#fff3a6'), disp('#b6ff9e'), disp('#ffffff')];
    for (let i = 0; i < NS; i++) {
      this.spSeed.push({ u: Math.random() * Math.PI * 2, ph: Math.random(), sp: 0.28 + Math.random() * 0.35, rise: 0.45 + Math.random() * 0.75, c: sc[i % sc.length], s: 4 + Math.random() * 7 });
    }
    this.group.add(this.sparks.points);
    this.built = true;
  }

  update(t: number, dt: number, alpha: number, pxPerUnit: number) {
    if (!this.built) return;
    const R = this.R, Rb = R * BADGE;
    // rise up out of the floor: small and low -> overshoot -> hover
    let rise = 1;
    if (this.reformT0 >= 0) {
      const p = (this.clock() - this.reformT0) / 0.75;
      if (p >= 1) this.reformT0 = -1;
      else rise = Math.max(0, p);
    }
    const c1 = 1.70158, c3 = c1 + 1, x = rise - 1;
    const e = rise >= 1 ? 1 : 1 + c3 * x * x * x + c1 * x * x;          // easeOutBack
    const bob = Math.sin(t * 1.6) * Rb * 0.025;
    this.badge.position.set(this.floor.x * (1 - e), this.floor.y * (1 - e) + bob * e, 0);
    this.badge.scale.setScalar(0.18 + 0.82 * e);
    const appear = Math.min(1, rise * 2.2);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    const heat = pulse * (0.85 + 0.15 * Math.sin(t * 9.0));
    this.flare = Math.max(0, this.flare - dt * 1.6);
    const boost = 1 + this.flare * 1.1;
    const vis = Math.min(1, alpha / 0.78);                       // GameScene breathes its zone 0.78..1: stay steady
    const a = vis * vis * (3 - 2 * vis) * appear;
    for (const m of this.mats) m.m.opacity = Math.min(1, (m.base + m.heat * (0.35 + heat * 0.95)) * a * boost);
    for (const s of this.shaders) {
      s.uniforms.uTime.value = t;
      s.uniforms.uHeat.value = heat + this.flare;
      s.uniforms.uOpacity.value = Math.min(1, a * boost);
    }
    if (this.text) this.text.scale.setScalar(1 + pulse * 0.015);
    if (this.twinkles) {
      this.twSeed.forEach((p, i) => {
        const k = (t * p.sp + p.ph) % 1, tw = Math.pow(Math.sin(k * Math.PI), 3);
        const th = p.th + t * 0.35;
        this.twinkles!.set(i, Math.cos(th) * p.r, Math.sin(th) * p.r, 6, p.c, p.s * (0.5 + 0.7 * tw), tw);
      });
      this.twinkles.flush();
      this.twinkles.mat.uniforms.uPx.value = pxPerUnit;
      this.twinkles.mat.uniforms.uOpacity.value = Math.min(1, a * boost);
    }
    if (this.sparks) {
      const F = this.floor, fr = this.floorR;
      const burst = this.reformT0 >= 0 ? 1.8 : 1;
      this.spSeed.forEach((p, i) => {
        const life = (t * p.sp * burst + p.ph) % 1;
        const ang = p.u + Math.sin(t * 0.3 + i) * 0.05;
        const x0 = F.x + Math.cos(ang) * fr.x * (0.75 + 0.3 * Math.sin(i * 1.7));
        const y0 = F.y + Math.sin(ang) * fr.y;
        const y = y0 + life * Rb * p.rise;
        const fade = Math.min(1, life / 0.15) * (1 - Math.max(0, (life - 0.6) / 0.4));
        this.sparks!.set(i, x0 + Math.sin(life * 6 + i) * 3, y, 4, p.c, p.s * (1 - 0.4 * life), fade * 0.9);
      });
      this.sparks.flush();
      this.sparks.mat.uniforms.uPx.value = pxPerUnit;
      this.sparks.mat.uniforms.uOpacity.value = Math.min(1, vis * boost);
    }
  }
}
