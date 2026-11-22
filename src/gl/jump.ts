// The JUMP button of the say-it turn (phonics-kit common rule 2, user 2026-11-22): Phonics Match's button as it is -
// green round (#a6ea6f -> #4fbf43, #339132 underside), the white line 'jumping child', it jumps in when the turn starts,
// aria-label "Jump". Here it perches on the result card's top-right corner (Match: on the say bubble's), placed every
// frame by index.ts. A tap skips the word: no stars, coins, gems and no Compound Book card for it.
// The first quiet turn of a game, the white glove (the phonics games' shared hand, public/gl/hand.webp) taps it twice
// and it hops each time, while Glee points at it and says "Want to skip? Tap the jump button!" (Glee speaks in the
// phonics games' unified tutor voice since 2026-11-22, tools/build_glee_voice.py).
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="translate(12 12.2) scale(1.12) translate(-12 -12)">'
  + '<circle cx="15.4" cy="4.1" r="2.45" /><path d="M14.1 7.1 11.2 12" /><path d="M13.6 8.3 18.3 6.2" /><path d="M13.6 8.3 9.3 6.5" />'
  + '<path d="M11.2 12 14.8 13.5 13 16.5" /><path d="M11.2 12 8 14.3 5 12.9" /><path d="M7.8 20.9h9.8" /></g></svg>';

// Match's sizes are for a 118 px button; --u scales them to this one. The in / hop moves are in % of the button.
const CSS = `
.wm-jump { position: fixed; left: 0; top: 0; z-index: 20; width: 66px; height: 66px; padding: 0; border: 0; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  background: linear-gradient(180deg, #a6ea6f, #4fbf43);
  box-shadow: inset 0 calc(-10px * var(--u, .56)) 0 #339132, inset 0 calc(8px * var(--u, .56)) calc(8px * var(--u, .56)) rgba(255, 255, 255, .45),
    0 calc(12px * var(--u, .56)) calc(18px * var(--u, .56)) rgba(60, 40, 50, .25);
  opacity: 0; scale: .4; pointer-events: none; visibility: hidden;
  transition: opacity .2s, scale .3s cubic-bezier(.2, 1.6, .4, 1), transform .12s ease, visibility 0s .3s; }
.wm-jump.on { opacity: 1; scale: 1; pointer-events: auto; visibility: visible; transition: opacity .2s, scale .3s cubic-bezier(.2, 1.6, .4, 1), transform .12s ease;
  animation: wm-jump-in .62s cubic-bezier(.3, .7, .4, 1) both; }
.wm-jump.on.poke { animation: wm-jump-in .62s cubic-bezier(.3, .7, .4, 1) both, wm-jump-hop .52s ease-out; }
.wm-jump:active { transform: scale(.92); }
.wm-jump svg { width: 62%; height: 62%; fill: none; stroke: #fff; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round;
  filter: drop-shadow(0 calc(3px * var(--u, .56)) 0 rgba(0, 0, 0, .15)); pointer-events: none; }
.wm-jump svg circle { fill: #fff; stroke: none; }
@keyframes wm-jump-in { 0% { opacity: 0; translate: 0 51%; scale: .5; } 18% { opacity: 1; translate: 0 22%; scale: 1.08 .9; }
  50% { translate: 0 -34%; scale: .94 1.07; } 78% { translate: 0 0; scale: 1.1 .9; } 100% { opacity: 1; translate: 0 0; scale: 1; } }
@keyframes wm-jump-hop { 0% { translate: 0 0; scale: 1; } 18% { translate: 0 4%; scale: 1.1 .9; } 50% { translate: 0 -31%; scale: .94 1.07; }
  80% { translate: 0 0; scale: 1.1 .9; } 100% { translate: 0 0; scale: 1; } }
.wm-jump-hand { position: fixed; left: 0; top: 0; z-index: 21; pointer-events: none; transform-origin: 37.8% 0.6%;
  filter: drop-shadow(0 6px 5px rgba(80, 50, 40, .3)); }
`;
const HAND_W = 200, HAND_H = (200 * 320) / 240, TIP_X = HAND_W * 0.378, TIP_Y = HAND_H * 0.006;

