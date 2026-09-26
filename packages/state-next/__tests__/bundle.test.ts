/**
 * The conformance scenarios on a bundle built the way dist is (minified, internal property
 * names shortened by mangle.mjs): a shortened name that something outside the bundle
 * still reads — the DOM, a protocol, a declaration — shows up here and nowhere else.
 * vitest isolates this file, so its <wcs-state> does not collide with the source one.
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
let entry: { getBindingsReady(root: Node): Promise<void> };
let seq = 0;

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
  m.installFeatures([m.temporal, m.listKeys, m.scopes, m.recursion, m.ssr, m.devtools]);
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

describe("縮めたバンドルでの DevTools の面（外へ渡すキーは縮められない）", () => {
  it("ソース・要素の一覧・引き出し・イベントのキーがプロトコルの名前のまま", async () => {
    const reg = (globalThis as any).__WCSTACK_DEVTOOLS_HOOK__;
    expect(reg.version).toBe(2);
    const src = [...reg.sources.values()][0];
    expect(src.kind).toBe("state");
    const events: any[] = [];
    const off = reg.addListener({ onEvent: (_: string, e: any) => events.push(e) });
    try {
      const h = document.createElement(`bundle-devtools-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`;
      const el = root.querySelector("wcs-state") as any;
      const a = { v: 1 };
      el.setInitialState({ items: [a], $commandTokens: ["go"] });
      document.body.appendChild(h);
      await el.connectedCallbackPromise;
      await entry.getBindingsReady(root);
      el.createState("writable", (s: any) => { s.items = [a, { v: 2 }]; });
      el.createState("readonly", (s: any) => { s.$command.go.emit(1); });
      await new Promise((r) => setTimeout(r, 0));
      const sum = src.getStateElements().find((x: any) => x.rootNode === root);
      expect([...sum.paths.list]).toEqual(["items"]);
      expect([...sum.commandTokenNames]).toEqual(["go"]);
      expect(src.keys(root)).toEqual(["items"]);
      expect(src.read(root, "items.*.v", [1])).toBe(2);
      const write = events.find((e) => e.type === "state:write");
      expect(write.absoluteAddress.absolutePathInfo.pathInfo.path).toBe("items");
      expect(write.hasOldValue).toBe(true);
      const added = events.filter((e) => e.type === "state:binding-added");
      expect(added.map((e) => `${e.binding.propName}:${e.binding.statePathName}:${e.absoluteAddress.listIndex?.indexes ?? ""}`))
        .toEqual(expect.arrayContaining(["for:items:", "textContent:items.*.v:0", "textContent:items.*.v:1"]));
      expect(events.find((e) => e.type === "state:token-emit")).toMatchObject({ kind: "command", tokenName: "go", args: [1], subscriberCount: 0 });
    } finally {
      off();
    }
  });
});
