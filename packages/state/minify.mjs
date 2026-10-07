// The second minifier pass over esbuild's output (the runtime bundles and every file of the split
// build). esbuild bundles, drops the types and shortens the internal property names (mangle.mjs);
// terser then renames the identifiers by how often they occur and folds what esbuild leaves, which
// gzip rewards: about 1.2 KB off the core, 2.2 KB off `auto` (measured 2026-09-27). Property names
// are left alone (the split build's add-ons reach the core by the names esbuild gave), and so are
// the export names. No `unsafe` transform.
//
// __tests__/bundle.test.ts and split.test.ts run the conformance scenarios on files passed
// through this too.
//
// A file esbuild wrote a source map for keeps one: terser reads esbuild's map and writes the chained
// map in its place (still pointing into src, the TypeScript sources embedded), and ends the file
// with its `//# sourceMappingURL=` comment.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { minify } from 'terser';

export const TERSER = { module: true, ecma: 2022, compress: { passes: 2 }, mangle: true, format: { comments: false } };

/** Rewrites an esbuild-minified file in place, and the source map beside it when there is one. */
export async function terse(file) {
  const mapFile = `${file}.map`;
  const map = existsSync(mapFile) ? readFileSync(mapFile, 'utf8') : null;
  const sourceMap = map === null ? undefined : { content: map, url: `${basename(file)}.map`, includeSources: true };
  const { code, map: chained } = await minify(readFileSync(file, 'utf8'), { ...TERSER, sourceMap });
  writeFileSync(file, code);
  if (map !== null) writeFileSync(mapFile, chained);
}
