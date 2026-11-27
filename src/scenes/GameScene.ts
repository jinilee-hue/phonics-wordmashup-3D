import Phaser from 'phaser';
import { WordCard, CARD_W, CARD_H, floatAmp } from '../objects/WordCard';
import { pickRoundPairs, COMPOUND_PAIRS, type CompoundPair } from '../data/compounds';
import { gameAudio } from '../audio';
import { isPhone, PHONE_LANDSCAPE, PHONE_TAP } from '../phone';

const ROUNDS = 6;
/** phones (src/phone.ts): the controls keep PHONE_EDGE px from the screen's top, left and right edges and
 *  PHONE_EDGE_BOTTOM from the bottom (user 2026-11-26: "너무 좌우 상하 여백없이 붙어있는건 아닌지"); the bottom row's
 *  buttons are PHONE_NAV.w wide, PHONE_NAV.gap apart and up to PHONE_NAV.h tall (round 2: bigger play controls for
 *  5-year-olds, in their places - as tall as the room under this level's cards allows) */
const PHONE_EDGE = 12, PHONE_EDGE_BOTTOM = 14, PHONE_NAV = { w: 104, gap: 8, h: 64 };
/** phones: the top bar's body at most PHONE_BAR px tall (a little under its 40-42 px, so the top cards and their float
 *  - halved on phones, WordCard - clash with it less; its labels stay 12 px); the result book's bottom row (Next Play,
 *  Replay, Home) at most PHONE_FINALE_NAV px tall, so the book's '?' cards keep room */
const PHONE_BAR = 36, PHONE_FINALE_NAV = 52;
const HINT_COST = 5;   // coins for the Hint button (Glee's own idle help stays free)
const CARD_GEMS = 5;   // gems to open a '?' card in the Compound Book (user 2026-11-22: what a game collects needs a use)
/** Game levels (phonics-kit README "공통 규칙: 레벨", user 2026-11-22). Never picked: START goes on at the saved level
 *  (localStorage LEVEL_KEY). A good game (all 6 words, 2+ hearts left) -> +1; a poor one (out of hearts, or 3 words or
 *  fewer) -> the same level, and two poor games in a row -> one down; any other game -> the same level.
 *  cards: on screen (half on each side, LAYOUTS). hearts: a wrong pair costs one, none left ends the game.
 *  idle: Glee's idle help (tutor.ts): she points at a card after idle[0] s of quiet, and the hint follows
 *  idle[1] - idle[0] s after her pointing ends (15/28 = about 15 s and 31 s; 25/42 = about 25 s and 45 s). */
const LEVELS = [
  { cards: 4,  hearts: 3, idle: [15, 28] },
  { cards: 6,  hearts: 3, idle: [15, 28] },   // the game before levels
  { cards: 8,  hearts: 3, idle: [15, 28] },
  { cards: 8,  hearts: 3, idle: [25, 42] },   // Glee helps later
  { cards: 10, hearts: 3, idle: [25, 42] },
  { cards: 10, hearts: 2, idle: [25, 42] },
] as const;
/** Card slots per side by cards per side: [x, y, angle] in design px (1280 x 720, card centre, y before startRound's +30);
 *  the right side mirrors the left. k = card size against the 6-card game. Checked at 1280x720, 1280x800 and 1024x768
 *  (3D outlines, the float included): no card on another card, the HUD or its LEVEL chip, the Gravity Zone, the bottom
 *  buttons, Glee's spot or the explanation's SKIP. */
const LAYOUTS: Record<number, { k: number; slots: [number, number, number][] }> = {
  2: { k: 1,    slots: [[310, 235, -4], [160, 440, -8]] },
  3: { k: 1,    slots: [[209, 185, -8], [359, 345, -4], [153, 500, -12]] },   // the game before levels
  4: { k: 0.9,  slots: [[118, 223, -8], [288, 225, -4], [118, 490, -12], [284, 450, -6]] },
  5: { k: 0.74, slots: [[98, 219, -8], [237, 201, -6], [370, 364, -4], [104, 487, -12], [234, 424, -8]] },
};

export class GameScene extends Phaser.Scene {
  // Dynamic screen dimensions — set in create()
  private gw = 0;
  private gh = 0;
  private cx = 0;
  private cy = 0;
  private collectionOpen = false;   // 도감 팝업 열림 가드
  private infoOpen = false;         // 재화 안내 모달 열림 가드
  private overButton = false;       // 인터랙티브 버튼 위 hover 여부(커서 유지용)
  private zoneR = 0;
  private snapOff = 0;
  /** a phone held sideways (src/phone.ts): the bigger top bar and bottom buttons' sizes, for the popups, Glee, SKIP and
   *  JUMP (gl/index.ts) and the reward chips (gl/reward.ts); null on tablets and PCs, which keep the design as it was */
  private phone: { hudK: number; hudBottom: number; lvL: number; lvR: number; lvB: number; navK: number; navTop: number; navH: number; navCY: number; navL: number; navR: number; micCX: number } | null = null;
  /** the Mic and Hint buttons' pieces: on a phone the result book's Next Play takes their place in the bottom row */
  private navMid: Phaser.GameObjects.GameObject[] = [];
  /** phones: lays the bottom row's Replay and Home out at a lower height (the result book's PHONE_FINALE_NAV row) */
  private phoneNavTo: ((h: number) => void) | null = null;

  private leftCards: WordCard[] = [];
  private rightCards: WordCard[] = [];
  private selectedLeft?: WordCard;
  private selectedRight?: WordCard;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private zoneGlowGfx!: Phaser.GameObjects.Graphics;
  private zoneSpinGfx!: Phaser.GameObjects.Graphics;
  private zoneSpinContainer!: Phaser.GameObjects.Container;
  private zonePulse!: Phaser.Tweens.Tween;
  private zoneAnimT = 0;
  private neonGlowLayers: { obj: Phaser.GameObjects.Text; base: number }[] = [];
  private neonCores: Phaser.GameObjects.Text[] = [];
  private queue: CompoundPair[] = [];
  private roundIndex = 0;
  private score = 0;
  private coins = 0;
  /** gems stay on this device from game to game (localStorage GEMS_KEY); stars, coins and hearts are per game */
  private gemBank = 0;
  private get gems() { return this.gemBank; }
  private set gems(v: number) {
    this.gemBank = Math.max(0, Math.round(v) || 0);
    try { localStorage.setItem(GameScene.GEMS_KEY, String(this.gemBank)); } catch { /* blocked: this page only */ }
  }
  private hearts: number = LEVELS[0].hearts;
  /** this game's level (1..6, LEVELS), the poor games in a row at it, and the next game's level (set at the end) */
  private level = 1;
  private poorRun = 0;
  private levelNext = 1;
  private get lv() { return LEVELS[this.level - 1]; }
  /** Glee's idle help for this level (tutor.ts reads it) */
  get idleHelp() { return this.lv.idle; }
  private coinsSpent = 0;
  /** this game's gems at the start, the gems spent and the '?' cards opened with them (progress.ts records them) */
  private gemsAtStart = 0;
  private gemsSpent = 0;
  private cardsOpened: string[] = [];
  /** open books that keep the HUD gem badge above them (liftGemBadge) */
  private gemLifts = 0;
  private heartText!: Phaser.GameObjects.Text;
  private heartIcon!: Phaser.GameObjects.Image;
  /** each HUD badge: its pieces (shaken together) and where the "−n" chip goes */
  private badgeInfo: Partial<Record<'heart' | 'score' | 'coin' | 'gem', { parts: { x: number }[]; cx: number; bottom: number; ix: number; iy: number; isz: number; k: number; icon: string }>> = {};
  /** the Hint button's pieces, and their grey look while coins are short */
  private hintParts: (Phaser.GameObjects.Image | Phaser.GameObjects.Text)[] = [];
  private hintGrey: Phaser.FX.ColorMatrix[] = [];
  private hintOff: boolean | null = null;
  private shaking = new Set<object>();
  private scoreText!: Phaser.GameObjects.Text;
  private coinText!: Phaser.GameObjects.Text;
  private gemText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private progressFill!: Phaser.GameObjects.Graphics;
  private hudTrackX = 0;
  private hudTrackY = 0;
  private hudTrackW = 0;
  private hudTrackH = 0;
  private progressRatio = 0;
  private busy = false;
  private dragCard: WordCard | null = null;
  private dragOffX = 0;
  private dragOffY = 0;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private settingsPanel?: Phaser.GameObjects.Container;
  private bgmOn = true;
  private sfxOn = true;
  // Mic button refs for active-state visual
  private micBtnLayers: Phaser.GameObjects.Image[] = [];
  private micBtnIcon!: Phaser.GameObjects.Image;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private micRecognition: any = null;
  private micRingTween?: Phaser.Tweens.Tween;
  private micRing?: Phaser.GameObjects.Graphics;
  private micIconTween?: Phaser.Tweens.Tween;
  private micWaveGfx?: Phaser.GameObjects.Graphics;
  private micWaveTween?: Phaser.Tweens.Tween;
  private micLabel?: Phaser.GameObjects.Text;
  private static readonly COLLECTED_KEY = 'phonics_collected_v1';
  private static readonly GEMS_KEY = 'wm.gems.v1';
  private static readonly LEVEL_KEY = 'wm.level.v1';

  constructor() { super({ key: 'Game' }); }

  preload() {
    // Actual PNG files
    this.load.image('game_bg',    './images/game_bg.png');
    this.load.image('icon_book',  './images/icon_book_v2.png');    // _v2: 고해상도 + 캐시 무력화(파일명 변경)
    this.load.image('icon_star',  './images/icon_star_v2.png');
    this.load.image('icon_money', './images/icon_money_v2.png');
    this.load.image('icon_gem',   './images/icon_gemstone_v2.png');
    // Word-specific card images (left / right): compounds.ts의 word1 / word2에서 자동으로 만든다.
    // 단어를 추가하면 여기는 고칠 필요 없음('cake'는 word2에만 있어 card_left_cake 404도 생기지 않음)
    [...new Set(COMPOUND_PAIRS.map(p => p.word1))]
      .forEach(w => this.load.image(`card_left_${w}`, `./images/card_left_${w}.png`));
    [...new Set(COMPOUND_PAIRS.map(p => p.word2))]
      .forEach(w => this.load.image(`card_right_${w}`, `./images/card_right_${w}.png`));
    // Combined-word result cards (e.g. card_pancake.png). Loaded for every compound;
    // any not yet uploaded simply fail to register and fall back to the drawn card.
    COMPOUND_PAIRS.forEach(p => this.load.image(`card_${p.result}`, `./images/card_${p.result}.png`));
    // HUD bar
    this.load.svg('hud_bar_main', './images/hud_bar_main.svg', { scale: 2 });
    this.load.svg('hud_bar_pill', './images/hud_bar_pill.svg', { scale: 2 });

    // Figma SVG assets — scale:2 rasterizes at 2× viewBox size for crisp display at any screen size
    this.load.svg('btn_back_shadow', './images/btn_back_shadow.svg', { scale: 2 });
    this.load.image('btn_back_main', './images/btn_back_main.png');   // 고해상도 PNG(래스터 아티팩트/캐시 방지)
    this.load.svg('badge_shadow',    './images/badge_shadow.svg',    { scale: 2 });
    this.load.svg('badge_star_main', './images/badge_star_main.svg', { scale: 2 });
    this.load.svg('badge_coin_main', './images/badge_coin_main.svg', { scale: 2 });
    this.load.svg('btn_plus',        './images/btn_plus.svg',        { scale: 2 });
    this.load.image('btn_setting',   './images/btn_setting.png');
    this.load.image('btn_next_play', './images/btn_next_play.png');
    this.load.svg('nav_blue_shadow', './images/nav_blue_shadow.svg', { scale: 2 });
    this.load.svg('nav_blue_main',   './images/nav_blue_main.svg',   { scale: 2 });
    this.load.svg('nav_blue_top',    './images/nav_blue_top.svg',    { scale: 2 });
    this.load.svg('nav_home_shadow', './images/nav_home_shadow.svg', { scale: 2 });
    this.load.svg('nav_home_main',   './images/nav_home_main.svg',   { scale: 2 });
    this.load.svg('nav_home_top',    './images/nav_home_top.svg',    { scale: 2 });
    this.load.svg('nav_green_shadow','./images/nav_green_shadow.svg',{ scale: 2 });
    this.load.svg('nav_green_main',  './images/nav_green_main.svg',  { scale: 2 });
    this.load.svg('nav_green_top',   './images/nav_green_top.svg',   { scale: 2 });
    this.load.svg('nav_hint_shadow', './images/nav_hint_shadow.svg', { scale: 2 });
    this.load.svg('nav_hint_main',   './images/nav_hint_main.svg',   { scale: 2 });
    this.load.svg('nav_hint_top',    './images/nav_hint_top.svg',    { scale: 2 });
    this.load.image('icon_replay',   './images/icon_replay.png');   // 고해상도 PNG
    this.load.image('icon_mic',      './images/icon_mic.png');
    this.load.image('icon_hint',     './images/icon_hint.png');
    this.load.image('icon_home',     './images/icon_home.png');
  }

  create() {
    // Compute dynamic dimensions once at scene start
    this.gw = this.scale.width;
    this.gh = this.scale.height;
    this.cx = Math.round(this.gw / 2);
    // 카드/그래비티존 전체를 아래로 30(디자인px, 해상도 비례) 이동
    this.cy = Math.round(this.gh * 0.44) + Math.round(this.gh / 720 * 30);
    this.zoneR   = Math.round(Math.min(this.gw, this.gh) * 0.19);
    this.snapOff = Math.round(this.zoneR * 0.65);

    this.queue = pickRoundPairs(ROUNDS);
    this.roundIndex = 0;
    this.score = 0;
    this.coins = 0;
    this.gemBank = this.loadGems();   // the gems carry over from the last game
    this.gemsAtStart = this.gemBank;
    this.gemsSpent = 0;
    this.cardsOpened = [];
    this.gemLifts = 0;
    this.loadLevel();                 // START (and Next Play / Replay) goes on at the saved level
    this.hearts = this.lv.hearts;
    this.coinsSpent = 0;
    this.badgeInfo = {};
    this.hintParts = []; this.hintGrey = []; this.hintOff = null;
    this.shaking.clear();
    this.busy = false;

    // Audio — keep the user's toggle choices across restarts, and unlock +
    // start the calm BGM on the first interaction (browser autoplay policy).
    this.bgmOn = gameAudio.bgmOn;
    this.sfxOn = gameAudio.sfxOn;
    this.input.once('pointerdown', () => { gameAudio.unlock(); gameAudio.startBgm(); });

    // Pointer cursor on hover for all interactive objects.
    // overButton 플래그로 카드 근접 pointermove 핸들러가 버튼 커서를 덮어쓰지 않게 함.
    this.input.on('gameobjectover', () => { this.overButton = true;  this.game.canvas.style.cursor = 'pointer'; });
    this.input.on('gameobjectout',  () => { this.overButton = false; this.game.canvas.style.cursor = 'default'; });

    // the phone layout is built once here: if the phone check stops (or starts) matching later - a phone turned upright, a
    // foldable opened - the game starts over in the layout that fits. Tablets and PCs never match, so it never fires there.
    const mq = window.matchMedia?.(PHONE_LANDSCAPE);
    if (mq) {
      const builtPhone = mq.matches;
      const flip = () => { if (mq.matches !== builtPhone) this.scene.restart(); };
      mq.addEventListener('change', flip);
      this.events.once('shutdown', () => mq.removeEventListener('change', flip));
    }
    this.phone = isPhone() ? { hudK: 0, hudBottom: 0, lvL: 0, lvR: 0, lvB: 0, navK: 0, navTop: 0, navH: 0, navCY: 0, navL: 0, navR: 0, micCX: 0 } : null;
    this.buildStageBackground();
    this.buildParticleBurst();
    this.makeHeartIcons();
    this.buildHUD();
    this.buildGravityZone();
    this.buildBottomNav();
    this.setupDrag();
    this.startRound();
  }

  update(_time: number, delta: number) {
    this.refreshHint();
    if (this.zoneSpinContainer?.active) {
      this.zoneSpinContainer.rotation += 0.012;
    }
    if (this.zoneGlowGfx) {
      this.zoneAnimT += delta / 1000;
      this.drawAnimatedGlow(this.zoneAnimT);
      this.syncNeonText(this.zoneAnimT);
    }
  }

  // ── Stage background ─────────────────────────────────────────────

  private buildStageBackground() {
    const { gw: GW, gh: GH } = this;

    if (this.textures.exists('game_bg')) {
      // Scale image to cover full screen (object-fit: cover)
      const img = this.add.image(GW / 2, GH / 2, 'game_bg').setDepth(0);
      const tex = this.textures.get('game_bg').getSourceImage();
      const scaleX = GW / tex.width;
      const scaleY = GH / tex.height;
      img.setScale(Math.max(scaleX, scaleY));
    } else {
      // Fallback gradient if image failed to load
      const bg = this.add.graphics();
      bg.fillGradientStyle(0x05051A, 0x05051A, 0x080820, 0x080820, 1);
      bg.fillRect(0, 0, GW, GH);
    }
  }

  // ── Particle burst ────────────────────────────────────────────────

  private buildParticleBurst() {
    const pt = this.make.graphics({ x: 0, y: 0 }, false);
    pt.fillStyle(0xffffff, 1);
    pt.fillCircle(6, 6, 6);
    pt.generateTexture('pDot', 12, 12);
    pt.destroy();

    // ── 'ray' — a white rounded capsule, tinted per-instance for the sunburst ──
    if (!this.textures.exists('ray')) {
      const rg = this.make.graphics({ x: 0, y: 0 }, false);
      rg.fillStyle(0xffffff, 1);
      rg.fillRoundedRect(0, 0, 28, 180, 14);
      rg.generateTexture('ray', 28, 180);
      rg.destroy();
    }

    // ── 'rayGrad' — god-ray: opaque at the base, fading to 100% clear at the tip ──
    if (!this.textures.exists('rayGrad')) {
      const W = 28, H = 200;
      const rg2 = this.make.graphics({ x: 0, y: 0 }, false);
      for (let y = 0; y < H; y++) {
        // y=0 is the tip (far, transparent), y=H is the base (near card, opaque)
        rg2.fillStyle(0xffffff, y / H);
        rg2.fillRect(0, y, W, 1);
      }
      rg2.generateTexture('rayGrad', W, H);
      rg2.destroy();
    }

    // ── 'starSpark' — a 4-point twinkle star ──
    if (!this.textures.exists('starSpark')) {
      const S = 64, c = S / 2, tip = 30, waist = 5;
      const sg2 = this.make.graphics({ x: 0, y: 0 }, false);
      sg2.fillStyle(0xffffff, 1);
      sg2.fillPoints([
        new Phaser.Geom.Point(c, c - tip), new Phaser.Geom.Point(c + waist, c - waist),
        new Phaser.Geom.Point(c + tip, c), new Phaser.Geom.Point(c + waist, c + waist),
        new Phaser.Geom.Point(c, c + tip), new Phaser.Geom.Point(c - waist, c + waist),
        new Phaser.Geom.Point(c - tip, c), new Phaser.Geom.Point(c - waist, c - waist),
      ], true);
      sg2.generateTexture('starSpark', S, S);
      sg2.destroy();
    }

    // ── 'softGlow' — soft radial white glow for the card-reveal flare ──
    if (!this.textures.exists('softGlow')) {
      const sg = this.make.graphics({ x: 0, y: 0 }, false);
      for (let r = 64; r > 0; r -= 2) {
        sg.fillStyle(0xffffff, 0.05);
        sg.fillCircle(64, 64, r);
      }
      sg.generateTexture('softGlow', 128, 128);
      sg.destroy();
    }

    // ── 'cloudPuff' — a fluffy white cloud blob (cluster of soft circles) ──
    if (!this.textures.exists('cloudPuff')) {
      const cg = this.make.graphics({ x: 0, y: 0 }, false);
      const puffs: [number, number, number][] = [
        [58, 78, 34], [94, 68, 40], [134, 80, 36],
        [76, 104, 38], [118, 106, 34], [98, 92, 46],
      ];
      cg.fillStyle(0xffffff, 0.35); puffs.forEach(([x, y, r]) => cg.fillCircle(x, y, r + 6));
      cg.fillStyle(0xffffff, 1);    puffs.forEach(([x, y, r]) => cg.fillCircle(x, y, r));
      cg.generateTexture('cloudPuff', 192, 184);
      cg.destroy();
    }

    // ── 'icon_play_tri' — rounded-corner play triangle (canvas arcTo) ──
    if (!this.textures.exists('icon_play_tri')) {
      const sz = 48;
      const cvs = this.textures.createCanvas('icon_play_tri', sz, sz) as Phaser.Textures.CanvasTexture;
      const tc = cvs.getContext();
      tc.clearRect(0, 0, sz, sz);
      tc.fillStyle = '#FFFFFF';
      const cx = sz / 2, cy = sz / 2;
      const outerR  = sz * 0.42;  // circumscribed-circle radius
      const cornerR = sz * 0.16;  // corner rounding amount
      // Vertices: right-pointing triangle at 0°, 120°, 240°
      const pts = [0, 120, 240].map(deg => ({
        x: cx + outerR * Math.cos(deg * Math.PI / 180),
        y: cy + outerR * Math.sin(deg * Math.PI / 180),
      }));
      tc.beginPath();
      tc.moveTo((pts[2].x + pts[0].x) / 2, (pts[2].y + pts[0].y) / 2);
      for (let i = 0; i < 3; i++) {
        tc.arcTo(pts[i].x, pts[i].y, pts[(i + 1) % 3].x, pts[(i + 1) % 3].y, cornerR);
      }
      tc.closePath();
      tc.shadowColor = 'rgba(0,0,0,0.35)';
      tc.shadowOffsetX = 0;
      tc.shadowOffsetY = 2;
      tc.shadowBlur = 4;
      tc.fill();
      cvs.refresh();
    }

    this.burst = this.add.particles(this.cx, this.cy, 'pDot', {
      speed: { min: 140, max: 440 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 550, max: 900 },
      quantity: 0,
      tint: [0xFFD700, 0xFF6B9D, 0x74CFFF, 0xFF8C00, 0xAAFF88, 0xFFFFFF],
      emitting: false,
    }).setDepth(60);
  }

