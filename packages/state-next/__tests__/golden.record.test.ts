/**
 * Records the golden output of the conformance scenarios from the 3.x engine
 * (@wcstack/state 3.3.0, its checked-in dist, when it was recorded). Runs only with WCS_GOLDEN=1
 * (`npm run golden`); vitest isolates this file, so the 3.x engine's <wcs-state>
 * does not collide with the 4.0 one's.
 *
 * Since the 4.0 swap (docs/state-engine-rewrite/v4-remaining.ja.md R1) packages/state/dist is the
 * 4.0 engine, so the golden is frozen: recording from a 4.0 dist would compare 4.0 with itself, and
 * this refuses one (its wcs-manifest.json declares `behaviorOptions`, which 3.x's does not).
 * WCS_GOLDEN_DIST names a 3.x dist to record from instead (e.g. an unpacked `npm pack @wcstack/state@3`).
 */
import { it } from "vitest";
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scenarios } from "../conformance/scenarios";
import { runScenario } from "../conformance/run";

export const GOLDEN_PATH = resolve(__dirname, "golden/current-3.3.0.json");

/** The 3.x dist to record from: WCS_GOLDEN_DIST, or the checked-in packages/state/dist. */
const DIST = process.env.WCS_GOLDEN_DIST ? resolve(process.env.WCS_GOLDEN_DIST) : resolve(__dirname, "../../state/dist");

/** Throws unless `dist` is a 3.x @wcstack/state dist. */
export function assert3xDist(dist: string): void {
  const manifest = join(dist, "wcs-manifest.json");
  if (!existsSync(manifest) || !existsSync(join(dist, "index.esm.js"))) {
    throw new Error(`${dist} is not a @wcstack/state dist (no wcs-manifest.json / index.esm.js): set WCS_GOLDEN_DIST to a 3.x dist`);
  }
  if ("behaviorOptions" in JSON.parse(readFileSync(manifest, "utf8"))) {
    throw new Error(`${dist} is a 4.0 dist: the golden is recorded from 3.x and is frozen since the 4.0 swap — set WCS_GOLDEN_DIST to a 3.x dist`);
  }
}

it.skipIf(process.env.WCS_GOLDEN !== "1")("3.x の DOM をゴールデンとして記録する", async () => {
  assert3xDist(DIST);
  // copied under node_modules as .mjs, as public-surface.test.ts does with the 3.x parser (vitest
  // does not load a module from outside the package; the 3.x bundle has no imports of its own)
  const copy = resolve(__dirname, "../node_modules/.cache/state-next/golden-3x.mjs");
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(join(DIST, "index.esm.js"), copy);
  const current = await import(/* @vite-ignore */ `${pathToFileURL(copy).href}?t=${Date.now()}`);
  current.bootstrapState();
  const out: Record<string, unknown> = {};
  for (const s of scenarios) out[s.name] = await runScenario(s, current);
  mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
  writeFileSync(GOLDEN_PATH, JSON.stringify({ engine: `@wcstack/state ${current.VERSION ?? "3.3.0"} (dist/index.esm.js)`, recordedAt: new Date().toISOString(), scenarios: out }, null, 2) + "\n");
}, 60000);
