// The Gravity Zone as a 3D "gravity well".
//
// Same motifs and colours as the 2D zone (pink/cyan neon rings, tick ring, comets, GRAVITY/ZONE
// text, radial floor grid), rebuilt in depth: the floor grid bends into a funnel, the two inner
// rings swing like a gyroscope, and particles spiral down the well.
import * as THREE from 'three';
import type { Quality, Stage } from './stage';
import { dotTexture, hazeTexture, neonTextTexture, ringGlowTexture } from './textures';

const PINK = '#FF2DA0';
const CYAN = '#00E0FF';
const MAGENTA = '#FF5BFD';

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

const FUNNEL_VS = /* glsl */`
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FUNNEL_FS = /* glsl */`
uniform float uR;
uniform float uTime;
uniform float uOpacity;
uniform float uHeat;
uniform vec3 uLine;
uniform vec3 uHole;
uniform vec3 uPink;
varying vec3 vLocal;
float lineAA(float x, float px) {
  float d = abs(fract(x + 0.5) - 0.5);
  float w = fwidth(x);
  return 1.0 - smoothstep(w * (px - 0.6), w * (px + 0.6), d);
}
void main() {
  float r = length(vLocal.xz) / uR;
  float th = atan(vLocal.z, vLocal.x);
  // 12 spokes, slightly twisted like a drain; rings flow inward (log spacing = constant on screen)
  float spokes = lineAA((th + 0.28 / max(r, 0.18)) * 12.0 / 6.2831853, 1.3);
  float rings = lineAA(log(max(r, 1e-3)) * 3.4 + uTime * 0.42, 1.5);
  float outer = 1.0 - smoothstep(1.35, 1.9, r);
  float inner = smoothstep(0.16, 0.42, r);
  float lines = max(spokes * 0.55, rings) * outer * inner;
  float hole = 1.0 - smoothstep(0.12, 0.85, r);
  vec3 col = mix(uHole, uLine, lines);
  col = mix(col, uPink, (1.0 - smoothstep(0.0, 0.08, abs(r - 0.52))) * 0.6 * lines);
  float a = max(hole * 0.55, lines * (0.55 + 0.3 * uHeat));
  gl_FragColor = vec4(col, a * uOpacity);
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

function basic(color: string, opacity: number, additive = true, map?: THREE.Texture) {
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, toneMapped: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  if (map) m.map = map;
  return m;
}

export class Zone3D {
  readonly group = new THREE.Group();
  private R = 0;
  private built = false;
  private quality: Quality = 'high';
  private dot = dotTexture(64);
  private haze = hazeTexture(256);
  private glowWide = ringGlowTexture(512, 0.8, 0.075);
  private glowTight = ringGlowTexture(512, 0.8, 0.03);
  // parts
  private mats: { m: THREE.Material & { opacity: number }; base: number; heat: number }[] = [];
  private midRing = new THREE.Group();
  private innerRing = new THREE.Group();
  private spin = new THREE.Group();
  private wellG = new THREE.Group();
  private funnelMat?: THREE.ShaderMaterial;
  private texts: THREE.Mesh[] = [];
  private comets?: GlowPoints;
  private vortex?: GlowPoints;
  private vortexSeed: { th: number; sp: number; ph: number; c: THREE.Color; s: number }[] = [];
  private flare = 0;
  private reformT0 = -1;
  /** clock (s) for the re-form animation; the travel clock, so frozen test frames stay in sync */
  clock: () => number = () => performance.now() / 1000;

  constructor(private stage: Stage) {
    stage.scene.add(this.group);
  }

  well(r: number) { return -this.R * 0.95 / (1 + (r / (0.42 * this.R)) ** 2); }

  place(cx: number, cy: number, R: number, quality: Quality) {
    if (!this.built || Math.abs(R - this.R) > 0.5 || quality !== this.quality) {
      this.quality = quality;
      this.build(R);
    }
    this.stage.toWorld(cx, cy, -25, this.group.position);
  }

  /** A short brighten when two cards crash together in the zone. */
  pulse() { this.flare = 1; }

  /** After the warp: the zone grows back from small with a flare. */
  reform() { this.reformT0 = this.clock(); this.flare = 1; }

  private track<T extends THREE.Material & { opacity: number }>(m: T, base: number, heat = 0) {
    this.mats.push({ m, base, heat });
    return m;
  }

  private build(R: number) {
    for (const c of [...this.group.children]) {
      c.removeFromParent();
      c.traverse(o => { const mesh = o as THREE.Mesh; mesh.geometry?.dispose(); });
    }
    this.mats.forEach(e => e.m.dispose());
    this.mats = [];
    this.funnelMat?.dispose();
    this.texts = [];
    this.midRing = new THREE.Group();
    this.innerRing = new THREE.Group();
    this.spin = new THREE.Group();
    this.wellG = new THREE.Group();
    this.R = R;
    const g = this.group;

    // ── haze (bloom fill) behind everything ─────────────────────────────────
    const hazeP = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.track(basic(PINK, 0, true, this.haze), 0.05, 0.12));
    hazeP.scale.setScalar(R * 3.4); hazeP.position.z = -R * 0.3;
    const hazeC = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.track(basic(CYAN, 0, true, this.haze), 0.04, 0.09));
    hazeC.scale.setScalar(R * 2.8); hazeC.position.z = -R * 0.28;
    g.add(hazeP, hazeC);

    // ── gravity well: the 2D floor grid (spokes + rings) on a funnel surface. The rings flow
    //    inward and the centre darkens into a hole, so the depth reads even at a glance.
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 64; i++) {
      const r = R * (0.06 + 1.9 * Math.pow(i / 64, 1.35));
      prof.push(new THREE.Vector2(r, this.well(r)));
    }
    const funnelGeo = new THREE.LatheGeometry(prof, 128);
    this.funnelMat = new THREE.ShaderMaterial({
      vertexShader: FUNNEL_VS, fragmentShader: FUNNEL_FS,
      uniforms: {
        uR: { value: R }, uTime: { value: 0 }, uOpacity: { value: 1 }, uHeat: { value: 0 },
        uLine: { value: disp(CYAN) }, uHole: { value: disp('#220c4c') }, uPink: { value: disp(PINK) },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const funnel = new THREE.Mesh(funnelGeo, this.funnelMat);
    funnel.rotation.x = Math.PI / 2;           // lathe axis (y) -> well depth (z)
    funnel.renderOrder = -2;
    this.wellG.add(funnel);

    // ── rings: outer stays facing you (it is the drop target), the inner two swing ──
    const ring = (radius: number, tube: number, core: string, glow: string, parent: THREE.Object3D, wide: number, tight: number) => {
      const torus = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 180), this.track(basic(core, 0, false), 1, 0));
      const plane = new THREE.PlaneGeometry(1, 1);
      const gw = new THREE.Mesh(plane, this.track(basic(glow, 0, true, this.glowWide), wide * 0.25, wide * 0.5));
      const gt = new THREE.Mesh(plane, this.track(basic(glow, 0, true, this.glowTight), tight * 0.6, tight * 0.7));
      gw.scale.setScalar(radius * 2 / 0.8); gt.scale.setScalar(radius * 2 / 0.8);
      parent.add(gw, gt, torus);
    };
    const outer = new THREE.Group();
    ring(R, 2.1, '#ff8fcf', PINK, outer, 0.85, 1.0);
    ring(R * 0.76, 1.5, '#9ff4ff', CYAN, this.midRing, 0.6, 0.6);
    ring(R * 0.52, 1.5, '#ff9fd6', PINK, this.innerRing, 0.5, 0.55);
    g.add(outer, this.midRing, this.innerRing);

    // far cyan halo rings
    for (const [dr, a] of [[26, 0.3], [52, 0.15], [85, 0.07]] as const) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(R + dr, 1.1, 6, 160), this.track(basic(CYAN, 0, true), a, 0));
      g.add(t);
    }

    // ── spinning tick ring + neon dots (as drawSpinRing) ────────────────────
    const tickGeo = new THREE.BoxGeometry(1, 1, 1.5);
    const ticks = new THREE.InstancedMesh(tickGeo, this.track(new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }), 1, 0), 24);
    const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const v = new THREE.Vector3(); const s = new THREE.Vector3();
    for (let i = 0; i < 24; i++) {
      const deg = i * 15;
      const major = deg % 45 === 0;
      const a = THREE.MathUtils.degToRad(deg);
      const r0 = R + 8, r1 = R + (major ? 32 : 20);
      const mid = (r0 + r1) / 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
      m4.compose(v.set(Math.cos(a) * mid, Math.sin(a) * mid, 0), q, s.set(r1 - r0, major ? 3.5 : 1.6, 1));
      ticks.setMatrixAt(i, m4);
      ticks.setColorAt(i, new THREE.Color(major ? MAGENTA : CYAN).multiplyScalar(major ? 1 : 0.6));
    }
    this.spin.add(ticks);
    const dots = new GlowPoints(24, this.dot);
    for (let i = 0; i < 12; i++) {
      const a = THREE.MathUtils.degToRad(i * 30);
      const c = disp(i % 2 === 0 ? MAGENTA : CYAN);
      dots.set(i * 2, Math.cos(a) * (R + 48), Math.sin(a) * (R + 48), 0, c, 26, 0.55);
      dots.set(i * 2 + 1, Math.cos(a) * (R + 48), Math.sin(a) * (R + 48), 0.5, c.clone().lerp(new THREE.Color(1, 1, 1), 0.35), 10, 1);
    }
    dots.flush();
    this.track(dots.mat as unknown as THREE.Material & { opacity: number }, 1, 0);
    this.spin.add(dots.points);
    g.add(this.spin);

    // ── comets racing round the main ring ───────────────────────────────────
    this.comets = new GlowPoints(3 * 9, this.dot);
    g.add(this.comets.points);

    // ── vortex: particles spiralling down the well ──────────────────────────
    const N = this.quality === 'high' ? 240 : this.quality === 'mid' ? 150 : 80;
    this.vortex = new GlowPoints(N, this.dot);
    this.vortexSeed = [];
    const palette = [disp(PINK), disp(CYAN), disp('#ffffff'), disp(MAGENTA)];
    for (let i = 0; i < N; i++) {
      this.vortexSeed.push({
        th: Math.random() * Math.PI * 2, sp: 0.1 + Math.random() * 0.12, ph: Math.random(),
        c: palette[i % palette.length], s: 5 + Math.random() * 7,
      });
    }
    this.wellG.add(this.vortex.points);
    // lay the well back like a floor under the portal: head-on a funnel looks like a flat target
    this.wellG.rotation.x = -0.95;
    this.wellG.position.set(0, -R * 0.08, -R * 0.1);
    g.add(this.wellG);

    // ── GRAVITY / ZONE neon text (white core, coloured glow) ────────────────
    const fs = Math.round(R * 0.52);
    const addText = (label: string, glow: string, y: number) => {
      const { tex, w, h } = neonTextTexture(label, glow, fs * 2);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w / 2, h / 2), this.track(new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
      }), 1, 0));
      m.position.set(0, y, 8);
      m.userData.label = label; m.userData.glow = glow;
      g.add(m);
      this.texts.push(m);
    };
    addText('GRAVITY', CYAN, Math.round(fs * 0.55));
    addText('ZONE', PINK, -Math.round(fs * 0.5));
    // the canvas text needs Baloo 2; redraw once the font is surely there
    document.fonts?.load(`800 ${fs * 2}px "Baloo 2"`).then(() => {
      for (const m of this.texts) {
        const { tex } = neonTextTexture(m.userData.label, m.userData.glow, fs * 2);
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.map?.dispose(); mat.map = tex; mat.needsUpdate = true;
      }
    }).catch(() => {});
    this.built = true;
  }

  update(t: number, dt: number, alpha: number, pxPerUnit: number) {
    if (!this.built) return;
    const R = this.R;
    let sc = 1;
    if (this.reformT0 >= 0) {
      const p = (this.clock() - this.reformT0) / 0.65;
      if (p >= 1) this.reformT0 = -1;
      else {
        const c1 = 1.70158, c3 = c1 + 1, x = p - 1;
        sc = 0.25 + 0.75 * (1 + c3 * x * x * x + c1 * x * x);   // easeOutBack
      }
    }
    this.group.scale.setScalar(sc);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    const shimmer = 0.85 + 0.15 * Math.sin(t * 9.0);
    const heat = pulse * shimmer;
    this.flare = Math.max(0, this.flare - dt * 1.6);
    const boost = 1 + this.flare * 1.2;
    for (const e of this.mats) {
      e.m.opacity = Math.min(1, (e.base + e.heat * (0.35 + heat * 0.95)) * alpha * boost);
    }
    // gyro swing of the inner rings; tick ring turns like the 2D one (0.012 rad/frame)
    this.midRing.rotation.set(0, Math.sin(t * 0.8) * 0.55, 0);
    this.innerRing.rotation.set(Math.sin(t * 0.9 + 1) * 0.6, 0, 0);
    this.spin.rotation.z = -t * 0.72;
    if (this.funnelMat) {
      this.funnelMat.uniforms.uTime.value = t;
      this.funnelMat.uniforms.uHeat.value = heat;
      this.funnelMat.uniforms.uOpacity.value = Math.min(1, alpha * boost);
    }
    const cs = 1 + pulse * 0.022;
    for (const m of this.texts) m.scale.setScalar(cs);

    const white = new THREE.Color(1, 1, 1);
    if (this.comets) {
      for (let i = 0; i < 3; i++) {
        const ang = t * 1.7 + (i * Math.PI * 2) / 3;
        const c = disp(i % 2 === 0 ? CYAN : PINK);
        for (let tr = 0; tr < 6; tr++) {
          const ta = ang - (tr + 1) * 0.1;
          const f = 1 - (tr + 1) / 7;
          this.comets.set(i * 9 + tr, Math.cos(ta) * R, -Math.sin(ta) * R, 1, c, 14 * f, 0.55 * f);
        }
        this.comets.set(i * 9 + 6, Math.cos(ang) * R, -Math.sin(ang) * R, 1.5, c, 40, 0.5);
        this.comets.set(i * 9 + 7, Math.cos(ang) * R, -Math.sin(ang) * R, 2, c, 18, 0.9);
        this.comets.set(i * 9 + 8, Math.cos(ang) * R, -Math.sin(ang) * R, 2.5, white, 8, 1);
      }
      this.comets.flush();
      this.comets.mat.uniforms.uPx.value = pxPerUnit;
      this.comets.mat.uniforms.uOpacity.value = Math.min(1, alpha * boost);
    }
    if (this.vortex) {
      this.vortexSeed.forEach((p, i) => {
        const life = (t * p.sp + p.ph) % 1;
        const r = R * (1.9 - 1.78 * Math.pow(life, 0.8));
        const th = p.th + life * Math.PI * 2.4 + t * 0.25;
        const a = Math.min(1, life / 0.18) * (1 - Math.max(0, (life - 0.82) / 0.18)) * 0.85;
        this.vortex!.set(i, Math.cos(th) * r, Math.sin(th) * r, this.well(r) + 3, p.c, p.s * (1.15 - 0.55 * life), a);
      });
      this.vortex.flush();
      this.vortex.mat.uniforms.uPx.value = pxPerUnit;
      this.vortex.mat.uniforms.uOpacity.value = Math.min(1, alpha * (0.75 + heat * 0.25) * boost);
    }
    for (const e of this.mats) {
      const sm = e.m as unknown as THREE.ShaderMaterial;
      if (sm.uniforms?.uPx) sm.uniforms.uPx.value = pxPerUnit;
      if (sm.uniforms?.uOpacity) sm.uniforms.uOpacity.value = e.m.opacity;
    }
  }
}