  // ── HUD ──────────────────────────────────────────────────────────
  // All positions/sizes derived from Figma design at 1280×720

  private buildHUD() {
    const { gw: GW, gh: GH } = this;
    const sx = GW / 1280;
    const sy = GH / 720;
    const s  = Math.min(sx, sy);

    const p  = (fx: number) => Math.round(fx * sx);   // x pixel
    const q  = (fy: number) => Math.round(fy * sy);   // y pixel
    const HUD_K = 1.2;                                  // 상단 HUD 확대 배율
    // phones: the row as big as the width lets it be, PHONE_BAR px tall at most (the row is 1033 design units: back 62 +
    // 12 + book 241 | 4 badges 152 + 4 gaps 12 + settings 62), with its side margins and 8 px between the two groups
    const PH = this.phone;
    const PK = PH ? Math.min((GW - 2 * PHONE_EDGE - 8) / 1033, Math.max(s * HUD_K, 42 / 58), PHONE_BAR / 58) : 0;
    const ml = PH ? PHONE_EDGE : p(14);               // the left margin (phones: PHONE_EDGE)
    const sz = PH ? (f: number) => Math.round(f * PK) : (f: number)  => Math.round(f  * s * HUD_K); // uniform size (HUD 확대)

    // ── 상단 HUD 공통 규격 ──────────────────────────────────────────
    // 모든 에셋의 "몸통" 높이는 58단위. 단, 버튼(btn_back/btn_setting)만
    // viewBox 68(하단에 그림자 여백 10)이라 같은 크기로 그리면 몸통이 작게 렌더됨.
    // → 모든 요소의 "보이는 몸통 높이"를 bodyH(sz58)로 통일(무왜곡).
    const topY = this.phone ? PHONE_EDGE : q(13);   // 모든 몸통 top (Figma:13) — phones: PHONE_EDGE px from the top edge
    const bodyH = sz(58);                        // 공통 몸통 높이
    const midY = topY + Math.round(bodyH / 2);   // 몸통 세로 중심
    const bSz = sz(62);                          // 버튼 몸통 폭(레이아웃/히트존용)
    // 버튼: viewBox 68에 몸통 58 → 정사각 sz(68)로 그려 몸통을 정확히 bodyH로,
    // 몸통 중심(viewBox y=29)을 midY에 맞추는 y보정.
    const btnDisp = Math.round(bodyH * 68 / 58);
    const btnCyOff = Math.round(btnDisp * (0.5 - 29 / 68));
    // 공통 드롭섀도 — 버튼 baked shadow(dy3/blur1.5/black30%) 톤에 맞춤
    // 상단 4종(back/setting/pill/badge) 공통 그림자 — 완전히 동일하게 이 함수 하나로만 그림.
    // 동심 라운드렉트를 낮은 알파로 겹쳐 부드러운 falloff, 박스 중심에서 아래로 dy 오프셋.
    const drawTopShadow = (x: number, w: number, r: number) => {
      const g = this.add.graphics().setDepth(48);
      const cx = x + w / 2;
      const cy = midY + sz(4);          // dy 오프셋(아래로)
      const N = 6;
      for (let i = N; i >= 1; i--) {
        const sp = Math.round((sz(4) * i) / N);   // 0~sz4 동심 확산
        g.fillStyle(0x000000, 0.06);
        g.fillRoundedRect(cx - w / 2 - sp, cy - bodyH / 2 - sp, w + sp * 2, bodyH + sp * 2, r + sp);
      }
      return g;
    };

    // ── Back button (Figma: left:14, top:13, size:62) — 공통 그림자 함수 사용 ──
    drawTopShadow(ml, bSz, sz(16));
    const backImg = this.add.image(ml + bSz / 2, midY + btnCyOff, 'btn_back_main').setDisplaySize(btnDisp, btnDisp).setDepth(51);

    // Back button hit zone (invisible)
    const hitG = this.add.graphics().setDepth(55).setAlpha(0.001);
    hitG.fillRect(ml, topY, bSz, bodyH);
    hitG.setInteractive({ hitArea: new Phaser.Geom.Rectangle(ml, topY, bSz, bodyH), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
    hitG.on('pointerdown', () => {
      this.tweens.add({ targets: backImg, scaleX: 0.88, scaleY: 0.88, duration: 80, yoyo: true, ease: 'Back.easeIn' });
      this.cameras.main.fadeOut(280, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart());
    });

    // ── Compound Book pill (Figma: x88 top13 w241) — 몸통 높이 bodyH, 버튼과 동일 ──
    const pillW = sz(241), pillH = bodyH;
    const pillTop = topY, pillCY = midY;
    const pillX = ml + bSz + (PH ? Math.max(8, sz(12)) : sz(12));   // 뒤로가기 버튼과 간격 sz(12) (phones: 8 px at least)

    drawTopShadow(pillX, pillW, sz(16));
    // #3F2586 보라색 밑단(3D 그림자 박스) — 메인보다 sz(4) 아래로
    this.add.image(pillX + pillW / 2, pillCY + sz(4), 'hud_bar_main').setDisplaySize(pillW, pillH).setDepth(50);
    this.add.image(pillX + pillW / 2, pillCY, 'hud_bar_pill').setDisplaySize(pillW, pillH).setDepth(51);

    // Book icon on pill (Figma: offset x10, h56) — 세로 중앙
    this.iconShadow(this.add.image(pillX + sz(33), pillCY, 'icon_book').setDisplaySize(sz(42), sz(50)).setDepth(53));

    // "Compound Book" label — 상단
    this.add.text(pillX + sz(76), pillTop + sz(9), 'Compound Book', {
      fontFamily: '"Inter", "Baloo 2"', fontSize: `${PH ? Math.max(12, sz(18)) : sz(15)}px`,
      color: '#FFFFFF', fontStyle: 'bold',
    }).setDepth(52);

    // Track inner — 하단
    const tX = pillX + sz(63), tY = pillTop + sz(35), tW = sz(160), tH = sz(PH ? 22 : 19);   // phones: room for 12 px
    const trackG = this.add.graphics().setDepth(52);
    trackG.fillStyle(0x382a65, 1);
    trackG.fillRoundedRect(tX, tY, tW, tH, sz(10));

    this.hudTrackX = pillX + sz(65); this.hudTrackY = tY + sz(2);
    this.hudTrackW = sz(156); this.hudTrackH = sz(PH ? 18 : 15);
    this.progressFill = this.add.graphics().setDepth(53);

    // Round progress text (centered on track)
    this.roundText = this.add.text(tX + tW / 2, tY + tH / 2, `1 / ${ROUNDS}`, {
      fontFamily: 'Baloo 2', fontSize: `${PH ? Math.max(12, sz(18)) : sz(10)}px`, color: 'rgba(255,255,255,0.7)',
    }).setOrigin(0.5).setDepth(54);

    // 알약(Compound Book) 전체 클릭 → 도감 팝업. hover 시 손가락 커서.
    const bookHit = this.add.graphics().setDepth(54).setAlpha(0.001);
    bookHit.fillRect(pillX, topY, pillW, bodyH);
    bookHit.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(pillX, topY, pillW, bodyH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    bookHit.on('pointerdown', () => this.showCollection());

    // LEVEL chip under the bar's right end, in the bar's look - display only (the level is never picked)
    // phones: 12 px letters, the chip tucked up under the bar (the top cards of the 10-card levels start right below it)
    const lvW = sz(PH ? 100 : 80), lvH = sz(24), lvX = pillX + pillW - lvW, lvY = topY + bodyH + sz(PH ? 3 : 8);
    this.add.image(lvX + lvW / 2, lvY + lvH / 2 + sz(3), 'hud_bar_main').setDisplaySize(lvW, lvH).setDepth(50);
    this.add.image(lvX + lvW / 2, lvY + lvH / 2, 'hud_bar_pill').setDisplaySize(lvW, lvH).setDepth(51);
    this.add.text(lvX + lvW / 2, lvY + lvH / 2, `LEVEL ${this.level}`, {
      fontFamily: '"Inter", "Baloo 2"', fontSize: `${PH ? Math.max(12, sz(18)) : sz(14)}px`, color: '#FFFFFF', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(52);

    // ── 오른쪽 그룹: 배지 3 + 설정. 오른쪽 끝 기준(오른쪽 여백 = 왼쪽 back), 간격 sz(12) ──
    const bW = sz(152), bH = bodyH;
    const gap = PH ? Math.max(8, sz(12)) : sz(12);
    const margin = PH ? PHONE_EDGE : Math.round(14 * sx);   // 좌측 back 버튼 여백과 대칭
    const sLeft = GW - margin - bSz;             // 설정 버튼 좌측(몸통 폭 bSz)
    const b3L = sLeft - gap - bW;
    const b2L = b3L - gap - bW;
    const b1L = b2L - gap - bW;
    const b0L = b1L - gap - bW;                  // Heart badge, left of the star
    const badgeX = [b0L, b1L, b2L, b3L];

    // 설정 버튼 — 공통 그림자 함수 사용(back/pill/badge와 동일)
    drawTopShadow(sLeft, bSz, sz(16));
    const settingImg = this.add.image(sLeft + bSz / 2, midY + btnCyOff, 'btn_setting').setDisplaySize(btnDisp, btnDisp).setDepth(51);
    const settingHit = this.add.graphics().setDepth(55).setAlpha(0.001);
    settingHit.fillRect(sLeft, topY, bSz, bodyH);
    settingHit.setInteractive({ hitArea: new Phaser.Geom.Rectangle(sLeft, topY, bSz, bodyH), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
    settingHit.on('pointerdown', () => {
      this.tweens.add({ targets: settingImg, scaleX: 0.88, scaleY: 0.88, duration: 80, yoyo: true, ease: 'Back.easeIn' });
      this.showSettings();
    });

    // ── Currency badges ───────────────────────────────────────────
    const badges: { bgKey: string; iconKey: string; kind: 'heart' | 'score' | 'coin' | 'gem' }[] = [
      { bgKey: 'badge_coin_main', iconKey: 'icon_heart', kind: 'heart' },
      { bgKey: 'badge_star_main', iconKey: 'icon_star',  kind: 'score' },
      { bgKey: 'badge_coin_main', iconKey: 'icon_money', kind: 'coin'  },
      { bgKey: 'badge_coin_main', iconKey: 'icon_gem',   kind: 'gem'   },
    ];

    badges.forEach((cfg, i) => {
      const bx = badgeX[i];

      // #6A92BE 파란색 밑단(3D 그림자 박스) — 메인보다 sz(4) 아래로 + 부드러운 그림자
      const shadow = drawTopShadow(bx, bW, sz(16));
      const base = this.add.image(bx + bW / 2, midY + sz(4), 'badge_shadow').setDisplaySize(bW, bH).setDepth(50);
      const body = this.add.image(bx + bW / 2, midY, cfg.bgKey).setDisplaySize(bW, bH).setDepth(51);

      // 숫자용 어두운 인셋 바 (세로 중앙)
      const ibH = sz(40);
      const ibL = bx + sz(30), ibT = midY - ibH / 2, ibW = bW - sz(43);
      const ibG = this.add.graphics().setDepth(52);
      ibG.fillStyle(0x426295, 1);
      ibG.fillRoundedRect(ibL, ibT, ibW, ibH, sz(11));

      // 아이콘 (세로 중앙, 왼쪽으로 살짝 튀어나오게)
      const iconSz = sz(46);
      const icon = this.iconShadow(this.add.image(bx + sz(8) + iconSz / 2, midY, cfg.iconKey).setDisplaySize(iconSz, iconSz).setDepth(53));

      const numTxt = this.add.text(bx + sz(107), midY, cfg.kind === 'heart' ? `${this.hearts}` : cfg.kind === 'gem' ? `${this.gems}` : '0', {
        fontFamily: '"Inter", "Baloo 2"', fontSize: `${sz(22)}px`,
        color: '#FFFFFF', fontStyle: 'bold',
      }).setOrigin(1, 0.5).setDepth(53);
      if (cfg.kind === 'score') this.scoreText = numTxt;
      if (cfg.kind === 'coin')  this.coinText  = numTxt;
      if (cfg.kind === 'gem')   this.gemText   = numTxt;
      if (cfg.kind === 'heart') { this.heartText = numTxt; this.heartIcon = icon; }

      // + 버튼 (세로 중앙, 우측 끝) — 클릭 시 재화 정책 안내 모달
      const plusImg = this.add.image(bx + bW - sz(13), midY, 'btn_plus').setDisplaySize(sz(32), sz(32)).setDepth(53);
      // phones: the whole badge opens it (the + alone stays under 30 px there)
      const phX = PH ? bx : bx + bW - sz(31), phY = PH ? topY : midY - sz(18), phW = PH ? bW : sz(38), phH = PH ? bodyH : sz(36);
      const plusHit = this.add.graphics().setDepth(55).setAlpha(0.001);
      plusHit.fillRect(phX, phY, phW, phH);
      plusHit.setInteractive({ hitArea: new Phaser.Geom.Rectangle(phX, phY, phW, phH), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
      plusHit.on('pointerdown', () => {
        this.tweens.add({ targets: plusImg, scaleX: 0.85, scaleY: 0.85, duration: 80, yoyo: true, ease: 'Back.easeIn' });
        this.showCurrencyInfo(cfg.kind);
      });
      this.badgeInfo[cfg.kind] = {
        parts: [shadow, base, body, ibG, icon, numTxt, plusImg],
        cx: bx + bW / 2, bottom: midY + bH / 2 + sz(4), ix: icon.x, iy: midY, isz: iconSz, k: PH ? PK : s * HUD_K, icon: cfg.iconKey,
      };
    });
    if (PH) { PH.hudK = PK; PH.hudBottom = topY + bodyH + sz(4); Object.assign(PH, { lvL: lvX, lvR: lvX + lvW, lvB: lvY + lvH + sz(3) }); }
  }

  private drawProgress() {
    const fillW = Math.round(this.hudTrackW * this.progressRatio);
    this.progressFill.clear();
    if (fillW < 4) return;
    const r = Math.min(this.hudTrackH / 2, fillW / 2);
    // Main fill
    this.progressFill.fillStyle(0x9040c8, 1);
    this.progressFill.fillRoundedRect(this.hudTrackX, this.hudTrackY, fillW, this.hudTrackH, r);
    // Top highlight — inset by 3px sides and 2px top so it never exceeds fill bounds
    const hilX = this.hudTrackX + 3;
    const hilW = fillW - 6;
    if (hilW > 0) {
      const hilH = Math.max(2, Math.round(this.hudTrackH * 0.28));
      this.progressFill.fillStyle(0xffffff, 0.28);
      this.progressFill.fillRoundedRect(hilX, this.hudTrackY + 2, hilW, hilH, Math.min(hilH / 2, hilW / 2));
    }
  }

  private animateProgressTo(targetRatio: number) {
    const from = { r: this.progressRatio };
    this.tweens.add({
      targets: from,
      r: Math.min(targetRatio, 1),
      duration: 500,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        this.progressRatio = from.r;
        this.drawProgress();
      },
      onComplete: () => {
        this.progressRatio = Math.min(targetRatio, 1);
        this.drawProgress();
      },
    });
  }

  // ── Settings overlay ─────────────────────────────────────────────

  private showSettings() {
    if (this.settingsPanel) { this.settingsPanel.setVisible(true); return; }

    const { gw: GW, gh: GH } = this;
    // phones: the panel as big as the screen allows, on a shorter layout (340 units, rows 60 apart) - 42 px controls
    const PH = this.phone;
    const s = PH ? Math.min((GH - PHONE_EDGE - PHONE_EDGE_BOTTOM) / 340, (GW - 2 * PHONE_EDGE) / 480, 1) : Math.min(GW / 1280, GH / 720);
    const sz = (f: number) => Math.round(f * s);
    const py = (desk: number, phone: number) => (PH ? phone : desk);   // a design y: the phone layout's where it differs

    const panelW = sz(480), panelH = sz(py(400, 340));
    const panelX = GW / 2, panelY = GH / 2;

    const container = this.add.container(panelX, panelY).setDepth(200);

    // Dark backdrop
    const backdrop = this.add.graphics();
    backdrop.fillStyle(0x000000, 0.65);
    backdrop.fillRect(-GW / 2, -GH / 2, GW, GH);
    backdrop.setInteractive(new Phaser.Geom.Rectangle(-GW / 2, -GH / 2, GW, GH), Phaser.Geom.Rectangle.Contains);
    container.add(backdrop);

    // Panel background
    const panel = this.add.graphics();
    panel.fillStyle(0x1a1040, 1);
    panel.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, sz(24));
    panel.lineStyle(sz(2), 0x7b63b7, 0.6);
    panel.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, sz(24));
    container.add(panel);

    // Title
    const title = this.add.text(0, -panelH / 2 + sz(py(40, 34)), '⚙️  Settings', {
      fontFamily: '"Noto Sans KR", "Baloo 2"', fontSize: `${sz(28)}px`,
      color: '#FFFFFF', fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(title);

    // Divider
    const div = this.add.graphics();
    div.lineStyle(1, 0x7b63b7, 0.4);
    div.lineBetween(-panelW / 2 + sz(24), -panelH / 2 + sz(py(72, 62)), panelW / 2 - sz(24), -panelH / 2 + sz(py(72, 62)));
    container.add(div);

    // Toggle helper — iOS-style sliding knob, no emoji
    const makeToggle = (labelText: string, rowY: number, isOn: () => boolean, toggle: () => void) => {
      const label = this.add.text(-panelW / 2 + sz(40), rowY, labelText, {
        fontFamily: '"Noto Sans KR", "Baloo 2"', fontSize: `${sz(22)}px`, color: '#CCBBFF',
      }).setOrigin(0, 0.5);

      const tW = sz(88), tH = sz(44), tX = panelW / 2 - sz(56), tY = rowY;
      const knobR = tH / 2 - sz(4);
      const trackBg = this.add.graphics();
      const knobGfx = this.add.graphics();

      const refresh = () => {
        const on = isOn();
        // Track
        trackBg.clear();
        trackBg.fillStyle(on ? 0x9b6de8 : 0x3a3560, 1);
        trackBg.fillRoundedRect(tX - tW / 2, tY - tH / 2, tW, tH, tH / 2);
        // Knob shadow + white circle
        const kx = on ? tX + tW / 2 - tH / 2 : tX - tW / 2 + tH / 2;
        knobGfx.clear();
        knobGfx.fillStyle(0x000000, 0.18);
        knobGfx.fillCircle(kx, tY + sz(2), knobR);
        knobGfx.fillStyle(0xFFFFFF, 1);
        knobGfx.fillCircle(kx, tY, knobR);
      };
      refresh();

      const hit = this.add.graphics().setAlpha(0.001);
      hit.fillRect(tX - tW / 2, tY - tH / 2, tW, tH);
      hit.setInteractive({ hitArea: new Phaser.Geom.Rectangle(tX - tW / 2, tY - tH / 2, tW, tH), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
      hit.on('pointerdown', () => { toggle(); refresh(); });

      container.add([label, trackBg, knobGfx, hit]);
    };

    makeToggle('Music (BGM)', -sz(py(60, 66)), () => this.bgmOn, () => { this.bgmOn = !this.bgmOn; gameAudio.unlock(); gameAudio.startBgm(); gameAudio.setBgmEnabled(this.bgmOn); });
    makeToggle('Sounds (SFX)', sz(py(8, -6)),   () => this.sfxOn, () => { this.sfxOn = !this.sfxOn; gameAudio.sfxOn = this.sfxOn; });
    // phonics-api key (phonics-kit rule): a teacher enters it once per device; the pill shows whether the company server
    // hears the words (green 연결됨) or the browser does (키 입력) — gl/apiSR.ts
    const PA = (window as unknown as { PhonicsAPI?: PhonicsAPIType }).PhonicsAPI;
    if (PA) {
      const rowY = sz(py(76, 54));
      const keyLabel = this.add.text(-panelW / 2 + sz(40), rowY, 'Speech server key', {
        fontFamily: '"Noto Sans KR", "Baloo 2"', fontSize: `${sz(22)}px`, color: '#CCBBFF',
      }).setOrigin(0, 0.5);
      const pW = sz(124), pH = sz(44), pR = panelW / 2 - sz(12), pL = pR - pW;
      const pill = this.add.graphics();
      const pillText = this.add.text(pL + sz(34), rowY, '', {
        fontFamily: '"Noto Sans KR", "Baloo 2"', fontSize: `${sz(19)}px`, color: '#FFFFFF', fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      const paintKey = () => {
        const on = PA.status() === 'on';
        pill.clear();
        pill.fillStyle(on ? 0x2e7d5b : 0x3a3560, 1);
        pill.fillRoundedRect(pL, rowY - pH / 2, pW, pH, pH / 2);
        pill.fillStyle(on ? 0x5ff0a8 : 0x9a93c0, 1);
        pill.fillCircle(pL + sz(20), rowY, sz(7));
        pillText.setText(on ? 'Linked' : 'Add key');
      };
      paintKey();
      window.addEventListener('phonicsapi:status', paintKey);
      const keyHit = this.add.graphics().setAlpha(0.001);
      keyHit.fillRect(pL, rowY - pH / 2, pW, pH);
      keyHit.setInteractive({ hitArea: new Phaser.Geom.Rectangle(pL, rowY - pH / 2, pW, pH), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
      keyHit.on('pointerdown', () => { void PA.keyDialog().then(paintKey); });
      container.add([keyLabel, pill, pillText, keyHit]);
    }

    // Close button
    const closeBtnY = panelH / 2 - sz(py(44, 38));
    const closeBg = this.add.graphics();
    closeBg.fillStyle(0x5a3fbf, 1);
    closeBg.fillRoundedRect(-sz(72), closeBtnY - sz(22), sz(144), sz(44), sz(12));
    const closeText = this.add.text(0, closeBtnY, 'Close', {
      fontFamily: '"Noto Sans KR", "Baloo 2"', fontSize: `${sz(22)}px`, color: '#FFFFFF', fontStyle: 'bold',
    }).setOrigin(0.5);
    const closeHit = this.add.graphics().setAlpha(0.001);
    closeHit.fillRect(-sz(72), closeBtnY - sz(22), sz(144), sz(44));
    closeHit.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-sz(72), closeBtnY - sz(22), sz(144), sz(44)), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
    closeHit.on('pointerdown', () => container.setVisible(false));
    closeHit.on('pointerover', () => { closeBg.clear(); closeBg.fillStyle(0x7b63b7, 1); closeBg.fillRoundedRect(-sz(72), closeBtnY - sz(22), sz(144), sz(44), sz(12)); });
    closeHit.on('pointerout',  () => { closeBg.clear(); closeBg.fillStyle(0x5a3fbf, 1); closeBg.fillRoundedRect(-sz(72), closeBtnY - sz(22), sz(144), sz(44), sz(12)); });

    container.add([closeBg, closeText, closeHit]);

    // Entrance animation
    container.setScale(0.85).setAlpha(0);
    this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });

    this.settingsPanel = container;
  }

  // ── Gravity Zone ─────────────────────────────────────────────────

  private buildGravityZone() {
    const { cx: CX, cy: CY } = this;

    this.zoneGfx = this.add.graphics().setDepth(6);
    this.drawStaticZone();

    // Animated glow layer — pulsing bloom + light sweep racing around the ring.
    // Sits above the static zone but below the text so the rings light up behind GRAVITY/ZONE.
    this.zoneGlowGfx = this.add.graphics().setDepth(6.5).setBlendMode(Phaser.BlendModes.ADD);

    // Spinning ring container — text is NOT inside so it stays readable
    this.zoneSpinContainer = this.add.container(CX, CY).setDepth(7);
    this.zoneSpinGfx = this.add.graphics();
    this.zoneSpinContainer.add(this.zoneSpinGfx);
    this.drawSpinRing();

    // Static neon text — sized to fill the inner ring (×0.52 of zoneR)
    // Use zoneR to derive font size so it fills the circle regardless of screen size
    const fs = Math.round(this.zoneR * 0.52);
    const makeNeonText = (x: number, y: number, label: string, glowHex: string) => {
      // 흰색 코어만 렌더(자체 네온 글로우 유지). 배경에 겹쳐 보이던 확대 블룸 복제 레이어 제거.
      const core = this.add.text(x, y, label, {
        fontFamily: '"Baloo 2", sans-serif', fontSize: `${fs}px`,
        color: '#FFFFFF', fontStyle: 'bold',
        shadow: { offsetX: 0, offsetY: 0, color: glowHex, blur: 18, fill: true },
      }).setOrigin(0.5).setDepth(8);
      this.neonCores.push(core);
      return core;
    };
    makeNeonText(CX, CY - Math.round(fs * 0.55), 'GRAVITY', '#00E0FF');
    makeNeonText(CX, CY + Math.round(fs * 0.50), 'ZONE',    '#FF2DA0');

    // Subtle breathing of the static base zone (no scale → avoids drift; glow layer does the flashing)
    this.zonePulse = this.tweens.add({
      targets: this.zoneGfx,
      alpha: { from: 0.78, to: 1 },
      duration: 1400, ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
    });
  }

  private drawStaticZone() {
    const { cx: CX, cy: CY, zoneR: ZONE_R } = this;
    const g = this.zoneGfx;
    const PINK = 0xFF2DA0;
    const CYAN = 0x00E0FF;
    g.clear();

    // ── Floor grid (radial lines + concentric) ───────────────────
    for (let a = 0; a < 360; a += 30) {
      const rad = Phaser.Math.DegToRad(a);
      g.lineStyle(0.8, CYAN, 0.13);
      g.lineBetween(CX, CY,
        CX + Math.cos(rad) * ZONE_R * 1.85,
        CY + Math.sin(rad) * ZONE_R * 1.85,
      );
    }
    [0.38, 0.62].forEach(f => {
      g.lineStyle(0.8, CYAN, 0.15);
      g.strokeCircle(CX, CY, ZONE_R * f);
    });

    // ── Ambient bloom fill ───────────────────────────────────────
    [[ZONE_R * 2.0, 0.025], [ZONE_R * 1.45, 0.045], [ZONE_R * 1.1, 0.07]].forEach(([r, a]) => {
      g.fillStyle(PINK, a as number); g.fillCircle(CX, CY, r as number);
    });
    [[ZONE_R * 1.75, 0.02], [ZONE_R * 1.3, 0.04], [ZONE_R * 1.05, 0.06]].forEach(([r, a]) => {
      g.fillStyle(CYAN, a as number); g.fillCircle(CX, CY, r as number);
    });

    // ── Ring 1 — inner pink (×0.52) ──────────────────────────────
    [[32, 0.04], [20, 0.09], [11, 0.24], [5, 0.62], [2, 1]].forEach(([w, a]) => {
      g.lineStyle(w as number, PINK, a as number);
      g.strokeCircle(CX, CY, ZONE_R * 0.52);
    });

    // ── Ring 2 — middle cyan (×0.76) ─────────────────────────────
    [[28, 0.04], [17, 0.10], [9, 0.28], [4, 0.72], [1.5, 1]].forEach(([w, a]) => {
      g.lineStyle(w as number, CYAN, a as number);
      g.strokeCircle(CX, CY, ZONE_R * 0.76);
    });

    // ── Ring 3 — outer pink (×1.0) — main ring ───────────────────
    [[56, 0.03], [40, 0.06], [26, 0.11], [16, 0.20], [9, 0.40], [4, 0.78], [1.5, 1]].forEach(([w, a]) => {
      g.lineStyle(w as number, PINK, a as number);
      g.strokeCircle(CX, CY, ZONE_R);
    });
    // 메인 링 하이라이트 — 민트(시안 한 색)처럼 핑크도 같은 핑크 한 색으로만 빛나게
    g.lineStyle(1, PINK, 0.85);
    g.strokeCircle(CX, CY, ZONE_R);

    // ── Far cyan halo rings ───────────────────────────────────────
    [[ZONE_R + 85, 0.03], [ZONE_R + 52, 0.07], [ZONE_R + 26, 0.16]].forEach(([r, a]) => {
      g.lineStyle(2.5, CYAN, a as number);
      g.strokeCircle(CX, CY, r as number);
    });

    // ── Center target cross ───────────────────────────────────────
    const cr = ZONE_R * 0.14;
    [[8, 0.15], [4, 0.4], [1.5, 0.9]].forEach(([w, a]) => {
      g.lineStyle(w as number, CYAN, a as number);
      g.lineBetween(CX - cr, CY, CX + cr, CY);
      g.lineBetween(CX, CY - cr, CX, CY + cr);
    });
    g.fillStyle(CYAN, 0.9); g.fillCircle(CX, CY, 4);
    g.fillStyle(PINK, 0.7); g.fillCircle(CX, CY, 2.5);
  }

  private drawSpinRing() {
    const { zoneR: ZONE_R } = this;
    const g = this.zoneSpinGfx;
    // 눈금·점의 핑크를 원 링이 시안 글로우와 겹쳐 보이는 자홍빛에 맞춤(민트/시안은 유지)
    const PINK = 0xFF5BFD;
    const CYAN = 0x00E0FF;
    g.clear();

    // Tick marks on outer ring — major pink / minor cyan
    for (let a = 0; a < 360; a += 15) {
      const rad = Phaser.Math.DegToRad(a);
      const isMajor = a % 45 === 0;
      const color = isMajor ? PINK : CYAN;
      const inner = ZONE_R + 8;
      const outer = ZONE_R + (isMajor ? 32 : 20);
      g.lineStyle(isMajor ? 3.5 : 1.5, color, isMajor ? 1 : 0.6);
      g.lineBetween(
        Math.cos(rad) * inner, Math.sin(rad) * inner,
        Math.cos(rad) * outer, Math.sin(rad) * outer,
      );
    }

    // Outer neon dots — alternating pink/cyan
    for (let a = 0; a < 360; a += 30) {
      const rad = Phaser.Math.DegToRad(a);
      const r = ZONE_R + 48;
      const color = a % 60 === 0 ? PINK : CYAN;
      // glow dot (bloom)
      g.fillStyle(color, 0.25); g.fillCircle(Math.cos(rad) * r, Math.sin(rad) * r, 8);
      g.fillStyle(color, 0.90); g.fillCircle(Math.cos(rad) * r, Math.sin(rad) * r, 4);
    }
  }

  // ── Animated glow + light sweep (runs every frame) ───────────────

  private drawAnimatedGlow(t: number) {
    const { cx: CX, cy: CY, zoneR: ZONE_R } = this;
    const g = this.zoneGlowGfx;
    const PINK = 0xFF2DA0;
    const CYAN = 0x00E0FF;
    const WHITE = 0xFFFFFF;
    g.clear();

    // Overall breathing pulse 0..1 (slow heartbeat of the whole zone)
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    // Fast shimmer layered on top for a "flickering lights" feel
    const shimmer = 0.85 + 0.15 * Math.sin(t * 9.0);
    const heat = pulse * shimmer;

    // ── Pulsing bloom haze (ADD blend brightens whatever is behind) ──
    [[ZONE_R * 1.55, 0.05], [ZONE_R * 1.18, 0.08], [ZONE_R * 0.95, 0.11]].forEach(([r, a]) => {
      g.fillStyle(PINK, (a as number) * (0.35 + heat * 0.95));
      g.fillCircle(CX, CY, r as number);
    });
    [[ZONE_R * 1.32, 0.04], [ZONE_R * 1.0, 0.07], [ZONE_R * 0.74, 0.09]].forEach(([r, a]) => {
      g.fillStyle(CYAN, (a as number) * (0.35 + heat * 0.95));
      g.fillCircle(CX, CY, r as number);
    });

    // ── Bright ring overlays that flare with the pulse ──────────────
    [[16, 0.06], [9, 0.14], [4, 0.30], [1.5, 0.55]].forEach(([w, a]) => {
      g.lineStyle(w as number, PINK, (a as number) * (0.4 + heat * 0.85));
      g.strokeCircle(CX, CY, ZONE_R);
    });
    [[12, 0.05], [6, 0.12], [2.5, 0.28]].forEach(([w, a]) => {
      g.lineStyle(w as number, CYAN, (a as number) * (0.4 + heat * 0.85));
      g.strokeCircle(CX, CY, ZONE_R * 0.76);
    });
    [[10, 0.05], [5, 0.12], [2, 0.26]].forEach(([w, a]) => {
      g.lineStyle(w as number, PINK, (a as number) * (0.4 + heat * 0.85));
      g.strokeCircle(CX, CY, ZONE_R * 0.52);
    });
    // 메인 링 코어 라인(펄스 피크) — 핑크 한 색으로만 빛나게(민트와 동일 방식)
    g.lineStyle(2, PINK, 0.25 + heat * 0.6);
    g.strokeCircle(CX, CY, ZONE_R);

    // ── Light sweep — bright comets racing around the main ring ─────
    const COMETS = 3;
    for (let i = 0; i < COMETS; i++) {
      const ang = t * 1.7 + (i * Math.PI * 2 / COMETS);
      const col = i % 2 === 0 ? CYAN : PINK;
      // trailing tail
      for (let tr = 6; tr >= 1; tr--) {
        const ta = ang - tr * 0.10;
        const tx = CX + Math.cos(ta) * ZONE_R;
        const ty = CY + Math.sin(ta) * ZONE_R;
        const f = 1 - tr / 7;
        g.fillStyle(col, 0.30 * f);
        g.fillCircle(tx, ty, 6 * f);
      }
      // bright head
      const hx = CX + Math.cos(ang) * ZONE_R;
      const hy = CY + Math.sin(ang) * ZONE_R;
      g.fillStyle(col, 0.22); g.fillCircle(hx, hy, 18);
      g.fillStyle(col, 0.55); g.fillCircle(hx, hy, 8);
      g.fillStyle(WHITE, 0.95); g.fillCircle(hx, hy, 3.5);
    }
  }

  private syncNeonText(t: number) {
    // Neon glow breathes in step with the ring so the text reads as part of the same light
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    const shimmer = 0.88 + 0.12 * Math.sin(t * 9.0);
    this.neonGlowLayers.forEach(l => l.obj.setAlpha(l.base * (0.45 + pulse * 1.05) * shimmer));
    // Gentle breathing of the crisp cores keeps the letters alive without drifting
    const cs = 1 + pulse * 0.022;
    this.neonCores.forEach(c => c.setScale(cs));
  }

  // ── Bottom navigation ─────────────────────────────────────────────
  // Figma: 4 buttons at top:648, each width:162
  // Replay:301  Mic:473  Hint:645  Home:817

  private buildBottomNav() {
    const { gw: GW, gh: GH } = this;
    const sx = GW / 1280;
    const sy = GH / 720;
    const s  = Math.min(sx, sy);

    const p  = (fx: number) => Math.round(fx * sx);
    const q  = (fy: number) => Math.round(fy * sy);
    // phones (round 2, 2026-11-26: bigger play controls for 5-year-olds, in their places): the four buttons PHONE_NAV.w
    // wide in a centred row PHONE_EDGE_BOTTOM px over the bottom edge, 20 px labels, as tall as the room under this
    // level's cards (as designed - their places and size untouched) over that row allows: 64 px at most, 42 at least
    const PH = this.phone;
    const BW = PHONE_NAV.w, BG = PHONE_NAV.gap, rowL = Math.round(GW / 2 - (4 * BW + 3 * BG) / 2), rowR = rowL + 4 * BW + 3 * BG;
    let NH = 42;
    if (PH) {
      const lay = LAYOUTS[this.lv.cards / 2], ck = 0.972 * 0.8 * s * lay.k;   // startRound's card slots and size
      let low = 0;
      for (const [x, y, a] of lay.slots) for (const fx of [x, 1280 - x]) {
        const r = (a * Math.PI) / 180, c = Math.abs(Math.cos(r)), n = Math.abs(Math.sin(r));
        const hw = (100 * c + 134 * n) * ck, hh = (100 * n + 134 * c) * ck, cx = Math.round(fx * sx);
        if (cx + hw > rowL - 4 && cx - hw < rowR + 4) low = Math.max(low, Math.round((y + 30) * sy) + hh);
      }
      NH = Math.max(42, Math.min(PHONE_NAV.h, Math.floor(GH - PHONE_EDGE_BOTTOM - 5 - (low + 8))));
    }
    const NK = PH ? NH / 58 : 0;
    const sz = PH ? (f: number) => Math.round(f * NK) : (f: number)  => Math.round(f  * s);
    const iz = PH ? (f: number) => Math.round(f * 0.9) : sz;          // icons (phones: a little under the label's scale)
    /** a Figma x on the button row (301 / 473 / 645 / 817 = the buttons' left edges, + 81 = their centres); phones: the centred row */
    const nx = PH ? (fx: number) => { const i = Math.floor((fx - 301) / 172); return rowL + i * (BW + BG) + Math.round(((fx - 301 - i * 172) / 162) * BW); } : p;
    const nw = PH ? () => BW : p;                                        // a button's width (Figma 162)

    const navH = sz(58), shadowOff = sz(4);
    const navY = PH ? GH - navH - shadowOff - PHONE_EDGE_BOTTOM : q(648); // 높이는 균일 배율(sz)로 → 상단 HUD와 높이 일치
    const navCY = navY + Math.round(navH / 2);
    if (PH) Object.assign(PH, { navK: NK, navTop: navY, navH, navCY, navL: rowL, navR: rowR, micCX: nx(473 + 81) });
    const txtStyle = {
      fontFamily: '"Inter", "Baloo 2"', fontSize: `${PH ? 20 : sz(24)}px`,
      color: '#FFFFFF', fontStyle: 'bold',
      shadow: { offsetX: 0, offsetY: sz(2), color: 'rgba(0,0,0,0.25)', blur: 2, fill: true },
    };

    const drawLayered = (figX: number, figW: number, shKey: string, mainKey: string, topKey: string) => {
      const x = nx(figX), w = nw(figW);
      return [
        this.add.image(x + w / 2, navCY + shadowOff, shKey  ).setDisplaySize(w, navH).setDepth(40),
        this.add.image(x + w / 2, navCY,             mainKey).setDisplaySize(w, navH).setDepth(41),
        this.add.image(x + w / 2, navCY,             topKey ).setDisplaySize(w, navH).setDepth(42),
      ];
    };

    const makeHit = (figX: number, figW: number, cb: () => void) => {
      const x = nx(figX), w = nw(figW);
      const h = this.add.graphics().setDepth(45).setAlpha(0.001);
      h.fillRect(x, navY, w, navH);
      h.setInteractive({ hitArea: new Phaser.Geom.Rectangle(x, navY, w, navH), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
      h.on('pointerdown', cb);
      return h;
    };
    // phones: Replay's and Home's pieces (layers, icon, label, tap area) for phoneNavTo
    const ends: { layers: Phaser.GameObjects.Image[]; mid: Phaser.GameObjects.Components.Transform[]; hit: Phaser.GameObjects.Graphics; x: number; w: number }[] = [];

    const btnPress = (imgs: Phaser.GameObjects.Image[]) => {
      this.tweens.add({ targets: imgs, scaleX: 0.92, scaleY: 0.92, duration: 80, yoyo: true, ease: 'Back.easeIn' });
    };

    // Center icon+text pair within button: measures text width after creation
    const centerInBtn = (btnCX: number, icon: Phaser.GameObjects.Image, iconW: number, label: string): Phaser.GameObjects.Text => {
      const txt = this.add.text(0, navCY, label, txtStyle).setOrigin(0, 0.5).setDepth(43);
      const gap = sz(10);
      const totalW = iconW + gap + txt.width;
      icon.setX(Math.round(btnCX - totalW / 2 + iconW / 2));
      txt.setX(Math.round(btnCX - totalW / 2 + iconW + gap));
      return txt;
    };

    // ── Replay  (Figma left:301) ──────────────────────────────────
    const replayLayers = drawLayered(301, 162, 'nav_home_shadow', 'nav_home_main', 'nav_home_top');
    const replayIcon = this.add.image(0, navCY, 'icon_replay').setDisplaySize(iz(30), iz(30)).setDepth(43);
    const replayLabel = centerInBtn(nx(301 + 81), replayIcon, iz(30), 'Replay');
    const replayHit = makeHit(301, 162, () => {
      btnPress([replayIcon]);
      this.time.delayedCall(100, () => {
        this.cameras.main.fadeOut(280, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart());
      });
    });

    // ── Mic  (Figma left:473) ─────────────────────────────────────
    const micX = nx(473), micW = nw(162);
    const micShadow = this.add.image(micX + micW / 2, navCY + shadowOff, 'nav_green_shadow').setDisplaySize(micW, navH).setDepth(40);
    const micMain = this.add.image(micX + micW / 2, navCY, 'nav_green_main').setDisplaySize(micW, navH).setDepth(41);
    const micTop  = this.add.image(micX + micW / 2, navCY, 'nav_green_top' ).setDisplaySize(micW, navH).setDepth(42);
    this.micBtnLayers = [micMain, micTop];
    this.micBtnIcon = this.add.image(0, navCY, 'icon_mic').setDisplaySize(iz(24), iz(34)).setDepth(43);
    this.micLabel = centerInBtn(nx(473 + 81), this.micBtnIcon, iz(24), 'Mic');
    const micHit = makeHit(473, 162, () => {
      btnPress([this.micBtnIcon]);
      this.startMic();
    });

    // ── Hint  (Figma left:645) ────────────────────────────────────
    const hintImgs: Phaser.GameObjects.Image[] = [];
    const hintLayers = drawLayered(645, 162, 'nav_hint_shadow', 'nav_hint_main', 'nav_hint_top');
    const hintIcon = this.add.image(0, navCY, 'icon_hint').setDisplaySize(iz(28), iz(34)).setDepth(43);
    hintImgs.push(hintIcon);
    const hintLabel = centerInBtn(nx(645 + 81), hintIcon, iz(28), 'Hint');
    // grey while coins are short (refreshHint); WebGL only - the Canvas renderer fades it instead
    this.hintParts = [...hintLayers, hintIcon, hintLabel];
    for (const o of this.hintParts) {
      const fx = o.preFX?.addColorMatrix();
      if (!fx) continue;
      fx.grayscale(1); fx.brightness(0.82, true); fx.active = false;
      this.hintGrey.push(fx);
    }
    const hintHit = makeHit(645, 162, () => {
      // the Hint costs HINT_COST coins. Nothing to show now (between rounds, game over) = no charge.
      // Too few coins: it does nothing - the button and the coin badge shake "no" (no text).
      if (this.busy || this.hearts <= 0) return;
      if (this.coins < HINT_COST) {
        this.shake(this.hintParts, 0.6);
        this.shake(this.badgeInfo.coin?.parts ?? []);
        return;
      }
      btnPress(hintImgs);
      this.spend('coin', HINT_COST);
      this.showHint();
    });
    this.navMid = [micShadow, micMain, micTop, this.micBtnIcon, this.micLabel!, micHit, ...hintLayers, hintIcon, hintLabel, hintHit];

    // ── Home  (Figma left:817) ────────────────────────────────────
    const homeImgs: Phaser.GameObjects.Image[] = [];
    const homeLayers = drawLayered(817, 162, 'nav_home_shadow', 'nav_home_main', 'nav_home_top');
    const homeIcon = this.add.image(0, navCY, 'icon_home').setDisplaySize(iz(30), iz(28)).setDepth(43);
    homeImgs.push(homeIcon);
    const homeLabel = centerInBtn(nx(817 + 81), homeIcon, iz(30), 'Home');
    const homeHit = makeHit(817, 162, () => {
      btnPress(homeImgs);
      this.time.delayedCall(100, () => {
        this.cameras.main.fadeOut(400, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => window.location.reload());
      });
    });

    // phones: the result book's row is lower (PHONE_FINALE_NAV): Replay and Home go down to height h on the same bottom
    // margin - same width, icon and 20 px label (they never scale with the row on a phone); the Mic and Hint are hidden then
    this.phoneNavTo = null;
    if (!PH) return;
    ends.push({ layers: replayLayers, mid: [replayIcon, replayLabel], hit: replayHit, x: nx(301), w: nw(162) },
      { layers: homeLayers, mid: [homeIcon, homeLabel], hit: homeHit, x: nx(817), w: nw(162) });
    this.phoneNavTo = (h: number) => {
      if (h >= navH) return;
      const sh = Math.round((h / 58) * 4), y = GH - h - sh - PHONE_EDGE_BOTTOM, cy = y + Math.round(h / 2);
      for (const e of ends) {
        e.layers.forEach((im, i) => im.setY(i === 0 ? cy + sh : cy).setDisplaySize(e.w, h));
        e.mid.forEach(o => { o.y = cy; });
        e.hit.clear().fillStyle(0x000000, 0).fillRect(e.x, y, e.w, h);   // (clear() drops the new graphics' clear fill)
        (e.hit.input!.hitArea as Phaser.Geom.Rectangle).setTo(e.x, y, e.w, h);
      }
      Object.assign(PH, { navK: h / 58, navTop: y, navH: h, navCY: cy });
    };
  }

  private startMic() {
    // Toggle off if already listening
    if (this.micRecognition) {
      this.micRecognition.stop();
      return;
    }
    if (this.busy) return;

    const SR = (window as unknown as Record<string, unknown>).SpeechRecognition
             || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SR) { this.showToast("This browser can't listen."); return; }

    const { gw: GW, gh: GH } = this;
    const s  = Math.min(GW / 1280, GH / 720);
    const PH = this.phone;   // phones: the bottom buttons' own size and row (buildBottomNav)
    const sz = PH ? (f: number) => Math.round(f * PH.navK) : (f: number) => Math.round(f * s);

    // ── Active visual ──────────────────────────────────────────────
    this.micBtnLayers.forEach(l => l.setTint(0x88ffaa));
    this.micBtnIcon.setTint(0x00ff66);
    this.micLabel?.setColor('#00ff66');

    // Button top layer breathes
    this.micIconTween = this.tweens.add({
      targets: this.micBtnLayers[1],
      alpha: { from: 0.45, to: 1 },
      duration: 500, ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
    });

    // Sound-wave arcs behind mic icon (right-facing concentric arcs)
    const waveGfx = this.add.graphics().setDepth(42);
    this.micWaveGfx = waveGfx;
    const ix = this.micBtnIcon.x;
    const iy = this.micBtnIcon.y;
    const arcA = -Math.PI * 0.42, arcB = Math.PI * 0.42;
    const drawWave = (alpha: number) => {
      waveGfx.clear();
      [{ r: sz(13), a: alpha * 0.9, w: 2.5 },
       { r: sz(19), a: alpha * 0.65, w: 2.0 },
       { r: sz(25), a: alpha * 0.38, w: 1.5 }].forEach(({ r, a, w }) => {
        waveGfx.lineStyle(w, 0x00ff66, a);
        waveGfx.beginPath();
        waveGfx.arc(ix, iy, r, arcA, arcB, false, 0.02);
        waveGfx.strokePath();
      });
    };
    drawWave(1);
    this.micWaveTween = this.tweens.addCounter({
      from: 100, to: 35, duration: 600,
      ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
      onUpdate: t => drawWave((t.getValue() ?? 100) / 100),
    });

    // Expanding ring radiating from button center
    const ringX = PH ? PH.micCX : Math.round((473 + 81) * GW / 1280);
    const ringY = PH ? PH.navCY : Math.round(GH * 677 / 720);
    const ringW = PH ? PHONE_NAV.w : sz(162);   // phones: the Mic button's width (buildBottomNav)
    const ring  = this.add.graphics().setDepth(39);
    this.micRing = ring;
    this.micRingTween = this.tweens.add({
      targets: ring, alpha: { from: 0.7, to: 0 },
      scaleX: { from: 1, to: 2.6 }, scaleY: { from: 1, to: 2.6 },
      duration: 700, repeat: -1, ease: 'Sine.easeOut',
      onUpdate: () => {
        ring.clear();
        ring.lineStyle(sz(4), 0x44ff88, 1);
        ring.strokeRoundedRect(ringX - ringW / 2, ringY - sz(29), ringW, sz(58), sz(14));
      },
    });

    const stopMic = () => {
      this.micRecognition = null;
      this.micRingTween?.stop();
      this.micRing?.destroy();
      this.micIconTween?.stop();
      this.micWaveTween?.stop();
      this.micWaveGfx?.destroy();
      this.micBtnLayers.forEach(l => { l.clearTint(); l.setAlpha(1); });
      this.micBtnIcon.clearTint();
      this.micLabel?.setColor('#ffffff');
    };

    // ── Speech Recognition ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (SR as new () => any)();
    this.micRecognition = recognition;
    recognition.lang            = 'en-US';
    recognition.interimResults  = false;
    recognition.maxAlternatives = 5;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      stopMic();
      const pair = this.queue[this.roundIndex];

      // Collect all alternatives into one string pool
      const texts: string[] = [];
      for (let i = 0; i < e.results[0].length; i++) {
        texts.push(e.results[0][i].transcript.trim().toLowerCase());
      }

      const hasWord1 = texts.some(t => t.includes(pair.word1));
      const hasWord2 = texts.some(t => t.includes(pair.word2));

      if (hasWord1 && hasWord2) {
        // Both words heard → auto-snap and check
        const leftCard  = this.leftCards.find(c => c?.active && c.word === pair.word1);
        const rightCard = this.rightCards.find(c => c?.active && c.word === pair.word2);
        if (leftCard && rightCard) {
          if (this.selectedLeft  && this.selectedLeft  !== leftCard)  this.selectedLeft.shakeBack();
          if (this.selectedRight && this.selectedRight !== rightCard) this.selectedRight.shakeBack();
          this.selectedLeft  = leftCard;
          this.selectedRight = rightCard;
          leftCard.snapToZone (this.cx - this.snapOff, this.cy);
          rightCard.snapToZone(this.cx + this.snapOff, this.cy);
          this.time.delayedCall(400, () => this.checkMatch());
        }
      } else if (hasWord1 || hasWord2) {
        const found = hasWord1 ? pair.word1 : pair.word2;
        this.showToast(`"${found}" — got it! Now say the other word!`);
      } else {
        this.showToast('Try saying it again!');
      }
    };

    recognition.onerror = () => stopMic();
    recognition.onend   = () => stopMic();

    recognition.start();
  }

  private showHint() {
    if (this.busy) return;
    const pair = this.queue[this.roundIndex];
    const correctL = this.leftCards.find(c =>  c?.active && c.word === pair.word1);
    const correctR = this.rightCards.find(c => c?.active && c.word === pair.word2);

    // Dim wrong cards
    [...this.leftCards, ...this.rightCards].forEach(c => {
      if (!c?.active || c === correctL || c === correctR) return;
      this.tweens.add({ targets: c, alpha: 0.25, duration: 220 });
      this.time.delayedCall(2200, () => {
        if (c?.active) this.tweens.add({ targets: c, alpha: 1, duration: 300 });
      });
    });

    // Highlight correct cards
    [correctL, correctR].forEach(card => {
      if (!card?.active) return;
      const sx = card.scaleX, sy = card.scaleY;
      const cW = CARD_W * sx, cH = CARD_H * sy;

      // Glow layers behind the card (like Gravity Zone aura)
      const glow = this.add.graphics().setDepth(card.depth - 2);
      const ringR = Math.max(cW, cH) * 0.7;
      [
        { r: ringR * 1.5, a: 0.07 },
        { r: ringR * 1.25, a: 0.13 },
        { r: ringR * 1.0,  a: 0.20 },
        { r: ringR * 0.78, a: 0.13 },
      ].forEach(({ r, a }) => {
        glow.fillStyle(0xFFFF00, a);
        glow.fillCircle(card.x, card.y, r);
      });

      // Dotted circle ring — small dots arranged around the circumference
      const ring = this.add.graphics().setDepth(card.depth + 2);
      const dotCount = 16, dotR = 5;
      ring.fillStyle(0xFFFF00, 1);
      for (let d = 0; d < dotCount; d++) {
        const angle = (d / dotCount) * Math.PI * 2 - Math.PI / 2;
        ring.fillCircle(
          card.x + Math.cos(angle) * ringR,
          card.y + Math.sin(angle) * ringR,
          dotR,
        );
      }

      // Blink ring + glow together
      this.tweens.add({
        targets: [ring, glow], alpha: 0,
        duration: 260, ease: 'Sine.easeInOut', yoyo: true, repeat: 4,
        onComplete: () => { ring.destroy(); glow.destroy(); },
      });

      // Scale bounce ×3
      this.tweens.add({
        targets: card, scaleX: sx * 1.14, scaleY: sy * 1.14,
        duration: 200, ease: 'Back.easeOut', yoyo: true, repeat: 2,
      });
    });

  }

  private getCollected(): Set<string> {
    try {
      const raw = localStorage.getItem(GameScene.COLLECTED_KEY);
      return new Set(raw ? JSON.parse(raw) as string[] : []);
    } catch { return new Set(); }
  }

  private addCollected(result: string) {
    const set = this.getCollected();
    set.add(result);
    try { localStorage.setItem(GameScene.COLLECTED_KEY, JSON.stringify([...set])); } catch {}
  }

  private loadGems() {
    try {
      const v = parseInt(localStorage.getItem(GameScene.GEMS_KEY) ?? '', 10);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch { return this.gemBank; }   // blocked storage: keep this page's count
  }

  private showToast(msg: string) {
    const { gw: GW, gh: GH } = this;
    const s = Math.min(GW / 1280, GH / 720);
    const toast = this.add.text(GW / 2, Math.round(GH * 0.82), msg, {
      fontFamily: '"Noto Sans KR", "Baloo 2"', fontSize: `${this.phone ? Math.max(13, Math.round(s * 22)) : Math.round(s * 22)}px`,
      color: '#FFFFFF', fontStyle: 'bold',
      backgroundColor: 'rgba(0,0,0,0.65)', padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setDepth(200).setAlpha(0);
    this.tweens.add({ targets: toast, alpha: 1, y: toast.y - Math.round(GH * 0.03), duration: 250, ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({ targets: toast, alpha: 0, delay: 1800, duration: 300, onComplete: () => toast.destroy() }),
    });
  }

  // ── Round management ──────────────────────────────────────────────

  private startRound() {
    const { gw: GW, gh: GH } = this;
    this.busy = false;
    this.dragCard = null;
    this.selectedLeft = undefined;
    this.selectedRight = undefined;
    this.leftCards = [];
    this.rightCards = [];
    this.roundText.setText(`${this.roundIndex + 1} / ${ROUNDS}`);

    const pair = this.queue[this.roundIndex];

    // ── 보기 카드 선택 ──────────────────────────────────────────────
    // 규칙: (1) 보여지는 좌/우 카드로 만들 수 있는 실제 합성어는 정답 1개뿐,
    //       (2) 좌/우 각각 중복 단어 없음. 한쪽 카드 수 n은 레벨(LEVELS.cards / 2).
    const n = this.lv.cards / 2;
    const validSet = new Set(COMPOUND_PAIRS.map(p => `${p.word1} ${p.word2}`));
    const isCompound = (a: string, b: string) => validSet.has(`${a} ${b}`);
    const iconW1 = new Map(COMPOUND_PAIRS.map(p => [p.word1, p.icon1] as const));
    const iconW2 = new Map(COMPOUND_PAIRS.map(p => [p.word2, p.icon2] as const));
    const allW1 = [...new Set(COMPOUND_PAIRS.map(p => p.word1))];
    const allW2 = [...new Set(COMPOUND_PAIRS.map(p => p.word2))];
    const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);

    // 좌측: 정답 word1 + distractor n-1개(정답 word2와 합쳐도 합성어가 아닌 것, 중복 없음)
    const leftWords = [pair.word1];
    for (const w of shuffle(allW1)) {
      if (leftWords.length >= n) break;
      if (leftWords.includes(w)) continue;
      if (isCompound(w, pair.word2)) continue;      // 정답 우측과 또 다른 조합이 되면 제외
      leftWords.push(w);
    }
    // 우측: 정답 word2 + distractor n-1개(어떤 좌측 카드와도 합성어가 안 되는 것, 중복 없음)
    const rightWords = [pair.word2];
    for (const w of shuffle(allW2)) {
      if (rightWords.length >= n) break;
      if (rightWords.includes(w)) continue;
      if (leftWords.some(l => isCompound(l, w))) continue;  // 좌측(정답 포함) 어느 것과도 조합 불가
      rightWords.push(w);
    }

    const leftData  = shuffle(leftWords.map(w => ({ word: w, icon: iconW1.get(w) ?? '' })));
    const rightData = shuffle(rightWords.map(w => ({ word: w, icon: iconW2.get(w) ?? '' })));

    const s = Math.min(GW / 1280, GH / 720);   // 화면 균일 배율
    const lay = LAYOUTS[n];
    const CARD_SCALE = 0.972 * 0.8 * s * lay.k;   // 카드 크기 80%로 축소 + 화면 균일 배율(태블릿 대응) + 카드 수별 배율
    // Figma-matched staggered positions (Figma canvas: 1280×720)
    // Values are card CENTER coordinates
    const pf = (fx: number) => Math.round(fx * GW / 1280);
    const qf = (fy: number) => Math.round(fy * GH / 720);

    const leftPos  = lay.slots.map(([x, y]) => ({ x, y }));   // 카드 수별 자리(LAYOUTS; 6장 = 레벨 전과 같음)
    // 오른쪽 = 왼쪽의 좌우 대칭(사용자: "왼쪽과 대칭 되게 배치하면 될거 같아"). 원래: x 1139/950/1060, y 175/360/510, 각도 10/4/8
    const rightPos = leftPos.map(p => ({ x: 1280 - p.x, y: p.y }));
    const leftAngle  = lay.slots.map(([, , a]) => a);
    const rightAngle = leftAngle.map(a => -a);

    const makeCard = (figX: number, figY: number, angle: number, slotIdx: number, word: string, icon: string, side: 'left' | 'right') => {
      const targetX  = pf(figX);
      let targetY    = qf(figY + 30);   // 전체 아래로 30(그래비티존과 동일 이동)
      let k = CARD_SCALE;
      if (this.phone) ({ y: targetY, k } = this.phoneCardFit(targetX, targetY, angle, CARD_SCALE));   // phones: clear of the bars
      const startX   = side === 'left' ? -CARD_W : GW + CARD_W;
      const leftKey  = `card_left_${word}`;
      const rightKey = `card_right_${word}`;
      const bgKey    = side === 'left'
        ? (this.textures.exists(leftKey)  ? leftKey  : undefined)
        : (this.textures.exists(rightKey) ? rightKey : undefined);
      const card = new WordCard(this, startX, targetY, word, icon, true, bgKey);
      card.baseScale = k;   // 상호작용 트윈의 기준 배율(클릭 시 커지는 버그 방지) (CARD_SCALE; phones: phoneCardFit)
      card.setScale(k);
      card.setAngle(angle);
      card.baseX = targetX;
      this.tweens.add({ targets: card, x: targetX, duration: 480 + slotIdx * 40, ease: 'Back.easeOut', delay: slotIdx * 80 });
      return card;
    };

    leftData.forEach((d, i) => this.leftCards.push(
      makeCard(leftPos[i].x, leftPos[i].y, leftAngle[i], i, d.word, d.icon, 'left')
    ));
    rightData.forEach((d, i) => this.rightCards.push(
      makeCard(rightPos[i].x, rightPos[i].y, rightAngle[i], i, d.word, d.icon, 'right')
    ));
  }

  /** phones: a card's rest place and size in its slot, so that at the top of its float it stays 8 px under the top bar
   *  and its LEVEL chip and at the bottom of its float (its rest) 8 px over the bottom buttons (coordinator 2026-11-26).
   *  A card that would cross one moves the least it needs to, straight up or down; one that can't fit between them shrinks
   *  (85 % of its size at the least - then it sits halfway). Cards clear of both keep their slot as designed. */
  private phoneCardFit(x: number, y0: number, angle: number, k0: number) {
    const PH = this.phone!, amp = floatAmp(), a = (angle * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
    /** the card outline's highest (or lowest) point over the x range L..R, against its centre; null: not over it */
    const edge = (k: number, L: number, R: number, low: boolean) => {
      let poly = [[-CARD_W / 2, -CARD_H / 2], [CARD_W / 2, -CARD_H / 2], [CARD_W / 2, CARD_H / 2], [-CARD_W / 2, CARD_H / 2]]
        .map(([u, v]) => [x + (u * cs - v * sn) * k, (u * sn + v * cs) * k]);
      for (const [side, lim] of [[1, L], [-1, R]]) {
        const out: number[][] = [];
        poly.forEach((p, i) => {
          const q = poly[(i + 1) % poly.length], ip = side * (p[0] - lim) >= 0, iq = side * (q[0] - lim) >= 0;
          if (ip) out.push(p);
          if (ip !== iq) out.push([lim, p[1] + ((lim - p[0]) / (q[0] - p[0])) * (q[1] - p[1])]);
        });
        poly = out;
      }
      if (!poly.length) return null;
      const ys = poly.map(p => p[1]);
      return low ? Math.max(...ys) : Math.min(...ys);
    };
    const room = (k: number) => {
      let lo = PH.hudBottom + 8 + amp - edge(k, -1e9, 1e9, false)!;
      const chip = edge(k, PH.lvL, PH.lvR, false);
      if (chip !== null) lo = Math.max(lo, PH.lvB + 8 + amp - chip);
      const nav = edge(k, PH.navL, PH.navR, true);
      return [Math.ceil(lo), nav === null ? Infinity : Math.floor(PH.navTop - 8 - nav)];
    };
    let k = k0, [lo, hi] = room(k);
    while (lo > hi && k > k0 * 0.85) { k = Math.max(k0 * 0.85, k - k0 * 0.01); [lo, hi] = room(k); }
    return { y: lo > hi ? Math.round((lo + hi) / 2) : Math.min(Math.max(y0, lo), hi), k };
  }

  // ── Drag event wiring ─────────────────────────────────────────────

  private setupDrag() {
    // Grab radius = visual card half-diagonal + finger slop, in CSS/game pixels.
    // Distance-based selection means the card whose CENTER is closest to the touch
    // always wins — no hit-zone overlap issues, works on touch and mouse equally.
    const s = Math.min(this.gw / 1280, this.gh / 720);
    const GRAB_R = (Math.hypot(CARD_W / 2, CARD_H / 2) * 0.972 * 0.8 + 20) * s; // 카드 80% 축소 반영

    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (this.busy || this.dragCard) return;

      const cards = [...this.leftCards, ...this.rightCards].filter(c => !c.inZone);
      let best: WordCard | null = null;
      let bestDist = GRAB_R;
      for (const c of cards) {
        const d = Phaser.Math.Distance.Between(ptr.worldX, ptr.worldY, c.x, c.y);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      if (!best) return;

      this.dragCard = best;
      this.dragOffX = best.x - ptr.worldX;
      this.dragOffY = best.y - ptr.worldY;
      best.startDrag();
    });

    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (this.dragCard) {
        if (ptr.isDown) {
          this.dragCard.x = ptr.worldX + this.dragOffX;
          this.dragCard.y = ptr.worldY + this.dragOffY;
        }
        return;
      }
      // Hand cursor on any card within grab radius (proximity-based, same as drag selection)
      const cards = [...this.leftCards, ...this.rightCards].filter(c => !c.inZone);
      const nearCard = cards.some(
        c => Phaser.Math.Distance.Between(ptr.worldX, ptr.worldY, c.x, c.y) < GRAB_R,
      );
      // 버튼 위(overButton)면 버튼 hover 커서 유지, 아니면 카드 근접 여부로 결정
      this.game.canvas.style.cursor = (nearCard || this.overButton) ? 'pointer' : 'default';
    });

    this.input.on('pointerup', () => {
      if (!this.dragCard) return;
      const card = this.dragCard;
      this.dragCard = null;

      const isLeft  = this.leftCards.includes(card);
      const isRight = this.rightCards.includes(card);
      const dist = Phaser.Math.Distance.Between(card.x, card.y, this.cx, this.cy);

      if ((isLeft || isRight) && dist < this.zoneR + 30) {
        if (isLeft) {
          if (this.selectedLeft && this.selectedLeft !== card) this.selectedLeft.shakeBack();
          this.selectedLeft = card;
          card.snapToZone(this.cx - this.snapOff, this.cy);
        } else {
          if (this.selectedRight && this.selectedRight !== card) this.selectedRight.shakeBack();
          this.selectedRight = card;
          card.snapToZone(this.cx + this.snapOff, this.cy);
        }
        if (this.selectedLeft?.inZone && this.selectedRight?.inZone) {
          this.time.delayedCall(260, () => this.checkMatch());
        }
      } else if (!card.inZone) {
        card.resetPosition();
      }
      card.endDrag();
      this.game.canvas.style.cursor = 'default';
    });
  }

  private checkMatch() {
    const pair = this.queue[this.roundIndex];
    if (this.selectedLeft!.word === pair.word1 && this.selectedRight!.word === pair.word2) {
      this.time.delayedCall(160, () => this.triggerCollision());
    } else {
      this.onWrongMatch();
    }
  }

  private onWrongMatch() {
    this.cameras.main.flash(180, 255, 60, 60, false);
    this.cameras.main.shake(260, 0.009);
    gameAudio.playWrong();   // failure SFX

    const wrongText = this.add.text(this.cx, this.cy, '✗', {
      fontFamily: 'Baloo 2', fontSize: '80px', color: '#FF4444', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(70).setAlpha(0);
    this.tweens.add({
      targets: wrongText, alpha: 1, scaleX: 1.4, scaleY: 1.4, duration: 200,
      onComplete: () => this.tweens.add({ targets: wrongText, alpha: 0, duration: 300, delay: 200, onComplete: () => wrongText.destroy() }),
    });

    // shake both cards back to their column positions
    this.selectedLeft?.shakeBack();
    this.selectedRight?.shakeBack();
    this.selectedLeft  = undefined;
    this.selectedRight = undefined;

    // a wrong pair costs a heart; with none left the game ends (never below 0)
    if (this.hearts > 0) {
      this.spend('heart', 1);
      if (this.hearts <= 0) this.outOfHearts();
    }
  }

  /** No hearts left: the game ends - the result screen with what was collected so far (stars, coins, gems and the
   *  Compound Book cards stay). A moment first to see the last heart go; the cards fade out under it. */
  private outOfHearts() {
    this.busy = true;
    this.time.delayedCall(1100, () => {
      [...this.leftCards, ...this.rightCards].forEach(c => { if (c?.active) this.tweens.add({ targets: c, alpha: 0, duration: 260 }); });
      this.showFinale();
    });
  }

  // ── Collision sequence ────────────────────────────────────────────

  private triggerCollision() {
    const { cx: CX, cy: CY } = this;
    this.busy = true;

    // Fade out all non-selected cards
    [...this.leftCards, ...this.rightCards].forEach(c => {
      if (c !== this.selectedLeft && c !== this.selectedRight) {
        this.tweens.add({ targets: c, alpha: 0, duration: 200, onComplete: () => c.destroy() });
      }
    });

    this.tweens.add({ targets: this.selectedLeft,  x: CX - 18, y: CY, duration: 300, ease: 'Cubic.easeIn' });
    this.tweens.add({
      targets: this.selectedRight, x: CX + 18, y: CY, duration: 300, ease: 'Cubic.easeIn',
      onComplete: () => this.playImpact(),
    });
  }

  private playImpact() {
    const { cx: CX, cy: CY } = this;
    const pair = this.queue[this.roundIndex];

    this.cameras.main.flash(200, 255, 255, 255, false);
    this.cameras.main.shake(280, 0.012);
    gameAudio.playBurst();   // sparkle SFX as the particles burst

    // Background pink/blue fluorescent lights rising up from the zone
    this.playRisingLights(CX, CY);
    // Cartoon mashup burst — colourful sunburst rays + fluffy cloud poof
    this.playMashupBurst(CX, CY);

    const wave = this.add.graphics().setDepth(55);
    this.tweens.add({
      targets: { r: 0, a: 1 },
      r: Math.max(this.gw, this.gh) * 0.29, a: 0,
      duration: 500, ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        const v = tw.targets[0] as { r: number; a: number };
        wave.clear();
        wave.lineStyle(4, 0xFFFFFF, v.a * 0.8);
        wave.strokeCircle(CX, CY, v.r);
        wave.lineStyle(2, 0x74C0E8, v.a * 0.4);
        wave.strokeCircle(CX, CY, v.r * 0.7);
      },
      onComplete: () => wave.destroy(),
    });

    const bolt = this.add.graphics().setDepth(56);
    bolt.lineStyle(3, 0xFFFFFF, 0.9);
    bolt.lineBetween(CX - this.gw * 0.11, CY, CX + this.gw * 0.11, CY);
    this.time.delayedCall(120, () => bolt.destroy());

    // Confetti follows the poof so the cloud/rays read first
    this.time.delayedCall(160, () => {
      this.burst.setPosition(CX, CY);
      this.burst.explode(80);
    });
    this.time.delayedCall(280, () => {
      this.burst.setPosition(CX - 60, CY); this.burst.explode(30);
      this.burst.setPosition(CX + 60, CY); this.burst.explode(30);
    });

    this.selectedLeft?.pulseOut();
    this.selectedRight?.pulseOut();

    this.time.delayedCall(520, () => {
      this.showResultCard(pair);
    });
  }

  // ── Rising pink/blue fluorescent lights (background, on combine) ──

  private playRisingLights(cx: number, cy: number) {
    const PINK = 0xFF2DA0;
    const CYAN = 0x00E0FF;
    const span = this.zoneR * 1.2;
    // Start low — down at the floor behind the zone — and rise gently from there
    const baseY = cy + this.zoneR * 1.05;

    // Thin vertical neon light columns easing softly upward from the background
    const COUNT = 13;
    for (let i = 0; i < COUNT; i++) {
      const t = i / (COUNT - 1);
      const x = cx - span + t * span * 2 + Phaser.Math.Between(-8, 8);
      const color = i % 2 === 0 ? PINK : CYAN;
      const w = this.zoneR * Phaser.Math.FloatBetween(0.028, 0.05);
      const h = this.zoneR * Phaser.Math.FloatBetween(1.3, 2.1);
      const streak = this.add.image(x, baseY, 'ray')
        .setOrigin(0.5, 1)          // grows upward from its base
        .setTint(color)
        .setDepth(5)                // behind the cards — reads as background
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDisplaySize(w, 1)
        .setAlpha(0);
      this.tweens.add({
        targets: streak, displayHeight: h, alpha: 0.5,   // subtle
        y: baseY - this.zoneR * 0.2,
        duration: 520 + i * 24, ease: 'Sine.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: streak, alpha: 0, displayHeight: h * 1.1,
            y: streak.y - this.zoneR * 0.5,
            duration: 560, ease: 'Sine.easeIn',
            onComplete: () => streak.destroy(),
          });
        },
      });
    }

    // A few soft sparkles drifting up from the floor
    const sparks = this.add.particles(0, 0, 'pDot', {
      x: { min: cx - span, max: cx + span },
      y: baseY,
      speedY: { min: -220, max: -90 },
      speedX: { min: -30, max: 30 },
      accelerationY: -40,
      scale: { start: 0.38, end: 0 },
      alpha: { start: 0.6, end: 0 },
      lifespan: { min: 700, max: 1200 },
      tint: [PINK, CYAN, 0xFFFFFF],
      blendMode: 'ADD',
      quantity: 0,
      emitting: false,
    }).setDepth(6);
    sparks.explode(26);
    this.time.delayedCall(1400, () => sparks.destroy());
  }

  // ── Cartoon mashup burst (sunburst rays + cloud poof) ─────────────

  private playMashupBurst(cx: number, cy: number) {
    const base = Math.min(this.gw, this.gh);
    const COLORS = [0xFF2DA0, 0x00E0FF, 0xFFD400, 0x7BE0A0, 0xFF8C2A, 0x9B6BFF, 0x4DA6FF, 0xFFFFFF];

    // ── Sunburst rays — colourful capsules shooting outward from center ──
    const RAY_COUNT = 16;
    const rayLen = base * 0.34;
    for (let i = 0; i < RAY_COUNT; i++) {
      const ang = (i / RAY_COUNT) * 360 + (i % 2 === 0 ? 0 : 11);
      const color = COLORS[i % COLORS.length];
      const long = i % 2 === 0;
      const w = long ? base * 0.022 : base * 0.014;
      const ray = this.add.image(cx, cy, 'ray')
        .setOrigin(0.5, 1)            // pivot at the tail so it grows from the center
        .setAngle(ang)
        .setTint(color)
        .setDepth(53)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDisplaySize(w, 1)
        .setAlpha(0.95);
      const len = rayLen * (long ? 1 : 0.62);
      this.tweens.add({
        targets: ray, displayHeight: len,
        duration: 260, ease: 'Cubic.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: ray, displayHeight: len * 1.18, alpha: 0,
            duration: 240, ease: 'Cubic.easeIn',
            onComplete: () => ray.destroy(),
          });
        },
      });
    }

    // ── Fluffy cloud poof — a ring of cloud blobs blooming at the center ──
    const PUFF_COUNT = 9;
    const puffR = base * 0.075;
    for (let i = 0; i < PUFF_COUNT; i++) {
      const ang = Phaser.Math.DegToRad((i / PUFF_COUNT) * 360 + 18);
      const dist = base * 0.05;
      const px = cx + Math.cos(ang) * dist;
      const py = cy + Math.sin(ang) * dist;
      const puff = this.add.image(px, py, 'cloudPuff')
        .setDisplaySize(puffR, puffR)
        .setDepth(58)
        .setAlpha(0)
        .setScale(0.2);
      const tgt = puffR * Phaser.Math.FloatBetween(1.5, 2.1);
      this.tweens.add({
        targets: puff, displayWidth: tgt, displayHeight: tgt, alpha: 1,
        x: cx + Math.cos(ang) * dist * 2.4,
        y: cy + Math.sin(ang) * dist * 2.4,
        duration: 220, ease: 'Back.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: puff, alpha: 0, displayWidth: tgt * 1.25, displayHeight: tgt * 1.25,
            duration: 320, ease: 'Cubic.easeIn', delay: 60,
            onComplete: () => puff.destroy(),
          });
        },
      });
    }

    // Dense central puff to hide the seam where cards meet
    const core = this.add.image(cx, cy, 'cloudPuff')
      .setDisplaySize(puffR * 1.4, puffR * 1.4)
      .setDepth(59).setAlpha(0).setScale(0.3);
    this.tweens.add({
      targets: core, alpha: 1, scaleX: 1.6, scaleY: 1.6,
      duration: 200, ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({
        targets: core, alpha: 0, scaleX: 2.0, scaleY: 2.0,
        duration: 340, ease: 'Cubic.easeIn', delay: 40,
        onComplete: () => core.destroy(),
      }),
    });
  }

  // ── Result card ───────────────────────────────────────────────────

  private showResultCard(pair: CompoundPair) {
    const { cx: CX, cy: CY } = this;
    const rx = CX + 20;
    const ry = CY - 10;

    const cont = this.add.container(rx, ry - 60)
      .setDepth(52).setAlpha(0);
    cont.scaleX = 0.02; cont.scaleY = 0.5;   // start edge-on for the flip-in

    // phones: no taller than the room between the top bar and the reward chips over the bottom buttons
    // (round 2: and clear of the reward chips, which sit at most 18 px over the taller bottom buttons - gl/reward.ts; 3:4 art)
    const CRW = this.phone ? Math.round(Math.min(this.gw * 0.234, Math.min(ry - this.phone.hudBottom - 8, this.phone.navTop - 32 - ry) * 2 / 1.34)) : Math.round(this.gw * 0.234);
    const imgKey = `card_${pair.result}`;
    let CRH: number;

    if (this.textures.exists(imgKey)) {
      // ── Designed result-card image (preserves the asset's own aspect ratio) ──
      const tex = this.textures.get(imgKey).getSourceImage() as { width: number; height: number };
      CRH = Math.round(CRW * (tex.height / tex.width));

      const cardImg = this.add.image(0, 0, imgKey).setDisplaySize(CRW, CRH);

      cont.add([cardImg]);
    } else {
      // ── Fallback: drawn gold card with emoji (result image not uploaded yet) ──
      CRH = Math.round(CRW * 1.29);
      const CR = 22;

      const g = this.add.graphics();

      g.fillStyle(0x000000, 0.35);
      g.fillRoundedRect(-CRW / 2 + 6, -CRH / 2 + 10, CRW, CRH, CR);

      g.fillGradientStyle(0x1A0D00, 0x1A0D00, 0x2A1800, 0x2A1800, 1);
      g.fillRoundedRect(-CRW / 2, -CRH / 2, CRW, CRH, CR);

      g.lineStyle(4, 0xFFD700, 0.95);
      g.strokeRoundedRect(-CRW / 2, -CRH / 2, CRW, CRH, CR);
      g.lineStyle(1.5, 0xFFD700, 0.3);
      g.strokeRoundedRect(-CRW / 2 + 8, -CRH / 2 + 8, CRW - 16, CRH - 16, CR - 4);

      g.fillStyle(0xFFD700, 0.08);
      g.fillRoundedRect(-CRW / 2 + 10, -CRH / 2 + 10, CRW - 20, CRH * 0.58,
        { tl: CR - 4, tr: CR - 4, bl: 0, br: 0 });

      const iconFs = Math.round(CRH * 0.27);
      const iconText = this.add.text(0, -CRH / 2 + CRH * 0.31, pair.iconResult, {
        fontSize: `${iconFs}px`,
      }).setOrigin(0.5);

      g.lineStyle(1.5, 0xFFD700, 0.3);
      g.lineBetween(-CRW / 2 + 20, -CRH / 2 + CRH * 0.6, CRW / 2 - 20, -CRH / 2 + CRH * 0.6);

      const wordFs = Math.round(CRH * 0.115);
      const wordText = this.add.text(0, -CRH / 2 + CRH * 0.73, pair.result.toUpperCase(), {
        fontFamily: 'Baloo 2', fontSize: `${wordFs}px`, color: '#FFD700', fontStyle: 'bold',
        shadow: { offsetX: 2, offsetY: 3, color: '#000000', blur: 8, fill: true },
      }).setOrigin(0.5);

      const pronText = this.add.text(0, -CRH / 2 + CRH * 0.87, pair.pron, {
        fontFamily: 'Noto Sans KR', fontSize: `${Math.round(CRH * 0.06)}px`, color: '#AA9966',
      }).setOrigin(0.5);

      cont.add([g, iconText, wordText, pronText]);
    }

    // Radiant glow flare + sunburst spokes behind the card, plus sparkle ring
    this.playCardReveal(rx, ry, CRW, CRH);

    // Flip / pop entrance (card unfolds edge-on then settles with overshoot)
    this.tweens.add({
      targets: cont,
      y: ry, alpha: 1, scaleX: 1, scaleY: 1,
      duration: 560, ease: 'Back.easeOut',
      onComplete: () => {
        this.playShineSweep(rx, ry, CRW, CRH);   // light sweeps across the face
        this.onRoundWin(cont);
      },
    });

    this.tweens.add({
      targets: cont,
      scaleX: 1.03, scaleY: 1.03,
      duration: 900, ease: 'Sine.easeInOut',
      yoyo: true, repeat: -1, delay: 600,
    });
  }

  // ── Card-reveal flair: glow flare + sunburst spokes + sparkle ring ──

  private playCardReveal(rx: number, ry: number, CRW: number, CRH: number) {
    // Soft warm halo behind the card (normal blend so it reads on the bright scene)
    const glow = this.add.image(rx, ry, 'softGlow')
      .setTint(0xFFE9A0)
      .setDepth(50).setAlpha(0).setDisplaySize(CRW * 0.6, CRW * 0.6);
    this.tweens.add({
      targets: glow, alpha: 0.7,
      displayWidth: CRW * 2.6, displayHeight: CRW * 2.6,
      duration: 300, ease: 'Cubic.easeOut',
      onComplete: () => this.tweens.add({
        targets: glow, alpha: 0,
        displayWidth: CRW * 3.0, displayHeight: CRW * 3.0,
        duration: 620, ease: 'Cubic.easeIn',
        onComplete: () => glow.destroy(),
      }),
    });

    // Sunburst spokes peeking out from behind the card, rotating slowly
    const spokes = this.add.container(rx, ry).setDepth(51).setAlpha(0).setScale(0.5);
    const SPOKES = 14;
    for (let i = 0; i < SPOKES; i++) {
      const long = i % 2 === 0;
      const ray = this.add.image(0, 0, 'rayGrad')
        .setOrigin(0.5, 1)            // base at center; tip fades to fully transparent
        .setAngle((i / SPOKES) * 360)
        .setTint(0xFFFFFF)
        .setDisplaySize(CRW * (long ? 0.05 : 0.032), CRH * (long ? 1.5 : 1.18));
      spokes.add(ray);
    }
    this.tweens.add({
      targets: spokes, alpha: 0.28, scaleX: 1.12, scaleY: 1.12,   // faint translucent white
      duration: 320, ease: 'Cubic.easeOut',
      onComplete: () => this.tweens.add({
        targets: spokes, alpha: 0, scaleX: 1.3, scaleY: 1.3,
        duration: 680, ease: 'Cubic.easeIn',
        onComplete: () => spokes.destroy(),
      }),
    });
    // Spin clockwise while it appears (positive rotation = clockwise in screen space)
    this.tweens.add({ targets: spokes, rotation: 1.1, duration: 1000, ease: 'Cubic.easeOut' });

    // Sparkle ring — twinkling stars popping around the card edge
    const SPARKS = 18;
    const sBase = (CRW * 0.085) / 64;   // star display scale (texture is 64px)
    for (let i = 0; i < SPARKS; i++) {
      const ang = (i / SPARKS) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.15, 0.15);
      const rr = CRW * Phaser.Math.FloatBetween(0.58, 0.82);
      const big = sBase * Phaser.Math.FloatBetween(0.7, 1.3);
      const sx = rx + Math.cos(ang) * rr;
      const sy = ry + Math.sin(ang) * rr * (CRH / CRW);
      const spark = this.add.image(sx, sy, 'starSpark')
        .setTint(i % 3 === 0 ? 0xFFFFFF : 0xFFE680)
        .setDepth(60).setAlpha(0).setScale(0).setAngle(Phaser.Math.Between(0, 90));
      this.tweens.add({
        targets: spark, alpha: 1, scaleX: big, scaleY: big, angle: spark.angle + 45,
        x: rx + Math.cos(ang) * rr * 1.28,
        y: ry + Math.sin(ang) * rr * 1.28 * (CRH / CRW),
        duration: 300, ease: 'Back.easeOut', delay: 100 + i * 12,
        onComplete: () => this.tweens.add({
          targets: spark, alpha: 0, scaleX: 0, scaleY: 0, angle: spark.angle + 90,
          duration: 380, ease: 'Cubic.easeIn',
          onComplete: () => spark.destroy(),
        }),
      });
    }
  }

  // ── Specular shine sweeping diagonally across the card face ──

  private playShineSweep(rx: number, ry: number, CRW: number, CRH: number) {
    const radius = Math.round(CRW * 0.08);
    // Geometry mask shaped like the card so the shine stays on the face
    const maskG = this.make.graphics({ x: 0, y: 0 }, false);
    maskG.fillStyle(0xffffff, 1);
    maskG.fillRoundedRect(rx - CRW / 2, ry - CRH / 2, CRW, CRH, radius);
    const mask = maskG.createGeometryMask();

    const shine = this.add.graphics().setDepth(53);
    shine.setMask(mask);

    const skew = CRH * 0.35;
    const left = rx - CRW / 2;
    this.tweens.add({
      targets: { p: -0.4 },
      p: 1.4,
      duration: 560, ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        const p = (tw.targets[0] as { p: number }).p;
        const bx = left + p * CRW;
        shine.clear();
        const band = (w: number, a: number) => {
          shine.fillStyle(0xffffff, a);
          shine.fillPoints([
            new Phaser.Geom.Point(bx, ry - CRH / 2),
            new Phaser.Geom.Point(bx + w, ry - CRH / 2),
            new Phaser.Geom.Point(bx + w - skew, ry + CRH / 2),
            new Phaser.Geom.Point(bx - skew, ry + CRH / 2),
          ], true);
        };
        band(CRW * 0.34, 0.30);   // soft wide halo
        band(CRW * 0.12, 0.85);   // bright glossy core
      },
      onComplete: () => { shine.destroy(); mask.destroy(); maskG.destroy(); },
    });
  }

  private bumpBadge(txt: Phaser.GameObjects.Text) {
    this.tweens.add({ targets: txt, scaleX: 1.5, scaleY: 1.5, duration: 160, ease: 'Back.easeOut', yoyo: true });
  }

  /** −n on a HUD badge (a wrong pair: a heart; the Hint: coins; a Compound Book card: gems). The number drops, a dark
   *  "−n" chip (the reward's "+N" chip look) pops under the badge, and a lost heart hops off the badge and falls away. */
  private spend(kind: 'heart' | 'coin' | 'gem', n: number) {
    const txt = kind === 'heart' ? this.heartText : kind === 'coin' ? this.coinText : this.gemText;
    if (kind === 'heart') this.hearts = Math.max(0, this.hearts - n);
    else if (kind === 'coin') { const paid = Math.min(n, this.coins); this.coins -= paid; this.coinsSpent += paid; }
    else { const paid = Math.min(n, this.gems); this.gems -= paid; this.gemsSpent += paid; }
    txt.setText(`${kind === 'heart' ? this.hearts : kind === 'coin' ? this.coins : this.gems}`);
    this.bumpBadge(txt);
    const b = this.badgeInfo[kind];
    if (!b) return;
    const k = b.k;
    // the chip
    const chip = this.add.container(b.cx, b.bottom + Math.round(26 * k)).setDepth(kind === 'gem' && this.gemLifts > 0 ? 96 : 60).setScale(0);
    const isz = Math.round(30 * k);
    const ic = this.add.image(0, 0, b.icon).setDisplaySize(isz, isz);
    const t = this.add.text(0, 0, `−${n}`, {
      fontFamily: '"Baloo 2", "Inter", sans-serif', fontSize: `${Math.round(22 * k)}px`, color: '#FFFFFF', fontStyle: 'bold',
      shadow: { offsetX: 0, offsetY: 2, color: '#000000', blur: 4, fill: true },
    }).setOrigin(0, 0.5);
    const gap = Math.round(6 * k), padX = Math.round(14 * k);
    const cw = padX * 2 + isz + gap + t.width, ch = Math.round(38 * k);
    ic.setX(-cw / 2 + padX + isz / 2);
    t.setX(ic.x + isz / 2 + gap);
    const bg = this.add.graphics();
    bg.fillStyle(0x1B1747, 0.82); bg.fillRoundedRect(-cw / 2, -ch / 2, cw, ch, ch / 2);
    bg.lineStyle(Math.max(1.5, 2 * k), 0xFFFFFF, 0.2); bg.strokeRoundedRect(-cw / 2, -ch / 2, cw, ch, ch / 2);
    chip.add([bg, ic, t]);
    this.tweens.add({ targets: chip, scale: 1, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: chip, alpha: 0, y: chip.y + 10 * k, delay: 1000, duration: 320, onComplete: () => chip.destroy() });
    if (kind !== 'heart') return;
    // the heart hops off the badge and falls away; the badge's heart empties for a moment (stays empty at 0)
    const h = this.add.image(b.ix, b.iy, 'icon_heart').setDisplaySize(b.isz, b.isz).setDepth(61);
    const sx = h.scaleX;
    this.tweens.add({
      targets: h, y: b.iy - 16 * k, scale: sx * 1.3, duration: 200, ease: 'Quad.easeOut',
      onComplete: () => this.tweens.add({
        targets: h, x: b.ix - 30 * k, y: b.iy + 110 * k, angle: -40, alpha: 0, scale: sx * 0.8,
        duration: 620, ease: 'Quad.easeIn', onComplete: () => h.destroy(),
      }),
    });
    this.heartIcon.setTexture('icon_heart_empty');
    if (this.hearts > 0) this.time.delayedCall(520, () => { if (this.heartIcon?.active) this.heartIcon.setTexture('icon_heart'); });
    this.shake(b.parts, 0.6);
  }

  /** a short sideways "no" shake of a group of HUD pieces (one at a time per group) */
  private shake(parts: { x: number }[], amp = 1) {
    if (!parts.length || this.shaking.has(parts)) return;
    this.shaking.add(parts);
    const xs = parts.map(o => o.x);
    const d = Math.round(7 * Math.min(this.gw / 1280, this.gh / 720) * amp);
    this.tweens.addCounter({
      from: 0, to: 1, duration: 420,
      onUpdate: tw => { const v = tw.getValue() ?? 0; parts.forEach((o, i) => { o.x = xs[i] + Math.sin(v * Math.PI * 6) * d * (1 - v); }); },
      onComplete: () => { parts.forEach((o, i) => { o.x = xs[i]; }); this.shaking.delete(parts); },
    });
  }

  /** the Hint button looks off (grey) while there are fewer coins than it costs */
  private refreshHint() {
    const off = this.coins < HINT_COST;
    if (off === this.hintOff || !this.hintParts.length) return;
    this.hintOff = off;
    if (this.hintGrey.length) this.hintGrey.forEach(fx => { fx.active = off; });
    else this.hintParts.forEach(o => o.setAlpha(off ? 0.5 : 1));
  }

  /** the HUD gem badge comes up over an open Compound Book (its dim covers the HUD): the gems to spend stay in sight */
  private liftGemBadge(d: 1 | -1) {
    const was = this.gemLifts > 0;
    this.gemLifts = Math.max(0, this.gemLifts + d);
    const now = this.gemLifts > 0;
    if (was === now) return;
    const parts = (this.badgeInfo.gem?.parts ?? []) as unknown as Phaser.GameObjects.Components.Depth[];
    for (const o of parts) o.setDepth(o.depth + (now ? 40 : -40));
  }

  /** The '?' cards of one Compound Book (the top bar's or the result screen's). A tap on one shows its price chip
   *  (the gem + CARD_GEMS); a second tap (on the card or its chip) spends the gems and the card flips open into its
   *  compound card with its word clip, collected like a made word. Too few gems: the chip is dim and the gem badge
   *  shakes "no" - nothing is spent (the Hint's rule). */
  private gemCards(countTxt: Phaser.GameObjects.Text) {
    let picked: { result: string; chip: Phaser.GameObjects.Container; parts: { x: number }[] } | null = null;
    const unpick = () => { picked?.chip.destroy(); picked = null; };
    const add = (parent: Phaser.GameObjects.Container, result: string, x: number, y: number, w: number, h: number,
      cover: Phaser.GameObjects.GameObject[], cell?: { w: number; h: number }) => {
      // phones: a tap target of at least PHONE_TAP px even round a small card - but inside its cell (given: the result
      // book's small cards), so two tap areas stay 3 px apart
      const tw = cell ? Math.max(w, Math.min(PHONE_TAP, cell.w - 4)) : Math.max(w, PHONE_TAP);
      const th = cell ? Math.max(h, Math.min(PHONE_TAP, cell.h - 4)) : Math.max(h, PHONE_TAP);
      const hit = this.add.zone(x, y, this.phone ? tw : w, this.phone ? th : h).setInteractive({ useHandCursor: true });
      parent.add(hit);
      hit.on('pointerdown', () => {
        const short = this.gems < CARD_GEMS;
        if (picked?.result !== result) {
          unpick();
          const chip = this.priceChip(parent, x, y + h * 0.3, w, short);
          picked = { result, chip, parts: [chip] };
          if (short) this.shake(this.badgeInfo.gem?.parts ?? []);
          return;
        }
        if (short) { this.shake(this.badgeInfo.gem?.parts ?? []); this.shake(picked.parts, 0.6); return; }
        unpick();
        if (!this.buyCard(result)) return;
        hit.destroy();
        countTxt.setText(`${this.getCollected().size} / ${COMPOUND_PAIRS.length}`);
        this.flipOpen(parent, result, x, y, w, h, cover);
      });
    };
    return { add, unpick };
  }

  /** the price on a picked '?' card: a dark chip (the "−n" chip look) with the HUD's gem and CARD_GEMS; dim when short */
  private priceChip(parent: Phaser.GameObjects.Container, x: number, y: number, w: number, short: boolean) {
    const ch = this.phone ? Math.max(Math.round(w * 0.3), 22) : Math.round(w * 0.3);   // phones: its number 13 px at least
    const isz = Math.round(ch * 0.86), padX = Math.round(ch * 0.3), gap = Math.round(ch * 0.12);
    const ic = this.add.image(0, 0, 'icon_gem').setDisplaySize(isz, isz);
    const t = this.add.text(0, 0, `${CARD_GEMS}`, {
      fontFamily: '"Baloo 2", "Inter", sans-serif', fontSize: `${Math.round(ch * 0.62)}px`, color: '#FFFFFF', fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    const cw = padX * 2 + isz + gap + t.width;
    ic.setX(-cw / 2 + padX + isz / 2);
    t.setX(ic.x + isz / 2 + gap);
    const bg = this.add.graphics();
    bg.fillStyle(0x1B1747, 0.88); bg.fillRoundedRect(-cw / 2, -ch / 2, cw, ch, ch / 2);
    bg.lineStyle(Math.max(1.5, ch * 0.06), 0xFFFFFF, 0.25); bg.strokeRoundedRect(-cw / 2, -ch / 2, cw, ch, ch / 2);
    const chip = this.add.container(x, y, [bg, ic, t]).setScale(0);
    if (short) { chip.setAlpha(0.5); ic.setTint(0x9A9AB0); }
    parent.add(chip);
    this.tweens.add({ targets: chip, scale: 1, duration: 220, ease: 'Back.easeOut' });
    return chip;
  }

  /** CARD_GEMS gems for a Compound Book card: it goes into the book like a made word (progress.ts records it) */
  private buyCard(result: string) {
    if (this.gems < CARD_GEMS || this.getCollected().has(result)) return false;
    this.spend('gem', CARD_GEMS);
    this.addCollected(result);
    this.cardsOpened.push(result);
    return true;
  }

  /** the bought '?' card turns over into its compound card (the game's card art), with a sparkle and its word clip */
  private flipOpen(parent: Phaser.GameObjects.Container, result: string, x: number, y: number, w: number, h: number,
    cover: Phaser.GameObjects.GameObject[]) {
    const key = `card_${result}`;
    const face = this.textures.exists(key)
      ? this.add.image(x, y, key).setDisplaySize(w, h)
      : this.add.text(x, y, result, {
        fontFamily: '"Baloo 2"', fontSize: `${Math.round(w * 0.16)}px`, color: '#5A2E94', fontStyle: 'bold',
        align: 'center', wordWrap: { width: w * 0.85 },
      }).setOrigin(0.5);
    const fsx = face.scaleX;
    face.scaleX = 0;
    parent.add(face);
    this.tweens.add({
      targets: cover, scaleX: 0, duration: 150, ease: 'Quad.easeIn',
      onComplete: () => {
        cover.forEach(o => o.destroy());
        this.tweens.add({ targets: face, scaleX: fsx, duration: 240, ease: 'Back.easeOut' });
        const at = parent.getWorldTransformMatrix().transformPoint(x, y);
        const fx = this.add.particles(at.x, at.y, 'pDot', {
          speed: { min: 80, max: 260 }, angle: { min: 0, max: 360 }, scale: { start: 0.6, end: 0 },
          alpha: { start: 1, end: 0 }, lifespan: { min: 450, max: 750 }, quantity: 0,
          tint: [0x8FE3FF, 0xFFFFFF, 0xFFD700], emitting: false,
        }).setDepth(97);
        fx.explode(16);
        this.time.delayedCall(900, () => fx.destroy());
      },
    });
    if (this.sfxOn) gameAudio.playBurst();
    this.playWordClip(result);
  }

  /** a word's own clip (Glee's "Pancake!" line, public/gl/voice/r_<word>.mp3); in 3D index.ts has Glee say it */
  private playWordClip(result: string) {
    try { void new Audio(`./gl/voice/r_${result}.mp3`).play().catch(() => {}); } catch { /* no audio here */ }
  }

  /** the Heart badge icon, drawn in the look of the star / coin / gem icons (a darker rim, a glossy body, a white
   *  shine), and its empty twin for a lost heart. Same canvas size, so they swap without resizing. */
  private makeHeartIcons() {
    const S = 256;
    const path = (ctx: CanvasRenderingContext2D, k: number) => {
      const u = (S * 0.92 / 100) * k, ox = S / 2 - 50 * u, oy = S / 2 - 46 * u;   // a chunky heart in a 100 x 92 box
      const c = (a: number, b: number, c2: number, d: number, e: number, f: number) =>
        ctx.bezierCurveTo(ox + a * u, oy + b * u, ox + c2 * u, oy + d * u, ox + e * u, oy + f * u);
      ctx.beginPath();
      ctx.moveTo(ox + 50 * u, oy + 92 * u);
      c(20, 72, 1, 54, 1, 31);
      c(1, 12, 15, 1, 30, 1);
      c(40, 1, 47, 7, 50, 17);
      c(53, 7, 60, 1, 70, 1);
      c(85, 1, 99, 12, 99, 31);
      c(99, 54, 80, 72, 50, 92);
      ctx.closePath();
    };
    const draw = (key: string, full: boolean) => {
      if (this.textures.exists(key)) return;
      const tex = this.textures.createCanvas(key, S, S);
      if (!tex) return;
      const ctx = tex.getContext();
      const lin = (stops: [number, string][]) => {
        const g = ctx.createLinearGradient(0, S * 0.06, 0, S * 0.94);
        stops.forEach(([o, col]) => g.addColorStop(o, col));
        return g;
      };
      path(ctx, 1);
      ctx.fillStyle = lin(full ? [[0, '#FF5C84'], [1, '#B80F3C']] : [[0, '#A598C2'], [1, '#6C5F92']]);
      ctx.fill();
      path(ctx, 0.84);
      ctx.fillStyle = lin(full ? [[0, '#FFA3BA'], [0.45, '#FF4F7D'], [1, '#EE2A5A']] : [[0, '#6F6494'], [1, '#4A3F6E']]);
      ctx.fill();
      // shine on the left lobe + a small glint
      ctx.save();
      ctx.translate(S * 0.33, S * 0.31);
      ctx.rotate(-0.62);
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.12);
      rg.addColorStop(0, `rgba(255,255,255,${full ? 0.95 : 0.35})`);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.scale(1, 0.55);
      ctx.beginPath(); ctx.arc(0, 0, S * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = `rgba(255,255,255,${full ? 0.8 : 0.3})`;
      ctx.beginPath(); ctx.arc(S * 0.22, S * 0.44, S * 0.025, 0, Math.PI * 2); ctx.fill();
      tex.refresh();
    };
    draw('icon_heart', true);
    draw('icon_heart_empty', false);
  }

  // Roll the badge number up in place from `from` to `to`
  private countUp(txt: Phaser.GameObjects.Text, from: number, to: number) {
    const o = { v: from };
    this.tweens.add({
      targets: o, v: to, duration: 600, ease: 'Cubic.easeOut',
      onUpdate: () => txt.setText(`${Math.round(o.v)}`),
      onComplete: () => txt.setText(`${to}`),
    });
  }

  private onRoundWin(resultCont: Phaser.GameObjects.Container) {
    this.addCollected(this.queue[this.roundIndex].result);
    this.animateProgressTo((this.roundIndex + 1) / ROUNDS);

    const prevScore = this.score, prevCoins = this.coins, prevGems = this.gems;
    this.score += 10;
    this.coins += 15;
    this.gems  += 3;
    this.countUp(this.scoreText, prevScore, this.score);
    this.countUp(this.coinText,  prevCoins, this.coins);
    this.countUp(this.gemText,   prevGems,  this.gems);
    this.bumpBadge(this.scoreText);
    this.time.delayedCall(80,  () => this.bumpBadge(this.coinText));
    this.time.delayedCall(160, () => this.bumpBadge(this.gemText));

    this.time.delayedCall(2400, () => {
      this.tweens.add({
        targets: resultCont, alpha: 0, scaleX: 0.7, y: '-=50',
        duration: 320, ease: 'Cubic.easeIn',
        onComplete: () => {
          resultCont.destroy();
          this.roundIndex++;
          this.zoneGfx.alpha = 1;
          this.zonePulse.resume();
          if (this.roundIndex >= ROUNDS) this.showFinale();
          else this.startRound();
        },
      });
    });
  }

  // ── Finale ────────────────────────────────────────────────────────

  // ── 모은 단어 도감 (책 아이콘 클릭 시 언제든 열림) ─────────────────
  // 아이콘에 자연스러운 드롭섀도(preFX) 적용
  private iconShadow<T extends Phaser.GameObjects.Image>(img: T): T {
    img.preFX?.addShadow(0, -4, 0.1, 1, 0x000000, 10, 0.09);
    return img;
  }

  private showCollection() {
    if (this.collectionOpen) return;
    this.collectionOpen = true;
    this.liftGemBadge(1);

    const { gw: GW, gh: GH } = this;
    const s = Math.min(GW / 1280, GH / 720);
    const CX = Math.round(GW / 2), CY = Math.round(GH / 2);

    const layer = this.add.container(0, 0).setDepth(80).setAlpha(0);

    const dim = this.add.graphics();
    dim.fillStyle(0x150B33, 0.82);
    dim.fillRect(0, 0, GW, GH);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GW, GH), Phaser.Geom.Rectangle.Contains);
    layer.add(dim);

    // phones: the book fills the screen under the top bar (the gem badge stays in sight above it), its cards 6 x 2 a
    // spread instead of 4 x 3 so each is big enough to tap
    const PH = this.phone;
    const bookTop = PH ? PH.hudBottom + 6 : 0;
    const bookH = PH ? GH - bookTop - PHONE_EDGE_BOTTOM : Math.round(GH * 0.72);
    const bookW = PH ? Math.min(GW - 24, Math.round(bookH * 2.3)) : Math.round(Math.min(GW * 0.62, GH * 1.15));
    const r = Math.round(Math.min(bookW, bookH) * 0.05);
    const book = this.add.container(CX, PH ? bookTop + Math.round(bookH / 2) : CY);
    layer.add(book);

    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(-bookW / 2 + 8, -bookH / 2 + 14, bookW, bookH, r);
    g.fillStyle(0x6B49A8, 1);
    g.fillRoundedRect(-bookW / 2, -bookH / 2, bookW, bookH, r);
    g.lineStyle(Math.max(3, Math.round(bookW * 0.006)), 0x3A2168, 1);
    g.strokeRoundedRect(-bookW / 2, -bookH / 2, bookW, bookH, r);
    const inset = Math.round(bookW * 0.035);
    const pageX = -bookW / 2 + inset, pageY = -bookH / 2 + inset;
    const pageW = bookW - inset * 2, pageH = bookH - inset * 2;
    g.fillStyle(0xF4EEFF, 1);
    g.fillRoundedRect(pageX, pageY, pageW, pageH, Math.round(r * 0.5));
    // 가운데 접힘선(두 페이지 스프레드) — 종료 화면 도감과 동일한 틀
    for (let k = 5; k >= 0; k--) {
      const fw = Math.round(bookW * 0.012) * (k + 1);
      g.fillStyle(0x3A2168, 0.045 * (1 - k / 6));
      g.fillRect(-fw, pageY, fw * 2, pageH);
    }
    g.fillStyle(0x3A2168, 0.14); g.fillRect(-1, pageY, 2, pageH);
    g.fillStyle(0xFFFFFF, 0.5);  g.fillRect(1, pageY, 1, pageH);
    book.add(g);
    // 책 내부 클릭 흡수(바깥 클릭만 닫힘) — topOnly 입력이라 위 버튼이 우선
    const swallow = this.add.zone(0, 0, bookW, bookH).setInteractive();
    swallow.on('pointerdown', () => {});
    book.add(swallow);

    const pad = Math.round(bookW * 0.03);
    const titleH = Math.round(bookH * 0.11);
    const titleY = pageY + pad + titleH * 0.4;
    const ibH = Math.round(titleH * 0.62), ibW = Math.round(ibH * 46 / 56);
    book.add(this.iconShadow(this.add.image(pageX + pad + ibW / 2, titleY, 'icon_book').setDisplaySize(ibW, ibH)));
    book.add(this.add.text(pageX + pad + ibW + Math.round(s * 10), titleY, 'Compound Book', {
      fontFamily: '"Baloo 2"', fontSize: `${Math.round(titleH * 0.5)}px`,
      color: '#5A2E94', fontStyle: 'bold',
    }).setOrigin(0, 0.5));

    const collected = this.getCollected();
    const countTxt = this.add.text(pageX + pageW - pad - Math.round(titleH * 0.9), titleY,
      `${collected.size} / ${COMPOUND_PAIRS.length}`, {
      fontFamily: '"Baloo 2"', fontSize: `${Math.round(titleH * 0.42)}px`,
      color: '#8A43D6', fontStyle: 'bold',
    }).setOrigin(1, 0.5);
    book.add(countTxt);

    // ── 닫기 버튼 (우상단 X) ──
    const closeR = PH ? Math.max(Math.round(titleH * 0.42), PHONE_TAP / 2 - 2) : Math.round(titleH * 0.42);
    const closeX = pageX + pageW - pad - closeR, closeY = titleY;
    const closeG = this.add.graphics();
    closeG.fillStyle(0x8A43D6, 1); closeG.fillCircle(closeX, closeY, closeR);
    const closeTxt = this.add.text(closeX, closeY, '✕', {
      fontFamily: '"Baloo 2"', fontSize: `${Math.round(closeR * 1.1)}px`, color: '#FFFFFF', fontStyle: 'bold',
    }).setOrigin(0.5);
    book.add([closeG, closeTxt]);
    countTxt.setX(closeX - closeR - Math.round(s * 12));
    const buy = this.gemCards(countTxt);

    // ── 카드 그리드 (전체 페어, 획득=이미지 / 미획득=흐린 ?), 페이지네이션 ──
    const contentTop = pageY + titleH + Math.round(bookH * 0.05);
    const navH = Math.round(bookH * 0.1);
    const contentBottom = pageY + pageH - pad - navH;
    const COLS = PH ? 6 : 4, ROWS = PH ? 2 : 3, PER = COLS * ROWS, HALF = COLS / 2;
    const centerGap = Math.round(bookW * 0.03);   // 가운데 접힘선 여백
    const leftL = pageX + pad, rightR = pageX + pageW - pad;
    const halfCellW = ((rightR - leftL) - centerGap) / COLS;   // 좌2 + 우2, 동일 셀폭
    const cellH = (contentBottom - contentTop) / ROWS;
    // (phones: a little shorter so the tap zones of two rows stay 8 px apart)
    const cardH = Math.min(cellH * (PH ? 0.86 : 0.9), halfCellW * 0.82 * 1.21), cardW = cardH / 1.21;
    const totalPages = Math.ceil(COMPOUND_PAIRS.length / PER);

    const pages: Phaser.GameObjects.Container[] = [];
    for (let pg = 0; pg < totalPages; pg++) {
      const pc = this.add.container(0, 0);
      if (pg !== 0) pc.setVisible(false);
      book.add(pc);
      COMPOUND_PAIRS.slice(pg * PER, (pg + 1) * PER).forEach((p, idx) => {
        const col = idx % COLS, row = Math.floor(idx / COLS);
        // 좌측 페이지(col 0,1) / 우측 페이지(col 2,3) — 가운데 접힘선 기준 분리
        const tx = col < HALF
          ? leftL + halfCellW * (col + 0.5)
          : (centerGap / 2) + halfCellW * (col - HALF + 0.5);
        const ty = contentTop + cellH * (row + 0.5);
        const slot = this.add.graphics();
        slot.fillStyle(0x6B49A8, 0.08);
        slot.fillRoundedRect(tx - cardW / 2 - 3, ty - cardH / 2 - 3, cardW + 6, cardH + 6, 8);
        pc.add(slot);
        const has = collected.has(p.result);
        const key = `card_${p.result}`;
        if (has && this.textures.exists(key)) {
          pc.add(this.add.image(tx, ty, key).setDisplaySize(cardW, cardH));
        } else if (this.textures.exists(key)) {
          const im = this.add.image(tx, ty, key).setDisplaySize(cardW, cardH).setTint(0x888888).setAlpha(0.4);
          const q = this.add.text(tx, ty, '?', {
            fontFamily: '"Baloo 2"', fontSize: `${Math.round(cardH * 0.38)}px`, color: '#FFFFFF', fontStyle: 'bold',
          }).setOrigin(0.5).setAlpha(0.8);
          pc.add([im, q]);
          buy.add(pc, p.result, tx, ty, cardW, cardH, [im, q]);
        } else {
          const t = this.add.text(tx, ty, has ? p.result : '?', {
            fontFamily: '"Baloo 2"', fontSize: `${Math.round(cardW * 0.16)}px`,
            color: has ? '#5A2E94' : '#8A6BB8', fontStyle: 'bold', align: 'center', wordWrap: { width: cardW * 0.85 },
          }).setOrigin(0.5).setAlpha(has ? 1 : 0.4);
          pc.add(t);
          if (!has) buy.add(pc, p.result, tx, ty, cardW, cardH, [t]);
        }
      });
      pages.push(pc);
    }

    let page = 0;
    const navCY = contentBottom + Math.round(navH * 0.5);
    const navFont = Math.round(bookH * 0.07);
    const dotR = Math.round(navH * 0.12), dotGap = Math.round(dotR * 3.2);
    const dotStart = -((totalPages - 1) * dotGap) / 2;
    const dotG = this.add.graphics(); book.add(dotG);
    const drawDots = () => {
      dotG.clear();
      for (let d = 0; d < totalPages; d++) {
        dotG.fillStyle(d === page ? 0x6B49A8 : 0x9A7DB8, d === page ? 1 : 0.35);
        dotG.fillCircle(dotStart + d * dotGap, navCY, dotR);
      }
    };
    drawDots();
    const cardsLow = contentTop + cellH * (ROWS - 0.5) + Math.max(cardH, PHONE_TAP) / 2;   // the low row's tap areas (gemCards)
    const prevBtn = this.tapArrow(this.add.text(pageX + pad + navFont * 0.5, navCY, '‹', {
      fontFamily: '"Baloo 2"', fontSize: `${navFont}px`, color: '#6B49A8', fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(false), cardsLow);
    const nextBtn = this.tapArrow(this.add.text(pageX + pageW - pad - navFont * 0.5, navCY, '›', {
      fontFamily: '"Baloo 2"', fontSize: `${navFont}px`, color: '#6B49A8', fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(totalPages > 1), cardsLow);
    book.add([prevBtn, nextBtn]);
    const nav = (dir: number) => {
      const np = page + dir;
      if (np < 0 || np >= totalPages) return;
      buy.unpick();
      pages[page].setVisible(false); page = np; pages[page].setVisible(true);
      drawDots();
      prevBtn.setVisible(page > 0); nextBtn.setVisible(page < totalPages - 1);
    };
    prevBtn.on('pointerdown', () => nav(-1));
    nextBtn.on('pointerdown', () => nav(1));

    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      this.liftGemBadge(-1);
      this.tweens.add({ targets: layer, alpha: 0, duration: 200, onComplete: () => { layer.destroy(); this.collectionOpen = false; } });
    };
    dim.on('pointerdown', close);
    closeG.setInteractive({
      hitArea: new Phaser.Geom.Circle(closeX, closeY, closeR * 1.4),
      hitAreaCallback: Phaser.Geom.Circle.Contains,
      useHandCursor: true,
    });
    closeG.on('pointerdown', close);

    book.setScale(0.85);
    this.tweens.add({ targets: layer, alpha: 1, duration: 200 });
    this.tweens.add({ targets: book, scaleX: 1, scaleY: 1, duration: 320, ease: 'Back.easeOut' });
  }

  // ── 재화 정책 안내 모달 (+ 버튼 클릭 시) ──────────────────────────
  private showCurrencyInfo(kind: 'heart' | 'score' | 'coin' | 'gem') {
    if (this.infoOpen) return;
    this.infoOpen = true;

    const { gw: GW, gh: GH } = this;
    const s = Math.min(GW / 1280, GH / 720);
    const CX = Math.round(GW / 2), CY = Math.round(GH / 2);

    const rows: { kind: string; icon: string; name: string; color: number; earn: string; spend: string }[] = [
      { kind: 'heart', icon: 'icon_heart', name: 'Heart', color: 0xE8335A,
        earn: `You start with ${this.lv.hearts} hearts`,
        spend: 'A wrong pair: −1  ·  No hearts left: the game ends (you keep what you got)' },
      { kind: 'score', icon: 'icon_star',  name: 'Star',   color: 0xF5B301,
        earn: 'Make a word: +10',
        spend: 'Yours to keep' },
      { kind: 'coin',  icon: 'icon_money', name: 'Coin',  color: 0xE08A00,
        earn: 'Make a word: +15',
        spend: `A hint: −${HINT_COST}` },
      { kind: 'gem',   icon: 'icon_gem',   name: 'Gem',   color: 0x2E9BE0,
        earn: 'Make a word: +3  ·  Gems stay for your next game',
        spend: `Open a ? card in the Compound Book: −${CARD_GEMS}` },
    ];

    const layer = this.add.container(0, 0).setDepth(82).setAlpha(0);
    const dim = this.add.graphics();
    dim.fillStyle(0x150B33, 0.82); dim.fillRect(0, 0, GW, GH);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GW, GH), Phaser.Geom.Rectangle.Contains);
    layer.add(dim);

    // phones: the panel nearly as tall as the screen; on the left the icon and its name side by side, then Get / Use in 13 px
    const PH = this.phone;
    const panelW = PH ? Math.min(GW - 24, 640) : Math.round(Math.min(GW * 0.62, GH * 1.15));
    const panelH = PH ? GH - PHONE_EDGE - PHONE_EDGE_BOTTOM : Math.round(Math.min(GH * 0.66, panelW * 0.78));
    const r = Math.round(Math.min(panelW, panelH) * 0.05);
    const panel = this.add.container(CX, CY);
    layer.add(panel);

    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.4); g.fillRoundedRect(-panelW / 2 + 8, -panelH / 2 + 14, panelW, panelH, r);
    g.fillStyle(0x6B49A8, 1);   g.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, r);
    g.lineStyle(Math.max(3, Math.round(panelW * 0.006)), 0x3A2168, 1);
    g.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, r);
    const inset = Math.round(panelW * 0.035);
    const pageX = -panelW / 2 + inset, pageY = -panelH / 2 + inset;
    const pageW = panelW - inset * 2, pageH = panelH - inset * 2;
    g.fillStyle(0xF4EEFF, 1); g.fillRoundedRect(pageX, pageY, pageW, pageH, Math.round(r * 0.5));
    // 가운데 접힘선(도감과 동일 틀)
    for (let k = 5; k >= 0; k--) {
      const fw = Math.round(panelW * 0.012) * (k + 1);
      g.fillStyle(0x3A2168, 0.045 * (1 - k / 6));
      g.fillRect(-fw, pageY, fw * 2, pageH);
    }
    g.fillStyle(0x3A2168, 0.14); g.fillRect(-1, pageY, 2, pageH);
    g.fillStyle(0xFFFFFF, 0.5);  g.fillRect(1, pageY, 1, pageH);
    panel.add(g);
    const swallow = this.add.zone(0, 0, panelW, panelH).setInteractive();
    swallow.on('pointerdown', () => {});
    panel.add(swallow);

