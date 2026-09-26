/**
 * public-api.test.ts — @wcstack/state 3.3 の公開面を 4.0 で埋めたもの（入口 `.` の振る舞い）。
 * `.` の bootstrapState() はすべての後付けを入れる（3.3 と同じ）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeContract, bootstrapState, buildBindings, getBindingsReady, getConfig, Ssr, VERSION,
} from "../src/exports";
import { setConfig } from "../src/config";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;
const DEFAULTS = { ...getConfig(), tagNames: { ...getConfig().tagNames } };

beforeAll(() => {
  bootstrapState();
});
afterEach(() => {
  setConfig(DEFAULTS);
});

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`api-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
    await flush();
  };
  return { root, el, write };
}

describe("bootstrapState（入口 `.`）", () => {
  it("すべての後付けを入れる（$watch・$listKeys を installFeatures なしで使える）", async () => {
    const seen: unknown[] = [];
    const { write } = await page(`<p>{{ n }}</p>`, {
      n: 1,
      items: [{ id: 1, v: "a" }],
      $listKeys: { items: "id" },
      $watch: { n(this: any, cur: unknown) { seen.push(cur); } },
    });
    await write((s) => { s.n = 2; });
    expect(seen).toEqual([2]);
  });

  it("第 2 引数の登録簿に <wcs-state> と後付けのタグ（<wcs-ssr>）を定義する", () => {
    const defined = new Map<string, CustomElementConstructor>();
    const registry = { get: (n: string) => defined.get(n), define: (n: string, c: CustomElementConstructor) => { defined.set(n, c); } } as unknown as CustomElementRegistry;
    bootstrapState(undefined, registry);
    expect([...defined.keys()].sort()).toEqual(["wcs-ssr", "wcs-state"]);
    expect(customElements.get("wcs-state")).toBeDefined();
  });
});

describe("getConfig と設定", () => {
  it("既定値が 3.3 と同じ", () => {
    const c = getConfig();
    expect({ ...c, locale: undefined }).toEqual({
      bindAttributeName: "data-wcs",
      commentTextPrefix: "wcs-text", commentForPrefix: "wcs-for", commentIfPrefix: "wcs-if",
      commentElseIfPrefix: "wcs-elseif", commentElsePrefix: "wcs-else",
      tagNames: { state: "wcs-state", ssr: "wcs-ssr" },
      locale: undefined, debug: false, enableMustache: true,
      enableDirectionalInitialSync: true, enablePropagationContext: true, enableContractAnalyzer: false, sameValueGuard: true,
    });
  });

  it("型の違う値は受け取らない", () => {
    setConfig({ debug: "yes" as any, sameValueGuard: 0 as any });
    expect(getConfig().debug).toBe(false);
    expect(getConfig().sameValueGuard).toBe(true);
  });

  it("sameValueGuard: false で同じ値の書き込みも通り、$watch の prev は undefined", async () => {
    const seen: [unknown, unknown][] = [];
    const watch = { n(this: any, cur: unknown, prev: unknown) { seen.push([cur, prev]); } };
    const on = await page(`<p>{{ n }}</p>`, { n: 1, $watch: watch });
    await on.write((s) => { s.n = 1; });
    expect(seen).toEqual([]);
    await on.write((s) => { s.n = 2; });
    expect(seen).toEqual([[2, 1]]);
    setConfig({ sameValueGuard: false });
    seen.length = 0;
    await on.write((s) => { s.n = 2; });
    expect(seen).toEqual([[2, undefined]]);
  });

  it("enableDirectionalInitialSync: false で出力専用メンバーも状態が初期値を渡し、#init= は投げる", async () => {
    const tag = `api-output-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
      status = "ready";
    });
    const directional = await page(`<${tag} data-wcs="status: st"></${tag}><p>{{ st }}</p>`, { st: "seed" });
    expect((directional.root.querySelector(tag) as any).status).toBe("ready");
    expect(directional.root.querySelector("p")!.textContent).toBe("ready");
    setConfig({ enableDirectionalInitialSync: false });
    const legacy = await page(`<${tag} data-wcs="status: st"></${tag}><p>{{ st }}</p>`, { st: "seed" });
    expect((legacy.root.querySelector(tag) as any).status).toBe("seed");
    expect(legacy.root.querySelector("p")!.textContent).toBe("seed");
    // the binding is refused while the page is bound: the element fails to initialize with it
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(page(`<${tag} data-wcs="status#init=element: st"></${tag}>`, { st: "x" }))
      .rejects.toThrow("init=/sync= modifiers require enableDirectionalInitialSync.");
    error.mockRestore();
  });

  it("コメントの接頭辞が構造のアンカーの文字になる", async () => {
    setConfig({ commentForPrefix: "my-for", commentIfPrefix: "my-if", commentElseIfPrefix: "my-elseif", commentElsePrefix: "my-else" });
    const { root } = await page(
      `<ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`
      + `<template data-wcs="if: a"><p>a</p></template><template data-wcs="elseif: b"><p>b</p></template><template data-wcs="else:"><p>c</p></template>`,
      { items: [1], a: false, b: false },
    );
    const comments: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) comments.push((n as Comment).data);
    expect(comments).toEqual(["my-for", "my-if", "my-elseif", "my-else"]);
    expect(root.querySelector("p")!.textContent).toBe("c");
  });
});

describe("SSR（<wcs-ssr> と tagNames.ssr）", () => {
  async function serverRender(html: string, state: Record<string, any>): Promise<string> {
    document.documentElement.setAttribute("data-wcs-server", "orchestrated");
    try {
      const h = document.createElement(`api-server-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = html;
      const el = root.querySelector("wcs-state") as any;
      el.setInitialState(state);
      document.body.appendChild(h);
      await el.connectedCallbackPromise;
      await getBindingsReady(root);
      await flush();
      (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(root);
      const out = root.innerHTML;
      h.remove();
      return out;
    } finally {
      document.documentElement.removeAttribute("data-wcs-server");
    }
  }
  const html = `<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`;

  it("<wcs-ssr> は Ssr 要素で、版・データ・テンプレートを読める", async () => {
    const out = await serverRender(html, { items: ["a", "b"] });
    const host = document.createElement("div");
    host.innerHTML = out;
    const ssr = Ssr.find(host)!;
    expect(ssr).toBeInstanceOf(Ssr);
    expect(ssr.version).toBe(VERSION);
    expect(ssr.verifyVersion()).toBe(true);
    expect(ssr.stateData).toEqual({ items: ["a", "b"] });
    const [id, template] = [...ssr.templates][0];
    expect(template.localName).toBe("template");
    expect(ssr.getTemplate(id)).toBe(template);
    expect(ssr.getTemplate("none")).toBeNull();
    expect(ssr.hydrateProps).toEqual({});
  });

  it("tagNames.ssr の名前でサーバが書き、クライアントが引き取る", async () => {
    setConfig({ tagNames: { ssr: "my-ssr" } });
    const out = await serverRender(html, { items: ["a", "b"] });
    expect(out).toContain("<my-ssr");
    const h = document.createElement(`api-client-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = out;
    const lis = Array.from(root.querySelectorAll("li"));
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ items: ["a", "b"] });
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    expect(Array.from(root.querySelectorAll("li"))).toEqual(lis);
    expect(root.querySelector("my-ssr")).toBeNull();
  });
});

describe("そのほかの export", () => {
  it("buildBindings は根の束ねを待つ", async () => {
    const { root } = await page(`<p>{{ n }}</p>`, { n: 3 });
    await expect(buildBindings(root)).resolves.toBeUndefined();
    expect(root.querySelector("p")!.textContent).toBe("3");
  });

  it("VERSION は package.json の版", () => {
    expect(VERSION).toBe(JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")).version);
  });

  it("analyzeContract: 既定では何もせず、有効にすると登録済みの宣言との食い違いを返す", () => {
    const tag = `api-contract-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "value", event: `${tag}:change` }], inputs: [{ name: "value" }], commands: [{ name: "reset" }] };
    });
    const manifest = {
      manifestExtensions: {
        "wcstack.types": { components: { [tag]: { observables: { value: { event: "other" }, missing: {} }, commands: { reset: {}, play: {} } }, "not-loaded-x": {} } },
        "vendor.thing": {},
      },
    };
    expect(analyzeContract(manifest)).toEqual([]);
    setConfig({ enableContractAnalyzer: true });
    expect(analyzeContract(manifest)).toEqual([
      { type: "contract:unsupported-extension", namespace: "vendor.thing" },
      { type: "contract:manifest-read", tag, loaded: true },
      { type: "contract:drift", reason: "event-mismatch", tag, member: "value", sidecarEvent: "other", liveEvent: `${tag}:change` },
      { type: "contract:drift", reason: "missing-member", tag, member: "missing" },
      { type: "contract:drift", reason: "missing-member", tag, member: "play" },
      { type: "contract:manifest-read", tag: "not-loaded-x", loaded: false },
      { type: "contract:drift", reason: "component-not-loaded", tag: "not-loaded-x" },
    ]);
  });

  it("$errorCallback の bindingType はパーサの分類（class. は prop）", async () => {
    const infos: any[] = [];
    await page(`<p data-wcs="class.hot: bad"></p><p>{{ bad2 }}</p>`, {
      get bad() { throw new Error("x"); },
      get bad2() { throw new Error("y"); },
      $errorCallback(_e: unknown, info: any) { infos.push({ path: info.path, bindingType: info.bindingType }); },
    });
    await flush();
    expect(infos).toEqual([{ path: "bad", bindingType: "prop" }, { path: "bad2", bindingType: "text" }]);
  });
});
