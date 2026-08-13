import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import viteConfig from '../vite.config.js';

const root = resolve(import.meta.dirname, '..');

test('offline core cache includes every application module', async () => {
  const worker = await readFile(resolve(root, 'service-worker.js'), 'utf8');
  const match = worker.match(/const CORE_FILES = (\[[\s\S]*?\]);/);
  assert.ok(match, 'CORE_FILES was not found');
  const files = JSON.parse(match[1].replaceAll("'", '"'));
  const required = [
    './',
    './index.html',
    './styles.css',
    './src/app.js',
    './src/data.js',
    './src/kinematics.js',
    './src/renderer.js',
    './manifest.webmanifest'
  ];

  assert.deepEqual(files, required);
  for (const file of files.filter((item) => item !== './')) {
    await access(resolve(root, file));
  }
});

test('offline cache version is bumped for the continuous mechanics rebuild', async () => {
  const worker = await readFile(resolve(root, 'service-worker.js'), 'utf8');
  assert.match(worker, /rift-form-lab-v12/);
});

test('production build emits a worker that caches bundled assets', () => {
  assert.equal(viteConfig.base, './');
  const emitted = [];
  const plugin = viteConfig.plugins.find((item) => item.name === 'rift-offline-assets');
  assert.ok(plugin);
  plugin.generateBundle.call(
    { emitFile: (file) => emitted.push(file) },
    {},
    {
      'index.html': {},
      'assets/app.js': {},
      'assets/app.css': {},
      'assets/manifest-example.webmanifest': {}
    }
  );
  const worker = emitted.find((item) => item.fileName === 'service-worker.js');
  const manifest = emitted.find((item) => item.fileName === 'manifest.webmanifest');
  assert.ok(worker && manifest);
  assert.match(worker.source, /\.\/assets\/app\.js/);
  assert.match(worker.source, /\.\/assets\/app\.css/);
  assert.match(worker.source, /\.\/assets\/manifest-example\.webmanifest/);
});
