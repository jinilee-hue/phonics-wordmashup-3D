// Glee (글리) - the squishy puzzle-jelly tutor ("TUTOR CHARACTER SHEET: Glee").
//
// Modelled as a signed distance field and ray-marched in a fragment shader: the torso (two
// ellipsoids), the legs and the arms are joined with smooth-min, so the jelly has no seams anywhere
// and every pose is just a few uniforms (hand positions, squash).  The face (eyes, mouth, blush,
// brows, tears) is painted analytically on the front of the body; the glitter is a twinkling point
// cloud inside the torso.  Glee lives in the stage's overlay pass (a fixed camera), so the camera
// flights between rounds never move it - it travels with the player.
import * as THREE from 'three';
import type { Quality, Stage } from './stage';
import { DEPART } from './travel';

export type GleeEvent = 'hello' | 'grab' | 'snap' | 'wrong' | 'match' | 'cheer' | 'hint' | 'finale';
type Pt = { x: number; y: number };

// Proportions measured on the sheet's front view (height 1 = sole to crown): a round body 0.78 wide,
// legs 0.17 tall, big eyes (0.18 x 0.2) at +-0.165 / 0.656, mouth at 0.537, blush at +-0.25 / 0.505.
const SH_X = 0.31, SH_Y = 0.45;                        // shoulders, body space
const BOX = { x: 0.84, y0: -0.03, y1: 1.22, z: 0.52 };  // ray-march bounds (covers squash + raised arms)
const STEPS: Record<Quality, number> = { high: 80, mid: 64, low: 48 };
const FOOT_L = new THREE.Vector3(-0.122, 0.08, 0.035), FOOT_R = new THREE.Vector3(0.122, 0.08, 0.035);
const TUCK_L = new THREE.Vector3(-0.11, 0.15, 0.0), TUCK_R = new THREE.Vector3(0.11, 0.15, 0.0);
// Between rounds Glee runs to the gate and comes back with the next cards (driven by the travel clock):
// DEPART: turn to the gate, dash along the pink path to the zone, leap into the portal (fades in the flash)
// ARRIVE: drop out of the portal, run back home facing the player; then a 360-degree twirl and a landing.
const RUN_FREQ = 3.3;                     // leg cycles per second (two steps each)
const YAW_IN = Math.PI - 0.5;             // back to the viewer, toward the portal
const YAW_OUT = -0.5;                     // toward the viewer and home
const S_FLOOR = 0.55, S_PORTAL = 0.3;     // perspective scale at the zone's foot / inside the portal
const RUN_END = DEPART + 1.0;             // then the twirl act takes over (it outlives the travel)
const PUFF_LIFE = 0.5;
const GLITTER: Record<Quality, number> = { high: 140, mid: 96, low: 56 };

