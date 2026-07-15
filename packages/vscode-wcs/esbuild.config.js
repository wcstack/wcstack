import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const sharedOptions = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['vscode', 'typescript'],
  outExtension: { '.js': '.cjs' },
};

const configs = [
  {
    ...sharedOptions,
    entryPoints: ['src/extension.ts'],
    outdir: 'dist',
  },
  {
    ...sharedOptions,
    entryPoints: ['src/server.ts'],
    outdir: 'dist',
  },
  {
    // CI CLI (Phase 5a): pure validator core を bundle して単一 node 実行可能に。
    // @wcstack/state/manifest を inline するので実行時に依存解決を要しない。
    ...sharedOptions,
    entryPoints: ['src/cli.ts'],
    outdir: 'dist',
    banner: { js: '#!/usr/bin/env node' },
  },
];

if (isWatch) {
  for (const config of configs) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
  }
  console.log('Watching for changes...');
} else {
  for (const config of configs) {
    await esbuild.build(config);
  }
  console.log('Build complete.');
}
