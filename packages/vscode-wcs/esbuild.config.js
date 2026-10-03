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
  {
    // @wcstack/typescript（wcs-schema）が同梱する validator core。cli.cjs と同じく
    // 自己完結の単一 CJS。lint と同じ「vscode-wcs をビルドしてコピー」経路で配る。
    ...sharedOptions,
    entryPoints: ['src/schemaCore.ts'],
    outdir: 'dist',
    outbase: 'src',
    entryNames: 'schema-core',
  },
  {
    // @wcstack/typescript（wcs-tsc）が同梱する Language Plugin。@volar/* は型 import
    // だけなので、vscode-uri を含めて自己完結の単一 CJS になる。
    ...sharedOptions,
    external: [...sharedOptions.external, '@volar/language-core', '@volar/typescript'],
    entryPoints: ['src/tscCore.ts'],
    outdir: 'dist',
    outbase: 'src',
    entryNames: 'tsc-core',
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