const VS = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FS = /* glsl */ `
precision highp float;
varying vec3 vPos;
uniform vec3 uCam;        // camera, body-local
uniform vec3 uLight;      // toward the key light, body-local
uniform vec3 uHi1;        // normal of the big candy highlight, body-local
uniform vec3 uHi2;        // normal of the small highlight
uniform vec3 uHandL;
uniform vec3 uHandR;
uniform vec3 uShL;
uniform vec3 uShR;
uniform vec3 uFootL;
uniform vec3 uFootR;
uniform vec3 uSquash;
uniform vec2 uLook;
uniform float uBlink, uHappy, uSad, uOpen, uFrown, uO, uBlush;
uniform float uPx;        // one device pixel in body units
uniform float uTime, uOpacity, uSteps;

float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float sdEll(vec3 p, vec3 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
float sdRC(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a; float l2 = dot(ba, ba); float rr = r1 - r2; float a2 = l2 - rr * rr; float il2 = 1.0 / l2;
  vec3 pa = p - a; float y = dot(pa, ba); float z = y - l2;
  vec3 xv = pa * l2 - ba * y; float x2 = dot(xv, xv); float y2 = y * y * l2; float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
float torso(vec3 q) {
  return smin(sdEll(q - vec3(0.0, 0.6, 0.0), vec3(0.39, 0.4, 0.33)),
              sdEll(q - vec3(0.0, 0.38, 0.015), vec3(0.385, 0.24, 0.32)), 0.12);
}
float map(vec3 p) {
  vec3 q = p / uSquash;
  float b = torso(q);
  float lg = min(sdRC(q, vec3(-0.115, 0.22, 0.02), uFootL, 0.085, 0.08),
                 sdRC(q, vec3(0.115, 0.22, 0.02), uFootR, 0.085, 0.08));
  b = smin(b, lg, 0.06);
  float ar = min(sdRC(q, uShL, uHandL, 0.088, 0.08), sdRC(q, uShR, uHandR, 0.088, 0.08));
  b = smin(b, ar, 0.05);
  return b * min(uSquash.x, min(uSquash.y, uSquash.z));
}
vec3 calcNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0015;
  return normalize(k.xyy * map(p + k.xyy * h) + k.yyx * map(p + k.yyx * h) +
                   k.yxy * map(p + k.yxy * h) + k.xxx * map(p + k.xxx * h));
}
float fill(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// upper half of a ring (a "^" closed happy eye), round caps
float arcUp(vec2 p, float R, float th) {
  if (p.y >= 0.0) return abs(length(p) - R) - th;
  return min(length(p - vec2(R, 0.0)), length(p + vec2(R, 0.0))) - th;
}

vec3 jelly(vec3 q) {
  float y = q.y + 0.06 * q.x;
  vec3 c = vec3(1.0, 0.86, 0.56);                                  // butter (feet)
  c = mix(c, vec3(0.62, 0.93, 0.82), smoothstep(0.07, 0.17, y));   // mint
  c = mix(c, vec3(0.54, 0.77, 1.0), smoothstep(0.15, 0.27, y));    // sky
  c = mix(c, vec3(0.71, 0.63, 1.0), smoothstep(0.25, 0.37, y));    // periwinkle
  c = mix(c, vec3(0.94, 0.57, 0.93), smoothstep(0.34, 0.47, y));   // lilac pink
  c = mix(c, vec3(1.0, 0.52, 0.79), smoothstep(0.44, 0.6, y));     // candy pink
  c = mix(c, vec3(1.0, 0.47, 0.75), smoothstep(0.72, 0.98, y));    // deeper pink crown
  // holographic patches in the lower half (peach / blue)
  float hp = sin(q.x * 13.0 + q.y * 7.0 + q.z * 5.0) * sin(q.x * 5.0 - q.y * 11.0 + 1.3);
  vec3 holo = mix(vec3(1.0, 0.8, 0.55), vec3(0.55, 0.8, 1.0), 0.5 + 0.5 * hp);
  return mix(c, holo, 0.22 * (1.0 - smoothstep(0.16, 0.45, y)));
}

// entry / exit of the ray-march box (body-local)
vec2 boxHit(vec3 ro, vec3 rd) {
  vec3 r = rd;
  r = mix(r, vec3(1e-5), step(abs(r), vec3(1e-5)));
  vec3 inv = 1.0 / r;
  vec3 t0 = (vec3(-${BOX.x}, ${BOX.y0}, -${BOX.z}) - ro) * inv;
  vec3 t1 = (vec3(${BOX.x}, ${BOX.y1}, ${BOX.z}) - ro) * inv;
  vec3 mn = min(t0, t1), mx = max(t0, t1);
  return vec2(max(max(mn.x, mn.y), mn.z), min(min(mx.x, mx.y), mx.z));
}

void eye(vec2 f, vec2 c, float aa, inout vec3 col, inout float cover) {
  vec2 r = vec2(0.088, 0.1);
  vec2 e = (f - c) / r;
  float de = (length(e) - 1.0) * 0.088;
  float lid = c.y + r.y * (1.0 - 2.0 * uBlink);                  // a blink lowers a lid
  float open = (1.0 - uHappy) * (1.0 - smoothstep(0.82, 0.97, uBlink));
  float a = fill(max(de, f.y - lid), aa) * open;
  vec3 ec = mix(vec3(0.13, 0.045, 0.07), vec3(0.5, 0.22, 0.2), smoothstep(-0.05, -1.0, e.y));
  ec = mix(ec, vec3(0.08, 0.02, 0.05), smoothstep(0.72, 1.0, length(e)));             // darker rim
  ec = mix(ec, vec3(0.32, 0.45, 0.66), uSad * smoothstep(0.0, -0.95, e.y) * 0.75);   // welling tears
  float h1 = fill(length((f - c - vec2(-0.028, 0.034)) / vec2(1.0, 1.12)) - (0.034 + 0.008 * uSad), aa);
  float h2 = fill(length(f - c - vec2(0.036, -0.045)) - (0.014 + 0.005 * uSad), aa);
  float h3 = fill(length(f - c - vec2(0.012, 0.05)) - 0.007, aa);
  ec = mix(ec, vec3(1.0), max(h1, max(h2, h3) * 0.95));
  col = mix(col, ec, a);
  cover = max(cover, a);
  // closed lines: the end of a blink (a soft smile line) and the happy "^"
  vec2 w = f - c - vec2(0.0, -0.006); w.y -= 5.0 * w.x * w.x;
  float bl = fill(sdSeg(w, vec2(-0.07, 0.0), vec2(0.07, 0.0)) - 0.01, aa) * smoothstep(0.8, 1.0, uBlink) * (1.0 - uHappy);
  float ha = fill(arcUp(f - c + vec2(0.0, 0.026), 0.064, 0.014), aa) * uHappy;
  float la = max(bl, ha);
  col = mix(col, vec3(0.17, 0.06, 0.09), la);
  cover = max(cover, la);
}

void mouth(vec2 f, float aa, inout vec3 col, inout float cover) {
  vec2 m = f - vec2(0.0, 0.545);
  vec2 mr = vec2(0.064, 0.058) * (0.72 + 0.28 * uOpen);
  float dD = max((length(m / mr) - 1.0) * mr.y, m.y - 0.004);                        // open "D" smile
  float dS = sdSeg(vec2(m.x, m.y - (-0.018 + 6.0 * m.x * m.x)), vec2(-0.05, 0.0), vec2(0.05, 0.0)) - 0.009;  // closed smile
  float dF = sdSeg(vec2(m.x, m.y - (-0.026 - 7.0 * m.x * m.x)), vec2(-0.04, 0.0), vec2(0.04, 0.0)) - 0.009;   // frown
  float dO = (length(m / vec2(0.03, 0.037)) - 1.0) * 0.03;                            // little "o"
  float d = mix(dS, dD, uOpen);
  d = mix(d, dF, uFrown);
  d = mix(d, dO, uO);
  float a = fill(d, aa);
  vec3 mc = vec3(0.47, 0.09, 0.15);
  float tA = fill(length(m - vec2(0.0, -0.05)) - 0.038, aa) * uOpen * (1.0 - uFrown) * (1.0 - uO);
  mc = mix(mc, vec3(1.0, 0.47, 0.56), tA);
  col = mix(col, mc, a);
  cover = max(cover, a);
}

void main() {
  vec3 ro = uCam;
  vec3 rd = normalize(vPos - uCam);
  vec2 tb = boxHit(ro, rd);
  float t = max(tb.x, 0.0);
  float tEnd = tb.y;
  float dmin = 1e9;
  bool hit = false;
  for (int i = 0; i < 96; i++) {
    if (float(i) >= uSteps) break;
    float d = map(ro + rd * t);
    dmin = min(dmin, d);
    if (d < 0.0005) { hit = true; break; }
    t += d * 0.88;
    if (t > tEnd) break;
  }
  vec3 outline = mix(vec3(0.38, 0.29, 0.66), vec3(0.52, 0.15, 0.42), clamp((vPos.y - 0.2) * 1.6, 0.0, 1.0));
  if (!hit) {
    // outer half of the outline, antialiased (near misses)
    float w = uPx * 1.7;
    if (dmin > w) discard;
    gl_FragColor = vec4(outline, (1.0 - smoothstep(uPx * 0.5, w, dmin)) * 0.92 * uOpacity);
    return;
  }
  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  vec3 q = p / uSquash;
  float ndv = clamp(dot(n, -rd), 0.0, 1.0);

  // thickness of jelly along the view ray: trace back from the far side of the box to the exit
  // (the inside of an ellipsoid bound is no distance at all, so marching forward inside stalls)
  float tx = tEnd;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= uSteps * 0.7) break;
    float d = map(ro + rd * tx);
    if (d < 0.0008) break;
    tx -= d * 0.9;
    if (tx <= t) { tx = t; break; }
  }
  float th = max(tx - t, 0.0);
  float thin = exp(-th * 6.0);

  vec3 alb = jelly(q);
  float dif = clamp(dot(n, uLight) * 0.5 + 0.5, 0.0, 1.0);
  float ao = clamp(0.55 + 0.45 * map(p + n * 0.06) / 0.06, 0.0, 1.0);
  vec3 col = alb * (0.68 + 0.4 * dif) * mix(0.8, 1.0, ao);
  col = mix(col, min(alb * 1.15 + 0.06, vec3(1.0)), thin * 0.4);             // light through thin parts
  float edge = pow(1.0 - ndv, 2.0);
  col = mix(col, col * vec3(0.86, 0.68, 0.92), edge * 0.5);                 // saturated jelly edge
  col += vec3(0.85, 0.82, 1.0) * pow(1.0 - ndv, 4.0) * 0.3;                // back rim glow
  vec3 ir = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + (1.0 - ndv) * 1.3 + q.y * 0.8));
  col = mix(col, col * 0.6 + ir * 0.45, pow(1.0 - ndv, 3.0) * 0.3);         // holographic sheen

  // face, only on the front of the body
  float front = smoothstep(0.08, 0.3, n.z) * step(0.0, q.z);
  float aa = uPx * 1.2;
  vec2 f = q.xy;
  float cover = 0.0;
  if (front > 0.0) {
    vec3 fc = col;
    for (int s = 0; s < 2; s++) {
      float side = s == 0 ? -1.0 : 1.0;
      float bl = length((f - vec2(side * 0.25, 0.51)) / vec2(0.068, 0.037));
      fc = mix(fc, vec3(1.0, 0.45, 0.62), (1.0 - smoothstep(0.3, 1.0, bl)) * 0.55 * uBlush);
    }
    mouth(f, aa, fc, cover);
    vec2 look = uLook * vec2(0.026, 0.018);
    eye(f, vec2(-0.165, 0.656) + look, aa, fc, cover);
    eye(f, vec2(0.165, 0.656) + look, aa, fc, cover);
    if (uSad > 0.01) {
      for (int s = 0; s < 2; s++) {
        float side = s == 0 ? -1.0 : 1.0;
        float br = fill(sdSeg(f, vec2(side * 0.09, 0.8), vec2(side * 0.235, 0.772)) - 0.01, aa) * uSad;
        fc = mix(fc, vec3(0.42, 0.13, 0.27), br);
        cover = max(cover, br);
        float fall = fract(uTime * 0.55 + side * 0.3) * 0.07;
        vec2 tp = f - vec2(side * 0.2, 0.57 - fall);
        float tr = fill((length(tp / vec2(0.019, 0.027)) - 1.0) * 0.019, aa) * uSad * (1.0 - fall / 0.07);
        fc = mix(fc, mix(vec3(0.55, 0.82, 1.0), vec3(1.0), fill(length(tp - vec2(-0.006, 0.008)) - 0.006, aa)), tr);
        cover = max(cover, tr);
      }
    }
    col = mix(col, fc, front);
    cover *= front;
  }

  // gloss: sharp specular, the big candy highlight (upper left) and a small one (right)
  vec3 H = normalize(uLight - rd);
  float gl = pow(max(dot(n, H), 0.0), 70.0) * 0.55;
  gl += smoothstep(0.885, 0.955, dot(n, uHi1)) * 0.9;
  gl += smoothstep(0.955, 0.985, dot(n, uHi2)) * 0.6;
  col = mix(col, vec3(1.0), clamp(gl, 0.0, 1.0) * (1.0 - cover * 0.8));

  // inner half of the outline
  float ol = 1.0 - smoothstep(0.1, 0.26, ndv);
  col = mix(col, outline, ol * 0.72);

  float alpha = max(1.0 - exp(-th * 10.0), 0.86);
  alpha = max(alpha, max(cover, ol * 0.8));
  gl_FragColor = vec4(col, alpha * uOpacity);
}`;

