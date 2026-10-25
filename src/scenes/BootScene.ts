import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() { super({ key: 'Boot' }); }

  preload() {
    const W = this.scale.width;
    const H = this.scale.height;

    // Loading bar background
    const barBg = this.add.graphics();
    barBg.fillStyle(0x1a1a3a, 1);
    barBg.fillRoundedRect(W / 2 - 200, H / 2 - 16, 400, 32, 16);

    const barFill = this.add.graphics();

    this.load.on('progress', (v: number) => {
      barFill.clear();
      barFill.fillStyle(0x74C0E8, 1);
      barFill.fillRoundedRect(W / 2 - 200, H / 2 - 16, 400 * v, 32, 16);
    });

    this.add.text(W / 2, H / 2 - 50, 'Loading...', {
      fontFamily: 'Baloo 2',
      fontSize: '28px',
      color: '#74C0E8',
    }).setOrigin(0.5);
  }

  create() {
    this.scene.start('Game');
  }
}