export class JumpButton {
  readonly el: HTMLButtonElement;
  /** a tap on it (the say-it turn ends without the reward) */
  onJump: (() => void) | null = null;
  shown = false;
  /** where it sits, in game px (Glee points here) */
  at: { x: number; y: number } | null = null;
  /** its size on the page (px) */
  private px = 66;

  constructor() {
    if (!document.getElementById('wm-jump-css')) {
      const st = document.createElement('style');
      st.id = 'wm-jump-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wm-jump';
    b.setAttribute('aria-label', 'Jump');
    b.tabIndex = -1;
    b.innerHTML = ICON;
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.addEventListener('click', e => { e.stopPropagation(); if (this.shown) this.onJump?.(); });
    document.body.appendChild(b);
    this.el = b;
  }

  /** puts it in place (index.ts): called before it shows, so it never jumps in at a stale spot */
  placer: (() => void) | null = null;

  show() {
    if (this.shown) return;
    this.shown = true;
    this.placer?.();
    this.el.classList.remove('poke');
    this.el.classList.add('on');
  }

  hide() {
    this.shown = false;
    this.el.classList.remove('on', 'poke');
  }

  /** centre (page px) and diameter (page px); `game` = the same centre in game px */
  place(x: number, y: number, size: number, game: { x: number; y: number }) {
    this.at = game;
    const d = Math.round(size);
    if (d !== this.px) {
      this.px = d;
      this.el.style.width = this.el.style.height = `${d}px`;
      this.el.style.setProperty('--u', (d / 118).toFixed(3));
    }
    this.el.style.left = `${Math.round(x - d / 2)}px`;
    this.el.style.top = `${Math.round(y - d / 2)}px`;
  }

  /** one hop (the guide's glove taps it) */
  poke() {
    this.el.classList.remove('poke');
    void this.el.offsetWidth;
    this.el.classList.add('poke');
  }

  /** The white glove taps the button twice (it hops each time); resolves when done or when `stop()` turns true. */
  async guide(stop: () => boolean) {
    if (!this.shown) return;
    const r = this.el.getBoundingClientRect(), k = this.px / 118;
    const h = document.createElement('img');
    h.className = 'wm-jump-hand';
    h.alt = '';
    h.draggable = false;
    h.src = './gl/hand.webp';
    h.style.width = `${HAND_W * k}px`;
    h.style.height = `${HAND_H * k}px`;
    document.body.appendChild(h);
    const x = r.left + r.width / 2 + 6 * k, y = r.top + r.height / 2 + 12 * k;   // the fingertip a little below the centre
    const at = (dx: number, dy: number, sc = 1) => `translate(${x + dx * k - TIP_X * k}px, ${y + dy * k - TIP_Y * k}px) scale(${sc})`;
    const D = 2400;
    const anim = h.animate([
      { transform: at(90, 160, 1.05), opacity: 0, offset: 0 },
      { transform: at(0, 0), opacity: 1, offset: 0.24 },
      { transform: at(0, 0, 0.86), offset: 0.34 },
      { transform: at(0, 0), offset: 0.46 },
      { transform: at(0, 0, 0.86), offset: 0.56 },
      { transform: at(0, 0), opacity: 1, offset: 0.74 },
      { transform: at(70, 130, 1.05), opacity: 0, offset: 1 },
    ], { duration: D, easing: 'ease-in-out', fill: 'forwards' });
    const t1 = window.setTimeout(() => this.poke(), D * 0.34), t2 = window.setTimeout(() => this.poke(), D * 0.56);
    try {
      await new Promise<void>(res => {
        const t0 = performance.now();
        const tick = () => { if (stop() || !this.shown || performance.now() - t0 > D + 100) res(); else setTimeout(tick, 50); };
        tick();
      });
    } finally {
      clearTimeout(t1); clearTimeout(t2);
      anim.cancel(); h.remove();
      this.el.classList.remove('poke');
    }
  }

  dispose() { this.hide(); this.el.remove(); }
}
