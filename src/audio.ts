// Audio: the BGM reuses the intro video's own soundtrack (videos/intro.mp4)
// looped, so the in-game music matches the intro exactly. SFX (sparkle on a
// successful mash, a gentle buzz on a wrong match) are synthesized with the
// Web Audio API — no extra asset files. A single shared instance survives
// scene restarts so the BGM never doubles up.

class GameAudio {
  // ── SFX (Web Audio) ──
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  // ── BGM (the intro track, looped) ──
  private bgmEl: HTMLAudioElement | null = null;

  bgmOn = true;
  sfxOn = true;

  private ensureCtx() {
    if (this.ctx) return;
    const AC = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
  }

  private ensureBgm() {
    if (this.bgmEl) return;
    const el = new Audio('./videos/intro.mp4'); // same soundtrack as the intro
    el.loop = true;
    el.volume = 0.4;
    el.preload = 'auto';
    this.bgmEl = el;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock() {
    this.ensureCtx();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    this.ensureBgm();
    if (this.bgmOn) void this.bgmEl?.play().catch(() => {});
  }

  startBgm() {
    this.ensureBgm();
    if (this.bgmOn) void this.bgmEl?.play().catch(() => {});
  }

  setBgmEnabled(on: boolean) {
    this.bgmOn = on;
    this.ensureBgm();
    if (on) void this.bgmEl?.play().catch(() => {});
    else this.bgmEl?.pause();
  }

  private soft(freq: number, when: number, dur: number, gain: number, type: OscillatorType, dest: AudioNode) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(gain, when + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    g.connect(dest);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  /** Bright ascending sparkle — played when the mashup particles burst. */
  playBurst() {
    if (!this.sfxOn) return;
    this.ensureCtx();
    if (!this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const t = this.ctx.currentTime;
    const freqs = [880, 1174.66, 1567.98, 2093.0]; // A5 D6 G6 C7 — twinkle up
    freqs.forEach((f, i) => this.soft(f, t + i * 0.035, 0.18, 0.11, 'triangle', this.master!));
    this.soft(659.25, t, 0.10, 0.06, 'sine', this.master); // soft low body
  }

  /** Gentle descending two-tone — played on a wrong match (kid-friendly, not harsh). */
  playWrong() {
    if (!this.sfxOn) return;
    this.ensureCtx();
    if (!this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const t = this.ctx.currentTime;
    this.soft(311.13, t,        0.16, 0.12, 'triangle', this.master); // Eb4
    this.soft(233.08, t + 0.13, 0.24, 0.12, 'triangle', this.master); // Bb3 (down)
  }
}

export const gameAudio = new GameAudio();
