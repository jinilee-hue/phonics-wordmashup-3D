import { defineConfig } from 'vite';
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
};

function copyAssetsPlugin() {
  const cwd = process.cwd();
  const imgDir   = join(cwd, 'Word Mashup', 'Images');
  const videoSrc = join(cwd, 'Word Mashup', 'Word Mashup.mp4');

  return {
    name: 'copy-game-assets',

    // Dev server: serve Word Mashup assets at /images/ and /videos/
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configureServer(server: any) {
      server.middlewares.use('/images', (req, res, next) => {
        const file = join(imgDir, decodeURIComponent(req.url.replace(/^\//, '')));
        if (existsSync(file)) {
          res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
          createReadStream(file).pipe(res as unknown as NodeJS.WritableStream);
        } else { next(); }
      });
      server.middlewares.use('/videos', (req, res, next) => {
        if (req.url === '/intro.mp4' && existsSync(videoSrc)) {
          res.setHeader('Content-Type', 'video/mp4');
          createReadStream(videoSrc).pipe(res as unknown as NodeJS.WritableStream);
        } else { next(); }
      });
    },

    closeBundle() {
      const cwd = process.cwd();

      // Intro video
      const videoSrc = join(cwd, 'Word Mashup', 'Word Mashup.mp4');
      const videoDest = join(cwd, 'dist', 'videos', 'intro.mp4');
      mkdirSync(join(cwd, 'dist', 'videos'), { recursive: true });
      if (existsSync(videoSrc)) {
        cpSync(videoSrc, videoDest);
        console.log('\n✓ Intro video   → dist/videos/intro.mp4');
      }

      // All images from Word Mashup/Images/
      const imgDir = join(cwd, 'Word Mashup', 'Images');
      const distImgDir = join(cwd, 'dist', 'images');
      mkdirSync(distImgDir, { recursive: true });
      if (existsSync(imgDir)) {
        readdirSync(imgDir)
          .filter(f => f.endsWith('.png') || f.endsWith('.svg'))
          .forEach(f => {
            cpSync(join(imgDir, f), join(distImgDir, f));
            console.log(`✓ ${f} → dist/images/${f}`);
          });
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [copyAssetsPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('phaser')) return 'phaser';
        },
      },
    },
  },
});
