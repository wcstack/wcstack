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
