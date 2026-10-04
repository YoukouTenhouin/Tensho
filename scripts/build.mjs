import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const controlled = process.argv.includes('--controlled');
const outdir = controlled ? 'dist-controlled' : 'dist';
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir);
await cp('public', outdir, { recursive: true });
await build({ entryPoints: ['src/browser/worker.ts', 'src/browser/page.ts', 'src/browser/panel.ts'],
  outdir, bundle: true, format: 'iife', target: 'chrome154', sourcemap: true,
  plugins: controlled ? [{ name: 'controlled-reading-fixture', setup(build) {
    build.onResolve({ filter: /providers\/whitaker\.ts$/ }, args => {
      if (args.importer === resolve('src/browser/worker.ts')) return { path: resolve('tests/native/controlled_adapter.ts') };
    });
  } }] : [],
});
