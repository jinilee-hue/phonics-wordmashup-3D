// The language of Glee's voice: English or Korean (user 2026-11-22). The same toggle as the other phonics games (Halli
// Galli gl/lang.css + gl/lang.js, Toy Catch): a pill with the two round flags, a white knob under the flag in use, the
// other flag small and faded. On the title only (the intro video, main.ts) - it goes with the title, so it is never
// there in play or on the result. It switches Glee's lines only (no speech bubbles here; the card words stay English
// inside a Korean line, tools/build_glee_voice.py); the screen text stays English. Korean on a first visit; the choice
// is kept on this device (localStorage 'wm-lang').
export type Lang = 'en' | 'ko';
const KEY = 'wm-lang';

let cur: Lang = 'ko';
try { cur = localStorage.getItem(KEY) === 'en' ? 'en' : 'ko'; } catch { /* private mode: Korean */ }

export const lang = {
  get: (): Lang => cur,
  set(l: Lang) {
    cur = l === 'en' ? 'en' : 'ko';
    try { localStorage.setItem(KEY, cur); } catch { /* private mode */ }
    paint();
  },
};

// Sizes as Halli Galli's (in --hb, the pill's height). On the title it sits in the top-right button group of the intro
// video's last frame (the game's HUD, drawn into the video: badges + settings; 1280x720, object-fit: cover), one row
// under the settings button, as tall as those buttons (69.6 video px = GameScene's bodyH at 1280x720). Colours: the
// HUD badges (white glass, #6A92BE underside).
const CSS = `
.wm-lang { --k: max(100vw / 1280, 100vh / 720); --tu: min(1vh, calc(100vw / 177.78)); --hb: calc(69.6 * var(--k)); --e: calc(.09 * var(--hb));
  position: absolute; z-index: 2; top: max(calc(3 * var(--tu)), calc((100vh - 720 * var(--k)) / 2 + 105 * var(--k)));
  right: max(calc(3 * var(--tu)), calc((100vw - 1280 * var(--k)) / 2 + 25 * var(--k)));   /* never off-screen when cover crops the video's sides */
  display: flex; align-items: center; gap: calc(.03 * var(--hb)); height: var(--hb);
  padding: 0 calc(.08 * var(--hb)); border: 0; border-radius: 999px; translate: 0 calc(-.5 * var(--e)); cursor: pointer;
  background: radial-gradient(130% 80% at 50% -6%, rgb(255 255 255 / .92) 0 40%, rgb(255 255 255 / 0) 52%), linear-gradient(#ffffff, #e9f1fb);
  box-shadow: inset 0 0 calc(.05 * var(--hb)) #cfdff2, 0 var(--e) 0 0 #6a92be, 0 calc(var(--e) + .06 * var(--hb)) calc(.15 * var(--hb)) rgb(30 50 90 / .3);
  -webkit-tap-highlight-color: transparent; }
.wm-lang::before { content: ''; position: absolute; inset: calc(.07 * var(--hb)); border-radius: 999px; pointer-events: none;
  background: linear-gradient(#d3e2f4, #edf3fb); box-shadow: inset 0 calc(.05 * var(--hb)) calc(.08 * var(--hb)) rgb(40 70 120 / .28); }
.wm-lang .knob { position: absolute; top: calc(.1 * var(--hb)); left: calc(.1 * var(--hb)); width: calc(.8 * var(--hb)); height: calc(.8 * var(--hb));
  border-radius: 50%; background: #fff; box-shadow: 0 calc(.03 * var(--hb)) calc(.07 * var(--hb)) rgb(30 50 90 / .32);
  transition: transform .25s cubic-bezier(.3, 1.4, .5, 1); }
.wm-lang[data-l="ko"] .knob { transform: translateX(calc(.87 * var(--hb))); }
.wm-lang .flag { position: relative; z-index: 1; display: grid; place-items: center; width: calc(.84 * var(--hb)); height: calc(.84 * var(--hb)); }
.wm-lang .flag svg { width: 86%; height: 86%; border-radius: 50%; transition: transform .25s ease, opacity .25s ease, filter .25s ease; }
.wm-lang .flag:not(.on) svg { transform: scale(.68); opacity: .6; filter: grayscale(.3); }
.wm-lang:active { transform: scale(.96); }
.wm-lang:focus-visible { outline: calc(.06 * var(--hb)) solid #8a43d6; outline-offset: calc(.05 * var(--hb)); }
`;

