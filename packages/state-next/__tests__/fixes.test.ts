/**
 * fixes.test.ts — カバレッジの作業で見つかった不具合（docs/state-engine-rewrite/v4-remaining.ja.md §2.5）の修正。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, DirtyStrategy, Engine, getBindingsReady, installFeatures, mount, recursion, scopes, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes, recursion]);
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`fix-page-${seq++}`);
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
  const read = (path: string) => {
    let v: unknown;
    el.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  return { root, el, write, read };
}

/** A component whose `<wcs-state bind-component="state">` sits in its shadow root. */
function component(markup: string, state: () => Record<string, any>): string {
  const tag = `fix-cmp-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    state = state();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${markup}`;
    }
  });
  return tag;
}

const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);

describe("F1 行の中で別のリストのワイルドカードのパスを読み書きしても、今いる行（別のリスト）に解決しない", () => {
  it("読みは今いる行のリストの値を返さない（文脈が無いのと同じく undefined）", async () => {
    const { root } = await page(`<ul><template data-wcs="for: a"><li>{{ .z }}</li></template></ul>`, {
      a: [{ y: "A0" }], b: [{ y: "B0" }],
      get "a.*.z"() { return String((this as any)["b.*.y"]); },
    });
    expect(texts(root, "li")).toEqual(["undefined"]);
  });

  it("書きは別のリストのデータを壊さず、行が無いとして投げる", async () => {
    const errors: string[] = [];
    const { root, read } = await page(`<ul><template data-wcs="for: a"><li data-wcs="onclick: put">{{ .y }}</li></template></ul>`, {
      a: [{ y: "A0" }], b: [{ y: "B0" }],
      put(this: any) { try { this["b.*.y"] = "written"; } catch (e) { errors.push((e as Error).message); } },
    });
    (root.querySelector("li") as HTMLElement).click();
    await flush();
    expect(read("a.0.y")).toBe("A0");
    expect(read("b.0.y")).toBe("B0");
    expect(texts(root, "li")).toEqual(["A0"]);
    expect(errors).toEqual(['[@wcstack/state] #3 "b.*.y"']);
  });

  it("同じリストの行の中なら、これまでどおりその行に解決する", async () => {
    const { root, write } = await page(`<ul><template data-wcs="for: b"><li>{{ .z }}</li></template></ul>`, {
      b: [{ y: "B0" }, { y: "B1" }],
      get "b.*.z"() { return (this as any)["b.*.y"] + "!"; },
    });
    expect(texts(root, "li")).toEqual(["B0!", "B1!"]);
    await write((s) => { s["b.1.y"] = "X"; });
    expect(texts(root, "li")).toEqual(["B0!", "X!"]);
  });
});

describe("F2 マウントした入れ子のパスの下の getter が値を読める", () => {
  it("state.info: user で、コンポーネントの info.sub.upper がホストの user.sub.name を読む", async () => {
    const tag = component(`<p>{{ info.sub.upper }}</p>`, () => ({
      get "info.sub.upper"() { return String((this as any)["info.sub.name"]).toUpperCase(); },
    }));
    const { root, write } = await page(`<${tag} data-wcs="state.info: user"></${tag}>`, { user: { sub: { name: "al" } } });
    const shown = () => ((root.querySelector(tag) as any).shadowRoot as ShadowRoot).querySelector("p")!.textContent;
    expect(shown()).toBe("AL");
    await write((s) => { s["user.sub.name"] = "bo"; });
    expect(shown()).toBe("BO");
  });
});

describe("F3 入れ子の行の getter の $eqIndex（level 1 と 2）が、選択の書き込みと並べ替えに追従する", () => {
  const html = `<template data-wcs="for: groups"><section><template data-wcs="for: .items"><i>{{ .label }}:{{ .cur }}</i></template></section></template>`;
  const groups = () => [{ items: [{ label: "a" }, { label: "b" }] }, { items: [{ label: "c" }, { label: "d" }] }];

  it("level 2（内側の添字）: 選択を書くと、どの組でもその添字の行が選ばれる", async () => {
    const { root, write } = await page(html, {
      sel: 0, groups: groups(),
      get "groups.*.items.*.cur"() { return (this as any).$eqIndex("sel", 2); },
    });
    expect(texts(root, "i")).toEqual(["a:true", "b:false", "c:true", "d:false"]);
    await write((s) => { s.sel = 1; });
    expect(texts(root, "i")).toEqual(["a:false", "b:true", "c:false", "d:true"]);
    // the inner list reordered: the row now at the selected index is the selected one
    await write((s) => { s["groups.0.items"] = s["groups.0.items"].toReversed(); });
    expect(texts(root, "i")).toEqual(["b:false", "a:true", "c:false", "d:true"]);
  });

  it("level 1（外側の添字）: 選択を書くと、その組の行がすべて選ばれる", async () => {
    const { root, write } = await page(html, {
      sel: 0, groups: groups(),
      get "groups.*.items.*.cur"() { return (this as any).$eqIndex("sel", 1); },
    });
    expect(texts(root, "i")).toEqual(["a:true", "b:true", "c:false", "d:false"]);
    await write((s) => { s.sel = 1; });
    expect(texts(root, "i")).toEqual(["a:false", "b:false", "c:true", "d:true"]);
    await write((s) => { s.groups = s.groups.toReversed(); });
    expect(texts(root, "i")).toEqual(["c:false", "d:false", "a:true", "b:true"]);
  });
});

