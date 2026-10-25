import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { gameAudio } from './audio';

runIntro(() => {
  new Phaser.Game({
    type: Phaser.AUTO,
    backgroundColor: '#0a0a1a',
    parent: 'game-container',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, GameScene],
  });
});

// ── Intro video overlay ──────────────────────────────────────────────────────

function runIntro(onComplete: () => void) {
  const overlay = document.createElement('div');
  overlay.id = 'intro-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:9999;overflow:hidden;cursor:pointer;';

  const video = document.createElement('video');
  video.src = './videos/intro.mp4';
  video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';
  video.playsInline = true;
  video.muted = true;


  const style = document.createElement('style');
  style.textContent = [
    '@keyframes mutePulse{0%,100%{opacity:0.55}50%{opacity:0.15}}',
    '@keyframes skipPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0.3)}50%{box-shadow:0 0 0 8px rgba(255,255,255,0)}}',
  ].join('');
  document.head.appendChild(style);

  // ── SKIP / START button ─────────────────────────────────────────
  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'SKIP';

  const skipBaseStyle = [
    'position:absolute',
    'bottom:6%',
    'right:4%',
    'padding:clamp(10px,1.5vh,16px) clamp(24px,3vw,44px)',
    'font-size:clamp(15px,1.8vw,22px)',
    'font-family:"Baloo 2",cursive',
    'font-weight:700',
    'color:rgba(255,255,255,0.88)',
    'background:rgba(255,255,255,0.12)',
    'border:2px solid rgba(255,255,255,0.35)',
    'border-radius:50px',
    'cursor:pointer',
    'letter-spacing:2px',
    'outline:none',
    'opacity:0',
    'pointer-events:none',
    'backdrop-filter:blur(10px)',
    '-webkit-backdrop-filter:blur(10px)',
    'transition:opacity 0.5s ease, background 0.3s ease, transform 0.2s ease, border-color 0.3s ease',
  ].join(';');

  skipBtn.style.cssText = skipBaseStyle;

  skipBtn.addEventListener('mouseenter', () => {
    skipBtn.style.background = 'rgba(255,255,255,0.22)';
    skipBtn.style.transform = 'scale(1.05)';
    skipBtn.style.borderColor = 'rgba(255,255,255,0.6)';
  });
  skipBtn.addEventListener('mouseleave', () => {
    skipBtn.style.background = isStartMode ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.12)';
    skipBtn.style.transform = 'scale(1)';
    skipBtn.style.borderColor = isStartMode ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)';
  });

  skipBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    gameAudio.unlock();   // continue the intro music into the game as BGM
    video.pause();
    overlay.style.transition = 'opacity 0.4s ease';
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.remove(); onComplete(); }, 420);
  });

  // Show SKIP after 2 seconds
  let isStartMode = false;
  setTimeout(() => {
    skipBtn.style.opacity = '1';
    skipBtn.style.pointerEvents = 'auto';
    skipBtn.style.animation = 'skipPulse 2s ease-in-out infinite';
  }, 2000);

  // Video ends → change to START
  video.addEventListener('ended', () => {
    isStartMode = true;
    skipBtn.textContent = 'START';
    skipBtn.style.background = 'rgba(255,255,255,0.2)';
    skipBtn.style.border = '2px solid rgba(255,255,255,0.7)';
    skipBtn.style.color = '#ffffff';
    skipBtn.style.fontSize = 'clamp(18px,2.2vw,28px)';
    skipBtn.style.padding = 'clamp(12px,1.8vh,20px) clamp(32px,4vw,60px)';
    skipBtn.style.letterSpacing = '4px';
    skipBtn.style.animation = 'skipPulse 1.2s ease-in-out infinite';
  });

  video.addEventListener('error', () => { overlay.remove(); onComplete(); });

  // Anywhere on overlay → unmute
  overlay.addEventListener('click', () => {
    video.muted = false;
  }, { once: true });

  overlay.append(video, skipBtn);
  document.body.appendChild(overlay);

  video.play().catch(() => { overlay.remove(); onComplete(); });
}