    const pad = Math.round(panelW * 0.035);
    const titleH = Math.round(panelH * 0.1);
    const titleY = pageY + pad + titleH * 0.4;
    panel.add(this.add.text(pageX + pad, titleY, 'Points & Rewards', {
      fontFamily: '"Baloo 2"', fontSize: `${Math.round(titleH * 0.5)}px`, color: '#5A2E94', fontStyle: 'bold',
    }).setOrigin(0, 0.5));

    // 닫기 X
    const closeR = PH ? Math.max(Math.round(titleH * 0.42), PHONE_TAP / 2 - 2) : Math.round(titleH * 0.42);
    const closeX = pageX + pageW - pad - closeR, closeY = titleY;
    const closeG = this.add.graphics();
    closeG.fillStyle(0x8A43D6, 1); closeG.fillCircle(closeX, closeY, closeR);
    panel.add(closeG);
    panel.add(this.add.text(closeX, closeY, '✕', {
      fontFamily: '"Baloo 2"', fontSize: `${Math.round(closeR * 1.1)}px`, color: '#FFFFFF', fontStyle: 'bold',
    }).setOrigin(0.5));

    // ── 좌: 선택된 재화 크게 / 우: 목록(탭하여 전환) ─────────────────
    const contentTop = pageY + titleH + Math.round(panelH * 0.04);
    const contentBottom = pageY + pageH - pad;
    const gapC = Math.round(panelW * 0.025);
    const leftL = pageX + pad, leftR = -gapC;
    const rightL = gapC, rightR = pageX + pageW - pad;
    const leftW = leftR - leftL, rightW = rightR - rightL;
    const rgba = (c: number) => Phaser.Display.Color.IntegerToColor(c).rgba;
    const row = (k: string) => rows.find(r => r.kind === k) ?? rows[0];
    let sel = kind as string;

