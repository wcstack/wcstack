// Builds the self-contained auto bundle (dirty strategy) and, for the record, the spike's
// version-strategy bundle. Either can be served to the benchmark page in place of the
// current dist/auto.min.js (see bench/run-all.sh).
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const entries = [
  ['src/auto.ts', 'dist/auto.min.js'],
  ['src/core-entry.ts', 'dist/core.min.js'],
  ['src/auto.delegate.ts', 'dist/auto.delegate.min.js'],
  ['src/auto.version.ts', 'dist/auto.version.min.js'],
];
for (const [entry, outfile] of entries) {
  await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile, legalComments: 'none' });
  const code = readFileSync(outfile);
  console.log(`${outfile}: ${code.length} B, gzip ${gzipSync(code, { level: 9 }).length} B`);
}
