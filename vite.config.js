import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

function offlineAssets() {
  return {
    name: 'rift-offline-assets',
    generateBundle(_options, bundle) {
      const bundledFiles = Object.keys(bundle)
        .filter((file) => /\.(?:css|js|webmanifest)$/.test(file))
        .map((file) => `./${file}`);
      const coreFiles = [
        './',
        './index.html',
        './manifest.webmanifest',
        ...bundledFiles
      ];
      const sourceWorker = readFileSync(
        new URL('./service-worker.js', import.meta.url),
        'utf8'
      );
      const productionWorker = sourceWorker.replace(
        /const CORE_FILES = \[[\s\S]*?\];/,
        `const CORE_FILES = ${JSON.stringify(coreFiles, null, 2)};`
      );
      this.emitFile({
        type: 'asset',
        fileName: 'service-worker.js',
        source: productionWorker
      });
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: readFileSync(new URL('./manifest.webmanifest', import.meta.url))
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [offlineAssets()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local']
  }
});