describe("F6 state= が指す JSON の script が空なら、空の状態で始める", () => {
  function load(body: string) {
    const h = document.createElement(`fix-page-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<script type="application/json" id="s">${body}</script><wcs-state state="s"></wcs-state>`;
    const el = root.querySelector("wcs-state") as any;
    document.body.appendChild(h);
    return el;
  }

  it("中身が空なら {} として初期化する（3.3 と同じ）", async () => {
    const el = load("");
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    let keys: string[] = [];
    el.createState("readonly", (s: any) => { keys = Object.keys(s); });
    expect(keys).toEqual([]);
  });

  it("空白だけは JSON ではないので投げる（3.3 と同じ）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = load("   ");
    await expect(el.connectedCallbackPromise).rejects.toThrow(SyntaxError);
    error.mockRestore();
  });
});

describe("F4 落ち着かない更新を打ち切ったあとも、getter の束縛とその上の for に書き込みが届く", () => {
  it("打ち切りで捨てた束縛の getter は、次の書き込みで再評価される", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = `<div id="d" data-wcs="foo: n"></div>
      <p>{{ double }}</p><b>{{ quad }}</b>
      <ol><template data-wcs="for: rows"><li>{{ . }}</li></template></ol>
      <ul><template data-wcs="for: items"><li>{{ .scaled }}</li></template></ul>`;
    const d = document.getElementById("d") as any;
    let e!: Engine;
    let stop = false;
    // an element property whose setter writes state back: every apply produces more work
    Object.defineProperty(d, "foo", {
      get() { return undefined; },
      set(v: number) { if (!stop) e.proxy.n = v + 1; },
      configurable: true,
    });
    e = new Engine({
      n: 0,
      get double() { return (this as any).n * 2; },
      get quad() { return (this as any).double * 2; },
      get rows() { return [(this as any).n]; },
      items: [{ k: 1 }, { k: 2 }],
      get "items.*.scaled"() { return (this as any)["items.*.k"] * (this as any).n; },
    }, new DirtyStrategy());
    mount(e, document);
    await flush();
    expect(error).toHaveBeenCalledTimes(1);
    stop = true;
    e.proxy.n = 100;
    await flush();
    const texts = (sel: string) => Array.from(document.querySelectorAll(sel)).map((n) => n.textContent);
    expect([texts("p"), texts("b"), texts("ol li"), texts("ul li")]).toEqual([["200"], ["400"], ["100"], ["100", "200"]]);
    e.proxy.n = 7;
    await flush();
    expect([texts("p"), texts("b"), texts("ol li"), texts("ul li")]).toEqual([["14"], ["28"], ["7"], ["7", "14"]]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
    document.body.innerHTML = "";
  });
});

describe("F5 1 つのコンポーネントの重なる 2 つの対応は、どちらへの書き込みも、もう一方に届く", () => {
  async function setup() {
    const tag = component(`<p class="addr">{{ addr.city }}</p><p class="city">{{ city }}</p>`, () => ({
      move(this: any) { this.addr = { city: "Kyoto" }; },
      rename(this: any) { this["addr.city"] = "Osaka"; },
      retag(this: any) { this.city = "Nara"; },
    }));
    const p = await page(`<p class="host">{{ user.address.city }}</p><${tag} data-wcs="state.addr: user.address; state.city: user.address.city"></${tag}>`,
      { user: { address: { city: "Tokyo" } } });
    const c = p.root.querySelector(tag) as any;
    const shown = () => [p.root.querySelector(".host")!.textContent, c.shadowRoot.querySelector(".addr").textContent, c.shadowRoot.querySelector(".city").textContent];
    return { ...p, c, shown };
  }

  it("上の対応（addr）を丸ごと書く", async () => {
    const { c, shown } = await setup();
    c.state.move();
    await flush();
    await flush();
    expect(shown()).toEqual(["Kyoto", "Kyoto", "Kyoto"]);
  });

  it("上の対応の下（addr.city）を書く", async () => {
    const { c, shown } = await setup();
    c.state.rename();
    await flush();
    await flush();
    expect(shown()).toEqual(["Osaka", "Osaka", "Osaka"]);
  });

  it("下の対応（city）を書く", async () => {
    const { c, shown } = await setup();
    c.state.retag();
    await flush();
    await flush();
    expect(shown()).toEqual(["Nara", "Nara", "Nara"]);
  });

  it("ホストが書くと両方に届く（これまでどおり）", async () => {
    const { write, shown } = await setup();
    await write((s) => { s["user.address"] = { city: "Kobe" }; });
    expect(shown()).toEqual(["Kobe", "Kobe", "Kobe"]);
  });
});

