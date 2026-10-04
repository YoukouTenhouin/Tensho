import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await cp('public', 'dist', { recursive: true });
await build({ entryPoints: ['src/browser/worker.ts', 'src/browser/page.ts', 'src/browser/panel.ts'],
  outdir: 'dist', bundle: true, format: 'iife', target: 'chrome154', sourcemap: true });
