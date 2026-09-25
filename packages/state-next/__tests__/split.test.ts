/**
 * The conformance scenarios on the split build (`core.js` + `features/*.js` + shared chunks, one
 * esbuild build with the shortened internal names): the add-ons, loaded as separate modules,
 * must reach the core through the names the build shortened. vitest isolates this file.
 */
import { describe, it, expect, beforeAll } from "vitest";
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
const FEATURES = ["formats", "diagnostics", "temporal", "list-keys", "scopes", "recursion"];
let entry: { getBindingsReady(root: Node): Promise<void> };

beforeAll(async () => {
  const outdir = resolve(__dirname, "../node_modules/.cache/state-next/split");
  mkdirSync(outdir, { recursive: true });
  await build({
    entryPoints: { core: resolve(__dirname, "../src/core.ts"), ...Object.fromEntries(FEATURES.map((f) => [`features/${f}`, resolve(__dirname, `../src/features/${f}.ts`)])) },
    outdir, splitting: true, chunkNames: "chunks/[name]-[hash]", bundle: true, minify: true, format: "esm",
    target: "es2022", legalComments: "none", mangleProps: MANGLE_PROPS, logLevel: "error",
  });
  const load = (file: string) => import(/* @vite-ignore */ `${pathToFileURL(resolve(outdir, file)).href}?t=${Date.now()}`);
  const core = await load("core.js");
  const features = await Promise.all(FEATURES.map(async (f) => (await load(`features/${f}.js`)).default));
  core.installFeatures(features);
  core.bootstrapState();
  entry = core;
}, 60000);

describe("分割ビルド（core.js ＋ features）での突き合わせ（ゴールデン）", () => {
  for (const s of scenarios) {
    it(s.name, async () => {
      expectGolden(s, await runScenario(s, entry), golden.scenarios[s.name]);
    });
  }
});

describe("分割ビルドの後付けがコアの受け口に届く", () => {
  it("features/diagnostics.js が入れた助言が、core.js のエラーに付く", async () => {
    const messages: string[] = [];
    const h = document.createElement("split-test-host");
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ cout }}</p>`;
    (root.querySelector("wcs-state") as any).setInitialState({
      count: 1,
      $errorCallback(error: Error) { messages.push(error.message); },
    });
    document.body.appendChild(h);
    await (root.querySelector("wcs-state") as any).connectedCallbackPromise;
    await entry.getBindingsReady(root);
    await new Promise((r) => setTimeout(r, 0));
    expect(messages).toEqual([expect.stringMatching(/\[wcs\/binding-path-missing\] .* Did you mean "count"\? Validate statically/)]);
    h.remove();
  });
});