describe("F8 ** は代入・$resolve・$postUpdate・$dependOn では [wcs/recursion-unsupported]（ノードの行の中でも）", () => {
  it.each<[string, (s: any) => unknown, string]>([
    ["代入", (s) => { s["nodes.**.value"] = 5; }, "nodes.**.value"],
    ["$resolve", (s) => s.$resolve("nodes.**.total", [0]), "nodes.**.total"],
    ["$resolve（書き込み）", (s) => s.$resolve("nodes.**.value", [0], 5), "nodes.**.value"],
    ["$postUpdate", (s) => s.$postUpdate("nodes.**.value"), "nodes.**.value"],
    ["$dependOn", (s) => s.$dependOn("nodes.**.value"), "nodes.**.value"],
  ])("%s", async (_name, act, path) => {
    const errors: string[] = [];
    const { root, read } = await page(`<template data-wcs="for: nodes"><button data-wcs="onclick: run">{{ .total }}</button></template>`, {
      $recursion: { "nodes.*": "children.*" },
      nodes: [{ value: 1, children: [] }],
      get "nodes.**.total"() { return (this as any)["nodes.**.value"]; },
      run(this: any) { try { act(this); } catch (e) { errors.push((e as Error).message); } },
    });
    (root.querySelector("button") as HTMLElement).click();
    await flush();
    expect(errors).toEqual([`[@wcstack/state] [wcs/recursion-unsupported] #1101 "${path}"`]);
    expect(read("nodes.0.value")).toBe(1);
  });

  it("読み（行の深さに束ねる）と $getAll・$setAll はこれまでどおり", async () => {
    const { root, read } = await page(`<template data-wcs="for: nodes"><button data-wcs="onclick: run">{{ .total }}</button></template>`, {
      $recursion: { "nodes.*": "children.*" },
      nodes: [{ value: 1, children: [{ value: 2, children: [] }] }],
      get "nodes.**.total"() { return (this as any)["nodes.**.value"] * 10; },
      run(this: any) { this.$setAll("nodes.**.value", [], this["nodes.**.value"] + 1); },
    });
    expect(texts(root, "button")).toEqual(["10"]);
    (root.querySelector("button") as HTMLElement).click();
    await flush();
    await flush();
    expect(read("nodes.0.value")).toBe(2);
    expect(read("nodes.0.children.0.value")).toBe(2);
    expect(texts(root, "button")).toEqual(["20"]);
  });
});

describe("F13 行の構築中に変更が届いたスロットの失敗は、$errorCallback に 1 回だけ届く", () => {
  it("出力専用メンバーが行の値を埋め、同じ行の後ろのスロット（class.）がその値で失敗する", async () => {
    const tag = `fix-out-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
      status = "ready";
    });
    const reports: unknown[] = [];
    const { root } = await page(`<template data-wcs="for: items"><${tag} data-wcs="status: .st"></${tag}><p data-wcs="class.hot: .st"></p></template>`, {
      items: [{ st: true }],
      $errorCallback(_e: unknown, info: any) { reports.push(info.path); },
    });
    await flush();
    expect(reports).toEqual(["items.*.st"]);
    expect(root.querySelector("p")).not.toBeNull();
  });
});

describe("F8 追加: ** のパスをそのまま引く API（$eqPath・$eqIndex）も [wcs/recursion-unsupported]", () => {
  it.each<[string, (s: any) => unknown, string]>([
    ["$eqPath の族のひな形", (s) => s.$eqPath("sel", "nodes.**.total"), "nodes.**.total"],
    ["$eqPath の族でないパス", (s) => s.$eqPath("sel", "nodes.**.value"), "nodes.**.value"],
    ["$eqIndex", (s) => s.$eqIndex("nodes.**.value", 1), "nodes.**.value"],
  ])("%s", async (_name, act, path) => {
    const errors: string[] = [];
    const { root } = await page(`<template data-wcs="for: nodes"><button data-wcs="onclick: run">{{ .total }}</button></template>`, {
      $recursion: { "nodes.*": "children.*" },
      sel: 0,
      nodes: [{ value: 1, children: [] }],
      get "nodes.**.total"() { return (this as any)["nodes.**.value"]; },
      run(this: any) { try { act(this); } catch (e) { errors.push((e as Error).message); } },
    });
    (root.querySelector("button") as HTMLElement).click();
    await flush();
    expect(errors).toEqual([`[@wcstack/state] [wcs/recursion-unsupported] #1101 "${path}"`]);
  });
});
