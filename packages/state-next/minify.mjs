// The second minifier pass over esbuild's output (the runtime bundles and every file of the split
// build). esbuild bundles, drops the types and shortens the internal property names (mangle.mjs);
// terser then renames the identifiers by how often they occur and folds what esbuild leaves, which
// gzip rewards: about 1.2 KB off the core, 2.2 KB off `auto` (measured 2026-09-27). Property names
// are left alone (the split build's add-ons reach the core by the names esbuild gave), and so are
// the export names. No `unsafe` transform.
//
// __tests__/bundle.test.ts and split.test.ts run the conformance scenarios on files passed
// through this too.
import { readFileSync, writeFileSync } from 'node:fs';
import { minify } from 'terser';

export const TERSER = { module: true, ecma: 2022, compress: { passes: 2 }, mangle: true, format: { comments: false } };

/** Rewrites an esbuild-minified file in place. */
export async function terse(file) {
  const { code } = await minify(readFileSync(file, 'utf8'), TERSER);
  writeFileSync(file, code);
}
