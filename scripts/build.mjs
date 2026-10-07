import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const controlled = process.argv.includes('--controlled');
const recovery = process.argv.includes('--recovery');
const lifecycle = process.argv.includes('--lifecycle');
const outdir = lifecycle ? 'dist-lifecycle' : recovery ? 'dist-recovery' : controlled ? 'dist-controlled' : 'dist';
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir);
await cp('public', outdir, { recursive: true });
await build({ entryPoints: ['src/browser/worker.ts', 'src/browser/page.ts', 'src/browser/panel.ts', 'src/browser/options.ts'],
  outdir, bundle: true, format: 'iife', target: 'chrome154', sourcemap: true,
  plugins: controlled || recovery || lifecycle ? [{ name: 'controlled-reading-fixture', setup(build) {
    build.onResolve({ filter: /providers\/catalog\.ts$/ }, args => {
      if (!lifecycle && args.importer === resolve('src/browser/worker.ts')) return { path: resolve(recovery ? 'tests/native/recovery_catalog.ts' : 'tests/native/controlled_catalog.ts') };
    });
    build.onResolve({ filter: /providers\/integrated\.ts$/ }, args => {
      if (args.importer === resolve('src/browser/worker.ts')) return { path: resolve(lifecycle ? 'tests/native/lifecycle_integrated.ts' : recovery ? 'tests/native/recovery_integrated.ts' : 'tests/native/controlled_integrated.ts') };
    });
  } }] : [],
});
