import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      // Copies static PWA assets into dist/ so manifest.json, sw.js, icons/, styles.css, and js/
      // resolve cleanly on GitHub Pages (including subpaths like /Kinetiks/).
      {
        name: 'copy-static-pwa-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const entries = [
            'src/assets',
            'icons',
            'js',
            'manifest.json',
            'sw.js',
            'styles.css',
          ];
          for (const rel of entries) {
            const srcPath = path.resolve(__dirname, rel);
            const destPath = path.resolve(distDir, rel);
            if (fs.existsSync(distDir) && fs.existsSync(srcPath)) {
              fs.cpSync(srcPath, destPath, {recursive: true, force: true});
            }
          }
          const distIndex = path.resolve(distDir, 'index.html');
          if (fs.existsSync(distIndex)) {
            const html = fs
              .readFileSync(distIndex, 'utf8')
              .replace(/href="\.\/assets\/manifest-[^"]+\.json"/, 'href="./manifest.json"');
            fs.writeFileSync(distIndex, html);
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