    // 좌측 상세 (재선택 시 다시 그림)
    const leftCont = this.add.container(0, 0);
    panel.add(leftCont);
    const drawLeft = () => {
      leftCont.removeAll(true);
      const rr = row(sel);
      const lcx = (leftL + leftR) / 2;
      // 고해상도 아이콘 → 크게 표시(최대 150px), 원본 비율 유지
      const bigBox = PH ? Math.round(Math.min(52, (contentBottom - contentTop) * 0.3))
        : Math.round(Math.min(leftW * 0.42, (contentBottom - contentTop) * 0.34, 150));
      const src = this.textures.get(rr.icon).getSourceImage() as { width: number; height: number };
      const ar = (src.width || 1) / (src.height || 1);
      const iw = ar >= 1 ? bigBox : Math.round(bigBox * ar);
      const ih = ar >= 1 ? Math.round(bigBox / ar) : bigBox;
      let y: number;
      if (PH) {   // phones: icon and name in one row
        const ix = leftL + Math.round(leftW * 0.07) + bigBox / 2, iy = contentTop + bigBox / 2;
        leftCont.add(this.iconShadow(this.add.image(ix, iy, rr.icon).setDisplaySize(iw, ih)));
        leftCont.add(this.add.text(ix + bigBox / 2 + 10, iy, rr.name, {
          fontFamily: '"Baloo 2"', fontSize: `${Math.round(bigBox * 0.55)}px`, color: rgba(rr.color), fontStyle: 'bold',
        }).setOrigin(0, 0.5));
        y = contentTop + bigBox + 8;
      } else {
      y = contentTop + Math.round(bigBox * 0.6);
      leftCont.add(this.iconShadow(this.add.image(lcx, y, rr.icon).setDisplaySize(iw, ih)));
      y += Math.round(bigBox * 0.72);
      leftCont.add(this.add.text(lcx, y, rr.name, {
        fontFamily: '"Baloo 2"', fontSize: `${Math.round(leftW * 0.11)}px`, color: rgba(rr.color), fontStyle: 'bold',
      }).setOrigin(0.5));
      y += Math.round(leftW * 0.11);
      }
      const tx = leftL + Math.round(leftW * 0.07);
      const wrapW = leftW * 0.86;
      const fs = PH ? Math.max(13, Math.round(leftW * 0.05)) : Math.round(leftW * 0.05);
      const addBlock = (label: string, text: string) => {
        leftCont.add(this.add.text(tx, y, label, {
          fontFamily: '"Baloo 2"', fontSize: `${Math.round(fs * 1.05)}px`, color: '#8A43D6', fontStyle: 'bold',
        }).setOrigin(0, 0));
        const t = this.add.text(tx, y + Math.round(fs * 1.5), text, {
          fontFamily: '"Inter","Baloo 2"', fontSize: `${fs}px`, color: '#5A4A7A',
          wordWrap: { width: wrapW }, lineSpacing: 5,
        }).setOrigin(0, 0);
        leftCont.add(t);
        y += Math.round(fs * 1.5) + t.height + Math.round(fs * 1.0);
      };
      addBlock('Get', rr.earn);
      addBlock('Use', rr.spend);
    };

