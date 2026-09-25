/**
 * The conformance scenarios on a bundle built the way dist is (minified, internal property
 * names shortened by mangle.mjs): a shortened name that something outside the bundle
 * still reads — the DOM, a protocol, a declaration — shows up here and nowhere else.
 * vitest isolates this file, so its <wcs-state> does not collide with the source one.
 */
import { describe, it, beforeAll } from "vitest";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { scenarios } from "../conformance/scenarios";
import { runScenario } from "../conformance/run";
import { expectGolden } from "../conformance/compare";
// @ts-ignore — a plain ES module next to build.mjs
import { MANGLE_PROPS } from "../mangle.mjs";

const golden = JSON.parse(readFileSync(resolve(__dirname, "golden/current-3.3.0.json"), "utf8"));
let entry: { getBindingsReady(root: Node): Promise<void> };

beforeAll(async () => {
  const dir = resolve(__dirname, "../node_modules/.cache/state-next");
  mkdirSync(dir, { recursive: true });
  const outfile = resolve(dir, "index.bundle.mjs");
  await build({
    entryPoints: [resolve(__dirname, "../src/index.ts")], bundle: true, minify: true, format: "esm",
    target: "es2022", outfile, legalComments: "none", mangleProps: MANGLE_PROPS, logLevel: "error",
  });
  const m = await import(/* @vite-ignore */ `${pathToFileURL(outfile).href}?t=${Date.now()}`);
  m.installFormats();
  m.installFeatures([m.temporal, m.listKeys, m.scopes]);
  m.bootstrapState();
  entry = m;
}, 60000);

describe("縮めたバンドルでの突き合わせ（ゴールデン）", () => {
  for (const s of scenarios) {
    it(s.name, async () => {
      expectGolden(s, await runScenario(s, entry), golden.scenarios[s.name]);
    });
  }
});