const GLITTER_VS = /* glsl */ `
attribute float aPhase;
attribute float aSize;
attribute vec3 aColor;
uniform float uTime, uPxScale, uOpacity;
varying vec3 vColor;
varying float vA;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float tw = 0.5 + 0.5 * sin(uTime * (1.3 + fract(aPhase * 7.31) * 2.2) + aPhase * 6.2831);
  tw *= tw;
  vA = (0.22 + 0.78 * tw) * uOpacity;
  vColor = aColor;
  gl_PointSize = aSize * uPxScale * (0.6 + 0.55 * tw);
}`;

const GLITTER_FS = /* glsl */ `
varying vec3 vColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float core = exp(-dot(c, c) * 90.0);
  float rays = exp(-abs(c.x) * 30.0 - abs(c.y) * 6.0) + exp(-abs(c.y) * 30.0 - abs(c.x) * 6.0);
  gl_FragColor = vec4(vColor, clamp(core + rays * 0.55, 0.0, 1.0) * vA);
}`;

// --- small helpers -----------------------------------------------------------------------------
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
function ell(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz), k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return (k0 * (k0 - 1)) / k1;
}
const torso = (x: number, y: number, z: number) =>
  smin(ell(x, y - 0.6, z, 0.39, 0.4, 0.33), ell(x, y - 0.38, z - 0.015, 0.385, 0.24, 0.32), 0.12);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const lin = (a: number, b: number, x: number) => clamp((x - a) / (b - a), 0, 1);
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = (x: number) => x * x * (3 - 2 * x);

