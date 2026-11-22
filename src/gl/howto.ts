// The explanation's page pieces (first game of a visit; user 2026-11-22: "설명 있는게 맞지"), driven by tutor.ts teach():
// - SKIP: the phonics games' common explanation SKIP (phonics-kit README "공통 규칙" 1) - bottom right, a quiet white
//   see-through glass pill with the word in white (as Phonics Match / Puzzle / Toy Catch / Eye Catch), here as tall as
//   the bottom buttons and on their row. A tap stops her voice and the demo at once and gives the board to the child.
// - the white glove (the phonics games' shared hand, public/gl/hand.webp - the same as the JUMP guide in jump.ts) that
//   plays round 1's answer for real: tutor.ts moves the Phaser card and puts the glove's fingertip on it every frame.
const CSS = `
.wm-howto-skip { position: fixed; left: 0; top: 0; z-index: 22; height: 40px; translate: -100% -50%; padding: 0 16px;
  display: grid; place-items: center; white-space: nowrap; border: 0; border-radius: 999px; cursor: pointer;
  font: 800 18px / 1 "Baloo 2", "Inter", system-ui, sans-serif; letter-spacing: .08em; color: #fff;
  text-shadow: 0 1px 3px rgba(90, 70, 120, .45);
  background: linear-gradient(180deg, rgba(255, 255, 255, .58), rgba(255, 255, 255, .3));
  -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3);
  box-shadow: 0 4px 9px rgba(60, 40, 80, .18); -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .25s, visibility 0s .25s, scale .12s ease; }
.wm-howto-skip.on { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity .3s, visibility 0s, scale .12s ease; }
.wm-howto-skip:active { scale: .94; }
.wm-howto-hand { position: fixed; left: 0; top: 0; z-index: 21; pointer-events: none; transform-origin: 37.8% 0.6%;
  filter: drop-shadow(0 6px 5px rgba(80, 50, 40, .3)); opacity: 0; transition: opacity .22s; }
.wm-howto-hand.on { opacity: 1; }
`;
/** hand.webp is 240 x 320; the fingertip is 37.8 % across, 0.6 % down */
const TIP_X = 0.378, TIP_Y = 0.006, ASPECT = 320 / 240;

export class HowTo {
  readonly skipEl: HTMLButtonElement;
  readonly handEl: HTMLImageElement;
  /** a tap on SKIP */
  onSkip: (() => void) | null = null;
  skipShown = false;
  /** puts SKIP in place (index.ts, every frame while it shows) */
  placer: (() => void) | null = null;
  /** game px -> page px (index.ts) */
  toPage: ((x: number, y: number) => { x: number; y: number; k: number }) | null = null;

  constructor() {
    if (!document.getElementById('wm-howto-css')) {
      const st = document.createElement('style');
      st.id = 'wm-howto-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wm-howto-skip';
    b.textContent = 'SKIP';
    b.setAttribute('aria-label', 'Skip');
    b.tabIndex = -1;
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.addEventListener('click', e => { e.stopPropagation(); if (this.skipShown) this.onSkip?.(); });
    const h = document.createElement('img');
    h.className = 'wm-howto-hand';
    h.alt = '';
    h.draggable = false;
    h.src = './gl/hand.webp';
    document.body.append(h, b);
    this.skipEl = b;
    this.handEl = h;
  }

  showSkip() {
    this.skipShown = true;
    this.placer?.();
    this.skipEl.classList.add('on');
  }

  hideSkip() {
    this.skipShown = false;
    this.skipEl.classList.remove('on');
  }

  /** SKIP's right end and vertical centre (page px), its height (page px) */
  placeSkip(right: number, cy: number, h: number) {
    const s = this.skipEl.style, d = Math.round(h);
    s.left = `${Math.round(right)}px`;
    s.top = `${Math.round(cy)}px`;
    if (s.height !== `${d}px`) {
      s.height = `${d}px`;
      s.padding = `${Math.round(d * 0.05)}px ${Math.round(d * 0.42)}px 0`;
      s.fontSize = `${Math.round(d * 0.44)}px`;
    }
  }

  /** the glove's fingertip at game px (x, y), `w` game px wide; `press` = pushed down on a card */
  handAt(x: number, y: number, w: number, press = false) {
    const p = this.toPage?.(x, y);
    if (!p) return;
    const hw = w * p.k, hh = hw * ASPECT, st = this.handEl.style;
    st.width = `${hw}px`;
    st.height = `${hh}px`;
    st.transform = `translate(${p.x - TIP_X * hw}px, ${p.y - TIP_Y * hh}px) scale(${press ? 0.88 : 1})`;
  }

  handOn() { this.handEl.classList.add('on'); }
  handOff() { this.handEl.classList.remove('on'); }

  dispose() { this.hideSkip(); this.handOff(); this.skipEl.remove(); this.handEl.remove(); }
}
