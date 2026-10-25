// Three.js stage that sits UNDER the (transparent) Phaser canvas.
//
// World units = Phaser game pixels.  The camera is placed so the plane z = 0 projects 1:1 onto the
// Phaser canvas: game (x, y) -> world (x - W/2, H/2 - y, 0).  Phaser keeps all logic, hit tests and
// UI; this layer only draws what Phaser hides (backdrop, cards, Gravity Zone).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Quality = 'high' | 'mid' | 'low';

const FOV = 30;                 // vertical, degrees
const BG_Z = -1400;             // backdrop depth
const SHADOW_Z = -150;          // invisible shadow-catcher plane behind the cards
const BG_MARGIN = 1.07;         // backdrop over-size so parallax never shows its edge

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly key: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly canvas: HTMLCanvasElement;
  W = 1280; H = 720; dist = 1000;
  quality: Quality = 'high';

  private bg?: THREE.Mesh;
  private bgAspect = 16 / 9;
  // parallax state (radians), eased toward the pointer
  private par = new THREE.Vector2();
  private parTarget = new THREE.Vector2();
  private shake = new THREE.Vector2();

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
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, depthWrite: false }),
      );
      this.bg.position.z = BG_Z;
      this.bg.renderOrder = -10;
      this.scene.add(this.bg);
    } else {
      const m = this.bg.material as THREE.MeshBasicMaterial;
      m.map?.dispose(); m.map = tex; m.needsUpdate = true;
    }
    this.layout();
  }

  setQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'mid' ? Math.min(dpr, 1.5) : 1);
    this.layout();
  }

  resize(W: number, H: number) {
    if (W === this.W && H === this.H && this.canvas.width) return;
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
    this.camera.far = this.dist - BG_Z + 1000;
    this.camera.updateProjectionMatrix();
    // backdrop: object-fit cover at its depth, like the 2D game, plus a parallax margin
    if (this.bg) {
      const k = (this.dist - BG_Z) / this.dist;
      const vw = W * k, vh = H * k;
      let w = vw, h = vw / this.bgAspect;
      if (h < vh) { h = vh; w = vh * this.bgAspect; }
      this.bg.scale.set(w * BG_MARGIN, h * BG_MARGIN, 1);
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
    this.camera.lookAt(0, 0, 0);
    if (this.shake.lengthSq() > 0) {
      this.camera.setViewOffset(this.W, this.H, -this.shake.x, -this.shake.y, this.W, this.H);
    } else if (this.camera.view?.enabled) {
      this.camera.clearViewOffset();
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
    this.canvas.remove();
  }
}
