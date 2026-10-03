/**
 * The split auto entry (`dist/split/auto.js`) as a page loads it: one esbuild build of the core,
 * `auto` and `features/*` (the build.mjs options), then the built `auto.js` imported with the
 * page's markup in place. The add-ons it loads come from `./features/` beside it.
 * vitest isolates this file: its `<wcs-state>` definition and add-ons stay here.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loader } from "../src/load";
// @ts-ignore — a plain ES module next to build.mjs
import { MANGLE_PROPS } from "../mangle.mjs";
// @ts-ignore — the second minifier pass build.mjs runs
import { terse } from "../minify.mjs";

const FEATURES = ["formats", "diagnostics", "temporal", "list-keys", "scopes", "recursion", "ssr", "devtools"];
const outdir = resolve(__dirname, "../node_modules/.cache/state-next/split-auto");
const autoUrl = pathToFileURL(resolve(outdir, "auto.js")).href;
const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;
/** Evaluates the built `auto.js` again (its chunks, and so the core, stay the same instances). */
const runAuto = () => import(/* @vite-ignore */ `${autoUrl}?run=${seq++}`);

beforeAll(async () => {
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  await build({
    entryPoints: {
      core: resolve(__dirname, "../src/core.ts"),
      auto: resolve(__dirname, "../src/split-auto.ts"),
      ...Object.fromEntries(FEATURES.map((f) => [`features/${f}`, resolve(__dirname, `../src/features/${f}.ts`)])),
    },
    outdir, splitting: true, chunkNames: "chunks/[name]-[hash]", bundle: true, minify: true, format: "esm",
    target: "es2022", legalComments: "none", mangleProps: MANGLE_PROPS, logLevel: "error",
  });
  for (const f of readdirSync(outdir, { recursive: true })) if (String(f).endsWith(".js")) await terse(resolve(outdir, String(f)));
  document.body.innerHTML = `<wcs-state features="scopes temporal"></wcs-state><p id="n">{{ n }}</p><p id="user">{{ user.name }}</p><wcs-state mount="user"></wcs-state>`;
  await runAuto();
}, 60000);

afterEach(() => {
  Reflect.deleteProperty(document, "readyState");
});

describe("分割 auto のビルド", () => {
  it("auto.js は自分の import.meta.url から features/ を指し、どのファイルからも import されない", () => {
    expect(readFileSync(resolve(outdir, "auto.js"), "utf8")).toContain("import.meta.url");
    for (const f of readdirSync(outdir, { recursive: true })) {
      if (!String(f).endsWith(".js")) continue;
      expect(readFileSync(resolve(outdir, String(f)), "utf8")).not.toMatch(/["'](?:\.\.?\/)+auto\.js["']/);
    }
  });
});

describe("root の features 属性", () => {
  it("scopes・temporal を define の前に入れる: ボリュームが接ぎ木され、$watch が動く", async () => {
    const [root, volume] = Array.from(document.querySelectorAll("wcs-state")) as any[];
    const seen: unknown[] = [];
    root.setInitialState({ n: 1, $watch: { n(cur: unknown) { seen.push(cur); } } });
    volume.setInitialState({ name: "ann" });
    await root.connectedCallbackPromise;
    await volume.connectedCallbackPromise;
    await flush();
    expect(document.getElementById("n")!.textContent).toBe("1");
    expect(document.getElementById("user")!.textContent).toBe("ann");
    root.createState("writable", (s: any) => { s.n = 2; });
    await flush();
    await flush();
    expect(seen).toEqual([2]);
  });

  it("知らない名前は [wcs/feature-unknown] で、エントリの評価が失敗する", async () => {
    const root = document.querySelector("wcs-state")!;
    root.setAttribute("features", "scopes nope");
    try {
      await expect(runAuto()).rejects.toThrow('[wcs/feature-unknown] "nope" is not an add-on');
    } finally {
      root.setAttribute("features", "scopes temporal");
    }
  });

  it("文書の解析中（async の module script）は DOMContentLoaded を待ってから読む", async () => {
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });
    // the import may take longer than a task under load: dispatch only once the entry waits
    const add = document.addEventListener.bind(document);
    let waiting!: () => void;
    const waited = new Promise<void>((resolve) => { waiting = resolve; });
    const spy = vi.spyOn(document, "addEventListener").mockImplementation((type: string, listener: any, options?: any) => {
      add(type, listener, options);
      if (type === "DOMContentLoaded") waiting();
    });
    try {
      let done = false;
      const running = runAuto().then(() => { done = true; });
      await waited;
      await flush();
      expect(done).toBe(false);
      document.dispatchEvent(new Event("DOMContentLoaded"));
      await running;
      expect(done).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("状態の $features", () => {
  it("足りない後付け（list-keys・formats）を、エンジンを作る前に同じビルドから読み込む", async () => {
    const h = document.createElement("split-auto-host");
    const shadow = h.attachShadow({ mode: "open" });
    shadow.innerHTML = `<wcs-state></wcs-state><p>{{ name|upper }}</p><ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`;
    const el = shadow.querySelector("wcs-state") as any;
    el.setInitialState({ name: "ann", items: [{ id: 1, v: "a" }], $listKeys: { items: "id" }, $features: ["list-keys", "formats"] });
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await flush();
    expect(shadow.querySelector("p")!.textContent).toBe("ANN");
    expect(shadow.querySelector("li")!.textContent).toBe("a");
  });

  it("知らない名前は [wcs/feature-unknown] で、その要素の初期化が失敗する", async () => {
    const h = document.createElement("split-auto-host-unknown");
    const shadow = h.attachShadow({ mode: "open" });
    shadow.innerHTML = `<wcs-state></wcs-state>`;
    const el = shadow.querySelector("wcs-state") as any;
    el.setInitialState({ $features: ["temporl"] });
    const error = console.error;
    console.error = () => {};
    try {
      document.body.appendChild(h);
      await expect(el.connectedCallbackPromise).rejects.toThrow('[wcs/feature-unknown] "temporl"');
    } finally {
      console.error = error;
    }
  });
});

describe("loader（src/load.ts）", () => {
  it("base の隣の features/ から既定の export を読み、許可リストに無い名前は拒む", async () => {
    const load = loader(autoUrl);
    const [formats, scopes] = await load(["formats", "scopes"]);
    expect([formats.name, scopes.name]).toEqual(["formats", "scopes"]);
    await expect(load(["../core"])).rejects.toThrow('[wcs/feature-unknown] "../core"');
  });
});
