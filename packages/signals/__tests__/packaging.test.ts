// Packaging regression: the built `index` and `dom` entries must share ONE
// reactive core chunk (docs §8 (f) / migration-plan Phase 1).
//
// The core duplication bug is a BUNDLING artifact, not a source-level one: at
// source level there is a single `reactive.ts` module, so any test importing from
// `src/` always shares the core. Only the BUILT bundles can split it. Hence this
// test runs against `dist/` and is skipped when the package has not been built.
//
// Two checks, cheap → behavioral:
//   1. static — both entry files import the SAME core chunk filename.
//   2. behavioral — a signal created via the `index` entry is observed by an
//      `effect` from the `dom` entry, proving a single tracking context.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "../dist");
const indexFile = resolve(distDir, "index.esm.js");
const domFile = resolve(distDir, "dom.esm.js");
const built = existsSync(indexFile) && existsSync(domFile);

/** Extract the `./core-*.esm.js` chunk specifier an entry imports/re-exports. */
function coreChunkOf(file: string): string | null {
  const src = readFileSync(file, "utf8");
  const match = src.match(/from\s*["'](\.\/core-[^"']+\.esm\.js)["']/);
  return match ? match[1] : null;
}

describe.skipIf(!built)("packaging: index と dom は単一 reactive コアを共有する", () => {
  it("両エントリが同一の core チャンクを参照する（静的検証）", () => {
    const indexChunk = coreChunkOf(indexFile);
    const domChunk = coreChunkOf(domFile);
    expect(indexChunk).not.toBeNull();
    expect(domChunk).not.toBeNull();
    expect(domChunk).toBe(indexChunk);
  });

  it("index 由来の signal を dom 由来の effect が購読できる（単一 tracking context）", async () => {
    const core = await import(pathToFileURL(indexFile).href);
    const dom = await import(pathToFileURL(domFile).href);

    const s = core.signal(0);
    let seen = -1;
    dom.effect(() => {
      seen = s.get();
    });
    dom.flushSync();
    expect(seen).toBe(0);

    // If the two entries carried separate core copies, this signal write would mark
    // observers in the `index` core while the effect lives in the `dom` core — the
    // effect would never re-run and `seen` would stay 0.
    s.set(42);
    dom.flushSync();
    expect(seen).toBe(42);
  });
});