    // 우측 목록 (탭하여 선택 전환) — 닫기(X) 버튼 아래에서 시작해 겹침 방지
    const rightTop = Math.max(contentTop, closeY + closeR + (PH ? 8 : Math.round(panelH * 0.045)));   // phones: rows 40 px tall,
    const rItemGap = PH ? 8 : Math.round(panelH * 0.03);                                                // 8 px apart
    const rItemH = (contentBottom - rightTop - rItemGap * (rows.length - 1)) / rows.length;
    const rIconSz = Math.round(rItemH * 0.5);
    const itemGfx: { k: string; g: Phaser.GameObjects.Graphics; top: number }[] = [];
    const redrawItems = () => {
      itemGfx.forEach(it => {
        it.g.clear();
        if (it.k === sel) {
          it.g.lineStyle(Math.max(2, Math.round(s * 3)), row(it.k).color, 1);
          it.g.strokeRoundedRect(rightL, it.top, rightW, rItemH, Math.round(rItemH * 0.22));
        }
      });
    };
    rows.forEach((rr, i) => {
      const top = rightTop + i * (rItemH + rItemGap);
      const cy = top + rItemH / 2;
      const ig = this.add.graphics();
      panel.add(ig);
      itemGfx.push({ k: rr.kind, g: ig, top });
      const icx = rightL + Math.round(rItemH * 0.55);
      panel.add(this.iconShadow(this.add.image(icx, cy, rr.icon).setDisplaySize(rIconSz, rIconSz)));
      panel.add(this.add.text(icx + Math.round(rItemH * 0.5), cy, rr.name, {
        fontFamily: '"Baloo 2"', fontSize: `${Math.round(rItemH * 0.3)}px`, color: rgba(rr.color), fontStyle: 'bold',
      }).setOrigin(0, 0.5));
      const hit = this.add.zone(rightL + rightW / 2, cy, rightW, rItemH).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => { sel = rr.kind; drawLeft(); redrawItems(); });
      panel.add(hit);
    });

    drawLeft();
    redrawItems();

    const close = () => {
      this.tweens.add({ targets: layer, alpha: 0, duration: 200, onComplete: () => { layer.destroy(); this.infoOpen = false; } });
    };
    dim.on('pointerdown', close);
    closeG.setInteractive({ hitArea: new Phaser.Geom.Circle(closeX, closeY, closeR * 1.4), hitAreaCallback: Phaser.Geom.Circle.Contains, useHandCursor: true });
    closeG.on('pointerdown', close);

    panel.setScale(0.85);
    this.tweens.add({ targets: layer, alpha: 1, duration: 200 });
    this.tweens.add({ targets: panel, scaleX: 1, scaleY: 1, duration: 320, ease: 'Back.easeOut' });
  }

  private showFinale() {
    const { gw: GW, gh: GH, cx: CX, cy: CY } = this;
    const s = Math.min(GW / 1280, GH / 720);
    this.judgeLevel();

    const dim = this.add.graphics().setDepth(70).setAlpha(0);
    dim.fillStyle(0x150B33, 0.82);
    dim.fillRect(0, 0, GW, GH);
    this.tweens.add({ targets: dim, alpha: 1, duration: 400 });
    this.liftGemBadge(1);   // the gems stay in sight: they open the book's '?' cards

    // ── Open "Compound Book" (purple themed) ──────────────────────
    // phones: Next Play 44 px tall at the bottom, the book between it and the top bar (the gem badge stays in sight)
    const PH = this.phone;
    // (it stands in the bottom row in place of Mic and Hint, which have nothing to do once the game is over; the row
    // PHONE_FINALE_NAV px tall at most, so the book above it is taller)
    if (PH && PH.navH > PHONE_FINALE_NAV) this.phoneNavTo?.(PHONE_FINALE_NAV);
    const kb = PH ? PH.navH / 62 : s;   // Next Play's scale
    const bookTop = PH ? PH.hudBottom + 6 : 0;
    const bookH = PH ? PH.navTop - 10 - bookTop : Math.round(GH * 0.58);
    const bookW = PH ? Math.round(GW * 0.86) : Math.round(GW * 0.66);
    const bookCY = PH ? bookTop + Math.round(bookH / 2) : CY - Math.round(GH * 0.07);
    const r = Math.round(Math.min(bookW, bookH) * 0.05);

    const book = this.add.container(CX, bookCY).setDepth(71).setAlpha(0).setScale(0.82);

    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(-bookW / 2 + 8, -bookH / 2 + 14, bookW, bookH, r);
    g.fillStyle(0x6B49A8, 1);
    g.fillRoundedRect(-bookW / 2, -bookH / 2, bookW, bookH, r);
    g.lineStyle(Math.max(3, Math.round(bookW * 0.006)), 0x3A2168, 1);
    g.strokeRoundedRect(-bookW / 2, -bookH / 2, bookW, bookH, r);
    const inset = Math.round(bookW * 0.035);
    const pageX = -bookW / 2 + inset;
    const pageY = -bookH / 2 + inset;
    const pageFullW = bookW - inset * 2;
    const pageH = bookH - inset * 2;
    g.fillStyle(0xF4EEFF, 1);                       // light lavender paper
    g.fillRoundedRect(pageX, pageY, pageFullW, pageH, Math.round(r * 0.5));
    // soft centre fold so the two halves read as one connected spread
    for (let k = 5; k >= 0; k--) {
      const w = Math.round(bookW * 0.012) * (k + 1);
      g.fillStyle(0x3A2168, 0.045 * (1 - k / 6));
      g.fillRect(-w, pageY, w * 2, pageH);
    }
    g.fillStyle(0x3A2168, 0.14); g.fillRect(-1, pageY, 2, pageH);
    g.fillStyle(0xFFFFFF, 0.5);  g.fillRect(1, pageY, 1, pageH);
    book.add(g);

    // ── Title at the book's top-left: game book icon + "Compound Book" ──
    const pad = Math.round(bookW * 0.025);
    const titleH = Math.round(bookH * 0.135);
    const titleY = pageY + pad + titleH * 0.4;
    const ibH = Math.round(titleH * 0.62);
    const ibW = Math.round(ibH * 46 / 56);
    const bookIcon = this.iconShadow(this.add.image(pageX + pad + ibW / 2, titleY, 'icon_book').setDisplaySize(ibW, ibH));
    const title = this.add.text(pageX + pad + ibW + Math.round(s * 10), titleY, 'Compound Book', {
      fontFamily: '"Baloo 2"', fontSize: `${Math.round(titleH * 0.5)}px`,
      color: '#5A2E94', fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    book.add([bookIcon, title]);

    const contentTop = pageY + titleH + Math.round(bookH * 0.075);
    const contentBottom = pageY + pageH - pad;
    const centerGap = Math.round(bookW * 0.02);

    // ── LEFT page: this run's collected word cards (2 × 3) ──────────
    const made = this.queue.slice(0, Math.min(this.roundIndex, ROUNDS)).map(p => p.result);
    const lCols = 3, lRows = 2;
    const gL = pageX + pad, gR = -centerGap - pad;
    const cW = (gR - gL) / lCols, cH = (contentBottom - contentTop) / lRows;
    const cardH = Math.min(cH * 0.9, cW * 0.86 * 1.21);
    const cardW = cardH / 1.21;
    const slots = this.add.graphics();
    book.add(slots);

    made.forEach((result, i) => {
      const col = i % lCols, row = Math.floor(i / lCols);
      const lx = gL + cW * (col + 0.5);
      const ly = contentTop + cH * (row + 0.5);
      slots.fillStyle(0x6B49A8, 0.08);
      slots.fillRoundedRect(lx - cardW / 2 - 4, ly - cardH / 2 - 4, cardW + 8, cardH + 8, 9);
      slots.lineStyle(1.5, 0x6B49A8, 0.18);
      slots.strokeRoundedRect(lx - cardW / 2 - 4, ly - cardH / 2 - 4, cardW + 8, cardH + 8, 9);

      const key = `card_${result}`;
      let obj: Phaser.GameObjects.GameObject & { setScale: (x: number, y?: number) => unknown; setAlpha: (a: number) => unknown };
      let tsx = 1, tsy = 1;
      if (this.textures.exists(key)) {
        const im = this.add.image(lx, ly, key).setDisplaySize(cardW, cardH);
        tsx = im.scaleX; tsy = im.scaleY;
        obj = im as unknown as typeof obj;
      } else {
        const fc = this.add.container(lx, ly);
        const cg = this.add.graphics();
        cg.fillStyle(0xFFE6A0, 1); cg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 8);
        cg.lineStyle(2, 0xB8860B, 1); cg.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 8);
        const ct = this.add.text(0, 0, result, {
          fontFamily: '"Baloo 2"', fontSize: `${Math.round(cardW * 0.16)}px`,
          color: '#7A5200', fontStyle: 'bold', align: 'center', wordWrap: { width: cardW * 0.85 },
        }).setOrigin(0.5);
        fc.add([cg, ct]);
        obj = fc as unknown as typeof obj;
      }
      book.add(obj as unknown as Phaser.GameObjects.GameObject);
      obj.setScale(0); obj.setAlpha(0);
      this.tweens.add({
        targets: obj, scaleX: tsx, scaleY: tsy, alpha: 1,
        duration: 340, ease: 'Back.easeOut', delay: 360 + i * 140,
        onComplete: () => { this.burst.setPosition(CX + lx, bookCY + ly); this.burst.explode(10); },
      });
    });

    // ── RIGHT page: unobtained cards only, greyed-out, paginated (6/page) ──
    const rL = centerGap + pad, rR = pageX + pageFullW - pad;
    const rCX = (rL + rR) / 2;
    const collected = this.getCollected();

    // Count badge — top-right of right grid
    const countTxt = this.add.text(rR, titleY, `${collected.size} / ${COMPOUND_PAIRS.length}`, {
      fontFamily: '"Baloo 2"', fontSize: `${PH ? Math.max(12, Math.round(titleH * 0.42)) : Math.round(titleH * 0.42)}px`,
      color: '#8A43D6', fontStyle: 'bold',
    }).setOrigin(1, 0.5);
    book.add(countTxt);
    const buy = this.gemCards(countTxt);

    // Only unobtained cards go on the right page
    const unobtained = COMPOUND_PAIRS.filter(p => !collected.has(p.result));

    const navH        = Math.round(bookH * 0.11);
    const RCOLS = 3, RROWS = 2;
    const CARDS_PER_PAGE = RCOLS * RROWS;  // 6
    const totalPages     = unobtained.length > 0 ? Math.ceil(unobtained.length / CARDS_PER_PAGE) : 0;
    const rCellW = (rR - rL) / RCOLS;
    const rCellH = (contentBottom - navH - contentTop) / RROWS;
    const rCardH = Math.min(rCellH * 0.9, rCellW * 0.86 * 1.21);
    const rCardW = rCardH / 1.21;

    let collPage = 0;
    const pages: Phaser.GameObjects.Container[] = [];

    if (unobtained.length === 0) {
      // All cards collected — show a congratulations message
      const allTxt = this.add.text(rCX, (contentTop + contentBottom) / 2, 'All\nCollected! 🎉', {
        fontFamily: '"Baloo 2"', fontSize: `${Math.round(bookH * 0.055)}px`,
        color: '#5A2E94', fontStyle: 'bold', align: 'center',
      }).setOrigin(0.5);
      book.add(allTxt);
    } else {
      for (let pg = 0; pg < totalPages; pg++) {
        const pgCont = this.add.container(0, 0);
        if (pg !== 0) pgCont.setVisible(false);
        book.add(pgCont);

        unobtained.slice(pg * CARDS_PER_PAGE, (pg + 1) * CARDS_PER_PAGE).forEach((p, idx) => {
          const col = idx % RCOLS, row = Math.floor(idx / RCOLS);
          const tx  = rL + rCellW * (col + 0.5);
          const ty  = contentTop + rCellH * (row + 0.5);

          const key = `card_${p.result}`;
          if (this.textures.exists(key)) {
            const im = this.add.image(tx, ty, key).setDisplaySize(rCardW, rCardH);
            im.setTint(0x888888).setAlpha(0.4);
            const qTxt = this.add.text(tx, ty, '?', {
              fontFamily: '"Baloo 2"', fontSize: `${Math.round(rCardH * 0.38)}px`,
              color: '#FFFFFF', fontStyle: 'bold',
              shadow: { offsetX: 0, offsetY: 2, color: 'rgba(0,0,0,0.3)', blur: 3, fill: true },
            }).setOrigin(0.5).setAlpha(0.75);
            pgCont.add([im, qTxt]);
            buy.add(pgCont, p.result, tx, ty, rCardW, rCardH, [im, qTxt], { w: rCellW, h: rCellH });
          } else {
            // Fallback: grey slot
            const lo = this.add.graphics();
            lo.fillStyle(0xB0A0C8, 0.3);
            lo.fillRoundedRect(tx - rCardW / 2, ty - rCardH / 2, rCardW, rCardH, 4);
            const lt = this.add.text(tx, ty, p.result, {
              fontFamily: '"Baloo 2"', fontSize: `${Math.round(rCardH * 0.18)}px`,
              color: '#8A6BB8', fontStyle: 'bold',
            }).setOrigin(0.5).setAlpha(0.4);
            pgCont.add([lo, lt]);
            buy.add(pgCont, p.result, tx, ty, rCardW, rCardH, [lo, lt], { w: rCellW, h: rCellH });
          }
        });

        pages.push(pgCont);
      }

      // ── Dot indicators + nav arrows ──────────────────────────────
      const navCY      = contentBottom - Math.round(navH * 0.46);
      const navFontSz  = Math.round(bookH * 0.075);
      const dotR       = Math.round(navH * 0.13);
      const dotSpacing = Math.round(dotR * 3.2);
      const dotStartX  = rCX - ((totalPages - 1) * dotSpacing) / 2;

      const dotGfxArr: Phaser.GameObjects.Graphics[] = [];
      for (let d = 0; d < totalPages; d++) {
        const dg = this.add.graphics();
        dotGfxArr.push(dg);
        book.add(dg);
      }

      const updateDots = (page: number) => {
        dotGfxArr.forEach((dg, d) => {
          dg.clear();
          const dx = dotStartX + d * dotSpacing;
          if (d === page) {
            dg.fillStyle(0x6B49A8, 1);
            dg.fillCircle(dx, navCY, dotR);
          } else {
            dg.fillStyle(0x9A7DB8, 0.35);
            dg.fillCircle(dx, navCY, dotR);
          }
        });
      };
      updateDots(0);

      const prevBtn = this.add.text(rL + Math.round(navFontSz * 0.55), navCY, '‹', {
        fontFamily: '"Baloo 2"', fontSize: `${navFontSz}px`, color: '#6B49A8', fontStyle: 'bold',
      }).setOrigin(0.5).setVisible(false);
      book.add(prevBtn);

      const nextBtn = this.add.text(rR - Math.round(navFontSz * 0.55), navCY, '›', {
        fontFamily: '"Baloo 2"', fontSize: `${navFontSz}px`, color: '#6B49A8', fontStyle: 'bold',
      }).setOrigin(0.5).setVisible(totalPages > 1);
      book.add(nextBtn);

      const navigate = (dir: number) => {
        const np = collPage + dir;
        if (np < 0 || np >= totalPages) return;
        buy.unpick();
        pages[collPage].setVisible(false);
        collPage = np;
        pages[collPage].setVisible(true);
        updateDots(collPage);
        prevBtn.setVisible(collPage > 0);
        nextBtn.setVisible(collPage < totalPages - 1);
      };

      // (the low row's '?' tap areas, as gemCards sizes them in their cells)
      const cardsLow = contentTop + rCellH * (RROWS - 0.5) + Math.max(rCardH, Math.min(PHONE_TAP, rCellH - 4)) / 2;
      this.tapArrow(prevBtn, cardsLow).on('pointerdown', () => navigate(-1));
      this.tapArrow(nextBtn, cardsLow).on('pointerdown', () => navigate(1));
    }

    // Book entrance
    this.tweens.add({ targets: book, alpha: 1, scaleX: 1, scaleY: 1, duration: 360, ease: 'Back.easeOut' });

    // Celebration confetti
    for (let i = 0; i < 5; i++) {
      this.time.delayedCall(i * 180, () => {
        this.burst.setPosition(Math.random() * GW, Math.random() * GH * 0.5);
        this.burst.explode(40);
      });
    }

    // ── Next Play button — nav_green style (same as in-game Mic button) ─
    const bW = Math.round(kb * 202);
    const bH = Math.round(kb * 62);
    const bCY = PH ? PH.navCY : (bookCY + bookH / 2) + Math.round(GH * 0.08) + bH / 2;
    if (PH) for (const o of this.navMid) { (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false); o.disableInteractive(); }
    const shadowOff = Math.round(kb * 4);

    const btnCont = this.add.container(CX, bCY).setDepth(72).setAlpha(0);
    const btnShadow = this.add.image(0, shadowOff, 'nav_green_shadow').setDisplaySize(bW, bH);
    const btnMain   = this.add.image(0, 0,         'nav_green_main'  ).setDisplaySize(bW, bH);
    const btnTop    = this.add.image(0, 0,         'nav_green_top'   ).setDisplaySize(bW, bH);

    const iconSz = Math.round(bH * 0.48);
    const btnIcon = this.add.image(0, 0, 'icon_play_tri').setDisplaySize(iconSz, iconSz);
    const btnTxt  = this.add.text(0, 0, 'Next Play', {
      fontFamily: '"Inter", "Baloo 2"', fontSize: `${Math.round(bH * 0.38)}px`,
      color: '#FFFFFF', fontStyle: 'bold',
      shadow: { offsetX: 0, offsetY: Math.round(kb * 2), color: 'rgba(0,0,0,0.25)', blur: 2, fill: true },
    }).setOrigin(0, 0.5);
    const gap    = Math.round(kb * 12);
    const totalW = iconSz + gap + btnTxt.width;
    btnIcon.setX(Math.round(-totalW / 2 + iconSz / 2));
    btnTxt.setX(Math.round(-totalW / 2 + iconSz + gap));
    btnCont.add([btnShadow, btnMain, btnTop, btnIcon, btnTxt]);

    const btnDelay = 360 + ROUNDS * 140 + 300;
    this.tweens.add({ targets: btnCont, alpha: 1, duration: 300, delay: btnDelay });
    if (this.levelNext > this.level) this.showLevelUp(CX, bookCY - bookH / 2, PH ? Math.max(s, 0.7) : s, btnDelay - 200);   // phones: LEVEL n 12 px

    const hit = this.add.graphics().setDepth(76).setAlpha(0.001);
    hit.fillRect(CX - bW / 2, bCY - bH / 2, bW, bH);
    hit.setInteractive({ hitArea: new Phaser.Geom.Rectangle(CX - bW / 2, bCY - bH / 2, bW, bH), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
    hit.on('pointerdown', () => {
      this.tweens.add({ targets: btnCont, scaleX: 0.92, scaleY: 0.92, duration: 80, yoyo: true, ease: 'Back.easeIn' });
      this.time.delayedCall(100, () => {
        this.cameras.main.fadeOut(300, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart());
      });
    });
  }

  /** a book's page arrow (‹ ›): tappable over its glyph - on phones over a PHONE_TAP px square round it; given clearTop
   *  (the lowest card tap area above it, in the book's space) the square starts 4 px under it (3 after rounding), still PHONE_TAP tall */
  private tapArrow(t: Phaser.GameObjects.Text, clearTop?: number) {
    if (!this.phone) return t.setInteractive({ useHandCursor: true });
    const d = PHONE_TAP;
    const y0 = clearTop === undefined ? t.height / 2 - d / 2 : Math.max(t.height / 2 - d / 2, clearTop + 4 - (t.y - t.height / 2));
    return t.setInteractive({ hitArea: new Phaser.Geom.Rectangle(t.width / 2 - d / 2, y0, d, d), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
  }

  // ── Level (LEVELS; phonics-kit "공통 규칙: 레벨") ─────────────────────

  private loadLevel() {
    let level = 1, poor = 0;
    try {
      const v = JSON.parse(localStorage.getItem(GameScene.LEVEL_KEY) || 'null');
      if (v && Number.isFinite(v.level)) level = Math.round(v.level);
      if (v && Number.isFinite(v.poor)) poor = Math.round(v.poor);
    } catch { /* blocked or broken: level 1 */ }
    this.level = Math.min(LEVELS.length, Math.max(1, level));
    this.poorRun = Math.max(0, poor);
    this.levelNext = this.level;
  }

  /** The game is over (showFinale): good -> +1, poor -> the same (two in a row -> -1), else the same. Saved for the next START. */
  private judgeLevel() {
    const words = Math.min(this.queue.length, this.roundIndex);
    const good = words >= ROUNDS && this.hearts >= 2;
    const poor = this.hearts <= 0 || words <= 3;
    let level = this.level, run = 0;
    if (good) level = Math.min(LEVELS.length, level + 1);
    else if (poor && ++this.poorRun >= 2) level = Math.max(1, level - 1);
    else if (poor) run = this.poorRun;
    this.levelNext = level;
    try { localStorage.setItem(GameScene.LEVEL_KEY, JSON.stringify({ level, poor: run })); } catch { /* blocked: this page only */ }
  }

  /** "LEVEL UP!" and the HUD's LEVEL chip with the new number, on the result book's top edge (screen text only) */
  private showLevelUp(x: number, y: number, s: number, delay: number) {
    const h = Math.round(s * 56), off = Math.round(s * 5);
    const label = this.add.text(0, 0, 'LEVEL UP!', {
      fontFamily: '"Baloo 2"', fontSize: `${Math.round(h * 0.6)}px`, color: '#FFFFFF', fontStyle: 'bold',
      stroke: '#B35C00', strokeThickness: Math.max(2, Math.round(s * 5)),
    }).setOrigin(0, 0.5);
    const cW = Math.round(s * 116), cH = Math.round(s * 36);
    const pad = Math.round(h * 0.42), gap = Math.round(s * 12);
    const w = pad + label.width + gap + cW + Math.round(pad * 0.6);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.28); g.fillRoundedRect(-w / 2 + off, -h / 2 + off * 2, w, h, h / 2);
    g.fillStyle(0xC46E00, 1);    g.fillRoundedRect(-w / 2, -h / 2 + off, w, h, h / 2);
    g.fillStyle(0xFFB524, 1);    g.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    g.fillStyle(0xFFD866, 1);    g.fillRoundedRect(-w / 2 + off, -h / 2 + off * 0.6, w - off * 2, h * 0.46, h * 0.23);
    g.lineStyle(Math.max(2, Math.round(s * 3)), 0xFFFFFF, 0.6); g.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    label.setX(-w / 2 + pad);
    const chipX = w / 2 - Math.round(pad * 0.6) - cW / 2;
    const chipBase = this.add.image(chipX, Math.round(s * 3), 'hud_bar_main').setDisplaySize(cW, cH);
    const chip = this.add.image(chipX, 0, 'hud_bar_pill').setDisplaySize(cW, cH);
    const num = this.add.text(chipX, 0, `LEVEL ${this.levelNext}`, {
      fontFamily: '"Inter", "Baloo 2"', fontSize: `${Math.round(cH * 0.5)}px`, color: '#FFFFFF', fontStyle: 'bold',
    }).setOrigin(0.5);
    const cont = this.add.container(x, y, [g, label, chipBase, chip, num]).setDepth(74).setScale(0).setAlpha(0);
    this.tweens.add({
      targets: cont, scaleX: 1, scaleY: 1, alpha: 1, duration: 420, ease: 'Back.easeOut', delay,
      onStart: () => gameAudio.playBurst(),
      onComplete: () => {
        this.burst.setPosition(x, y); this.burst.explode(30);
        this.tweens.add({ targets: cont, scaleX: 1.06, scaleY: 1.06, duration: 260, yoyo: true, repeat: 1, ease: 'Sine.easeInOut' });
      },
    });
  }

}