const EN = '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="wmflag-en"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#wmflag-en)"><rect width="24" height="24" fill="#fff"/><rect y="0" width="24" height="1.85" fill="#b22234"/><rect y="3.69" width="24" height="1.85" fill="#b22234"/><rect y="7.38" width="24" height="1.85" fill="#b22234"/><rect y="11.08" width="24" height="1.85" fill="#b22234"/><rect y="14.77" width="24" height="1.85" fill="#b22234"/><rect y="18.46" width="24" height="1.85" fill="#b22234"/><rect y="22.15" width="24" height="1.85" fill="#b22234"/><rect width="12" height="12.92" fill="#3c3b6e"/><g fill="#fff"><circle cx="1.6" cy="1.8" r=".7"/><circle cx="4.5" cy="1.8" r=".7"/><circle cx="7.4" cy="1.8" r=".7"/><circle cx="10.3" cy="1.8" r=".7"/><circle cx="3.05" cy="3.7" r=".7"/><circle cx="5.95" cy="3.7" r=".7"/><circle cx="8.85" cy="3.7" r=".7"/><circle cx="1.6" cy="5.6" r=".7"/><circle cx="4.5" cy="5.6" r=".7"/><circle cx="7.4" cy="5.6" r=".7"/><circle cx="10.3" cy="5.6" r=".7"/><circle cx="3.05" cy="7.5" r=".7"/><circle cx="5.95" cy="7.5" r=".7"/><circle cx="8.85" cy="7.5" r=".7"/><circle cx="1.6" cy="9.4" r=".7"/><circle cx="4.5" cy="9.4" r=".7"/><circle cx="7.4" cy="9.4" r=".7"/><circle cx="10.3" cy="9.4" r=".7"/><circle cx="3.05" cy="11.3" r=".7"/><circle cx="5.95" cy="11.3" r=".7"/><circle cx="8.85" cy="11.3" r=".7"/></g></g></svg>';
const KO = '<svg viewBox="-12 -12 24 24" aria-hidden="true"><defs><clipPath id="wmflag-ko"><circle r="12"/></clipPath></defs><g clip-path="url(#wmflag-ko)"><rect x="-18" y="-12" width="36" height="24" fill="#fff"/><g transform="rotate(33.69)"><path d="M-6 0a6 6 0 0 1 12 0 3 3 0 0 0-6 0 3 3 0 0 1-6 0z" fill="#cd2e3a"/><path d="M-6 0a6 6 0 0 0 12 0 3 3 0 0 0-6 0 3 3 0 0 1-6 0z" fill="#0047a0"/></g><g fill="#151515"><g transform="rotate(33.69) translate(-10.2 0)"><rect x="-1.55" y="-2.8" width=".9" height="5.6"/><rect x="-.15" y="-2.8" width=".9" height="5.6"/><rect x="1.25" y="-2.8" width=".9" height="5.6"/></g><g transform="rotate(33.69) translate(10.2 0)"><rect x="-2.2" y="-2.8" width=".9" height="2.5"/><rect x="-2.2" y=".3" width=".9" height="2.5"/><rect x="-.75" y="-2.8" width=".9" height="2.5"/><rect x="-.75" y=".3" width=".9" height="2.5"/><rect x=".7" y="-2.8" width=".9" height="2.5"/><rect x=".7" y=".3" width=".9" height="2.5"/></g><g transform="rotate(-33.69) translate(10.2 0)"><rect x="-2.2" y="-2.8" width=".9" height="2.5"/><rect x="-2.2" y=".3" width=".9" height="2.5"/><rect x="-.75" y="-2.8" width=".9" height="5.6"/><rect x=".7" y="-2.8" width=".9" height="2.5"/><rect x=".7" y=".3" width=".9" height="2.5"/></g><g transform="rotate(-33.69) translate(-10.2 0)"><rect x="-1.55" y="-2.8" width=".9" height="5.6"/><rect x="-.15" y="-2.8" width=".9" height="2.5"/><rect x="-.15" y=".3" width=".9" height="2.5"/><rect x="1.25" y="-2.8" width=".9" height="5.6"/></g></g></g></svg>';

let btn: HTMLButtonElement | null = null;

function paint() {
  if (!btn) return;
  btn.dataset.l = cur;
  btn.setAttribute('aria-pressed', String(cur === 'ko'));
  btn.querySelectorAll<HTMLElement>('.flag').forEach(f => f.classList.toggle('on', f.dataset.l === cur));
}

/** The toggle for the title screen (main.ts puts it on the intro overlay, which leaves with the title). */
export function langToggle() {
  if (!document.getElementById('wm-lang-css')) {
    const st = document.createElement('style');
    st.id = 'wm-lang-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'wm-lang';
  b.setAttribute('aria-label', "Language of Glee's voice: English or Korean");
  b.innerHTML = `<span class="knob"></span><span class="flag" data-l="en">${EN}</span><span class="flag" data-l="ko">${KO}</span>`;
  b.addEventListener('click', e => { e.stopPropagation(); lang.set(cur === 'ko' ? 'en' : 'ko'); });
  btn = b;
  paint();
  return b;
}
