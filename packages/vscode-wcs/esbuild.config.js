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
  {
    // @wcstack/typescript が TypeScript 7.1 に渡す content mapper（docs/typescript-content-mapper.md）。
    // TypeScript が `node ./dist/content-mapper.cjs` で起こすので、Node の組み込みだけの単一 CJS。
    // コピー先に .map は置かないので、指す先の無い sourceMappingURL を残さない。
    ...sharedOptions,
    sourcemap: false,
    entryPoints: ['src/contentMapperMain.ts'],
    outdir: 'dist',
    outbase: 'src',
    entryNames: 'content-mapper',
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
