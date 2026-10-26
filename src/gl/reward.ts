// Score reward as in the game's intro video (user: "점수획득하면 별이나 코인, 보석 들 모션도 인트로 영상이랑 동일하게"):
// once the result card is up, stars, coins and gems pop out from under it and arc outward - stars spinning, coins
// flipping, gems tumbling, each with a sparkle trail - then get pulled into three dark "+N" chips that pop in under
// the card; every landing bumps its chip and rolls the number up (intro 8.0-9.4 s). Then each chip's icon flies up
// into its HUD badge, which bumps and counts up (GameScene's own countUp/bumpBadge, held back until then).
// Drawn with Phaser (HUD layer, above the result card) using the game's own icons. 2D mode keeps the original.
type Any = any;

export type Kind = 'score' | 'coin' | 'gem';
export interface Gain {
  kind: Kind;
  amount: number;
  /** HUD badge icon (game px) */
  hud: { x: number; y: number; size: number } | null;
  /** the HUD badge counts up + bumps (called when its icon arrives) */
  arrive: () => void;
}

const ICON: Record<Kind, string> = { score: 'icon_star', coin: 'icon_money', gem: 'icon_gem' };
const COUNT: Record<Kind, number> = { score: 5, coin: 5, gem: 3 };
const TRAIL: Record<Kind, number> = { score: 0xFFE066, coin: 0xFFC233, gem: 0x8FE3FF };