function canvasTex(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 96) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const heartTex = () => canvasTex((g, s) => {
  g.translate(s / 2, s * 0.56); g.scale(s / 100, s / 100);
  g.beginPath(); g.moveTo(0, 30);
  g.bezierCurveTo(-48, -4, -36, -42, 0, -20); g.bezierCurveTo(36, -42, 48, -4, 0, 30); g.closePath();
  const gr = g.createLinearGradient(0, -40, 0, 30); gr.addColorStop(0, '#ff8cc6'); gr.addColorStop(1, '#ff3f86');
  g.fillStyle = gr; g.fill(); g.lineWidth = 3; g.strokeStyle = '#d42a6c'; g.stroke();
  g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.ellipse(-16, -18, 7, 4.5, -0.6, 0, Math.PI * 2); g.fill();
});
const starTex = () => canvasTex((g, s) => {
  g.translate(s / 2, s / 2); g.scale(s / 100, s / 100);
  g.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 19 : 42, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.closePath(); g.lineJoin = 'round';
  const gr = g.createLinearGradient(0, -40, 0, 40); gr.addColorStop(0, '#fff07a'); gr.addColorStop(1, '#ffc21f');
  g.fillStyle = gr; g.fill(); g.lineWidth = 4; g.strokeStyle = '#f0a000'; g.stroke();
});
const dropTex = () => canvasTex((g, s) => {
  g.translate(s / 2, s / 2); g.scale(s / 100, s / 100);
  g.beginPath(); g.moveTo(0, -42); g.bezierCurveTo(10, -22, 30, 0, 30, 14); g.arc(0, 14, 30, 0, Math.PI); g.bezierCurveTo(-30, 0, -10, -22, 0, -42);
  const gr = g.createLinearGradient(0, -40, 0, 44); gr.addColorStop(0, '#bfe9ff'); gr.addColorStop(1, '#45aef0');
  g.fillStyle = gr; g.fill(); g.lineWidth = 3; g.strokeStyle = '#2b8fd6'; g.stroke();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.ellipse(-11, 12, 6, 9, 0.3, 0, Math.PI * 2); g.fill();
});
const sparkleTex = () => canvasTex((g, s) => {
  const c = s / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(255,240,150,.55)'); gr.addColorStop(1, 'rgba(255,230,120,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  g.fillStyle = 'rgba(255,255,240,.95)';
  g.beginPath(); g.moveTo(c, 2); g.quadraticCurveTo(c, c, s - 2, c); g.quadraticCurveTo(c, c, c, s - 2); g.quadraticCurveTo(c, c, 2, c); g.quadraticCurveTo(c, c, c, 2); g.fill();
});
const puffTex = () => canvasTex((g, s) => {
  const c = s / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(246,238,255,.85)'); gr.addColorStop(0.75, 'rgba(196,170,255,.45)'); gr.addColorStop(1, 'rgba(170,140,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
}, 64);
const shadowTex = () => canvasTex((g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(18,6,40,1)'); gr.addColorStop(0.55, 'rgba(18,6,40,.5)'); gr.addColorStop(1, 'rgba(18,6,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
}, 64);

type Arm = { th: number; ph: number; len: number };     // th: 0 hangs down, PI/2 straight out, PI straight up
type Pose = {
  armL: Arm; armR: Arm;
  sy: number; lean: number; yaw: number;
  happy: number; sad: number; open: number; frown: number; o: number; blush: number;
  lookX: number; lookY: number;
};
const newPose = (): Pose => ({
  armL: { th: 0.95, ph: 0.1, len: 0.21 }, armR: { th: 0.95, ph: 0.1, len: 0.21 },
  sy: 1, lean: 0, yaw: 0, happy: 0, sad: 0, open: 0.85, frown: 0, o: 0, blush: 1, lookX: 0, lookY: 0,
});
type Act = { kind: string; t0: number; dur: number; targets?: Pt[] };
const mixArm = (a: Arm, b: Arm, k: number): Arm => ({ th: lerp(a.th, b.th, k), ph: lerp(a.ph, b.ph, k), len: lerp(a.len, b.len, k) });
/** One drawn frame: where the feet touch the floor (game px) and how deep (scale 1 = at home), plus the body pose. */
type Frame = {
  gx: number; gy: number; scale: number;
  jump: number; yaw: number; pitch: number; lean: number; sy: number;
  armL: Arm; armR: Arm; footL: THREE.Vector3; footR: THREE.Vector3;
  opacity: number;
  shadow: { x: number; y: number; scale: number; a: number };
};
const newFrame = (): Frame => ({
  gx: 0, gy: 0, scale: 1, jump: 0, yaw: 0, pitch: 0, lean: 0, sy: 1,
  armL: { th: 0.95, ph: 0.1, len: 0.21 }, armR: { th: 0.95, ph: 0.1, len: 0.21 },
  footL: FOOT_L.clone(), footR: FOOT_R.clone(), opacity: 1, shadow: { x: 0, y: 0, scale: 1, a: 1 },
});
type Fx = { s: THREE.Sprite; t0: number; life: number; x: number; y: number; vx: number; vy: number; size: number; spin: number };

export class Glee {
  readonly root = new THREE.Group();
  readonly mat: THREE.ShaderMaterial;
  private body: THREE.Mesh;
  private glitterMat: THREE.ShaderMaterial;
  private glitterGroup = new THREE.Group();
  private glitter: THREE.Points | null = null;
  private shadow: THREE.Mesh;
  private tex = { heart: heartTex(), star: starTex(), drop: dropTex(), sparkle: sparkleTex(), shadow: shadowTex(), puff: puffTex() };
  private fx: Fx[] = [];
  private wand: THREE.Sprite;
  private cur = newPose();
  private tgt = newPose();
  private act: Act | null = null;
  private queue: Act[] = [];
  private t = 0;
  private jump = 0;
  private nextBlink = 2;
  private blinkT0 = -1;
  private nextWave = 7;
  private hopsDone = 0;
  private home = { x: 0, y: 0, h: 120, yaw: 0.36 };
  private lastHand = new THREE.Vector3();
  private portal = { x: 640, y: 380, r: 150 };
  private running = false;
  private runFrom = { yaw: 0.36, armL: { th: 0.95, ph: 0.1, len: 0.21 } as Arm, armR: { th: 0.95, ph: 0.1, len: 0.21 } as Arm };
  private twirlFrom = 0;
  private directYaw = false;
  private F = newFrame();
  private pf = newFrame();
  private pfFace = newPose();
  private puffs: THREE.Sprite[] = [];
  private mtx = new THREE.Matrix4();
  private qtn = new THREE.Quaternion();
  private eul = new THREE.Euler(0, 0, 0, 'YXZ');
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  /** travel clock (s since the camera flight started) while a travel runs, else null; set by index.ts */
  runClock: () => number | null = () => null;
  /** tests: pin the clock (s) and/or place Glee explicitly */
  freezeAt: number | null = null;
  override: { x: number; y: number; h: number; yaw?: number; pitch?: number } | null = null;
  reduced = false;
  visible = true;
  dragTarget: Pt | null = null;

  constructor(private stage: Stage) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, transparent: true, depthTest: false, depthWrite: false,
      uniforms: {
        uCam: { value: new THREE.Vector3() }, uLight: { value: new THREE.Vector3() },
        uHi1: { value: new THREE.Vector3() }, uHi2: { value: new THREE.Vector3() },
        uHandL: { value: new THREE.Vector3() }, uHandR: { value: new THREE.Vector3() },
        uShL: { value: new THREE.Vector3(-SH_X, SH_Y, 0) }, uShR: { value: new THREE.Vector3(SH_X, SH_Y, 0) },
        uFootL: { value: FOOT_L.clone() }, uFootR: { value: FOOT_R.clone() },
        uSquash: { value: new THREE.Vector3(1, 1, 1) }, uLook: { value: new THREE.Vector2() },
        uBlink: { value: 0 }, uHappy: { value: 0 }, uSad: { value: 0 }, uOpen: { value: 0.85 },
        uFrown: { value: 0 }, uO: { value: 0 }, uBlush: { value: 1 },
        uPx: { value: 0.005 }, uTime: { value: 0 }, uOpacity: { value: 1 }, uSteps: { value: STEPS.high },
      },
    });
    const box = new THREE.BoxGeometry(BOX.x * 2, BOX.y1 - BOX.y0, BOX.z * 2);
    box.translate(0, (BOX.y0 + BOX.y1) / 2, 0);
    this.body = new THREE.Mesh(box, this.mat);
    this.body.renderOrder = 2;
    this.body.frustumCulled = false;
    this.root.add(this.body);
    this.glitterMat = new THREE.ShaderMaterial({
      vertexShader: GLITTER_VS, fragmentShader: GLITTER_FS, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPxScale: { value: 1 }, uOpacity: { value: 1 } },
    });
    this.root.add(this.glitterGroup);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.tex.shadow, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.shadow.renderOrder = 1;
    this.wand = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.sparkle, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.wand.renderOrder = 4;
    this.wand.visible = false;
    stage.overlay.add(this.shadow, this.root, this.wand);
    for (let i = 0; i < 8; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.puff, transparent: true, depthTest: false, depthWrite: false }));
      sp.visible = false;
      this.puffs.push(sp);
      stage.overlay.add(sp);
    }
    this.setQuality(stage.quality);
  }

  setQuality(q: Quality) {
    this.mat.uniforms.uSteps.value = STEPS[q];
    this.buildGlitter(GLITTER[q]);
  }

  private buildGlitter(n: number) {
    if (this.glitter) { this.glitterGroup.remove(this.glitter); this.glitter.geometry.dispose(); }
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const pos: number[] = [], phase: number[] = [], size: number[] = [], color: number[] = [];
    const palette = [[1, 1, 1], [1, 1, 1], [1, 0.86, 0.45], [1, 0.62, 0.86], [0.6, 0.9, 1], [0.7, 1, 0.75]];
    let guard = 0;
    while (phase.length < n && guard++ < 20000) {
      const x = (rnd() * 2 - 1) * 0.39, y = 0.14 + rnd() * 0.86, z = (rnd() * 2 - 1) * 0.33;
      if (torso(x, y, z) > -0.03) continue;
      if (Math.abs(x) < 0.33 && y > 0.45 && y < 0.8) continue;           // keep the face clear
      if (rnd() > 0.3 + 0.7 * (1 - smooth(0.3, 0.92, y))) continue;     // denser toward the feet
      pos.push(x, y, z);
      phase.push(rnd());
      const big = rnd() < 0.14;
      size.push(big ? 5 + rnd() * 3.5 : 1.7 + rnd() * 1.5);
      const c = palette[Math.floor(rnd() * palette.length)];
      color.push(c[0], c[1], c[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3));
    this.glitter = new THREE.Points(g, this.glitterMat);
    this.glitter.renderOrder = 3;
    this.glitter.frustumCulled = false;
    this.glitterGroup.add(this.glitter);
  }

  /** Feet at (x, y) in game px, `h` px tall, turned `yaw` rad toward the viewer's right. */
  place(x: number, y: number, h: number, yaw = 0.36) {
    this.home.x = x; this.home.y = y; this.home.h = h; this.home.yaw = yaw;
  }

  /** The Gravity Zone (game px): the run goes along the floor to its foot, then into it. */
  setPortal(x: number, y: number, r: number) {
    this.portal.x = x; this.portal.y = y; this.portal.r = r;
  }

  /** World point (overlay camera) whose projection is game px (x, y), at the depth where things look `scale` x. */
  private worldAt(x: number, y: number, scale: number, out: THREE.Vector3) {
    const st = this.stage, k = 1 / scale;
    return out.set((x - st.W / 2) * k, (st.H / 2 - y) * k, st.dist * (1 - k));
  }

  /** Screen position (game px) of a point in body space. */
  private toScreen(v: THREE.Vector3): Pt {
    const w = this.root.localToWorld(v.clone());
    return { x: w.x + this.stage.W / 2, y: this.stage.H / 2 - w.y };
  }

  react(kind: GleeEvent, targets?: Pt[]) {
    const now = this.t;
    const start = (k: string, dur: number, tg?: Pt[]): Act => ({ kind: k, t0: now, dur, targets: tg });
    switch (kind) {
      case 'hello': this.play([start('hello', 2.2)]); break;
      case 'grab': if (!this.busyAct()) this.play([start('grab', 0.7)]); break;
      case 'snap': if (!this.busyAct()) this.play([start('snap', 0.5)]); break;
      case 'wrong': this.play([start('wrong', 1.7), { kind: 'cheerup', t0: now + 1.7, dur: 1.1 }]); this.sweat(); break;
      case 'match': this.play([start('wow', 0.32)]); break;
      case 'cheer': this.play([start('cheer', 2.7)]); this.burst(); break;
      case 'hint': this.play([start('hint', 2.6, targets)]); break;
      case 'finale': this.play([start('finale', 1e9)]); this.burst(); break;
    }
  }

  private busyAct() { return !!this.act && ['wrong', 'cheerup', 'wow', 'cheer', 'hint', 'twirl', 'land', 'finale'].includes(this.act.kind); }

  private play(acts: Act[]) {
    this.act = acts[0];
    this.queue = acts.slice(1);
    this.hopsDone = 0;
  }

  reset() {
    this.act = null; this.queue = [];
    this.running = false;
    for (const sp of this.puffs) sp.visible = false;
    for (const f of this.fx) { f.s.removeFromParent(); f.s.material.dispose(); }
    this.fx = [];
  }

  private targetPose(t: number, out: Pose) {
    const yaw0 = this.override?.yaw ?? this.home.yaw;
    this.directYaw = false;
    // idle: breathe, sway, arms swing a little; eyes on the player
    out.armL = { th: 0.95 + 0.05 * Math.sin(t * 1.9), ph: 0.12, len: 0.21 };
    out.armR = { th: 0.95 + 0.05 * Math.sin(t * 1.9 + 1.4), ph: 0.12, len: 0.21 };
    out.sy = 1 + 0.018 * Math.sin(t * 2.6);
    out.lean = 0.035 * Math.sin(t * 1.3);
    out.yaw = yaw0 + 0.06 * Math.sin(t * 0.5);
    out.happy = 0; out.sad = 0; out.open = 0.85; out.frown = 0; out.o = 0; out.blush = 1;
    out.lookX = -out.yaw * 1.3; out.lookY = 0.05;
    if (this.dragTarget) this.lookAt(this.dragTarget, out);
    let jump = 0;
    const a = this.act;
    const u = a ? t - a.t0 : 0;
    const hop = (period: number, height: number, n: number) => {
      const k = Math.floor(u / period);
      if (k >= n) return 0;
      if (k > this.hopsDone) { this.hopsDone = k; if (a?.kind === 'cheer' || a?.kind === 'finale') this.burst(3); }
      const fr = (u % period) / period;
      out.sy = 0.9 + 0.17 * Math.sin(Math.PI * fr);                     // squash on the ground, stretch in the air
      return height * Math.sin(Math.PI * fr);
    };
    switch (a?.kind) {
      case 'hello':
      case 'wave': {
        out.armR = { th: 2.25 + 0.3 * Math.sin(u * 11), ph: 0.15, len: 0.27 };
        out.open = 1;
        if (a.kind === 'hello' && u < 0.45) jump = 0.06 * Math.sin((Math.PI * u) / 0.45);
        break;
      }
      case 'grab': out.o = u < 0.45 ? 0.8 : 0; out.open = 0.4; break;
      case 'snap': out.sy = 1 - 0.08 * Math.sin((Math.PI * u) / 0.5); out.happy = 1; break;
      case 'wrong': {
        out.sad = 1; out.frown = 1; out.open = 0; out.blush = 0.6;
        out.armL = { th: 0.42, ph: 0.4, len: 0.17 }; out.armR = { th: 0.42, ph: 0.4, len: 0.17 };
        out.sy = 0.93; out.lookY = -0.7; out.lookX = -out.yaw * 1.3;
        out.lean = 0.07 * Math.sin(u * 32) * Math.exp(-u * 5);
        break;
      }
      case 'cheerup': {
        out.happy = 1; out.open = 1;
        out.armL = { th: 2.05, ph: 0.6, len: 0.23 }; out.armR = { th: 2.05, ph: 0.6, len: 0.23 };
        out.sy = 1 + 0.05 * Math.sin(u * 13);
        break;
      }
      case 'wow': out.sy = 0.88; out.o = 1; out.open = 0; out.lookX = 0.7; out.lookY = 0.6; break;
      case 'cheer':
      case 'finale': {
        jump = this.reduced ? 0 : hop(0.5, 0.17, a.kind === 'finale' ? 1e9 : 3);
        const w = Math.sin(u * 14);
        out.armL = { th: 2.4 + 0.16 * w, ph: 0.1, len: 0.28 }; out.armR = { th: 2.4 - 0.16 * w, ph: 0.1, len: 0.28 };
        out.happy = 1; out.open = 1;
        break;
      }
      case 'hint': {
        const tg = a.targets ?? [];
        const target = tg.length ? tg[u < a.dur / 2 || tg.length < 2 ? 0 : 1] : null;
        out.open = 0.9;
        if (target) this.point(target, out);
        break;
      }
      case 'twirl': {
        // back home: one full turn on a little hop, arms out
        const p = lin(0, a.dur, u);
        out.yaw = lerp(this.twirlFrom, yaw0 + Math.PI * 2, easeInOut(p));
        this.directYaw = true;
        jump = 0.13 * Math.sin(Math.PI * p);
        out.sy = 1 + 0.06 * Math.sin(Math.PI * p);
        out.armL = { th: 1.75, ph: 0.0, len: 0.27 }; out.armR = { th: 1.75, ph: 0.0, len: 0.27 };
        out.happy = 1; out.open = 1;
        break;
      }
      case 'land': out.sy = 1 - 0.12 * Math.sin((Math.PI * u) / a.dur); out.happy = 1; out.open = 1; break;
    }
    return jump;
  }

  private lookAt(p: Pt, out: Pose) {
    const eye = this.toScreen(new THREE.Vector3(0, 0.656, 0.3));
    const dx = p.x - eye.x, dy = eye.y - p.y, l = Math.hypot(dx, dy) || 1;
    out.lookX = clamp((dx / l) * 1.1 - out.yaw * 0.9, -1, 1);
    out.lookY = clamp((dy / l) * 1.0, -1, 1);
  }

  /** Point at a screen target with the arm on its side, turn and look toward it. */
  private point(p: Pt, out: Pose) {
    const sh = this.toScreen(new THREE.Vector3(0, SH_Y, 0));
    const dx = p.x - sh.x, dy = sh.y - p.y;
    const side = dx >= 0 ? 1 : -1;
    const l = Math.hypot(dx, dy) || 1;
    const th = Math.atan2(Math.abs(dx) / l, -dy / l);
    // a steep target would put the arm along the head, where it vanishes: keep it out to the side
    const arm = { th: clamp(th, 1.15, 2.25), ph: 0.35, len: 0.32 };
    if (side > 0) out.armR = arm; else out.armL = arm;
    out.yaw = -side * 0.22;                 // turn the pointing arm toward the viewer, not behind the body
    this.lookAt(p, out);
  }

  /** shoulder (raised arms pull it up a little) and hand centre, body space */
  private arm(side: number, a: Arm, sh: THREE.Vector3, hand: THREE.Vector3) {
    const y = SH_Y + 0.06 * smooth(1.2, 2.5, a.th);
    sh.set(side * SH_X, y, 0);
    const s = Math.sin(a.th), c = Math.cos(a.th), cp = Math.cos(a.ph);
    hand.set(side * (SH_X + a.len * s * cp), y - a.len * c * cp, a.len * Math.sin(a.ph) + 0.02);
  }

  private burst(n = 6) {
    if (this.reduced) n = Math.min(n, 3);
    const head = this.toScreen(new THREE.Vector3(0, 1.0, 0));
    const h = this.home.h;
    for (let i = 0; i < n; i++) {
      const tex = i % 3 === 2 ? this.tex.star : this.tex.heart;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
      s.renderOrder = 5;
      this.stage.overlay.add(s);
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = h * (0.9 + Math.random() * 0.7);
      this.fx.push({ s, t0: this.t, life: 1.1 + Math.random() * 0.4, x: head.x + (Math.random() - 0.5) * h * 0.4, y: head.y + h * 0.05,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, size: h * (0.13 + Math.random() * 0.07), spin: (Math.random() - 0.5) * 3 });
    }
  }

  private sweat() {
    const p = this.toScreen(new THREE.Vector3(0.36, 0.9, 0.12));
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.drop, transparent: true, depthTest: false, depthWrite: false }));
    s.renderOrder = 5;
    this.stage.overlay.add(s);
    this.fx.push({ s, t0: this.t, life: 1.5, x: p.x, y: p.y, vx: 0, vy: this.home.h * 0.12, size: this.home.h * 0.22, spin: 0 });
  }

  /** The run between rounds at travel time `u` (s): fills the frame and the face. Pure (puffs replay it). */
  private runFrame(u: number, F: Frame, face: Pose) {
    const H0 = this.home, C = this.portal, h = H0.h;
    const fx = C.x, fy = C.y + C.r * 1.05;                  // the floor at the foot of the zone, in front of the gate
    const yIn = C.y + 0.45 * h * S_PORTAL;                   // feet while floating inside the portal
    const stride = (ph: number, amp: number, side: number, v: THREE.Vector3) =>
      v.set(side * 0.122, 0.08 + 0.12 * amp * Math.max(0, Math.cos(ph)), 0.035 + 0.1 * amp * Math.sin(ph));
    // arms pump up and down against the legs (readable from behind and from the front)
    const swing = (ph: number, amp: number): [Arm, Arm] => [
      { th: 0.95 - 0.45 * amp * Math.sin(ph), ph: -0.5 * amp * Math.sin(ph), len: 0.21 },
      { th: 0.95 + 0.45 * amp * Math.sin(ph), ph: 0.5 * amp * Math.sin(ph), len: 0.21 },
    ];
    const up: Arm = { th: 2.5, ph: 0.05, len: 0.28 };
    face.happy = 0; face.sad = 0; face.frown = 0; face.o = 0; face.blush = 1; face.open = 1; face.lookY = 0.1;
    if (u < DEPART) {
      const turn = easeInOut(lin(0, 0.16, u));               // 1) turn to the gate, crouch
      const q = easeInOut(lin(0.1, 0.8, u));                 // 2) dash along the pink path to the zone
      const l = lin(0.76, 1.03, u);                          // 3) leap into the portal
      const ph = 2 * Math.PI * RUN_FREQ * Math.max(0, u - 0.1);
      const amp = lin(0.08, 0.2, u) * (1 - lin(0.72, 0.8, u));
      F.yaw = lerp(this.runFrom.yaw, YAW_IN, turn);
      F.pitch = 0.28 * turn * (1 - 0.6 * l);
      F.lean = 0.1 * amp * Math.sin(ph);
      F.sy = 1 - 0.1 * Math.sin(Math.PI * lin(0.04, 0.16, u)) - 0.06 * amp * Math.cos(2 * ph);
      const ready: Arm = { th: 0.7, ph: -0.35, len: 0.2 };    // arms back: about to dash
      const b = lin(0, 0.12, u);
      const [sL, sR] = swing(ph, amp);
      const aL = mixArm(mixArm(this.runFrom.armL, ready, b), sL, amp), aR = mixArm(mixArm(this.runFrom.armR, ready, b), sR, amp);
      F.armL = mixArm(aL, up, lin(0, 0.35, l)); F.armR = mixArm(aR, up, lin(0, 0.35, l));
      stride(ph, amp, -1, F.footL); stride(ph + Math.PI, amp, 1, F.footR);
      if (l > 0) { F.footL.lerp(TUCK_L, lin(0, 0.3, l)); F.footR.lerp(TUCK_R, lin(0, 0.3, l)); }
      F.gx = lerp(H0.x, fx, q); F.gy = lerp(H0.y, fy, q);
      F.scale = 1 / (1 + (1 / S_FLOOR - 1) * q);
      F.jump = 0.06 * amp * Math.abs(Math.sin(ph));
      if (l > 0) {
        F.scale = lerp(S_FLOOR, S_PORTAL, l);
        const y = lerp(fy, yIn, Math.sin((l * Math.PI) / 2)) - Math.sin(Math.PI * l) * 0.3 * h * F.scale;
        F.jump = (fy - y) / (h * F.scale);
      }
      F.opacity = 1 - lin(0.93, 1.03, u);                    // gone into the flash
      F.shadow.x = F.gx; F.shadow.y = F.gy; F.shadow.scale = l > 0 ? S_FLOOR : F.scale; F.shadow.a = 1 - lin(0, 0.6, l);
      face.lookX = 0;
    } else {
      const a = u - DEPART;
      const p = lin(0.06, 0.36, a);                          // 1) drop out of the portal to the floor
      const q = 1 - Math.pow(1 - lin(0.33, 1.0, a), 2.2);    // 2) run home, slowing down at the end
      const ph = 2 * Math.PI * RUN_FREQ * Math.max(0, a - 0.33);
      const amp = lin(0.33, 0.42, a) * (1 - lin(0.86, 1.0, a));
      F.yaw = lerp(0, YAW_OUT, easeInOut(lin(0.3, 0.45, a)));
      F.pitch = 0.2 * amp;
      F.lean = 0.1 * amp * Math.sin(ph);
      F.sy = 1 - 0.06 * amp * Math.cos(2 * ph) - 0.12 * Math.sin(Math.PI * lin(0.33, 0.43, a));
      const [sL, sR] = swing(ph, amp);
      const k = lin(0.3, 0.42, a);
      F.armL = mixArm(up, sL, k); F.armR = mixArm(up, sR, k);
      stride(ph, amp, -1, F.footL); stride(ph + Math.PI, amp, 1, F.footR);
      if (p < 1) { F.footL.lerp(TUCK_L, 1 - lin(0.7, 1, p)); F.footR.lerp(TUCK_R, 1 - lin(0.7, 1, p)); }
      F.gx = lerp(fx, H0.x, q); F.gy = lerp(fy, H0.y, q);
      F.scale = 1 / (1 + (1 / S_FLOOR - 1) * (1 - q));
      F.jump = 0.06 * amp * Math.abs(Math.sin(ph));
      if (p < 1) {
        F.scale = lerp(S_PORTAL, S_FLOOR, p);
        const y = lerp(yIn, fy, p * p) - Math.sin(Math.PI * p) * 0.25 * h * F.scale;
        F.jump = (fy - y) / (h * F.scale);
      }
      F.opacity = lin(0.05, 0.15, a);                        // out of the flash
      F.shadow.x = F.gx; F.shadow.y = F.gy; F.shadow.scale = p < 1 ? S_FLOOR : F.scale; F.shadow.a = lin(0.5, 1, p);
      face.happy = a < 0.34 ? 1 : 0;                         // "^^" while popping out, then eyes on the player
      face.lookX = clamp(-F.yaw * 1.3, -1, 1);
    }
  }

  private frameMatrix(F: Frame, h: number, out: THREE.Matrix4) {
    const pos = this.worldAt(F.gx, F.gy, F.scale, this.v1);
    pos.y += F.jump * h;
    this.qtn.setFromEuler(this.eul.set(F.pitch, F.yaw, F.lean, 'YXZ'));
    return out.compose(pos, this.qtn, this.v2.set(h, h, h));
  }

  /** Dust puffs at every footfall of the run, replayed from the travel clock (so frozen frames show them). */
  private drawPuffs(u: number | null) {
    let n = 0;
    if (u !== null) {
      const h = this.home.h;
      const legs: [number, number, number][] = [[0.1, 0.2, 0.74], [DEPART + 0.33, DEPART + 0.42, DEPART + 0.9]];
      for (const [start, from, to] of legs) {
        for (let k = 0; k < 14 && n < this.puffs.length; k++) {
          const uk = start + (0.5 + k) / (2 * RUN_FREQ);     // a foot lands at phase pi/2 + k*pi
          const age = u - uk;
          if (uk < from || uk > to || age < 0 || age > PUFF_LIFE) continue;
          this.runFrame(uk, this.pf, this.pfFace);
          this.pf.jump = 0;
          const foot = k % 2 === 0 ? this.pf.footL : this.pf.footR;
          const sxz = 1 / Math.sqrt(this.pf.sy);
          // a little outside the foot, so it peeks out beside the body once she has moved on
          const w = new THREE.Vector3(foot.x * sxz * 1.7, 0.03, foot.z * sxz - 0.05).applyMatrix4(this.frameMatrix(this.pf, h, this.mtx));
          const sp = this.puffs[n++];
          const life = age / PUFF_LIFE;
          sp.visible = true;
          sp.position.copy(w);
          sp.scale.setScalar(h * (0.22 + 0.32 * life));
          sp.material.opacity = 0.95 * Math.pow(1 - life, 1.2) * this.pf.opacity;
          sp.renderOrder = w.z > this.root.position.z ? 6 : 1;   // in front of Glee when she runs away from us
        }
      }
    }
    for (let i = n; i < this.puffs.length; i++) this.puffs[i].visible = false;
  }

  update(dt: number) {
    const st = this.stage;
    this.t = this.freezeAt ?? this.t + dt;
    const t = this.t;
    this.root.visible = this.shadow.visible = this.visible;
    if (!this.visible) { this.drawPuffs(null); return; }
    const c = this.cur, g = this.tgt, F = this.F;
    const ru = this.runClock();
    const run = ru !== null && ru < RUN_END && !this.reduced;
    if (run && !this.running) {
      this.running = true;
      this.runFrom = { yaw: c.yaw, armL: { ...c.armL }, armR: { ...c.armR } };
      this.act = null; this.queue = [];
      this.wand.visible = false;
    } else if (!run && this.running) {
      this.running = false;
      this.twirlFrom = c.yaw;
      this.play([{ kind: 'twirl', t0: t, dur: 0.6 }, { kind: 'land', t0: t + 0.6, dur: 0.35 }]);
    }
    const P = this.override ?? this.home;
    const h = P.h;
    if (this.running) {
      this.runFrame(ru!, F, g);
      // keep the eased pose in step, so the twirl starts exactly where the run ended
      c.armL = { ...F.armL }; c.armR = { ...F.armR };
      c.yaw = F.yaw; c.sy = F.sy; c.lean = F.lean;
      for (const f of ['happy', 'sad', 'open', 'frown', 'o', 'blush', 'lookX', 'lookY'] as const) c[f] = g[f];
      this.jump = F.jump;
    } else {
      // acts: advance the queue, idle waves now and then
      if (this.act && t - this.act.t0 >= this.act.dur) {
        this.act = this.queue.shift() ?? null;
        this.hopsDone = 0;
        if (this.act) this.act.t0 = t;
        else this.nextWave = Math.max(this.nextWave, t + 5);     // no idle wave right after a reaction
      }
      if (!this.act && t > this.nextWave) { this.play([{ kind: 'wave', t0: t, dur: 1.8 }]); this.nextWave = t + 11 + Math.random() * 6; }
      // pose: analytic target, then ease toward it (jump stays analytic)
      this.jump = this.targetPose(t, g);
      const k = (r: number) => (this.freezeAt !== null ? 1 : 1 - Math.exp(-dt * r));
      const ease = (a: number, b: number, r: number) => a + (b - a) * k(r);
      for (const side of ['armL', 'armR'] as const) {
        c[side] = { th: ease(c[side].th, g[side].th, 16), ph: ease(c[side].ph, g[side].ph, 16), len: ease(c[side].len, g[side].len, 16) };
      }
      if (this.directYaw) c.yaw = g.yaw;
      else {
        const d = c.yaw - g.yaw;                                  // shortest way round (after a twirl: +2pi)
        c.yaw = g.yaw + Math.atan2(Math.sin(d), Math.cos(d));
        c.yaw = ease(c.yaw, g.yaw, 6);
      }
      c.sy = ease(c.sy, g.sy, 22); c.lean = ease(c.lean, g.lean, 10);
      for (const f of ['happy', 'sad', 'open', 'frown', 'o', 'blush'] as const) c[f] = ease(c[f], g[f], 14);
      c.lookX = ease(c.lookX, g.lookX, 12); c.lookY = ease(c.lookY, g.lookY, 12);
      F.gx = P.x; F.gy = P.y; F.scale = 1; F.jump = this.jump;
      F.yaw = c.yaw; F.pitch = this.override?.pitch ?? 0; F.lean = c.lean; F.sy = c.sy;
      F.armL = c.armL; F.armR = c.armR;
      const tuck = this.act?.kind === 'twirl' ? clamp(this.jump / 0.13, 0, 1) : 0;
      F.footL.copy(FOOT_L).lerp(TUCK_L, tuck * 0.7); F.footR.copy(FOOT_R).lerp(TUCK_R, tuck * 0.7);
      F.opacity = 1;
      F.shadow.x = P.x; F.shadow.y = P.y; F.shadow.scale = 1; F.shadow.a = 1;
    }
    // blink every few seconds (not while the eyes are closed happily)
    let blink = 0;
    if (t > this.nextBlink) { this.blinkT0 = t; this.nextBlink = t + 2.2 + Math.random() * 3; }
    if (this.blinkT0 >= 0 && t - this.blinkT0 < 0.16) blink = Math.sin((Math.PI * (t - this.blinkT0)) / 0.16);
    if (this.freezeAt !== null) blink = 0;
    // transform: feet on the floor (deeper = smaller), turned and leaning as the frame says
    const sy = F.sy, sxz = 1 / Math.sqrt(sy);
    this.frameMatrix(F, h, this.mtx).decompose(this.root.position, this.root.quaternion, this.root.scale);
    this.root.updateMatrixWorld(true);
    this.glitterGroup.scale.set(sxz, sy, sxz);
    // uniforms
    const u = this.mat.uniforms;
    const inv = this.root.matrixWorld.clone().invert();
    (u.uCam.value as THREE.Vector3).copy(st.overlayCam.position).applyMatrix4(inv);
    const qi = this.root.quaternion.clone().invert();
    (u.uLight.value as THREE.Vector3).set(-0.45, 0.75, 0.55).normalize().applyQuaternion(qi);
    (u.uHi1.value as THREE.Vector3).set(-0.5, 0.6, 0.62).normalize().applyQuaternion(qi);
    (u.uHi2.value as THREE.Vector3).set(0.62, 0.42, 0.66).normalize().applyQuaternion(qi);
    this.arm(-1, F.armL, u.uShL.value, u.uHandL.value);
    this.arm(1, F.armR, u.uShR.value, u.uHandR.value);
    (u.uFootL.value as THREE.Vector3).copy(F.footL);
    (u.uFootR.value as THREE.Vector3).copy(F.footR);
    (u.uSquash.value as THREE.Vector3).set(sxz, sy, sxz);
    (u.uLook.value as THREE.Vector2).set(c.lookX, c.lookY);
    u.uBlink.value = blink * (1 - c.happy);
    u.uHappy.value = c.happy; u.uSad.value = c.sad; u.uOpen.value = c.open;
    u.uFrown.value = c.frown; u.uO.value = c.o; u.uBlush.value = c.blush;
    const dpr = st.renderer.getPixelRatio();
    u.uPx.value = 1 / (h * dpr * F.scale);
    u.uTime.value = t;
    u.uOpacity.value = F.opacity;
    this.body.visible = F.opacity > 0.003;
    this.glitterMat.uniforms.uTime.value = t;
    this.glitterMat.uniforms.uPxScale.value = (dpr * h * F.scale) / 125;
    this.glitterMat.uniforms.uOpacity.value = F.opacity;
    // shadow on the floor, smaller and lighter while airborne
    const air = clamp(F.jump / 0.2, 0, 1);
    this.worldAt(F.shadow.x, F.shadow.y, F.shadow.scale, this.shadow.position);
    this.shadow.position.y -= h * 0.01;
    this.shadow.scale.set(h * 0.8 * (1 - 0.3 * air), h * 0.17 * (1 - 0.3 * air), 1);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - 0.55 * air) * F.shadow.a * F.opacity;
    this.drawPuffs(this.running ? ru : null);
    // hint sparkle at the pointing hand
    const pointing = this.act?.kind === 'hint';
    this.wand.visible = pointing;
    if (pointing) {
      const tip = (c.armR.len >= c.armL.len ? u.uHandR.value : u.uHandL.value) as THREE.Vector3;
      this.lastHand.copy(tip).multiply(u.uSquash.value as THREE.Vector3);
      const w = this.root.localToWorld(this.lastHand.clone());
      this.wand.position.set(w.x, w.y, 0);
      this.wand.scale.setScalar(h * (0.26 + 0.05 * Math.sin(t * 12)));
    }
    // fx sprites
    this.fx = this.fx.filter(f => {
      const a = t - f.t0;
      if (a > f.life) { f.s.removeFromParent(); f.s.material.dispose(); return false; }
      const x = f.x + f.vx * a, y = f.y + f.vy * a + (f.vy < 0 ? 0.5 * h * 1.2 * a * a : 0);
      f.s.position.set(x - st.W / 2, st.H / 2 - y, 0);
      const pop = Math.min(1, a / 0.12);
      f.s.scale.setScalar(f.size * (0.6 + 0.4 * pop));
      f.s.material.rotation = f.spin * a;
      f.s.material.opacity = 1 - smooth(f.life * 0.6, f.life, a);
      return true;
    });
  }

  dispose() {
    this.reset();
    this.mat.dispose(); this.glitterMat.dispose();
    this.body.geometry.dispose(); this.glitter?.geometry.dispose();
    for (const tx of Object.values(this.tex)) tx.dispose();
    this.root.removeFromParent(); this.shadow.removeFromParent(); this.wand.removeFromParent();
    for (const sp of this.puffs) { sp.removeFromParent(); sp.material.dispose(); }
  }
}
