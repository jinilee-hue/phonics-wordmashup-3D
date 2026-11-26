// Phones (2026-11-26; user: "모바일 용을 고친다고 태블릿이나 pc버전이 깨지면 안돼"). The game is laid out on a
// 1280 x 720 design scaled to the screen, so on a phone held sideways (about 750 x 342) the top bar and the bottom
// buttons came out 26-33 px tall and their labels 6-11 px. A phone gets bigger controls and labels (GameScene, gl/index.ts,
// gl/reward.ts); everything else - and every tablet and PC - keeps the design as it was. Only a touch screen 500 px or
// less tall (held sideways) matches, so an iPad (768 px or more) or a mouse never does.
export const PHONE_LANDSCAPE = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)';

export function isPhone(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_LANDSCAPE).matches;
}

/** smallest tap target on a phone (px) */
export const PHONE_TAP = 44;
