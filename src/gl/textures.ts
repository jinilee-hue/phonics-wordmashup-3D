// Small procedural textures for the 3D layer (glows, neon text, particles).
import * as THREE from 'three';

function canvasTex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft round dot: white core fading to transparent (for points / comets / sparks). */
export function dotTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return canvasTex(c, false);
}

/** Radial haze disc (additive bloom fill). */
export function hazeTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grd.addColorStop(0.75, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return canvasTex(c, false);
}

/** Gaussian ring glow: brightest at radius `at` (fraction of half-size), falloff `soft`. */
export function ringGlowTexture(size = 512, at = 0.78, soft = 0.07) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const r0 = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r0, y + 0.5 - r0) / r0;
      const a = Math.exp(-((d - at) ** 2) / (2 * soft * soft));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * a * (d < 1 ? 1 : 0));
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTex(c, false);
}

/** Neon word: white core with a coloured glow, matching the 2D 'GRAVITY' / 'ZONE' text. */
export function neonTextTexture(label: string, glow: string, fontPx: number) {
  const pad = Math.round(fontPx * 0.6);
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = `800 ${fontPx}px "Baloo 2", sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(label).width) + pad * 2;
  const h = Math.ceil(fontPx * 1.25) + pad * 2;
  c.width = w; c.height = h;
  const g2 = c.getContext('2d')!;
  g2.font = font;
  g2.textAlign = 'center';
  g2.textBaseline = 'middle';
  const cx = w / 2, cy = h / 2 + fontPx * 0.04;
  // wide glow, tight glow, white core (same idea as Phaser's text shadow blur 18)
  g2.shadowColor = glow;
  for (const [blur, alpha] of [[fontPx * 0.55, 0.9], [fontPx * 0.22, 1]] as const) {
    g2.shadowBlur = blur;
    g2.globalAlpha = alpha;
    g2.fillStyle = glow;
    g2.fillText(label, cx, cy);
  }
  g2.globalAlpha = 1;
  g2.shadowBlur = fontPx * 0.12;
  g2.shadowColor = glow;
  g2.fillStyle = '#ffffff';
  g2.fillText(label, cx, cy);
  const tex = canvasTex(c);
  return { tex, w, h };
}

/** Soft drop-shadow blob for a rounded card: black with a blurred alpha edge.
 *  Returns the texture and the plane size relative to the card (the blur needs room). */
export function cardShadowTexture(aspect: number, radius: number) {
  const rw = 200, rh = Math.round(rw / aspect), m = 44;
  const w = rw + 2 * m, h = rh + 2 * m;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const r = radius * rw;
  g.fillStyle = '#000';
  g.beginPath();
  g.moveTo(m + r, m);
  g.arcTo(m + rw, m, m + rw, m + rh, r); g.arcTo(m + rw, m + rh, m, m + rh, r);
  g.arcTo(m, m + rh, m, m, r); g.arcTo(m, m, m + rw, m, r);
  g.closePath(); g.fill();
  // separable box blur x3 on alpha (~gaussian); no ctx.filter, so older iPad Safari works too
  const img = g.getImageData(0, 0, w, h);
  const a = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = img.data[i * 4 + 3] / 255;
  const tmp = new Float32Array(w * h);
  const rad = 9;
  const pass = (src: Float32Array, dst: Float32Array, horiz: boolean) => {
    const n = horiz ? w : h, lines = horiz ? h : w;
    for (let j = 0; j < lines; j++) {
      const at = (k: number) => {
        const kk = Math.min(n - 1, Math.max(0, k));
        return src[horiz ? j * w + kk : kk * w + j];
      };
      let acc = 0;
      for (let k = -rad; k <= rad; k++) acc += at(k);
      for (let i = 0; i < n; i++) {
        dst[horiz ? j * w + i : i * w + j] = acc / (2 * rad + 1);
        acc += at(i + rad + 1) - at(i - rad);
      }
    }
  };
  for (let k = 0; k < 3; k++) { pass(a, tmp, true); pass(tmp, a, false); }
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 0;
    img.data[i * 4 + 3] = Math.round(a[i] * 255);
  }
  g.putImageData(img, 0, 0);
  return { tex: canvasTex(c, false), sx: w / rw, sy: h / rh };
}
