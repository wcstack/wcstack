// Builds the self-contained auto bundle (core + formats) and the core alone (the size the
// core <= 20 KB gzip target measures). auto.min.js can be served to the benchmark page in
// place of the current dist/auto.min.js (see bench/run-all.sh).
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { MANGLE_PROPS } from './mangle.mjs';

const entries = [
  ['src/auto.ts', 'dist/auto.min.js'],
  ['src/core-entry.ts', 'dist/core.min.js'],
];
for (const [entry, outfile] of entries) {
  await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile, legalComments: 'none', mangleProps: MANGLE_PROPS });
  const code = readFileSync(outfile);
  console.log(`${outfile}: ${code.length} B, gzip ${gzipSync(code, { level: 9 }).length} B`);
}
