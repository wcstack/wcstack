// The files the package's `exports` map (the same layout as @wcstack/state 3.x):
// dist/index.esm.js      `.`: the full engine as named exports; bootstrapState() installs every add-on
// dist/auto.min.js       `./auto`: the full engine, self-contained — the CDN one-liner, one integrity
// dist/split/core.js + dist/split/features/*.js + dist/split/chunks/*
//                        `./core` + `./features/*`: ONE esbuild build, so every output shares the
//                        shortened internal names (mangle.mjs) and an add-on reaches the core's
//                        internals directly. Core and add-ons must come from the same build.
// dist/define.js         `./define`: defineState and the types, no runtime
// dist/manifest.esm.js   `./manifest` (+ dist/wcs-manifest.json): tooling, DOM-free
// dist/parser.esm.js     `./parser`: tooling, DOM-free
// dist/*.d.ts, dist/split/**/*.d.ts: the types (rollup-plugin-dts)
// dist/core.min.js       not exported: the core alone, what the core <= 20 KB gzip target measures
//
// The tooling entries are built without shortened names: their results (a parsed binding's
// `statePathName`, the manifest) are read by name outside the bundle.
import { build } from 'esbuild';
import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MANGLE_PROPS } from './mangle.mjs';

export const FEATURES = ['formats', 'diagnostics', 'temporal', 'list-keys', 'scopes', 'recursion', 'ssr', 'devtools'];
const base = { bundle: true, format: 'esm', target: 'es2022', legalComments: 'none' };
const common = { ...base, minify: true, mangleProps: MANGLE_PROPS };
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const report = (file) => console.log(`${file}: ${readFileSync(file).length} B, gzip ${gz(file)} B`);

rmSync('dist', { recursive: true, force: true });

// the runtime entries
for (const [entry, outfile] of [['src/exports.ts', 'dist/index.esm.js'], ['src/auto.ts', 'dist/auto.min.js'], ['src/core-entry.ts', 'dist/core.min.js']]) {
  await build({ ...common, entryPoints: [entry], outfile });
  report(outfile);
}

// the split build
await build({
  ...common,
  entryPoints: { core: 'src/core.ts', ...Object.fromEntries(FEATURES.map((f) => [`features/${f}`, `src/features/${f}.ts`])) },
  outdir: 'dist/split', splitting: true, chunkNames: 'chunks/[name]-[hash]',
});
// what a page loads for an entry: the entry and every chunk it imports, transitively
const closure = (file, seen = new Set()) => {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const m of readFileSync(file, 'utf8').matchAll(/from\s*"(\.[^"]+)"|import\s*"(\.[^"]+)"/g)) closure(resolve(dirname(file), m[1] ?? m[2]), seen);
  return seen;
};
const core = closure(resolve('dist/split/core.js'));
const sum = (files) => [...files].reduce((n, f) => n + gz(f), 0);
console.log(`split: core.js + ${core.size - 1} chunk(s): gzip ${sum(core)} B (per file)`);
for (const f of FEATURES) {
  const own = [...closure(resolve(`dist/split/features/${f}.js`))].filter((x) => !core.has(x));
  console.log(`split: features/${f}.js: gzip ${sum(own)} B beyond the core`);
}

// the authoring and tooling entries
await build({ ...base, minify: true, entryPoints: ['src/public/defineState.ts'], outfile: 'dist/define.js' });
await build({ ...base, entryPoints: ['src/public/manifest.ts'], outfile: 'dist/manifest.esm.js' });
await build({ ...base, entryPoints: ['src/public/parser.ts'], outfile: 'dist/parser.esm.js' });
const { getWcsManifest } = await import(pathToFileURL(resolve('dist/manifest.esm.js')).href);
writeFileSync('dist/wcs-manifest.json', JSON.stringify(getWcsManifest(), null, 2) + '\n');
console.log('dist/wcs-manifest.json written');

// the types
const types = [
  ['src/exports.ts', 'dist/index.d.ts'],
  ['src/core.ts', 'dist/split/core.d.ts'],
  ...FEATURES.map((f) => [`src/features/${f}.ts`, `dist/split/features/${f}.d.ts`]),
  ['src/public/defineState.ts', 'dist/define.d.ts'],
  ['src/public/manifest.ts', 'dist/manifest.d.ts'],
  ['src/public/parser.ts', 'dist/parser.d.ts'],
];
for (const [input, file] of types) {
  const bundle = await rollup({ input, plugins: [dts({ tsconfig: 'tsconfig.json' })], onwarn: (w) => { throw new Error(`${input}: ${w.message}`); } });
  mkdirSync(dirname(file), { recursive: true });
  await bundle.write({ file, format: 'es' });
  await bundle.close();
}
console.log(`types: ${types.length} .d.ts written`);