/** seconds, from the moment the result card has grown */
export const REWARD = {
  start: 0.08,        // first icon pops out
  stagger: 0.035,     // between icons
  out: 0.42,          // pop + arc outward
  home: 0.4,          // pulled into the chip
  chip: 0.36,         // first chip pops in (+0.09 per chip)
  hold: 0.28,         // after the last landing
  up: 0.55,           // chip icon -> HUD badge
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const bez = (a: number, b: number, c: number, t: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;

export class Reward {
  private live: Any[] = [];
  private rnd: () => number = Math.random;

  constructor(private scene: Any) {
    scene.events?.once('shutdown', () => this.stop());
  }

  stop() {
    for (const o of this.live.splice(0)) {
      try { this.scene.tweens.killTweensOf(o); } catch { /* gone */ }
      try { o.destroy?.(); } catch { /* gone */ }
    }
  }

  private keep<T>(o: T): T { this.live.push(o); return o; }

  /**
   * @param card the result card container (its bounds place the burst and the chips)
   * @param avoid a screen box the chip row must not cover (Glee), or null
   */
  play(card: Any, gains: Gain[], avoid: { l: number; r: number; t: number; b: number } | null) {
    this.stop();
    const sc = this.scene, tw = sc.tweens;
    const W = sc.gw ?? sc.scale.width, H = sc.gh ?? sc.scale.height;
    const s = Math.min(W / 1280, H / 720);
    const b = card.getBounds();
    const cx = b.centerX, bottom = b.bottom;

    // ── the chips: a row of dark pills under the card ──
    const cw = Math.round(110 * s), ch = Math.round(40 * s), gap = Math.round(10 * s);
    let rowX = cx;
    const chipY = Math.min(bottom + 44 * s, H - 96 * s);
    const rowL = () => rowX - (gains.length * cw + (gains.length - 1) * gap) / 2;
    if (avoid && chipY + ch / 2 > avoid.t && chipY - ch / 2 < avoid.b && rowL() < avoid.r + 6 * s) rowX += avoid.r + 6 * s - rowL();
    const chips = gains.map((g, i) => {
      const x = rowL() + cw / 2 + i * (cw + gap);
      const c = this.keep(sc.add.container(x, chipY).setDepth(68).setScale(0));
      const bg = sc.add.graphics();
      bg.fillStyle(0x1B1747, 0.82); bg.fillRoundedRect(-cw / 2, -ch / 2, cw, ch, ch / 2);
      bg.lineStyle(Math.max(1.5, 2 * s), 0xFFFFFF, 0.2); bg.strokeRoundedRect(-cw / 2, -ch / 2, cw, ch, ch / 2);
      bg.fillStyle(0xFFFFFF, 0.08); bg.fillRoundedRect(-cw / 2 + 4 * s, -ch / 2 + 3 * s, cw - 8 * s, ch * 0.42, ch * 0.21);
      const isz = 44 * s;
      const icon = sc.add.image(-cw / 2 + isz * 0.42, 0, ICON[g.kind]);
      icon.setScale(isz / Math.max(icon.width, icon.height));
      const txt = sc.add.text(-cw / 2 + isz * 0.95, 0, '+0', {
        fontFamily: '"Baloo 2", "Inter", sans-serif', fontSize: `${Math.round(22 * s)}px`, color: '#FFFFFF', fontStyle: 'bold',
        shadow: { offsetX: 0, offsetY: 2, color: '#000000', blur: 4, fill: true },
      }).setOrigin(0, 0.5);
      c.add([bg, icon, txt]);
      tw.add({ targets: c, scale: 1, duration: 300, delay: (REWARD.chip + i * 0.09) * 1000, ease: 'Back.easeOut' });
      return { g, c, icon, txt, isz, x, y: chipY, landed: 0, total: COUNT[g.kind] };
    });

    // ── the burst: icons pop out from under the card, arc outward, then get pulled into their chip ──
    const order: number[] = [];
    const most = Math.max(...gains.map(g => COUNT[g.kind]));
    for (let k = 0; k < most; k++) gains.forEach((g, i) => { if (k < COUNT[g.kind]) order.push(i); });
    let lastLand = 0;
    order.forEach((gi, j) => {
      const chip = chips[gi], kind = chip.g.kind;
      const delay = REWARD.start + j * REWARD.stagger;
      lastLand = Math.max(lastLand, delay + REWARD.out + REWARD.home);
      const side = j % 2 === 0 ? -1 : 1;
      const x0 = cx + side * (0.12 + this.rnd() * 0.28) * b.width, y0 = bottom - (14 + this.rnd() * 26) * s;
      const hx = x0 + side * (80 + this.rnd() * 190) * s, hy = y0 - (10 + this.rnd() * 130) * s;
      const size = (54 + this.rnd() * 14) * s;           // the intro's are about as big as a button icon
      const img = this.keep(sc.add.image(x0, y0, ICON[kind]).setDepth(72).setScale(0));
      const base = size / Math.max(img.width, img.height), endK = chip.isz / Math.max(img.width, img.height);
      const spin = (this.rnd() < 0.5 ? -1 : 1) * (240 + this.rnd() * 220);
      const flip0 = this.rnd() * Math.PI, flips = 1.4 + this.rnd() * 0.8;
      const trail = this.keep(sc.add.particles(0, 0, 'pDot', {
        follow: img, frequency: 26, lifespan: 360, speed: { min: 4, max: 26 },
        scale: { start: 0.6 * s, end: 0 }, alpha: { start: 0.85, end: 0 }, tint: TRAIL[kind], blendMode: 'ADD', emitting: false,
      }).setDepth(71));
      const T = REWARD.out + REWARD.home;
      tw.addCounter({
        from: 0, to: 1, duration: T * 1000, delay: delay * 1000, ease: 'Linear',
        onStart: () => trail.start(),
        onUpdate: (t: Any) => {
          const u = t.getValue() * T;
          let x: number, y: number, k: number;
          if (u < REWARD.out) {
            const a = u / REWARD.out, e = easeOutCubic(a);
            x = x0 + (hx - x0) * e; y = y0 + (hy - y0) * e;
            k = base * (a < 0.35 ? 1.15 * easeOutBack(a / 0.35) : 1.15 - 0.15 * (a - 0.35) / 0.65);
          } else {
            const a = (u - REWARD.out) / REWARD.home, e = easeInCubic(a);
            // a short arc into the chip: down through a point above it
            x = bez(hx, (hx + chip.x) / 2, chip.x - chip.isz * 0.1, e);
            y = bez(hy, Math.min(hy, chip.y) - 30 * s, chip.y, e);
            k = base + (endK - base) * a;
          }
          const p = u / T;
          img.setPosition(x, y);
          if (kind === 'coin') {
            const f = Math.cos(flip0 + p * flips * Math.PI * 2);
            img.setScale(k * Math.max(0.12, Math.abs(f)), k);
            img.setTint(Math.abs(f) < 0.35 ? 0xD99A2B : 0xFFFFFF);          // edge-on: the darker rim
          } else if (kind === 'score') {
            img.setScale(k); img.setAngle(spin * p * (1 - 0.5 * p));
          } else {
            img.setScale(k * (1 + 0.08 * Math.sin(p * 18))); img.setAngle(22 * Math.sin(p * 9 + flip0));
          }
        },
        onComplete: () => {
          img.destroy(); trail.stop();
          sc.time.delayedCall(420, () => trail.destroy());
          this.land(chip, s);
        },
      });
    });

    // ── then each chip's icon flies up into its HUD badge ──
    chips.forEach((chip, i) => {
      const at = (Math.max(lastLand, REWARD.chip + 0.4) + REWARD.hold + i * 0.08) * 1000;
      sc.time.delayedCall(at, () => {
        if (!chip.c.active) { chip.g.arrive(); return; }
        const hud = chip.g.hud;
        const from = { x: chip.c.x + chip.icon.x, y: chip.c.y };
        tw.add({ targets: chip.c, alpha: 0, scale: 0.85, duration: 260, delay: 120, ease: 'Cubic.easeIn' });
        if (!hud) { chip.g.arrive(); return; }
        const img = this.keep(sc.add.image(from.x, from.y, ICON[chip.g.kind]).setDepth(72));
        const k0 = chip.isz / Math.max(img.width, img.height), k1 = hud.size / Math.max(img.width, img.height);
        img.setScale(k0);
        const trail = this.keep(sc.add.particles(0, 0, 'pDot', {
          follow: img, frequency: 22, lifespan: 380, speed: { min: 4, max: 24 },
          scale: { start: 0.7 * s, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: TRAIL[chip.g.kind], blendMode: 'ADD',
        }).setDepth(71));
        const side = i - (chips.length - 1) / 2;
        const mx = (from.x + hud.x) / 2 + side * 60 * s, my = (from.y + hud.y) / 2 + 40 * s;
        tw.addCounter({
          from: 0, to: 1, duration: REWARD.up * 1000, ease: 'Linear',
          onUpdate: (t: Any) => {
            const a = t.getValue(), e = easeInOutCubic(a);
            img.setPosition(bez(from.x, mx, hud.x, e), bez(from.y, my, hud.y, e));
            img.setScale(k0 + (k1 * 1.25 - k0) * Math.sin(Math.min(1, a) * Math.PI * 0.5) - (a > 0.85 ? (a - 0.85) / 0.15 * k1 * 0.25 : 0));
            if (chip.g.kind === 'coin') img.setScale(img.scaleX * Math.max(0.2, Math.abs(Math.cos(a * Math.PI * 2))), img.scaleY);
          },
          onComplete: () => {
            trail.stop(); sc.time.delayedCall(420, () => trail.destroy());
            chip.g.arrive();
            this.sparkle(hud.x, hud.y, TRAIL[chip.g.kind], 10, s);
            tw.add({ targets: img, alpha: 0, scale: k1 * 1.5, duration: 140, onComplete: () => img.destroy() });
          },
        });
      });
    });
    return (Math.max(lastLand, REWARD.chip + 0.4) + REWARD.hold + (chips.length - 1) * 0.08 + REWARD.up) ;
  }

  private land(chip: Any, s: number) {
    chip.landed++;
    const v = Math.round(chip.g.amount * Math.min(1, chip.landed / chip.total));
    chip.txt.setText(`+${v}`);
    this.scene.tweens.add({ targets: chip.c, scale: 1.13, duration: 80, yoyo: true, ease: 'Quad.easeOut' });
    this.sparkle(chip.c.x + chip.icon.x, chip.c.y, TRAIL[chip.g.kind as Kind], 6, s);
  }

  private sparkle(x: number, y: number, tint: number, n: number, s: number) {
    const sc = this.scene;
    const e = this.keep(sc.add.particles(x, y, 'pDot', {
      speed: { min: 60 * s, max: 170 * s }, lifespan: 420, scale: { start: 0.7 * s, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [tint, 0xFFFFFF], blendMode: 'ADD', emitting: false,
    }).setDepth(73));
    e.explode(n);
    sc.time.delayedCall(500, () => e.destroy());
  }
}
