// Three.js stage that sits UNDER the (transparent) Phaser canvas.
//
// World units = Phaser game pixels.  The camera is placed so the plane z = 0 projects 1:1 onto the
// Phaser canvas: game (x, y) -> world (x - W/2, H/2 - y, 0).  Phaser keeps all logic, hit tests and
// UI; this layer only draws what Phaser hides (backdrop, cards, Gravity Zone).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Quality = 'high' | 'mid' | 'low';

const FOV = 30;                 // vertical, degrees
const BG_Z = -1400;             // backdrop depth (flat reference plane)
const SHADOW_Z = -150;          // light target behind the cards
const BG_MARGIN = 1.07;         // backdrop over-size so parallax never shows its edge
// Depth relief for the backdrop painting: distances from the base camera, in units of `dist`.
// Every vertex moves along its base-camera ray, so at rest the picture looks exactly as before;
// only when the camera moves does the painting show real depth.
const D_NEAR = 1.3;             // nearest painted thing (the round stage at the bottom), behind the cards
const D_FAR = 6.0;              // sky
const SEG_X = 160, SEG_Y = 90;
/** Where the camera flies to between rounds: the arch gate in the painting (u, v from top-left). */
export const GATE_UV = { u: 0.5, v: 0.5 };

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Drawn after the world with a FIXED camera (the rest pose): characters that must not move with
   *  the parallax or the flights between rounds (Glee). Depth is cleared first, so it sits on top. */
  readonly overlay = new THREE.Scene();
  readonly overlayCam: THREE.PerspectiveCamera;
  readonly key: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly canvas: HTMLCanvasElement;
  W = 1280; H = 720; dist = 1000;
  quality: Quality = 'high';

  private bg?: THREE.Mesh;
  private bgAspect = 16 / 9;
  private bgW = 1; private bgH = 1;
  private depth: { data: Float32Array; w: number; h: number } | null = null;
  /** camera pose override used by Travel; w = blend weight against the play pose */
  readonly travel = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: FOV, w: 0 };
  readonly baseFov = FOV;
  private fovNow = FOV;
  // parallax state (radians), eased toward the pointer
  private par = new THREE.Vector2();
  private parTarget = new THREE.Vector2();
  private shake = new THREE.Vector2();
  private look = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wm3d-canvas';
    parent.prepend(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x0a0a1a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = false;   // cards draw a soft blob shadow instead (cheaper, softer)

    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 10, 8000);
    this.scene.add(this.camera);          // camera-space layers (flash, speed lines) hang off it
    this.overlayCam = new THREE.PerspectiveCamera(FOV, 16 / 9, 10, 8000);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.1;
    pmrem.dispose();

    // Light budget is calibrated so a card face turned to the camera shows the art's own colours
    // (r155+ lights: intensity pi == 1.0 irradiance).
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xe6e3ee, Math.PI * 0.48);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfffcf8, Math.PI * 0.46);
    this.scene.add(this.key, this.key.target);
  }

  /** Use Phaser's already-loaded game_bg image as the backdrop (no second download). */
  setBackdrop(img: HTMLImageElement | HTMLCanvasElement) {
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.bgAspect = img.width / img.height;
    if (!this.bg) {
      this.bg = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1, SEG_X, SEG_Y),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
      );
      this.bg.renderOrder = -10;
      this.bg.frustumCulled = false;
      this.scene.add(this.bg);
    } else {
      const m = this.bg.material as THREE.MeshBasicMaterial;
      m.map?.dispose(); m.map = tex; m.needsUpdate = true;
    }
    this.layout();
  }

  /** Depth map of the painting (8-bit disparity, 255 = near). Turns the backdrop into a relief. */
  setDepth(img: HTMLImageElement) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const data = new Float32Array(c.width * c.height);
    for (let i = 0; i < data.length; i++) data[i] = px[i * 4] / 255;
    this.depth = { data, w: c.width, h: c.height };
    this.layout();
  }

  /** Disparity (0 far .. 1 near) at painting coords u, v (v from the top). */
  private disp(u: number, v: number) {
    const d = this.depth;
    if (!d) return null;
    const x = Math.min(d.w - 1.001, Math.max(0, u * (d.w - 1)));
    const y = Math.min(d.h - 1.001, Math.max(0, v * (d.h - 1)));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i = y0 * d.w + x0;
    return (d.data[i] * (1 - fx) + d.data[i + 1] * fx) * (1 - fy) + (d.data[i + d.w] * (1 - fx) + d.data[i + d.w + 1] * fx) * fy;
  }

  /** z-distance from the base camera for painting coords (u, v from top-left). */
  private distAt(u: number, v: number) {
    const dp = this.disp(u, v);
    const D0 = this.dist - BG_Z;
    if (dp === null) return D0;
    const tFar = 1 / (D_FAR * this.dist), sNear = 1 / (D_NEAR * this.dist) - tFar;
    return 1 / (tFar + sNear * dp);
  }

  /** World point of painting coords on the relief (as seen from the base camera). */
  paintingPoint(u: number, v: number, out = new THREE.Vector3()) {
    const D0 = this.dist - BG_Z;
    const k = this.distAt(u, v) / D0;
    return out.set((u - 0.5) * this.bgW * k, (0.5 - v) * this.bgH * k, this.dist - D0 * k);
  }

  private buildRelief() {
    if (!this.bg) return;
    const geo = this.bg.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    // the plane is cover-fitted with a margin; uv spans the whole painting
    const D0 = this.dist - BG_Z;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i), v = 1 - uv.getY(i);
      const k = this.distAt(u, v) / D0;
      pos.setXYZ(i, (u - 0.5) * this.bgW * k, (0.5 - v) * this.bgH * k, this.dist - D0 * k);
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  setQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'mid' ? Math.min(dpr, 1.5) : 1);
    this.layout();
  }

  private sized = false;
  resize(W: number, H: number) {
    // (comparing with the defaults alone skipped the first resize at exactly 1280x720: the canvas
    // stayed 300x150 and the 3D scene filled a quarter of the screen)
    if (this.sized && W === this.W && H === this.H) return;
    this.sized = true;
    this.W = W; this.H = H;
    this.renderer.setSize(W, H, false);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.layout();
  }

  private layout() {
    const { W, H } = this;
    this.camera.aspect = W / H;
    this.dist = (H / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.camera.far = this.dist * (D_FAR + 2);
    this.camera.updateProjectionMatrix();
    this.overlayCam.aspect = W / H;
    this.overlayCam.far = this.dist * 8;       // Glee runs deep into the scene between rounds
    this.overlayCam.position.set(0, 0, this.dist);
    this.overlayCam.lookAt(0, 0, 0);
    this.overlayCam.updateProjectionMatrix();
    // backdrop: object-fit cover at its reference depth, like the 2D game, plus a parallax margin
    if (this.bg) {
      const k = (this.dist - BG_Z) / this.dist;
      const vw = W * k, vh = H * k;
      let w = vw, h = vw / this.bgAspect;
      if (h < vh) { h = vh; w = vh * this.bgAspect; }
      this.bgW = w * BG_MARGIN; this.bgH = h * BG_MARGIN;
      this.buildRelief();
    }
    // key light from the upper right, in front (the card art is lit that way)
    this.key.position.set(W * 0.45, H * 0.9, 1500);
    this.key.target.position.set(0, 0, SHADOW_Z);
  }

  toWorld(x: number, y: number, z = 0, out = new THREE.Vector3()) {
    return out.set(x - this.W / 2, this.H / 2 - y, z);
  }

  /** Pointer in game px (or null when it left the window). Drives the gentle camera parallax. */
  setPointer(x: number | null, y: number | null) {
    if (x === null || y === null) { this.parTarget.set(0, 0); return; }
    const nx = THREE.MathUtils.clamp((x / this.W) * 2 - 1, -1, 1);
    const ny = THREE.MathUtils.clamp((y / this.H) * 2 - 1, -1, 1);
    this.parTarget.set(nx, ny);
  }

  setShake(dx: number, dy: number) { this.shake.set(dx, dy); }

  render(t: number, dt: number) {
    // ease parallax; idle drift keeps the world alive when the pointer rests
    const k = 1 - Math.exp(-dt * 3);
    this.par.lerp(this.parTarget, k);
    const yaw = (this.par.x * 1.3 + Math.sin(t * 0.21) * 0.25) * Math.PI / 180;
    const pitch = (this.par.y * 0.9 + Math.sin(t * 0.17 + 1) * 0.18) * Math.PI / 180;
    const d = this.dist;
    // orbit around the card plane's centre: z = 0 stays put, far layers slide
    this.camera.position.set(Math.sin(yaw) * d * Math.cos(pitch), -Math.sin(pitch) * d, Math.cos(yaw) * d * Math.cos(pitch));
    const tr = this.travel;
    let fov = FOV;
    if (tr.w > 0) {
      this.camera.position.lerp(tr.pos, tr.w);
      this.look.set(0, 0, 0).lerp(tr.look, tr.w);
      this.camera.lookAt(this.look);
      fov = FOV + (tr.fov - FOV) * tr.w;
    } else {
      this.camera.lookAt(0, 0, 0);
    }
    if (Math.abs(fov - this.fovNow) > 1e-4) {
      this.fovNow = fov;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.shake.lengthSq() > 0) {
      this.camera.setViewOffset(this.W, this.H, -this.shake.x, -this.shake.y, this.W, this.H);
    } else if (this.camera.view?.enabled) {
      this.camera.clearViewOffset();
    }
    this.renderer.render(this.scene, this.camera);
    if (this.overlay.children.length) {
      const oc = this.overlayCam;
      if (this.shake.lengthSq() > 0) oc.setViewOffset(this.W, this.H, -this.shake.x, -this.shake.y, this.W, this.H);
      else if (oc.view?.enabled) oc.clearViewOffset();
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.overlay, oc);
      this.renderer.autoClear = true;
    }
  }

  dispose() {
    this.renderer.dispose();
    this.canvas.remove();
  }
}
