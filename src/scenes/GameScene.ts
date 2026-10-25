import Phaser from 'phaser';
import { WordCard, CARD_W, CARD_H } from '../objects/WordCard';
import { pickRoundPairs, COMPOUND_PAIRS, type CompoundPair } from '../data/compounds';
import { gameAudio } from '../audio';

const ROUNDS = 6;

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
  private gems = 0;
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

  constructor() { super({ key: 'Game' }); }

  preload() {
    // Actual PNG files
    this.load.image('game_bg',    './images/game_bg.png');
    this.load.image('icon_book',  './images/icon_book_v2.png');    // _v2: 고해상도 + 캐시 무력화(파일명 변경)
    this.load.image('icon_star',  './images/icon_star_v2.png');
    this.load.image('icon_money', './images/icon_money_v2.png');
    this.load.image('icon_gem',   './images/icon_gemstone_v2.png');
    // Word-specific card images (left)
    // 'cake'는 word1로 쓰이지 않고 card_left_cake.png도 없어 제외(404 방지)
    ['base','birth','book','butter','cup','door','eye','fire','foot','hand','key','light','moon','news','note','pan','play','rain','sea','snow','star','sun','tea','tooth','water','week']
      .forEach(w => this.load.image(`card_left_${w}`, `./images/card_left_${w}.png`));
    // Word-specific card images (right)
    ['bag','ball','bell','board','book','bow','brush','cake','day','end','fall','fish','flake','flower','fly','ground','house','light','melon','paper','place','pot','rise','set','shelf','shell']
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
    this.gems  = 0;
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

    this.buildStageBackground();
    this.buildParticleBurst();
    this.buildHUD();
    this.buildGravityZone();
    this.buildBottomNav();
    this.setupDrag();
    this.startRound();
  }

  update(_time: number, delta: number) {
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
    const sz = (f: number)  => Math.round(f  * s * HUD_K); // uniform size (HUD 확대)

    // ── 상단 HUD 공통 규격 ──────────────────────────────────────────
    // 모든 에셋의 "몸통" 높이는 58단위. 단, 버튼(btn_back/btn_setting)만
    // viewBox 68(하단에 그림자 여백 10)이라 같은 크기로 그리면 몸통이 작게 렌더됨.
    // → 모든 요소의 "보이는 몸통 높이"를 bodyH(sz58)로 통일(무왜곡).
    const topY = q(13);                          // 모든 몸통 top (Figma:13)
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
    };

    // ── Back button (Figma: left:14, top:13, size:62) — 공통 그림자 함수 사용 ──
    drawTopShadow(p(14), bSz, sz(16));
    const backImg = this.add.image(p(14) + bSz / 2, midY + btnCyOff, 'btn_back_main').setDisplaySize(btnDisp, btnDisp).setDepth(51);

    // Back button hit zone (invisible)
    const hitG = this.add.graphics().setDepth(55).setAlpha(0.001);
    hitG.fillRect(p(14), topY, bSz, bodyH);
    hitG.setInteractive({ hitArea: new Phaser.Geom.Rectangle(p(14), topY, bSz, bodyH), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
    hitG.on('pointerdown', () => {
      this.tweens.add({ targets: backImg, scaleX: 0.88, scaleY: 0.88, duration: 80, yoyo: true, ease: 'Back.easeIn' });
      this.cameras.main.fadeOut(280, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart());
    });

    // ── Compound Book pill (Figma: x88 top13 w241) — 몸통 높이 bodyH, 버튼과 동일 ──
    const pillW = sz(241), pillH = bodyH;
    const pillTop = topY, pillCY = midY;
    const pillX = p(14) + bSz + sz(12);   // 뒤로가기 버튼과 간격 sz(12)

    drawTopShadow(pillX, pillW, sz(16));
    // #3F2586 보라색 밑단(3D 그림자 박스) — 메인보다 sz(4) 아래로
    this.add.image(pillX + pillW / 2, pillCY + sz(4), 'hud_bar_main').setDisplaySize(pillW, pillH).setDepth(50);
    this.add.image(pillX + pillW / 2, pillCY, 'hud_bar_pill').setDisplaySize(pillW, pillH).setDepth(51);

    // Book icon on pill (Figma: offset x10, h56) — 세로 중앙
    this.iconShadow(this.add.image(pillX + sz(33), pillCY, 'icon_book').setDisplaySize(sz(42), sz(50)).setDepth(53));

    // "Compound Book" label — 상단
    this.add.text(pillX + sz(76), pillTop + sz(9), 'Compound Book', {
      fontFamily: '"Inter", "Baloo 2"', fontSize: `${sz(15)}px`,
      color: '#FFFFFF', fontStyle: 'bold',
    }).setDepth(52);

    // Track inner — 하단
    const tX = pillX + sz(63), tY = pillTop + sz(35), tW = sz(160), tH = sz(19);
    const trackG = this.add.graphics().setDepth(52);
    trackG.fillStyle(0x382a65, 1);
    trackG.fillRoundedRect(tX, tY, tW, tH, sz(10));

    this.hudTrackX = pillX + sz(65); this.hudTrackY = tY + sz(2);
    this.hudTrackW = sz(156); this.hudTrackH = sz(15);
    this.progressFill = this.add.graphics().setDepth(53);

    // Round progress text (centered on track)
    this.roundText = this.add.text(tX + tW / 2, tY + tH / 2, `1 / ${ROUNDS}`, {
      fontFamily: 'Baloo 2', fontSize: `${sz(10)}px`, color: 'rgba(255,255,255,0.7)',
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

    // ── 오른쪽 그룹: 배지 3 + 설정. 오른쪽 끝 기준(오른쪽 여백 = 왼쪽 back), 간격 sz(12) ──
    const bW = sz(152), bH = bodyH;
    const gap = sz(12);
    const margin = Math.round(14 * sx);          // 좌측 back 버튼 여백과 대칭
    const sLeft = GW - margin - bSz;             // 설정 버튼 좌측(몸통 폭 bSz)
    const b3L = sLeft - gap - bW;
    const b2L = b3L - gap - bW;
    const b1L = b2L - gap - bW;
    const badgeX = [b1L, b2L, b3L];

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
    const badges: { bgKey: string; iconKey: string; kind: 'score' | 'coin' | 'gem' }[] = [
      { bgKey: 'badge_star_main', iconKey: 'icon_star',  kind: 'score' },
      { bgKey: 'badge_coin_main', iconKey: 'icon_money', kind: 'coin'  },
      { bgKey: 'badge_coin_main', iconKey: 'icon_gem',   kind: 'gem'   },
    ];

    badges.forEach((cfg, i) => {
      const bx = badgeX[i];

      // #6A92BE 파란색 밑단(3D 그림자 박스) — 메인보다 sz(4) 아래로 + 부드러운 그림자
      drawTopShadow(bx, bW, sz(16));
      this.add.image(bx + bW / 2, midY + sz(4), 'badge_shadow').setDisplaySize(bW, bH).setDepth(50);
      this.add.image(bx + bW / 2, midY, cfg.bgKey).setDisplaySize(bW, bH).setDepth(51);

      // 숫자용 어두운 인셋 바 (세로 중앙)
      const ibH = sz(40);
      const ibL = bx + sz(30), ibT = midY - ibH / 2, ibW = bW - sz(43);
      const ibG = this.add.graphics().setDepth(52);
      ibG.fillStyle(0x426295, 1);
      ibG.fillRoundedRect(ibL, ibT, ibW, ibH, sz(11));

      // 아이콘 (세로 중앙, 왼쪽으로 살짝 튀어나오게)
      const iconSz = sz(46);
      this.iconShadow(this.add.image(bx + sz(8) + iconSz / 2, midY, cfg.iconKey).setDisplaySize(iconSz, iconSz).setDepth(53));

      const numTxt = this.add.text(bx + sz(107), midY, '0', {
        fontFamily: '"Inter", "Baloo 2"', fontSize: `${sz(22)}px`,
        color: '#FFFFFF', fontStyle: 'bold',
      }).setOrigin(1, 0.5).setDepth(53);
      if (cfg.kind === 'score') this.scoreText = numTxt;
      if (cfg.kind === 'coin')  this.coinText  = numTxt;
      if (cfg.kind === 'gem')   this.gemText   = numTxt;

      // + 버튼 (세로 중앙, 우측 끝) — 클릭 시 재화 정책 안내 모달
      const plusImg = this.add.image(bx + bW - sz(13), midY, 'btn_plus').setDisplaySize(sz(32), sz(32)).setDepth(53);
      const phX = bx + bW - sz(31), phY = midY - sz(18);
      const plusHit = this.add.graphics().setDepth(55).setAlpha(0.001);
      plusHit.fillRect(phX, phY, sz(38), sz(36));
      plusHit.setInteractive({ hitArea: new Phaser.Geom.Rectangle(phX, phY, sz(38), sz(36)), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
      plusHit.on('pointerdown', () => {
        this.tweens.add({ targets: plusImg, scaleX: 0.85, scaleY: 0.85, duration: 80, yoyo: true, ease: 'Back.easeIn' });
        this.showCurrencyInfo(cfg.kind);
      });
    });
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
    const s = Math.min(GW / 1280, GH / 720);
    const sz = (f: number) => Math.round(f * s);

    const panelW = sz(480), panelH = sz(320);
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
    const title = this.add.text(0, -panelH / 2 + sz(40), '⚙️  설정', {
      fontFamily: '"Noto Sans KR", "Baloo 2"', fontSize: `${sz(28)}px`,
      color: '#FFFFFF', fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(title);

    // Divider
    const div = this.add.graphics();
    div.lineStyle(1, 0x7b63b7, 0.4);
    div.lineBetween(-panelW / 2 + sz(24), -panelH / 2 + sz(72), panelW / 2 - sz(24), -panelH / 2 + sz(72));
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

    makeToggle('배경음악 (BGM)', -sz(30), () => this.bgmOn, () => { this.bgmOn = !this.bgmOn; gameAudio.unlock(); gameAudio.startBgm(); gameAudio.setBgmEnabled(this.bgmOn); });
    makeToggle('효과음 (SFX)',   sz(40),  () => this.sfxOn, () => { this.sfxOn = !this.sfxOn; gameAudio.sfxOn = this.sfxOn; });

    // Close button
    const closeBtnY = panelH / 2 - sz(44);
    const closeBg = this.add.graphics();
    closeBg.fillStyle(0x5a3fbf, 1);
    closeBg.fillRoundedRect(-sz(72), closeBtnY - sz(22), sz(144), sz(44), sz(12));
    const closeText = this.add.text(0, closeBtnY, '닫기', {
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
    const sz = (f: number)  => Math.round(f  * s);

    const navY = q(648), navH = sz(58), shadowOff = sz(4); // 높이는 균일 배율(sz)로 → 상단 HUD와 높이 일치
    const navCY = navY + Math.round(navH / 2);
    const txtStyle = {
      fontFamily: '"Inter", "Baloo 2"', fontSize: `${sz(24)}px`,
      color: '#FFFFFF', fontStyle: 'bold',
      shadow: { offsetX: 0, offsetY: sz(2), color: 'rgba(0,0,0,0.25)', blur: 2, fill: true },
    };

    const drawLayered = (figX: number, figW: number, shKey: string, mainKey: string, topKey: string) => {
      const x = p(figX), w = p(figW);
      this.add.image(x + w / 2, navCY + shadowOff, shKey  ).setDisplaySize(w, navH).setDepth(40);
      this.add.image(x + w / 2, navCY,             mainKey).setDisplaySize(w, navH).setDepth(41);
      this.add.image(x + w / 2, navCY,             topKey ).setDisplaySize(w, navH).setDepth(42);
    };

    const makeHit = (figX: number, figW: number, cb: () => void) => {
      const x = p(figX), w = p(figW);
      const h = this.add.graphics().setDepth(45).setAlpha(0.001);
      h.fillRect(x, navY, w, navH);
      h.setInteractive({ hitArea: new Phaser.Geom.Rectangle(x, navY, w, navH), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
      h.on('pointerdown', cb);
    };

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
    drawLayered(301, 162, 'nav_home_shadow', 'nav_home_main', 'nav_home_top');
    const replayIcon = this.add.image(0, navCY, 'icon_replay').setDisplaySize(sz(30), sz(30)).setDepth(43);
    centerInBtn(p(301 + 81), replayIcon, sz(30), 'Replay');
    makeHit(301, 162, () => {
      btnPress([replayIcon]);
      this.time.delayedCall(100, () => {
        this.cameras.main.fadeOut(280, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart());
      });
    });

    // ── Mic  (Figma left:473) ─────────────────────────────────────
    const micX = p(473), micW = p(162);
    this.add.image(micX + micW / 2, navCY + shadowOff, 'nav_green_shadow').setDisplaySize(micW, navH).setDepth(40);
    const micMain = this.add.image(micX + micW / 2, navCY, 'nav_green_main').setDisplaySize(micW, navH).setDepth(41);
    const micTop  = this.add.image(micX + micW / 2, navCY, 'nav_green_top' ).setDisplaySize(micW, navH).setDepth(42);
    this.micBtnLayers = [micMain, micTop];
    this.micBtnIcon = this.add.image(0, navCY, 'icon_mic').setDisplaySize(sz(24), sz(34)).setDepth(43);
    this.micLabel = centerInBtn(p(473 + 81), this.micBtnIcon, sz(24), 'Mic');
    makeHit(473, 162, () => {
      btnPress([this.micBtnIcon]);
      this.startMic();
    });

    // ── Hint  (Figma left:645) ────────────────────────────────────
    const hintImgs: Phaser.GameObjects.Image[] = [];
    drawLayered(645, 162, 'nav_hint_shadow', 'nav_hint_main', 'nav_hint_top');
    const hintIcon = this.add.image(0, navCY, 'icon_hint').setDisplaySize(sz(28), sz(34)).setDepth(43);
    hintImgs.push(hintIcon);
    centerInBtn(p(645 + 81), hintIcon, sz(28), 'Hint');
    makeHit(645, 162, () => {
      btnPress(hintImgs);
      this.showHint();
    });

    // ── Home  (Figma left:817) ────────────────────────────────────
    const homeImgs: Phaser.GameObjects.Image[] = [];
    drawLayered(817, 162, 'nav_home_shadow', 'nav_home_main', 'nav_home_top');
    const homeIcon = this.add.image(0, navCY, 'icon_home').setDisplaySize(sz(30), sz(28)).setDepth(43);
    homeImgs.push(homeIcon);
    centerInBtn(p(817 + 81), homeIcon, sz(30), 'Home');
    makeHit(817, 162, () => {
      btnPress(homeImgs);
      this.time.delayedCall(100, () => {
        this.cameras.main.fadeOut(400, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => window.location.reload());
      });
    });
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
    if (!SR) { this.showToast('이 브라우저는 음성 인식을 지원하지 않아요'); return; }

    const { gw: GW, gh: GH } = this;
    const s  = Math.min(GW / 1280, GH / 720);
    const sz = (f: number) => Math.round(f * s);

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
    const ringX = Math.round((473 + 81) * GW / 1280);
    const ringY = Math.round(GH * 677 / 720);
    const ring  = this.add.graphics().setDepth(39);
    this.micRing = ring;
    this.micRingTween = this.tweens.add({
      targets: ring, alpha: { from: 0.7, to: 0 },
      scaleX: { from: 1, to: 2.6 }, scaleY: { from: 1, to: 2.6 },
      duration: 700, repeat: -1, ease: 'Sine.easeOut',
      onUpdate: () => {
        ring.clear();
        ring.lineStyle(sz(4), 0x44ff88, 1);
        ring.strokeRoundedRect(ringX - sz(81), ringY - sz(29), sz(162), sz(58), sz(14));
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
        this.showToast(`"${found}" 들었어요! 다른 단어도 말해봐요`);
      } else {
        this.showToast('다시 한번 생각해서 말해볼까요?');
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

  private showToast(msg: string) {
    const { gw: GW, gh: GH } = this;
    const s = Math.min(GW / 1280, GH / 720);
    const toast = this.add.text(GW / 2, Math.round(GH * 0.82), msg, {
      fontFamily: '"Noto Sans KR", "Baloo 2"', fontSize: `${Math.round(s * 22)}px`,
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
    //       (2) 좌/우 각각 중복 단어 없음.
    const validSet = new Set(COMPOUND_PAIRS.map(p => `${p.word1} ${p.word2}`));
    const isCompound = (a: string, b: string) => validSet.has(`${a} ${b}`);
    const iconW1 = new Map(COMPOUND_PAIRS.map(p => [p.word1, p.icon1] as const));
    const iconW2 = new Map(COMPOUND_PAIRS.map(p => [p.word2, p.icon2] as const));
    const allW1 = [...new Set(COMPOUND_PAIRS.map(p => p.word1))];
    const allW2 = [...new Set(COMPOUND_PAIRS.map(p => p.word2))];
    const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);

    // 좌측: 정답 word1 + distractor 2개(정답 word2와 합쳐도 합성어가 아닌 것, 중복 없음)
    const leftWords = [pair.word1];
    for (const w of shuffle(allW1)) {
      if (leftWords.length >= 3) break;
      if (leftWords.includes(w)) continue;
      if (isCompound(w, pair.word2)) continue;      // 정답 우측과 또 다른 조합이 되면 제외
      leftWords.push(w);
    }
    // 우측: 정답 word2 + distractor 2개(어떤 좌측 카드와도 합성어가 안 되는 것, 중복 없음)
    const rightWords = [pair.word2];
    for (const w of shuffle(allW2)) {
      if (rightWords.length >= 3) break;
      if (rightWords.includes(w)) continue;
      if (leftWords.some(l => isCompound(l, w))) continue;  // 좌측(정답 포함) 어느 것과도 조합 불가
      rightWords.push(w);
    }

    const leftData  = shuffle(leftWords.map(w => ({ word: w, icon: iconW1.get(w) ?? '' })));
    const rightData = shuffle(rightWords.map(w => ({ word: w, icon: iconW2.get(w) ?? '' })));

    const s = Math.min(GW / 1280, GH / 720);   // 화면 균일 배율
    const CARD_SCALE = 0.972 * 0.8 * s;        // 카드 크기 80%로 축소 + 화면 균일 배율(태블릿 대응)
    // Figma-matched staggered positions (Figma canvas: 1280×720)
    // Values are card CENTER coordinates
    const pf = (fx: number) => Math.round(fx * GW / 1280);
    const qf = (fy: number) => Math.round(fy * GH / 720);

    const leftPos  = [{ x: 209, y: 185 }, { x: 359, y: 345 }, { x: 153, y: 500 }];
    const rightPos = [{ x: 1139, y: 175 }, { x: 950, y: 360 }, { x: 1060, y: 510 }];
    const leftAngle  = [-8, -4, -12];
    const rightAngle = [10,  4,   8];

    const makeCard = (figX: number, figY: number, angle: number, slotIdx: number, word: string, icon: string, side: 'left' | 'right') => {
      const targetX  = pf(figX);
      const targetY  = qf(figY + 30);   // 전체 아래로 30(그래비티존과 동일 이동)
      const startX   = side === 'left' ? -CARD_W : GW + CARD_W;
      const leftKey  = `card_left_${word}`;
      const rightKey = `card_right_${word}`;
      const bgKey    = side === 'left'
        ? (this.textures.exists(leftKey)  ? leftKey  : undefined)
        : (this.textures.exists(rightKey) ? rightKey : undefined);
      const card = new WordCard(this, startX, targetY, word, icon, true, bgKey);
      card.baseScale = CARD_SCALE;   // 상호작용 트윈의 기준 배율(클릭 시 커지는 버그 방지)
      card.setScale(CARD_SCALE);
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

    const CRW = Math.round(this.gw * 0.234);
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

    const { gw: GW, gh: GH } = this;
    const s = Math.min(GW / 1280, GH / 720);
    const CX = Math.round(GW / 2), CY = Math.round(GH / 2);

    const layer = this.add.container(0, 0).setDepth(80).setAlpha(0);

    const dim = this.add.graphics();
    dim.fillStyle(0x150B33, 0.82);
    dim.fillRect(0, 0, GW, GH);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GW, GH), Phaser.Geom.Rectangle.Contains);
    layer.add(dim);

    const bookW = Math.round(Math.min(GW * 0.62, GH * 1.15));
    const bookH = Math.round(GH * 0.72);
    const r = Math.round(Math.min(bookW, bookH) * 0.05);
    const book = this.add.container(CX, CY);
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
    const closeR = Math.round(titleH * 0.42);
    const closeX = pageX + pageW - pad - closeR, closeY = titleY;
    const closeG = this.add.graphics();
    closeG.fillStyle(0x8A43D6, 1); closeG.fillCircle(closeX, closeY, closeR);
    const closeTxt = this.add.text(closeX, closeY, '✕', {
      fontFamily: '"Baloo 2"', fontSize: `${Math.round(closeR * 1.1)}px`, color: '#FFFFFF', fontStyle: 'bold',
    }).setOrigin(0.5);
    book.add([closeG, closeTxt]);
    countTxt.setX(closeX - closeR - Math.round(s * 12));

    // ── 카드 그리드 (전체 페어, 획득=이미지 / 미획득=흐린 ?), 페이지네이션 ──
    const contentTop = pageY + titleH + Math.round(bookH * 0.05);
    const navH = Math.round(bookH * 0.1);
    const contentBottom = pageY + pageH - pad - navH;
    const COLS = 4, ROWS = 3, PER = COLS * ROWS;
    const centerGap = Math.round(bookW * 0.03);   // 가운데 접힘선 여백
    const leftL = pageX + pad, rightR = pageX + pageW - pad;
    const halfCellW = ((rightR - leftL) - centerGap) / COLS;   // 좌2 + 우2, 동일 셀폭
    const cellH = (contentBottom - contentTop) / ROWS;
    const cardH = Math.min(cellH * 0.9, halfCellW * 0.82 * 1.21), cardW = cardH / 1.21;
    const totalPages = Math.ceil(COMPOUND_PAIRS.length / PER);

    const pages: Phaser.GameObjects.Container[] = [];
    for (let pg = 0; pg < totalPages; pg++) {
      const pc = this.add.container(0, 0);
      if (pg !== 0) pc.setVisible(false);
      book.add(pc);
      COMPOUND_PAIRS.slice(pg * PER, (pg + 1) * PER).forEach((p, idx) => {
        const col = idx % COLS, row = Math.floor(idx / COLS);
        // 좌측 페이지(col 0,1) / 우측 페이지(col 2,3) — 가운데 접힘선 기준 분리
        const tx = col < 2
          ? leftL + halfCellW * (col + 0.5)
          : (centerGap / 2) + halfCellW * (col - 2 + 0.5);
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
          pc.add(this.add.image(tx, ty, key).setDisplaySize(cardW, cardH).setTint(0x888888).setAlpha(0.4));
          pc.add(this.add.text(tx, ty, '?', {
            fontFamily: '"Baloo 2"', fontSize: `${Math.round(cardH * 0.38)}px`, color: '#FFFFFF', fontStyle: 'bold',
          }).setOrigin(0.5).setAlpha(0.8));
        } else {
          pc.add(this.add.text(tx, ty, has ? p.result : '?', {
            fontFamily: '"Baloo 2"', fontSize: `${Math.round(cardW * 0.16)}px`,
            color: has ? '#5A2E94' : '#8A6BB8', fontStyle: 'bold', align: 'center', wordWrap: { width: cardW * 0.85 },
          }).setOrigin(0.5).setAlpha(has ? 1 : 0.4));
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
    const prevBtn = this.add.text(pageX + pad + navFont * 0.5, navCY, '‹', {
      fontFamily: '"Baloo 2"', fontSize: `${navFont}px`, color: '#6B49A8', fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(false).setInteractive({ useHandCursor: true });
    const nextBtn = this.add.text(pageX + pageW - pad - navFont * 0.5, navCY, '›', {
      fontFamily: '"Baloo 2"', fontSize: `${navFont}px`, color: '#6B49A8', fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(totalPages > 1).setInteractive({ useHandCursor: true });
    book.add([prevBtn, nextBtn]);
    const nav = (dir: number) => {
      const np = page + dir;
      if (np < 0 || np >= totalPages) return;
      pages[page].setVisible(false); page = np; pages[page].setVisible(true);
      drawDots();
      prevBtn.setVisible(page > 0); nextBtn.setVisible(page < totalPages - 1);
    };
    prevBtn.on('pointerdown', () => nav(-1));
    nextBtn.on('pointerdown', () => nav(1));

    const close = () => {
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
  private showCurrencyInfo(kind: 'score' | 'coin' | 'gem') {
    if (this.infoOpen) return;
    this.infoOpen = true;

    const { gw: GW, gh: GH } = this;
    const s = Math.min(GW / 1280, GH / 720);
    const CX = Math.round(GW / 2), CY = Math.round(GH / 2);

    const rows: { kind: string; icon: string; name: string; color: number; earn: string; spend: string }[] = [
      { kind: 'score', icon: 'icon_star',  name: '별 Star',   color: 0xF5B301,
        earn: '정답을 맞히면 +10  ·  첫 시도 정답은 보너스!',
        spend: '힌트 사용 시 −5  ·  별 100개 → 동전 1개로 교환' },
      { kind: 'coin',  icon: 'icon_money', name: '동전 Coin',  color: 0xE08A00,
        earn: '별 100개로 구매  ·  한 세트(6판) 완주 보너스',
        spend: '동전 1개 = 재도전 기회 1회 (틀려도 계속!)' },
      { kind: 'gem',   icon: 'icon_gem',   name: '보석 Gem',   color: 0x2E9BE0,
        earn: '세트 완주  ·  연속 정답(콤보) 보너스로 +1',
        spend: '보석 1개 = 못 모은 카드를 보기로 소환 (도감 채우기)' },
    ];

    const layer = this.add.container(0, 0).setDepth(82).setAlpha(0);
    const dim = this.add.graphics();
    dim.fillStyle(0x150B33, 0.82); dim.fillRect(0, 0, GW, GH);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GW, GH), Phaser.Geom.Rectangle.Contains);
    layer.add(dim);

    const panelW = Math.round(Math.min(GW * 0.62, GH * 1.15));
    const panelH = Math.round(Math.min(GH * 0.66, panelW * 0.78));
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
    panel.add(this.add.text(pageX + pad, titleY, '포인트 & 혜택 안내', {
      fontFamily: '"Baloo 2"', fontSize: `${Math.round(titleH * 0.5)}px`, color: '#5A2E94', fontStyle: 'bold',
    }).setOrigin(0, 0.5));

    // 닫기 X
    const closeR = Math.round(titleH * 0.42);
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
      const bigBox = Math.round(Math.min(leftW * 0.42, (contentBottom - contentTop) * 0.34, 150));
      const src = this.textures.get(rr.icon).getSourceImage() as { width: number; height: number };
      const ar = (src.width || 1) / (src.height || 1);
      const iw = ar >= 1 ? bigBox : Math.round(bigBox * ar);
      const ih = ar >= 1 ? Math.round(bigBox / ar) : bigBox;
      let y = contentTop + Math.round(bigBox * 0.6);
      leftCont.add(this.iconShadow(this.add.image(lcx, y, rr.icon).setDisplaySize(iw, ih)));
      y += Math.round(bigBox * 0.72);
      leftCont.add(this.add.text(lcx, y, rr.name, {
        fontFamily: '"Baloo 2"', fontSize: `${Math.round(leftW * 0.11)}px`, color: rgba(rr.color), fontStyle: 'bold',
      }).setOrigin(0.5));
      y += Math.round(leftW * 0.11);
      const tx = leftL + Math.round(leftW * 0.07);
      const wrapW = leftW * 0.86;
      const fs = Math.round(leftW * 0.05);
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
      addBlock('모으기', rr.earn);
      addBlock('쓰기', rr.spend);
    };

    // 우측 목록 (탭하여 선택 전환) — 닫기(X) 버튼 아래에서 시작해 겹침 방지
    const rightTop = Math.max(contentTop, closeY + closeR + Math.round(panelH * 0.045));
    const rItemGap = Math.round(panelH * 0.03);
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

    const dim = this.add.graphics().setDepth(70).setAlpha(0);
    dim.fillStyle(0x150B33, 0.82);
    dim.fillRect(0, 0, GW, GH);
    this.tweens.add({ targets: dim, alpha: 1, duration: 400 });

    // ── Open "Compound Book" (purple themed) ──────────────────────
    const bookW = Math.round(GW * 0.66);
    const bookH = Math.round(GH * 0.58);
    const bookCY = CY - Math.round(GH * 0.07);
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
    const made = this.queue.slice(0, ROUNDS).map(p => p.result);
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
      fontFamily: '"Baloo 2"', fontSize: `${Math.round(titleH * 0.42)}px`,
      color: '#8A43D6', fontStyle: 'bold',
    }).setOrigin(1, 0.5);
    book.add(countTxt);

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
        pages[collPage].setVisible(false);
        collPage = np;
        pages[collPage].setVisible(true);
        updateDots(collPage);
        prevBtn.setVisible(collPage > 0);
        nextBtn.setVisible(collPage < totalPages - 1);
      };

      prevBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => navigate(-1));
      nextBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => navigate(1));
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
    const bW = Math.round(s * 202);
    const bH = Math.round(s * 62);
    const bCY = (bookCY + bookH / 2) + Math.round(GH * 0.08) + bH / 2;
    const shadowOff = Math.round(s * 4);

    const btnCont = this.add.container(CX, bCY).setDepth(72).setAlpha(0);
    const btnShadow = this.add.image(0, shadowOff, 'nav_green_shadow').setDisplaySize(bW, bH);
    const btnMain   = this.add.image(0, 0,         'nav_green_main'  ).setDisplaySize(bW, bH);
    const btnTop    = this.add.image(0, 0,         'nav_green_top'   ).setDisplaySize(bW, bH);

    const iconSz = Math.round(bH * 0.48);
    const btnIcon = this.add.image(0, 0, 'icon_play_tri').setDisplaySize(iconSz, iconSz);
    const btnTxt  = this.add.text(0, 0, 'Next Play', {
      fontFamily: '"Inter", "Baloo 2"', fontSize: `${Math.round(bH * 0.38)}px`,
      color: '#FFFFFF', fontStyle: 'bold',
      shadow: { offsetX: 0, offsetY: Math.round(s * 2), color: 'rgba(0,0,0,0.25)', blur: 2, fill: true },
    }).setOrigin(0, 0.5);
    const gap    = Math.round(s * 12);
    const totalW = iconSz + gap + btnTxt.width;
    btnIcon.setX(Math.round(-totalW / 2 + iconSz / 2));
    btnTxt.setX(Math.round(-totalW / 2 + iconSz + gap));
    btnCont.add([btnShadow, btnMain, btnTop, btnIcon, btnTxt]);

    const btnDelay = 360 + ROUNDS * 140 + 300;
    this.tweens.add({ targets: btnCont, alpha: 1, duration: 300, delay: btnDelay });

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

}
