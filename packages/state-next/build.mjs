// dist/auto.min.js  the full engine, self-contained (core + every add-on): the CDN one-liner, one
//                   integrity attribute (the benchmark serves it in place of @wcstack/state's)
// dist/core.min.js  the core alone, self-contained: what the core <= 20 KB gzip target measures
// dist/core.js + dist/features/*.js + dist/chunks/*
//                   the split build: ONE esbuild build, so every output shares the shortened
//                   internal names (mangle.mjs) and an add-on reaches the core's internals
//                   directly. Core and add-ons must come from the same build.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MANGLE_PROPS } from './mangle.mjs';

export const FEATURES = ['formats', 'diagnostics', 'temporal', 'list-keys', 'scopes'];
const common = { bundle: true, minify: true, format: 'esm', target: 'es2022', legalComments: 'none', mangleProps: MANGLE_PROPS };
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;

rmSync('dist', { recursive: true, force: true });
for (const [entry, outfile] of [['src/auto.ts', 'dist/auto.min.js'], ['src/core-entry.ts', 'dist/core.min.js']]) {
  await build({ ...common, entryPoints: [entry], outfile });
  console.log(`${outfile}: ${readFileSync(outfile).length} B, gzip ${gz(outfile)} B`);
}

await build({
  ...common,
  entryPoints: { core: 'src/core.ts', ...Object.fromEntries(FEATURES.map((f) => [`features/${f}`, `src/features/${f}.ts`])) },
  outdir: 'dist', splitting: true, chunkNames: 'chunks/[name]-[hash]',
});
// what a page loads for an entry: the entry and every chunk it imports, transitively
const closure = (file, seen = new Set()) => {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const m of readFileSync(file, 'utf8').matchAll(/from\s*"(\.[^"]+)"|import\s*"(\.[^"]+)"/g)) closure(resolve(dirname(file), m[1] ?? m[2]), seen);
  return seen;
};
const core = closure(resolve('dist/core.js'));
const sum = (files) => [...files].reduce((n, f) => n + gz(f), 0);
console.log(`split: core.js + ${core.size - 1} chunk(s): gzip ${sum(core)} B (per file)`);
for (const f of FEATURES) {
  const own = [...closure(resolve(`dist/features/${f}.js`))].filter((x) => !core.has(x));
  console.log(`split: features/${f}.js: gzip ${sum(own)} B beyond the core`);
}
