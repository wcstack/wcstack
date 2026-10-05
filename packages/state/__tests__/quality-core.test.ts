/**
 * quality-core.test.ts — regressions found by the quality review of the core (cycle 1: A1–A17,
 * B3, B5; its re-check: N1–N3, BN2): delegated events, drains that fail, `$eq` ledgers, writes
 * under getters, HTML sinks, the page walk and the element API. The add-ons installed are scopes
 * (B5's volume) and ssr (BN2's server-rendered page).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, DirtyStrategy, Engine, getBindingsReady, installFeatures, mount, scopes, setTrustedTypesPolicy, ssr } from "../src/index";
import { drainBinds } from "../src/dom/binder";
import { resolve } from "node:path";
import ts from "typescript";

const flush = () => new Promise((r) => setTimeout(r, 0));
const BINDER_KEY = Symbol.for("wcstack.binder");
let seq = 0;

beforeAll(() => {
  installFeatures([scopes, ssr]);
  bootstrapState();
});

afterEach(() => {
  setTrustedTypesPolicy(null);
  vi.restoreAllMocks();
});

/** An engine mounted on a fresh shadow root holding `html`. */
function setup(html: string, state: Record<string, any>) {
  const h = document.createElement(`quality-core-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  document.body.appendChild(h);
  const engine = new Engine(state, new DirtyStrategy());
  mount(engine, root);
  const texts = (sel: string) => Array.from(root.querySelectorAll(sel)).map((n) => n.textContent);
  return { h, root, engine, proxy: engine.proxy, texts };
}

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`quality-core-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  return { h, root, el };
}

/**
 * `html` rendered on a server (the snapshot taken), then served to a client page: its root. The
 * server's HTML passes through `serve` (a tag defined on the server and not yet on the client).
 */
async function ssrRoundTrip(html: string, state: () => Record<string, any>, serve: (s: string) => string = (s) => s) {
  document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  let out: string;
  try {
    const server = await page(html, state());
    server.el.setAttribute("enable-ssr", "");
    (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(server.root);
    out = serve(server.root.innerHTML);
    server.h.remove();
  } finally {
    document.documentElement.removeAttribute("data-wcs-server");
  }
  const h = document.createElement(`quality-core-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = out;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state());
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  return { server: out, root, el };
}

describe("A1: 行の中の委譲イベント（前に構造の anchor・祖先にカスタム要素）", () => {
  it("同じ親で if: の後ろにある要素のクリックは、分岐が描かれていても自分のハンドラに届く", async () => {
    const calls: number[] = [];
    const { root } = setup(
      `<ul><template data-wcs="for: items"><li><template data-wcs="if: .done"><span>ok</span></template><button data-wcs="onclick: remove">x</button></li></template></ul>`,
      { items: [{ done: false }, { done: true }], remove(_e: Event, i: number) { calls.push(i); } },
    );
    await flush();
    const buttons = root.querySelectorAll("button");
    (buttons[0] as HTMLElement).click();
    (buttons[1] as HTMLElement).click();
    expect(calls).toEqual([0, 1]);
  });

  it("前の兄弟の for: が行を描いても、祖先の位置がずれた要素のハンドラに届く（テキストを通る経路で落ちない）", async () => {
    const calls: string[] = [];
    const { root, proxy } = setup(
      `<template data-wcs="for: rows"><section><div><template data-wcs="for: .tags"><i>{{ . }}</i></template>text<p><button data-wcs="onclick: hit">b</button></p></div></section></template>`,
      { rows: [{ tags: [] }], hit(_e: Event, i: number) { calls.push(`hit ${i}`); } },
    );
    await flush();
    proxy["rows.0.tags"] = ["a", "b", "c"];
    await flush();
    expect(root.querySelectorAll("i")).toHaveLength(3);
    (root.querySelector("button") as HTMLElement).click();
    expect(calls).toEqual(["hit 0"]);
  });

  it("子を先頭に足す Light DOM のカスタム要素の中でも、要素のハンドラに届く", async () => {
    const tag = `quality-prepend-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      connectedCallback(): void {
        if (this.querySelector("h3") === null) this.prepend(document.createElement("h3"));
      }
    });
    const calls: number[] = [];
    const { root } = setup(
      `<template data-wcs="for: items"><div><${tag}><button data-wcs="onclick: pick">x</button></${tag}></div></template>`,
      { items: [1, 2], pick(_e: Event, i: number) { calls.push(i); } },
    );
    await flush();
    expect(root.querySelectorAll("h3")).toHaveLength(2);
    for (const b of root.querySelectorAll("button")) (b as HTMLElement).click();
    expect(calls).toEqual([0, 1]);
  });

  it("要素に置いたハンドラも内側から順に呼ばれ、stopPropagation で外側（ブロックの経路）は呼ばれない", async () => {
    const calls: string[] = [];
    const { root, proxy } = setup(
      `<template data-wcs="for: items"><div data-wcs="onclick: outer"><template data-wcs="if: .on"><b>on</b></template><span><button data-wcs="onclick: inner">x</button></span></div></template>`,
      {
        items: [{ on: true }],
        stop: false,
        outer() { calls.push("outer"); },
        inner(this: any, e: Event) { calls.push("inner"); if (this.stop) e.stopPropagation(); },
      },
    );
    await flush();
    const button = root.querySelector("button") as HTMLElement;
    button.click();
    expect(calls.splice(0)).toEqual(["inner", "outer"]);
    proxy.stop = true;
    button.click();
    expect(calls).toEqual(["inner"]);
  });

  it("ずれない行（ブロックの経路で探す）でも、内側の #stop で外側と行の外のハンドラは呼ばれない", async () => {
    const calls: string[] = [];
    const { root } = setup(
      `<div data-wcs="onclick: page"><template data-wcs="for: items"><p data-wcs="onclick: outer"><button data-wcs="onclick#stop: inner">x</button></p></template></div>`,
      { items: [1], page() { calls.push("page"); }, outer() { calls.push("outer"); }, inner() { calls.push("inner"); } },
    );
    await flush();
    (root.querySelector("button") as HTMLElement).click();
    (root.querySelector("p") as HTMLElement).click();
    expect(calls).toEqual(["inner", "outer", "page"]);
  });
});

describe("A2・N1: 行の組み立てで投げても drain は止まらず、行は組み上がる", () => {
  it("行の束縛が付けるときに失敗するとその束縛の失敗として報告し、行・同じパスの束縛・その後の書き込みを反映する", async () => {
    const tag = `quality-cmd-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [], commands: [{ name: "go" }] };
      go(): void {}
    });
    const reported: [string, string][] = [];
    const { root, proxy } = setup(
      `<p>{{ count }}</p><template data-wcs="for: items"><${tag} data-wcs="command.go: $command.missing"></${tag}></template>`,
      {
        items: [], count: 0, $commandTokens: ["other"],
        $errorCallback(_error: unknown, info: { path: string; bindingType: string }) { reported.push([info.bindingType, info.path]); },
      },
    );
    await flush();
    proxy.items = [1];
    proxy.count = 1;
    await flush();
    // the path the binding names (R3: as 3.x reports it)
    expect(reported).toEqual([["prop", "$command.missing"]]);
    expect(root.querySelectorAll(tag)).toHaveLength(1);
    expect(root.querySelector("p")!.textContent).toBe("1");
    proxy.count = 2;
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("2");
    proxy.items = [];
    await flush();
    expect(root.querySelectorAll(tag)).toHaveLength(0);
  });
});

describe("N1: 1 行の組み立てが途中で失敗した後の一覧", () => {
  it("失敗した行も最後まで組まれ、原因が消えた後の追加・並べ替えで行が欠けたり半端な行が入ったりしない", async () => {
    const reported: [string, string][] = [];
    const { root, proxy, texts } = setup(
      `<ul><template data-wcs="for: items"><li><input data-wcs="value#init=auto: .calc"><b>{{ .v }}</b></li></template></ul><p>{{ n }}</p>`,
      {
        n: 0,
        items: [{ v: 1 }, { v: 2 }],
        get "items.*.calc"() { if ((this as any)["items.*.bad"]) throw new Error("bad row"); return "c"; },
        $errorCallback(_error: unknown, info: { path: string; bindingType: string }) { reported.push([info.bindingType, info.path]); },
      },
    );
    await flush();
    const [one, two] = proxy.items;
    const bad = { v: 3, bad: true };
    const four = { v: 4 };
    const five = { v: 5 };
    proxy.items = [one, two, bad, four];
    proxy.n = 1;
    await flush();
    expect(reported).toEqual([["prop", "items.*.calc"]]);
    expect(texts("li b")).toEqual(["1", "2", "3", "4"]);
    expect(root.querySelector("p")!.textContent).toBe("1");
    proxy["items.2.bad"] = false;
    proxy.items = [one, two, bad, four, five];
    await flush();
    expect(texts("li b")).toEqual(["1", "2", "3", "4", "5"]);
    proxy.items = [five, four, bad, two, one];
    await flush();
    expect(texts("li b")).toEqual(["5", "4", "3", "2", "1"]);
    expect(reported).toHaveLength(1);
  });

  it("それでも一覧の描画が投げたとき（anchor が外された）は for の失敗として報告し、同じパスの束縛は反映する", async () => {
    const reported: [string, string][] = [];
    const { root, proxy } = setup(`<p>{{ n }}</p><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`, {
      n: 0, items: ["a"],
      $errorCallback(_error: unknown, info: { path: string; bindingType: string }) { reported.push([info.bindingType, info.path]); },
    });
    await flush();
    // the list's anchor taken out of the page by code outside the engine
    root.querySelector("ul")!.lastChild!.remove();
    proxy.items = ["a", "b"];
    proxy.n = 1;
    await flush();
    expect(reported).toEqual([["for", "items"]]);
    expect(root.querySelector("p")!.textContent).toBe("1");
  });
});

describe("A3: カスタム要素のバブルしないイベント", () => {
  it("バブリングしない change を出すカスタム要素でも、ページの直下と行の中の両方でハンドラが呼ばれる", async () => {
    const calls: string[] = [];
    const { root } = setup(
      `<x-quality-pick data-wcs="onchange: picked"></x-quality-pick><template data-wcs="for: items"><x-quality-pick class="row" data-wcs="onchange: picked"></x-quality-pick></template>`,
      { items: [1], picked(e: Event) { calls.push((e.target as Element).className || "root"); } },
    );
    await flush();
    for (const el of root.querySelectorAll("x-quality-pick")) el.dispatchEvent(new Event("change"));
    expect(calls).toEqual(["root", "row"]);
  });
});

describe("A4: 1 つの要素に同じ種類のイベントを 2 つ", () => {
  it("ページの直下の要素でも、行の中と同じく両方が書いた順に呼ばれる", async () => {
    const calls: string[] = [];
    const { root } = setup(
      `<button id="r" data-wcs="onclick: a; onclick: b">r</button><template data-wcs="for: items"><button class="row" data-wcs="onclick: a; onclick: b">x</button></template>`,
      { items: [1], a() { calls.push("a"); }, b() { calls.push("b"); } },
    );
    await flush();
    (root.getElementById("r") as HTMLElement).click();
    (root.querySelector(".row") as HTMLElement).click();
    expect(calls).toEqual(["a", "b", "a", "b"]);
  });

  it("行の中で 1 つ目が stopPropagation しても、同じ要素の 2 つ目は呼ばれ、外側は呼ばれない（DOM と同じ）", async () => {
    const calls: string[] = [];
    const { root } = setup(
      `<template data-wcs="for: items"><p data-wcs="onclick: outer"><button data-wcs="onclick#stop: a; onclick: b; onclick: c">x</button></p></template>`,
      { items: [1], outer() { calls.push("outer"); }, a() { calls.push("a"); }, b() { calls.push("b"); }, c() { calls.push("c"); } },
    );
    await flush();
    (root.querySelector("button") as HTMLElement).click();
    expect(calls).toEqual(["a", "b", "c"]);
  });
});

describe("A5: $eq の購読の台帳", () => {
  it("行を作り直しても、消えた行の項目をキーにした空の組は残らない", async () => {
    let next = 1;
    const make = (n: number) => Array.from({ length: n }, () => ({ id: next++ }));
    const { engine, proxy } = setup(
      `<template data-wcs="for: items"><p data-wcs="class.sel: .selected">{{ .id }}</p></template>`,
      { items: make(20), selected: null, get "items.*.selected"() { return (this as any).$eq("selected", (this as any)["items.*"]); } },
    );
    await flush();
    const first = engine.target.items[0];
    for (let i = 0; i < 3; i++) {
      proxy.items = make(20);
      await flush();
    }
    const map = engine.pattern("selected").eqSubs!;
    expect(map.size).toBe(20);
    expect(map.has(first)).toBe(false);
    for (const set of map.values()) expect(set.size).toBe(1);
  });

  it("同じキーで待つ行がほかに残っていれば、そのキーの組は残る", async () => {
    const { engine, proxy, texts } = setup(
      `<template data-wcs="for: items"><p>{{ .sel }}</p></template>`,
      { items: [{ cat: "a" }, { cat: "a" }, { cat: "b" }], selected: "a", get "items.*.sel"() { const s = this as any; return s.$eq("selected", s["items.*.cat"]); } },
    );
    await flush();
    expect(texts("p")).toEqual(["true", "true", "false"]);
    proxy.items = engine.target.items.slice(1);
    await flush();
    const map = engine.pattern("selected").eqSubs!;
    expect([map.get("a")!.size, map.get("b")!.size]).toEqual([1, 1]);
    proxy.selected = "b";
    await flush();
    expect(texts("p")).toEqual(["false", "true"]);
  });
});

describe("A6: 1 回の評価で同じパスに 2 つのキーの $eq", () => {
  it("$eq(p, a) || $eq(p, b) は、どちらのキーへ移っても描き直される", async () => {
    const { root, proxy } = setup(`<p>{{ editable }}</p>`, {
      status: "draft",
      get editable() { const s = this as any; return s.$eq("status", "draft") || s.$eq("status", "review"); },
    });
    await flush();
    const seen: string[] = [];
    for (const s of ["published", "draft", "review", "published", "review", "draft"]) {
      proxy.status = s;
      await flush();
      seen.push(`${s}=${root.querySelector("p")!.textContent}`);
    }
    expect(seen).toEqual(["published=false", "draft=true", "review=true", "published=false", "review=true", "draft=true"]);
  });

  it("前の評価だけのキーは外れる（キーが動いた購読は増え続けない）", async () => {
    const { engine, proxy } = setup(`<p>{{ isWanted }}</p>`, {
      role: "a", want: "a",
      get isWanted() { const s = this as any; return s.$eq("role", s.want); },
    });
    await flush();
    for (const w of ["b", "c", "d"]) {
      proxy.want = w;
      await flush();
    }
    expect([...engine.pattern("role").eqSubs!.keys()]).toEqual(["d"]);
    proxy.role = "d";
    await flush();
    expect(engine.proxy.isWanted).toBe(true);
  });
});

describe("A7: 同じ配列を持つ一覧の台帳", () => {
  it("消えた行の子の一覧は配列の台帳から外れ、ひとりに戻った一覧は書き込みを写さない", async () => {
    const todos = [{ done: false, tags: ["a", "b"] }, { done: true, tags: ["c"] }];
    const { root, engine, proxy } = setup(
      `<template data-wcs="for: visible"><div><template data-wcs="for: .tags"><span>{{ . }}</span></template></div></template>`,
      { todos, all: true, get visible() { const s = this as any; return s.all ? s.todos : s.todos.filter((t: any) => !t.done); } },
    );
    await flush();
    for (let i = 0; i < 3; i++) {
      proxy.all = false;
      await flush();
      proxy.all = true;
      await flush();
    }
    expect(root.textContent).toBe("abc");
    const lists = (engine as any).listsByArray.get(todos[1].tags) as { shared: boolean }[];
    expect(lists).toHaveLength(1);
    expect(lists[0].shared).toBe(false);
  });
});

describe("A8: getter の下のパスへの書き込み", () => {
  it("前の値は getter を通して読む（getter の this は状態のプロキシ）", async () => {
    const { root, proxy } = setup(`<input data-wcs="value: current.name"><p>{{ current.name }}</p>`, {
      items: [{ name: "a" }, { name: "b" }], sel: 1,
      get current() { const s = this as any; return s.$resolve("items.*", [s.sel]); },
    });
    await flush();
    expect((root.querySelector("input") as HTMLInputElement).value).toBe("b");
    proxy["current.name"] = "z";
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("z");
    expect(proxy["items.1.name"]).toBe("z");
  });
});

describe("A9: 同じオブジェクトを表示する束縛", () => {
  it("$postUpdate と同じ配列の代入で、配列そのものを表示する束縛（checkbox: と {{ }}）も描き直される", async () => {
    const { root, proxy } = setup(`<input type="checkbox" value="b" data-wcs="checkbox: picked"><p>{{ picked }}</p>`, {
      picked: ["a"],
      add(this: any) { this.picked.push("b"); this.$postUpdate("picked"); },
      drop(this: any) { const same = this.picked; same.pop(); this.picked = same; },
    });
    await flush();
    const box = root.querySelector("input") as HTMLInputElement;
    expect([box.checked, root.querySelector("p")!.textContent]).toEqual([false, "a"]);
    proxy.add();
    await flush();
    expect([box.checked, root.querySelector("p")!.textContent]).toEqual([true, "a,b"]);
    proxy.drop();
    await flush();
    expect([box.checked, root.querySelector("p")!.textContent]).toEqual([false, "a"]);
  });
});

describe("A10: HTML の書き込み先", () => {
  it("TrustedHTML（ページ自身の policy で作ったもの）は文字列にせず、state の policy も通さない", async () => {
    const seen: unknown[] = [];
    setTrustedTypesPolicy({ createHTML(s: string) { seen.push(s); return s; } });
    const trusted = { toString: () => "<b>trusted</b>" };
    // a browser with Trusted Types: what isHTML says is a TrustedHTML
    (globalThis as any).trustedTypes = { isHTML: (v: unknown) => v === trusted };
    try {
      const div = document.createElement("div");
      // what the sink receives (a browser under Trusted Types enforcement refuses a string here)
      const writes: unknown[] = [];
      Object.defineProperty(div, "innerHTML", { set(v: unknown) { writes.push(v); }, configurable: true });
      const { applyTo, K_HTML, K_PROP } = await import("../src/dom/view");
      applyTo(K_HTML, div, "html", trusted);
      applyTo(K_PROP, div, "innerHTML", trusted);
      applyTo(K_PROP, div, "innerHTML", 1);
      expect(writes).toEqual([trusted, trusted, "1"]);
      expect(seen).toEqual(["1"]);
    } finally {
      delete (globalThis as any).trustedTypes;
    }
  });

  it("outerHTML: の undefined は何も書かない（要素は DOM に残る）。srcdoc: の null / undefined は属性を外す（R3-4）", async () => {
    const { root, proxy } = setup(`<p><b data-wcs="outerHTML: frag">old</b></p><iframe data-wcs="srcdoc: doc"></iframe><iframe class="a" data-wcs="attr.srcdoc: doc"></iframe>`, { frag: undefined, doc: "<i>d</i>" });
    await flush();
    expect(root.querySelector("p > b")!.textContent).toBe("old");
    const frames = Array.from(root.querySelectorAll("iframe"));
    expect(frames.map((fr) => fr.getAttribute("srcdoc"))).toEqual(["<i>d</i>", "<i>d</i>"]);
    for (const v of [undefined, "<u>x</u>", null]) {
      proxy.doc = v;
      await flush();
      expect(frames.map((fr) => fr.getAttribute("srcdoc"))).toEqual(v == null ? [null, null] : [v, v]);
    }
  });
});

describe("N3: HTML の書き込み先に同じオブジェクト", () => {
  it("同じ TrustedHTML（オブジェクト）が来ても html: / innerHTML: はパースし直さない（中のノードはそのまま）", async () => {
    const body = { toString: () => "<input class=in>" };
    const { root, proxy } = setup(`<div class="a" data-wcs="html: doc.body"></div><div class="b" data-wcs="innerHTML: doc.body"></div><p>{{ doc.title }}</p>`, {
      doc: { title: "a", body },
      touch(this: any) { this.$postUpdate("doc"); },
    });
    await flush();
    const before = Array.from(root.querySelectorAll(".in"));
    expect(before).toHaveLength(2);
    proxy.doc = { ...proxy.doc, title: "b" };
    await flush();
    proxy.touch();
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("b");
    // the same nodes (toEqual would compare DOM nodes by isEqualNode)
    const after = Array.from(root.querySelectorAll(".in"));
    expect(after.map((n, i) => n === before[i])).toEqual([true, true]);
  });
});

describe("A12: createStateAsync の readonly", () => {
  it("$setAll と $resolve の書き込みの形は拒み、$resolve の読みは通す", async () => {
    const { el } = await page(`<p>{{ items.0 }}</p>`, { items: [1, 2] });
    const out: string[] = [];
    await el.createStateAsync("readonly", async (s: any) => {
      await 0;
      out.push(String(s.$resolve("items.*", [1])));
      for (const write of [() => s.$setAll("items.*", [], 0), () => s.$resolve("items.*", [0], 9)]) {
        try {
          write();
          out.push("written");
        } catch (e) {
          out.push((e as Error).message.includes("#8") ? "readonly" : String(e));
        }
      }
    });
    expect(out).toEqual(["2", "readonly", "readonly"]);
    let v: unknown;
    el.createState("readonly", (s: any) => { v = s.items; });
    expect(v).toEqual([1, 2]);
  });
});

describe("A13: then / toJSON は状態の読みではない", () => {
  it("JSON.stringify(this)、this を返すハンドラ、this で解決する await が失敗しない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, proxy } = setup(`<button data-wcs="onclick: chain">x</button>`, {
      a: 1,
      dump(this: any) { return JSON.stringify(this); },
      chain(this: any) { return this; },
      async self(this: any) { return this; },
    });
    await flush();
    expect(JSON.parse(proxy.dump())).toEqual({ a: 1 });
    (root.querySelector("button") as HTMLElement).click();
    expect(await proxy.self()).toBe(proxy);
    expect(proxy.then).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("A14: 初期構築の前に渡されたサブツリー", () => {
  it("構築までに文書から外れたものは捨て、後で戻しても抱え続けない", () => {
    const h = document.createElement(`quality-early-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    document.body.appendChild(h);
    const p = document.createElement("p");
    p.setAttribute("data-wcs", "textContent: msg");
    root.appendChild(p);
    (globalThis as any)[BINDER_KEY].bind(p);
    p.remove();
    mount(new Engine({ msg: "late" }, new DirtyStrategy()), root);
    drainBinds();
    root.appendChild(p);
    drainBinds();
    expect(p.textContent).toBe("");
  });
});

describe("B3: 束縛が要素に入れた値は束縛として読まない", () => {
  it("ページの直下の textContent: / innerHTML: の値の {{ }} と data-wcs は文字どおり", async () => {
    let called = 0;
    const { root } = await page(`<p data-wcs="textContent: comment"></p><div data-wcs="innerHTML: html"></div>`, {
      comment: "x {{ secret }} y", secret: "SECRET",
      html: `<b>{{ secret }}</b><button data-wcs="onclick: danger">b</button>`,
      danger() { called++; },
    });
    (root.querySelector("button") as HTMLElement).click();
    expect(root.querySelector("p")!.textContent).toBe("x {{ secret }} y");
    expect(root.querySelector("div b")!.textContent).toBe("{{ secret }}");
    expect(called).toBe(0);
  });

  it("走査済みのサブツリーをもう一度渡されても、描いた値（行の {{ }}・innerHTML の中身）を束縛にしない", async () => {
    let called = 0;
    const { root } = await page(
      `<section><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul><div data-wcs="innerHTML: html"></div><p>{{ note }}</p></section>`,
      { items: ["a {{ secret }}"], note: "{{ secret }}", secret: "SECRET", html: `<button data-wcs="onclick: danger">b</button>`, danger() { called++; } },
    );
    const section = root.querySelector("section")!;
    (globalThis as any)[BINDER_KEY].bind(section);
    (root.querySelector("button") as HTMLElement).click();
    expect(root.querySelector("li")!.textContent).toBe("a {{ secret }}");
    expect(root.querySelector("p")!.textContent).toBe("{{ secret }}");
    expect(called).toBe(0);
  });

  it("束縛が残した子（値を入れない束縛の要素の中身）はこれまでどおり走査する", async () => {
    const { root } = await page(`<div data-wcs="class.on: on"><span>{{ msg }}</span></div>`, { on: true, msg: "hi" });
    expect(root.querySelector("span")!.textContent).toBe("hi");
  });

  it("N2: 束縛したプロパティで自分の子を中の要素へ移すカスタム要素でも、移った元の子は走査する", async () => {
    const tag = `quality-panel-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      set open(_v: boolean) {
        if (this.querySelector(":scope > .body") !== null) return;
        const body = document.createElement("div");
        body.className = "body";
        body.append(...this.childNodes);
        this.append(body);
      }
    });
    const { root } = await page(`<${tag} data-wcs="open: isOpen"><p>{{ msg }}</p></${tag}>`, { isOpen: true, msg: "hello" });
    expect(root.querySelector(".body > p")!.textContent).toBe("hello");
  });

  it("BN2・E1: 定義の前のカスタム要素の innerHTML: も、待たずにその場で当てる（HTML の書き込み先は wc-bindable のメンバーではない）。元の子は走査しない", async () => {
    const tag = `quality-late-${seq++}`;
    const { root } = await page(
      `<${tag} data-wcs="innerHTML: html"><b>{{ secret }}</b><button data-wcs="onclick: danger">b</button></${tag}><p data-wcs="textContent: msg"><i>{{ secret }}</i></p>`,
      { secret: "SECRET", msg: "m", html: "<u>value</u>", danger() {} },
    );
    expect(root.querySelector(tag)!.innerHTML).toBe("<u>value</u>");
    expect(root.querySelector("p")!.textContent).toBe("m");
    customElements.define(tag, class extends HTMLElement {});
    await flush();
    expect(root.querySelector(tag)!.innerHTML).toBe("<u>value</u>");
  });

  it("BN2: 書き込みが失敗した innerHTML: の要素（Trusted Types が拒んだ）の子も走査しない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setTrustedTypesPolicy({ createHTML() { throw new TypeError("blocked"); } });
    let called = 0;
    const { root } = await page(`<div data-wcs="innerHTML: html"><b>{{ secret }}</b><button data-wcs="onclick: danger">b</button></div>`, {
      secret: "SECRET", html: "<u>x</u>", danger() { called++; },
    });
    (root.querySelector("button") as HTMLElement).click();
    expect(root.querySelector("b")!.textContent).toBe("{{ secret }}");
    expect(called).toBe(0);
  });

  it("BN2: サーバで値が入り、クライアントでは未定義のカスタム要素の innerHTML: の中身を束縛にしない（SSR）", async () => {
    const serverTag = `quality-srv-${seq++}`;
    const clientTag = `quality-cli-${seq++}`;
    customElements.define(serverTag, class extends HTMLElement {});
    const log: number[] = [];
    const state = () => ({ secret: "SECRET", html: `<b>{{ secret }}</b><button data-wcs="onclick: danger">b</button>`, danger() { log.push(1); } });
    const { root } = await ssrRoundTrip(`<${serverTag} data-wcs="innerHTML: html"></${serverTag}>`, state, (s) => s.split(serverTag).join(clientTag));
    expect(root.querySelector(`${clientTag} b`)!.textContent).toBe("{{ secret }}");
    (root.querySelector("button") as HTMLElement).click();
    expect(log).toEqual([]);
  });

  it("R1: サーバは outerHTML: を当てずに要素を書いたまま出し、クライアントが当てる（値の中身を束縛にしない）", async () => {
    const log: number[] = [];
    const state = () => ({
      secret: "SECRET", html: `<section><b>{{ secret }}</b><button data-wcs="onclick: danger">b</button></section>`, danger() { log.push(1); },
    });
    const { server, root } = await ssrRoundTrip(`<div data-wcs="outerHTML: html"><i>{{ secret }}</i></div><p>{{ secret }}</p>`, state);
    expect(server).toContain(`data-wcs="outerHTML: html"`);
    expect(server).not.toContain("<section>");
    expect(root.querySelector("div")).toBeNull();
    expect(root.querySelector("section b")!.textContent).toBe("{{ secret }}");
    expect(root.querySelector("p")!.textContent).toBe("SECRET");
    (root.querySelector("button") as HTMLElement).click();
    expect(log).toEqual([]);
  });

  it("T1: outerText: もサーバでは当てず、クライアントが当てる（値のテキストの {{ }} を束縛にしない）", async () => {
    const state = () => ({ secret: "SECRET", txt: "x {{ secret }} y" });
    const { server, root } = await ssrRoundTrip(`<div data-wcs="outerText: txt"></div><p>{{ secret }}</p>`, state);
    expect(server).toContain(`data-wcs="outerText: txt"`);
    expect(root.querySelector("div")).toBeNull();
    expect(root.textContent).toBe("x {{ secret }} ySECRET");
  });

  it("R2: #init=element で中身を書かない textContent: の要素も、子は走査しない（SSR で値が入り得るため。制限）", async () => {
    const { root, proxy } = setup(`<p data-wcs="textContent#init=element: msg">hi <b>{{ x }}</b></p>`, { msg: undefined, x: "X" });
    await flush();
    expect(root.querySelector("p")!.innerHTML).toBe("hi <b>{{ x }}</b>");
    proxy.msg = "now";
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("now");
  });
});

describe("T2: テンプレートの中の outerHTML: / outerText:", () => {
  it("for: と if: のテンプレートの中では、計画を作る時点で拒む（#203）", () => {
    expect(() => setup(`<ul><template data-wcs="for: items"><li><span data-wcs="outerHTML: .h"></span></li></template></ul>`, { items: [] }))
      .toThrow("[@wcstack/state] [wcs/template-syntax] #203 \"outerHTML\"");
    expect(() => setup(`<template data-wcs="if: on"><b data-wcs="outerText: t"></b></template>`, { on: true, t: "x" }))
      .toThrow(/#203 "outerText"|"outerText:"/);
  });

  it("ページの直下の outerHTML: はこれまでどおり当たる（値は束縛にしない）", async () => {
    let called = 0;
    const { root } = setup(`<div data-wcs="outerHTML: html"></div>`, {
      html: `<section><b>{{ x }}</b><button data-wcs="onclick: danger">b</button></section>`, x: "X", danger() { called++; },
    });
    await flush();
    expect(root.querySelector("div")).toBeNull();
    expect(root.querySelector("section b")!.textContent).toBe("{{ x }}");
    (root.querySelector("button") as HTMLElement).click();
    expect(called).toBe(0);
  });
});

describe("V1: binder に渡したサブツリーのマークアップの誤り", () => {
  it("bind() は投げずに console へ報告し、続けて渡したサブツリーは束ねる", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root } = await page(`<main></main>`, { items: [], x: "<b>b</b>", msg: "m" });
    const binder = (globalThis as any)[BINDER_KEY];
    const handOver = (html: string): Element => {
      const box = document.createElement("div");
      box.innerHTML = html;
      const node = box.firstElementChild!;
      root.querySelector("main")!.appendChild(node);
      return node;
    };
    const bad1 = handOver(`<section><template data-wcs="for: items"><div data-wcs="outerHTML: x"></div></template></section>`);
    const bad2 = handOver(`<section><p data-wcs="text msg"></p></section>`);
    expect(() => binder.bind(bad1)).not.toThrow();
    expect(() => binder.bind(bad2)).not.toThrow();
    expect(error.mock.calls.map((c) => String((c[0] as Error).message))).toEqual([
      expect.stringContaining("#203"),
      expect.stringContaining("#101"),
    ]);
    const good = handOver(`<section><p data-wcs="text: msg"></p></section>`);
    binder.bind(good);
    expect(good.querySelector("p")!.textContent).toBe("m");
  });

  it("初期構築の前に渡された誤りのあるサブツリーも、ページの初期化を失敗させない", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`quality-early-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    document.body.appendChild(h);
    const bad = document.createElement("p");
    bad.setAttribute("data-wcs", "text msg");
    const good = document.createElement("i");
    good.setAttribute("data-wcs", "text: msg");
    root.append(bad, good);
    const binder = (globalThis as any)[BINDER_KEY];
    binder.bind(bad);
    binder.bind(good);
    // out of the page while it mounts (as <wcs-head>'s clones in <head> are): bound only as handed over
    bad.remove();
    good.remove();
    mount(new Engine({ msg: "late" }, new DirtyStrategy()), root);
    root.append(bad, good);
    expect(() => drainBinds()).not.toThrow();
    expect(good.textContent).toBe("late");
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("V2: ページの直下の outerHTML: / outerText: の要素の子", () => {
  it("置き換えでページから外れる子は束縛しない（外れたノードの束縛を残さない）", async () => {
    const { root, el } = await page(`<div data-wcs="outerHTML: html"><span>{{ x }}</span></div><b data-wcs="outerText: t"><i>{{ x }}</i></b>`, { html: "<p>v</p>", t: "T", x: "a" });
    expect(root.querySelector("p")!.textContent).toBe("v");
    expect(root.textContent).toBe("vT");
    const engine = el.engine as Engine;
    expect(engine.rootBindings.has(engine.pattern("x"))).toBe(false);
  });
});

describe("B5: 接続直後の volume への setInitialState", () => {
  it("状態を読み込む前なら初期状態として受け取る（根の要素と同じ）", async () => {
    const { root } = await page(`<p>{{ cart.n }}</p>`, {});
    const v = document.createElement("wcs-state") as any;
    v.setAttribute("mount", "cart");
    root.prepend(v);
    expect(() => v.setInitialState({ n: 5 })).not.toThrow();
    await v.connectedCallbackPromise;
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("5");
    // once loaded, a re-set is the volume's (refused)
    expect(() => v.setInitialState({ n: 6 })).toThrow(/re-setting a volume/);
  });
});

describe("C6: 縮める名前（mangle.mjs）と DOM・組み込みの名前", () => {
  // a name in the list is shortened everywhere: an access that TypeScript resolves to a lib
  // declaration (a DOM object's `children`, a built-in's method) would break in every bundle
  it("縮める名前のアクセスが、lib の宣言（DOM・組み込み）に解決されるところが src に無い", async () => {
    const { MANGLE_PROPS } = (await import("../mangle.mjs" as string)) as { MANGLE_PROPS: RegExp };
    const cfg = ts.getParsedCommandLineOfConfigFile(resolve(__dirname, "../tsconfig.json"), {}, {
      ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {},
    })!;
    const program = ts.createProgram(cfg.fileNames.filter((f) => f.includes("/src/")), cfg.options);
    const checker = program.getTypeChecker();
    const found: string[] = [];
    for (const sf of program.getSourceFiles()) {
      if (!sf.fileName.includes("/src/")) continue;
      const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node) && MANGLE_PROPS.test(node.name.text)) {
          const decls = checker.getSymbolAtLocation(node.name)?.declarations ?? [];
          if (decls.some((d) => d.getSourceFile().fileName.includes("/node_modules/"))) {
            found.push(`${sf.fileName.split("/src/")[1]}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.getText()}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(found).toEqual([]);
  }, 60_000);
});

describe("C1: getter の一覧を通るパスの解決（resolve の戻り値の上書き）", () => {
  const state = () => ({
    todos: [{ title: "a", done: false }, { title: "b", done: true }],
    filter: { done: false },
    get visible() { const s = this as any; return s.todos.filter((t: any) => t.done === s["filter.done"]); },
  });

  it("{{ visible.0.title }} は名指した行を表示し、getter が変わると追従する", async () => {
    const { proxy, texts } = setup(`<p>{{ visible.0.title }}</p>`, state());
    await flush();
    expect(texts("p")).toEqual(["a"]);
    proxy["filter.done"] = true;
    await flush();
    expect(texts("p")).toEqual(["b"]);
  });

  it("getter が古いうちに名指した行へ書いても、別のパス（getter が読んだパス）に書かない", async () => {
    const s: any = state();
    const { proxy } = setup(``, s);
    expect(proxy.visible).toHaveLength(1);
    proxy["filter.done"] = true;
    proxy["visible.0.title"] = "B";
    expect(s.filter.done).toBe(true);
    expect(s.todos[1].title).toBe("B");
  });
});

describe("C3: 行の getter のキャッシュの穴", () => {
  it("後から作られた getter の番号の前に穴があっても、穴を undefined のキャッシュとして読まない", async () => {
    const { root, el } = await page(`<ul><template data-wcs="for: items"><li>{{ .x }}</li></template></ul>`, {
      items: [{ v: 1, tags: ["t1"] }, { v: 2, tags: ["t2"] }],
      show: false,
      get "items.*.x"() { return (this as any)["items.*.v"] * 10; },
    });
    const binder = (globalThis as any)[BINDER_KEY];
    const handOver = (html: string): void => {
      const box = document.createElement("div");
      box.innerHTML = html;
      root.appendChild(box);
      binder.bind(box);
    };
    // $1 behind a closed if (its slot made first, not read yet), then a later slot read at once
    handOver(`<template data-wcs="if: show"><template data-wcs="for: items"><b>{{ $1 }}</b></template></template>`);
    handOver(`<template data-wcs="for: items"><i>{{ .tags.0 }}</i></template>`);
    await flush();
    expect(Array.from(root.querySelectorAll("i")).map((n) => n.textContent)).toEqual(["t1", "t2"]);
    el.createState("writable", (s: any) => { s.show = true; });
    await flush();
    expect(Array.from(root.querySelectorAll("b")).map((n) => n.textContent)).toEqual(["0", "1"]);
  });
});

describe("C4: $postUpdate と $eq", () => {
  for (const path of ["filter", "filter.status"]) {
    it(`その場で変えて $postUpdate("${path}") すると、$eq で待つ getter に届く`, async () => {
      const { proxy, texts } = setup(`<p>{{ isA }}</p><i>{{ filter.status }}</i>`, {
        filter: { status: "a" },
        get isA() { return (this as any).$eq("filter.status", "a"); },
      });
      await flush();
      expect(texts("p")).toEqual(["true"]);
      proxy.filter.status = "b";
      proxy.$postUpdate(path);
      await flush();
      expect([texts("i"), texts("p")]).toEqual([["b"], ["false"]]);
    });
  }
});

describe("C5: $eqIndex の付け替え", () => {
  const list = `<template data-wcs="for: items"><li>{{ .sel }}</li></template>`;
  const items = () => [{ id: 1 }, { id: 2 }, { id: 3 }];

  it("元のパスが getter なら、追跡付きの読みになる（getter の変化で選択が動く）", async () => {
    const { proxy, texts } = setup(list, {
      items: items(), selectedId: 1,
      get selectedIndex() { const s = this as any; return s.items.findIndex((i: any) => i.id === s.selectedId); },
      get "items.*.sel"() { return (this as any).$eqIndex("selectedIndex"); },
    });
    await flush();
    expect(texts("li")).toEqual(["true", "false", "false"]);
    proxy.selectedId = 3;
    await flush();
    expect(texts("li")).toEqual(["false", "false", "true"]);
  });

  it("元のパスの上のオブジェクトの置き換えと、その場の変更の $postUpdate でも選択が動く", async () => {
    const { proxy, texts } = setup(list, {
      items: items(), ui: { sel: 0 },
      get "items.*.sel"() { return (this as any).$eqIndex("ui.sel"); },
    });
    await flush();
    proxy.ui = { sel: 2 };
    await flush();
    expect(texts("li")).toEqual(["false", "false", "true"]);
    proxy.ui.sel = 1;
    proxy.$postUpdate("ui");
    await flush();
    expect(texts("li")).toEqual(["false", "true", "false"]);
    proxy["ui.sel"] = 0;
    await flush();
    expect(texts("li")).toEqual(["true", "false", "false"]);
  });
});

describe("C11: 描いている一覧のキーが無い状態・一覧が読めない状態への再セット", () => {
  it("キーの無い一覧は空になり（失敗にしない）、読めない一覧はその for の失敗として報告し、どちらも再セットは最後まで進む（reset の受け口が呼ばれ、以後の書き込みも描かれる）", async () => {
    const { hooks } = await import("../src/hooks");
    const phases: string[] = [];
    const prev = hooks.element;
    hooks.element = (engine, phase) => {
      prev?.(engine, phase);
      phases.push(phase);
    };
    try {
      const { root, el } = await page(`<ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul><p>{{ n }}</p>`, { items: ["x"], n: 0 });
      const reported: [string, string][] = [];
      const $errorCallback = (_e: unknown, info: { path: string; bindingType: string }) => { reported.push([info.bindingType, info.path]); };
      // a key the old state had: empty, as a missing path under a key is
      expect(() => el.setInitialState({ n: 1, $errorCallback })).not.toThrow();
      expect(reported).toEqual([]);
      expect(root.querySelectorAll("li").length).toBe(0);
      expect(phases).toContain("reset");
      expect(root.querySelector("p")!.textContent).toBe("1");
      el.createState("writable", (s: any) => { s.n = 2; });
      await flush();
      expect(root.querySelector("p")!.textContent).toBe("2");
      // a list that cannot be read fails alone
      phases.length = 0;
      expect(() => el.setInitialState({ n: 3, get items(): unknown[] { throw new Error("boom"); }, $errorCallback })).not.toThrow();
      expect(reported).toEqual([["for", "items"]]);
      expect(phases).toContain("reset");
      expect(root.querySelector("p")!.textContent).toBe("3");
    } finally {
      hooks.element = prev;
    }
  });
});

// D3 (an if / else chain handed over one template at a time) is refused as a whole since N1: see "N1"

describe("D4: ネイティブ要素の command. / eventToken. / ...:", () => {
  it("定義を待たずに、その場で #1202 / #1501 で拒む（行では束縛の失敗、ページでは初期化の失敗）", async () => {
    const reported: string[] = [];
    const { root } = setup(
      `<template data-wcs="for: rows"><dialog data-wcs="command.showModal: $command.open"></dialog><button data-wcs="eventToken.value: clicked"></button><input data-wcs="...: form"></template>`,
      {
        rows: [1], form: { a: 1 }, $commandTokens: ["open"], $eventTokens: ["clicked"],
        $errorCallback(e: unknown) { reported.push(String((e as Error).message)); },
      },
    );
    await flush();
    expect(root.querySelectorAll("dialog")).toHaveLength(1);
    expect(reported.map((m) => /#\d+/.exec(m)![0])).toEqual(["#1202", "#1202", "#1501"]);
    expect(() => setup(`<dialog data-wcs="command.showModal: $command.open"></dialog>`, { $commandTokens: ["open"] })).toThrow(/#1202/);
  });
});

describe("D5・D6: 定義が遅れて来るカスタム要素", () => {
  it("定義の後に束縛が拒まれたら、その束縛の失敗として $errorCallback に届く（未処理の reject にならない）", async () => {
    const tag = `quality-late-member-${seq++}`;
    const reported: [string, string][] = [];
    await page(`<${tag} data-wcs="nope: x"></${tag}>`, {
      x: 1, $errorCallback(_e: unknown, info: { path: string; bindingType: string }) { reported.push([info.bindingType, info.path]); },
    });
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "value", event: "change" }] };
    });
    await flush();
    expect(reported).toEqual([["prop", "x"]]);
  });

  it("定義の後の適用の失敗も、次の無関係な書き込みを待たずにすぐ報告する", async () => {
    const tag = `quality-late-apply-${seq++}`;
    const reported: string[] = [];
    await page(`<${tag} data-wcs="foo: x"></${tag}>`, {
      x: 1, $errorCallback(e: unknown) { reported.push(String((e as Error).message)); },
    });
    customElements.define(tag, class extends HTMLElement {
      set foo(_v: unknown) { throw new Error("boom"); }
      get foo(): unknown { return 0; }
    });
    await flush();
    expect(reported).toEqual(["boom"]);
  });

  it("定義の前に行が消えたら、定義されても束縛を付けない", async () => {
    const tag = `quality-late-gone-${seq++}`;
    const { root, el } = await page(`<template data-wcs="for: rows"><${tag} data-wcs="foo: .v"></${tag}></template>`, { rows: [{ v: 1 }] });
    const old = root.querySelector(tag) as any;
    el.createState("writable", (s: any) => { s.rows = []; });
    await flush();
    let set = 0;
    customElements.define(tag, class extends HTMLElement {
      set foo(_v: unknown) { set++; }
      get foo(): unknown { return undefined; }
    });
    customElements.upgrade(old);
    await flush();
    expect(set).toBe(0);
  });
});

describe("D6: 置かれる前に消えた行（登録簿を待つ経路）", () => {
  it("行が置かれた後の登録簿を待つ間に行が消えたら、定義されても束縛を付けない", async () => {
    const tag = `quality-scoped-gone-${seq++}`;
    // the row elements' registry (a stand-in for a scoped one): the wait for it goes through a microtask
    Object.defineProperty(HTMLElement.prototype, "customElementRegistry", {
      configurable: true,
      get(this: Element) { return customElements; },
    });
    try {
      const { engine, proxy } = setup(`<ul><template data-wcs="for: items"><li><${tag} data-wcs="foo: .v"></${tag}></li></template></ul>`, { items: [] });
      await flush();
      // built and removed within the same task, before the row's wait starts
      proxy.items = [{ v: 1 }];
      engine.drain();
      proxy.items = [];
      engine.drain();
      let set = 0;
      customElements.define(tag, class extends HTMLElement {
        set foo(_v: unknown) { set++; }
        get foo(): unknown { return undefined; }
      });
      await flush();
      await flush();
      expect(set).toBe(0);
    } finally {
      delete (HTMLElement.prototype as any).customElementRegistry;
    }
  });
});

describe("N1: binder に直接渡された構造のテンプレート（ルートの本文の直下）", () => {
  it("描かずに #204 で報告する（描いた行が渡した側の手の届かない隣に残らない）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root } = await page(`<div id="outlet"></div>`, { items: ["a", "b"], on: true });
    const outlet = root.getElementById("outlet")!;
    const tpl = document.createElement("template");
    tpl.innerHTML = `<h2>list</h2><template data-wcs="for: items"><p>{{ . }}</p></template><template data-wcs="if: on"><b>on</b></template><template data-wcs="else:"><i>off</i></template>`;
    const nodes = Array.from(tpl.content.childNodes);
    outlet.append(...nodes);
    const binder = (globalThis as any)[BINDER_KEY];
    for (const n of nodes) binder.bind(n);
    expect(outlet.querySelectorAll("p, b, i")).toHaveLength(0);
    expect(error.mock.calls.map((c) => String((c[0] as Error).message))).toEqual([
      '[@wcstack/state] [wcs/template-syntax] #204 "for"',
      '[@wcstack/state] [wcs/template-syntax] #204 "if"',
      '[@wcstack/state] [wcs/template-syntax] #204 "else"',
    ]);
    // what the inserter removes is all there is
    for (const n of nodes) n.parentNode?.removeChild(n);
    expect(outlet.childNodes).toHaveLength(0);
  });

  it("要素で包んだテンプレートは、渡されたときに描く", async () => {
    const { root } = await page(`<div id="outlet"></div>`, { items: ["a", "b"] });
    const outlet = root.getElementById("outlet")!;
    const ul = document.createElement("ul");
    ul.innerHTML = `<template data-wcs="for: items"><li>{{ . }}</li></template>`;
    outlet.append(ul);
    (globalThis as any)[BINDER_KEY].bind(ul);
    expect(Array.from(ul.querySelectorAll("li")).map((n) => n.textContent)).toEqual(["a", "b"]);
  });
});

describe("N2: 多くの行の下のタグが後から定義されたとき", () => {
  it("$renderedCallback は定義 1 つにつき 1 回（行ごとではない）", async () => {
    const tag = `quality-late-many-${seq++}`;
    let calls = 0;
    await page(`<ul><template data-wcs="for: rows"><li><${tag} data-wcs="foo: .v"></${tag}></li></template></ul>`, {
      rows: Array.from({ length: 20 }, (_, i) => ({ v: i })), $renderedCallback() { calls++; },
    });
    const before = calls;
    const seen: unknown[] = [];
    customElements.define(tag, class extends HTMLElement {
      set foo(v: unknown) { seen.push(v); }
      get foo(): unknown { return undefined; }
    });
    await flush();
    await flush();
    expect(seen).toHaveLength(20);
    expect(calls - before).toBe(1);
  });
});

describe("E1: HTML の書き込み先と、注入したサニタイザ policy", () => {
  const sanitized: string[] = [];
  const strip = { createHTML: (s: string) => { sanitized.push(s); return s.replace(/<[^>]*>/g, ""); } };
  const payload = () => [`<img src=x onerror="alert(1)">hi`];

  it("配列（や TrustedHTML でないオブジェクト）は文字列にして policy に通す（innerHTML: / html: / 行の中）", async () => {
    sanitized.length = 0;
    setTrustedTypesPolicy(strip);
    const { root } = await page(
      `<div class="a" data-wcs="innerHTML: body"></div><div class="b" data-wcs="html: body"></div><template data-wcs="for: rows"><div class="c" data-wcs="innerHTML: .body"></div></template>`,
      { body: payload(), rows: [{ body: payload() }] },
    );
    expect(root.querySelector("img")).toBeNull();
    expect([".a", ".b", ".c"].map((s) => root.querySelector(s)!.innerHTML)).toEqual(["hi", "hi", "hi"]);
    expect(sanitized).toHaveLength(3);
  });

  it("attr.srcdoc: と、wc-bindable の要素への innerHTML:（向きの検査を切っていても）も policy を通る", async () => {
    sanitized.length = 0;
    setTrustedTypesPolicy(strip);
    const tag = `quality-panel-tt-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [], inputs: [{ name: "title" }] };
    });
    const { root } = await page(`<${tag} data-wcs="innerHTML: body"></${tag}><iframe data-wcs="attr.srcdoc: body"></iframe>`, {
      body: `<img src=x onerror="alert(1)">x`, $behavior: { enableDirectionalInitialSync: false },
    });
    expect(root.querySelector(`${tag} img`)).toBeNull();
    expect(root.querySelector(tag)!.innerHTML).toBe("x");
    expect((root.querySelector("iframe") as HTMLIFrameElement).srcdoc).toBe("x");
    expect(sanitized).toHaveLength(2);
  });
});

describe("F1: <svg> の中の構造のテンプレート", () => {
  it("for: と if: を SVG の要素として描く（SVG の <template> は .content を持たない）", async () => {
    const h = document.createElement(`quality-svg-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><svg width="200" height="100"><template data-wcs="for: points"><circle data-wcs="attr.cx: .x" r="5"></circle></template><template data-wcs="if: on"><rect width="1" height="1"></rect></template></svg>`;
    const tpl = root.querySelector("svg template")!;
    expect(tpl.namespaceURI).toBe("http://www.w3.org/2000/svg");
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ points: [{ x: 1 }, { x: 3 }], on: true });
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await flush();
    const circles = Array.from(root.querySelectorAll("circle"));
    expect(circles.map((c) => [c.getAttribute("cx"), c.namespaceURI])).toEqual([["1", "http://www.w3.org/2000/svg"], ["3", "http://www.w3.org/2000/svg"]]);
    expect(root.querySelector("rect")!.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });

  it("SVG のテンプレートの中身を取り出しても、テンプレート自身は子を失わない", async () => {
    const { templateContent } = await import("../src/dom/plan");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const t = document.createElementNS("http://www.w3.org/2000/svg", "template");
    t.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "circle"));
    svg.appendChild(t);
    const f = templateContent(t as unknown as HTMLTemplateElement);
    expect(f.firstChild!.nodeName).toBe("circle");
    expect(t.childNodes).toHaveLength(1);
  });
});

describe("F2: 同じ root の 2 本目の <wcs-state>", () => {
  it("2 本目は #47 で初期化に失敗し、ページの束縛は 1 本目のまま（取り外した後の付け替えは通す）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, el } = await page(`<p>{{ user }}</p>`, { user: "page" });
    const second = document.createElement("wcs-state") as any;
    second.setInitialState({ user: "second" });
    root.appendChild(second);
    await expect(second.connectedCallbackPromise).rejects.toThrow(/#47/);
    const later = document.createElement("i");
    later.setAttribute("data-wcs", "textContent: user");
    root.appendChild(later);
    (globalThis as any)[BINDER_KEY].bind(later);
    expect(later.textContent).toBe("page");
    // the first taken out, a new one put in: it takes the root over
    el.remove();
    second.remove();
    const third = document.createElement("wcs-state") as any;
    third.setInitialState({ user: "third" });
    root.prepend(third);
    await third.connectedCallbackPromise;
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("束縛を作れずに失敗した 1 本目はその root を持たない: 2 本目は #47 で拒まれずに root を引き継ぐ", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const h = document.createElement(`quality-failed-root-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><p data-wcs="textContent: a|"></p>`;
      const first = root.querySelector("wcs-state") as any;
      first.setInitialState({ a: 1 });
      document.body.appendChild(h);
      await expect(first.connectedCallbackPromise).rejects.toThrow("[wcs/binding-syntax]");
      const second = document.createElement("wcs-state") as any;
      second.setInitialState({ a: 2 });
      root.appendChild(second);
      await second.connectedCallbackPromise;
      expect(second.engine).not.toBeNull();
      h.remove();
    } finally {
      error.mockRestore();
    }
  });
});

describe("E3: state=\"id\" の JSON script", () => {
  it("同じ id の別の要素（利用者の HTML）が先にあっても、その id の JSON script を読む", async () => {
    const h = document.createElement(`quality-clobber-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<p id="app-state">{"role":"admin"}</p><script type="application/json" id="app-state">{"role":"guest"}</script><wcs-state state="app-state"></wcs-state><b>{{ role }}</b>`;
    document.body.appendChild(h);
    const el = root.querySelector("wcs-state") as any;
    await el.connectedCallbackPromise;
    await flush();
    expect(root.querySelector("b")!.textContent).toBe("guest");
  });
});

describe("E4: プロトタイプに届くパス", () => {
  afterEach(() => {
    delete (Object.prototype as any).polluted;
  });

  it("__proto__ / prototype の段を持つパスは #120 で拒み、Object.prototype に書かない", async () => {
    const { el } = await page(``, { prefs: {}, items: [{ a: 1 }] });
    const attempts = [
      (s: any) => { s["__proto__.polluted"] = 1; },
      (s: any) => { s["constructor.prototype.polluted"] = 1; },
      (s: any) => { s[`prefs.${"__proto__.polluted"}`] = 1; },
      (s: any) => { s.$resolve("items.*.__proto__.polluted", [0], 1); },
    ];
    for (const write of attempts) {
      expect(() => el.createState("writable", write)).toThrow(/#120/);
    }
    expect(({} as any).polluted).toBeUndefined();
  });

  it("束縛のパスでも初期化の時点で拒む", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`quality-proto-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><input data-wcs="value: __proto__.polluted">`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ name: "a" });
    document.body.appendChild(h);
    await expect(el.connectedCallbackPromise).rejects.toThrow(/#120/);
    expect(error).toHaveBeenCalled();
  });
});

describe("E6・F3: 既定のロケール（formats）", () => {
  it("Intl が受け取らない <html lang> / locale は 1 回警告してフィルタの既定を \"en\" にし、値が変わるとまた確かめる（config.locale は設定した値のまま）", async () => {
    const { config, setConfig } = await import("../src/config");
    const { installFormats } = await import("../src/filters/formats");
    const { resolveFilter } = await import("../src/filters/registry");
    const getFilter = (name: string) => resolveFilter(name, [], []);
    installFormats();
    const original = config.locale;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      setConfig({ locale: "en_US" });
      const fn = getFilter("locale");
      expect(fn(1234.5)).toBe((1234.5).toLocaleString("en"));
      expect(config.locale).toBe("en_US");
      fn(1);
      expect(warn).toHaveBeenCalledTimes(1);
      setConfig({ locale: "de-DE" });
      expect(fn(1234.5)).toBe((1234.5).toLocaleString("de-DE"));
      // checked again for a value set again (once: the reads after it do not warn)
      setConfig({ locale: "ja_JP" });
      expect([fn(1), fn(2)]).toEqual([(1).toLocaleString("en"), (2).toLocaleString("en")]);
      expect(warn).toHaveBeenCalledTimes(2);
      // a correct locale set before the first use: the wrong one before it is never checked (no warning)
      setConfig({ locale: "fr_FR" });
      setConfig({ locale: "de-DE" });
      expect(fn(1234.5)).toBe((1234.5).toLocaleString("de-DE"));
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      setConfig({ locale: original });
    }
  });
});

describe("E9・F5: getBindingsReady", () => {
  it("初期化に失敗した root では reject する", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`quality-ready-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p data-wcs="text msg"></p>`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ msg: "m" });
    document.body.appendChild(h);
    await expect(getBindingsReady(root)).rejects.toThrow(/#101/);
  });
});

describe("E10: 初期構築の前に渡されたサブツリー", () => {
  it("同じサブツリーを何度渡されても 1 つとして持ち、構築の後に 1 回束ねる", async () => {
    const h = document.createElement(`quality-early-dup-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    document.body.appendChild(h);
    const p = document.createElement("p");
    p.setAttribute("data-wcs", "textContent: msg");
    root.appendChild(p);
    const binder = (globalThis as any)[BINDER_KEY];
    for (let i = 0; i < 5; i++) binder.bind(p);
    p.remove();
    const engine = new Engine({ msg: "late" }, new DirtyStrategy());
    mount(engine, root);
    root.appendChild(p);
    const report = vi.spyOn(engine, "report");
    drainBinds();
    expect(p.textContent).toBe("late");
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe("E12: 再接続の $connectedCallback の失敗", () => {
  it("非同期の失敗は、初回の接続と同じく要素を名指して console に報告する（未処理の reject にしない）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const { h } = await page(`<p></p>`, { async $connectedCallback() { if (n++ > 0) throw new Error("again"); } });
    h.remove();
    document.body.appendChild(h);
    await flush();
    // (this file installs no diagnostics: the report is numbered, #50 = "<wcs-state> $connectedCallback failed.")
    expect(error.mock.calls.map((c) => [c[0], String((c[1] as Error).message)])).toEqual([['[@wcstack/state] #50 "wcs-state"', "again"]]);
  });
});

describe("F7: 数値の段を持つパスの、配列でない入れ物", () => {
  it("数値のキーのオブジェクトを辿り、途中が無ければ undefined", async () => {
    const { root } = setup(`<p>{{ sales.2024.total }}</p><i>{{ sales.1999.total }}</i>`, { sales: { 2024: { total: 10 } } });
    await flush();
    expect([root.querySelector("p")!.textContent, root.querySelector("i")!.textContent]).toEqual(["10", ""]);
  });
});

describe("F1・SSR: <svg> の中の構造のテンプレートの往復", () => {
  it("クライアントで戻したテンプレートから作る行も SVG の要素になる（サーバの行も SVG のまま）", async () => {
    const SVG = "http://www.w3.org/2000/svg";
    const state = () => ({ points: [{ x: 1 }], on: true });
    const { root, el } = await ssrRoundTrip(
      `<svg width="200" height="100"><template data-wcs="for: points"><circle data-wcs="attr.cx: .x" r="5"></circle></template><template data-wcs="if: on"><rect width="1" height="1"></rect></template></svg>`,
      state,
    );
    expect(Array.from(root.querySelectorAll("circle")).map((c) => [c.getAttribute("cx"), c.namespaceURI])).toEqual([["1", SVG]]);
    el.createState("writable", (s: any) => { s.points = [{ x: 1 }, { x: 3 }]; s.on = false; });
    await flush();
    el.createState("writable", (s: any) => { s.on = true; });
    await flush();
    expect(Array.from(root.querySelectorAll("circle")).map((c) => [c.getAttribute("cx"), c.namespaceURI])).toEqual([["1", SVG], ["3", SVG]]);
    expect(Array.from(root.querySelectorAll("rect")).map((r) => r.namespaceURI)).toEqual([SVG]);
  });
});

describe("raw text の要素（noscript・iframe）の中", () => {
  it("ページの走査は入らない（中の {{ }} を束縛しない。スクリプトの動くページでは中身は文字で、サーバが値を描いたかもしれない）", async () => {
    const { root } = await page(`<noscript><p>{{ secret }}</p></noscript><iframe>{{ secret }}</iframe><p class="out">{{ secret }}</p>`, { secret: "S" });
    expect(root.querySelector("noscript")!.textContent).toContain("{{ secret }}");
    expect(root.querySelector("iframe")!.textContent).toBe("{{ secret }}");
    expect(root.querySelector(".out")!.textContent).toBe("S");
  });
});

describe("R3-1: ページの走査は子を先に（後順）", () => {
  it("カスタム要素が束縛の値を、作者の書いた子の中に描いても、その値を束縛にしない（{{ }} も data-wcs も）", async () => {
    const tag = `quality-fill-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      set body(v: string) { this.querySelector(".slot")!.innerHTML = v; }
    });
    const calls: string[] = [];
    const { root } = await page(`<${tag} data-wcs="body: comment"><div class="slot"></div><p>{{ secret }}</p></${tag}>`, {
      comment: `my token is {{ secret }} <button data-wcs="onclick: wipe">win</button><b data-wcs="nope nope">x</b>`,
      secret: "s3cr3t", wipe() { calls.push("wiped"); },
    });
    expect(root.querySelector(".slot")!.textContent).toBe("my token is {{ secret }} winx");
    (root.querySelector("button") as HTMLElement).click();
    expect(calls).toEqual([]);
    // the author's own child of the element is bound (it was walked before the element's bindings)
    expect(root.querySelector(`${tag} > p`)!.textContent).toBe("s3cr3t");
  });
});

describe("R3-3: 2 本目の <wcs-state> と getBindingsReady", () => {
  it("文書順で先の root が束ねたページでは、迷い込んだ 2 本目が失敗しても getBindingsReady は 1 本目のまま resolve する", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`quality-ready-two-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state json='{"user":"page"}'></wcs-state><p>{{ user }}</p><wcs-state json='{"user":"stray"}'></wcs-state>`;
    document.body.appendChild(h);
    const [first, second] = Array.from(root.querySelectorAll("wcs-state")) as any[];
    await expect(getBindingsReady(root)).resolves.toBeUndefined();
    await expect(second.connectedCallbackPromise).rejects.toThrow(/#47/);
    await first.connectedCallbackPromise;
    expect(root.querySelector("p")!.textContent).toBe("page");
    await expect(getBindingsReady(root)).resolves.toBeUndefined();
  });
});

describe("R3-3: getBindingsReady の時点（3.x の契約）", () => {
  const race = (p: Promise<unknown>, ms: number) =>
    Promise.race([p.then(() => "resolved", () => "rejected"), new Promise((r) => setTimeout(() => r("pending"), ms))]);

  for (const [label, cc] of [
    ["遅い", async () => { await new Promise((r) => setTimeout(r, 300)); }],
    ["終わらない", () => new Promise(() => {})],
    ["投げる", async () => { throw new Error("boom"); }],
  ] as const) {
    it(`束縛ができたら resolve する（$connectedCallback が${label}ときも）`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const h = document.createElement(`quality-ready-cc-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><p>{{ a }}</p>`;
      (root.querySelector("wcs-state") as any).setInitialState({ a: "A", $connectedCallback: cc });
      document.body.appendChild(h);
      expect(await race(getBindingsReady(root), 100)).toBe("resolved");
      expect(root.querySelector("p")!.textContent).toBe("A");
    });
  }

  it("先に接続した <wcs-state> が #47 で負けても（後から状態を受け取る 1 本目、先に束ねた 2 本目）、接続の直後に尋ねた分も後で尋ねた分も resolve する", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`quality-ready-lose-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ a }}</p><wcs-state json='{"a":"B"}'></wcs-state>`;
    document.body.appendChild(h);
    const [slow, fast] = Array.from(root.querySelectorAll("wcs-state")) as any[];
    // asked right after connecting: the slot holds the last connected (the fast one)
    const early = getBindingsReady(root);
    await fast.connectedCallbackPromise;
    slow.setInitialState({ a: "A" });
    await expect(slow.connectedCallbackPromise).rejects.toThrow(/#47/);
    await expect(early).resolves.toBeUndefined();
    await expect(getBindingsReady(root)).resolves.toBeUndefined();
    expect(root.querySelector("p")!.textContent).toBe("B");
  });

  it("後から接続した方が勝ったとき、先に接続した要素の待ちから尋ねても勝った方に引き継ぐ", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`quality-ready-handover-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ a }}</p>`;
    document.body.appendChild(h);
    const slow = root.querySelector("wcs-state") as any;
    // asked while only the slow one is connected
    const early = getBindingsReady(root);
    const fast = document.createElement("wcs-state") as any;
    fast.setInitialState({ a: "B" });
    root.appendChild(fast);
    await fast.connectedCallbackPromise;
    slow.setInitialState({ a: "A" });
    await expect(slow.connectedCallbackPromise).rejects.toThrow(/#47/);
    await expect(early).resolves.toBeUndefined();
  });
});

describe("R3-3: 迷い込んだ <wcs-state> と getBindingsReady", () => {
  const race = (p: Promise<unknown>, ms: number) =>
    Promise.race([p.then(() => "resolved", () => "rejected"), new Promise((r) => setTimeout(() => r("pending"), ms))]);

  it("束ね終えた root に、状態を受け取らない <wcs-state> が後から加わっても resolve する", async () => {
    const h = document.createElement(`quality-stray-late-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state json='{"a":"A"}'></wcs-state><p>{{ a }}</p>`;
    document.body.appendChild(h);
    expect(await race(getBindingsReady(root), 100)).toBe("resolved");
    root.appendChild(document.createElement("wcs-state"));
    expect(await race(getBindingsReady(root), 100)).toBe("resolved");
  });

  for (const [label, stray] of [
    ["壊れた json", `<wcs-state json='{oops'></wcs-state>`],
    ["無い state id", `<wcs-state state="nope"></wcs-state>`],
    ["状態を受け取らない（先に置かれた）", `<wcs-state></wcs-state>`],
  ]) {
    it(`同時に置かれた迷い込んだ <wcs-state>（${label}）は、ほかが束ねれば結果に影響しない`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const h = document.createElement(`quality-stray-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = label.includes("先に") ? `${stray}<wcs-state json='{"a":"A"}'></wcs-state><p>{{ a }}</p>` : `<wcs-state json='{"a":"A"}'></wcs-state><p>{{ a }}</p>${stray}`;
      document.body.appendChild(h);
      expect(await race(getBindingsReady(root), 200)).toBe("resolved");
      expect(root.querySelector("p")!.textContent).toBe("A");
    });
  }

  it("束ねた要素が 1 つも無く、すべて失敗したときだけ、最初の失敗で reject する", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`quality-stray-all-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state json='{oops'></wcs-state><wcs-state state="nope"></wcs-state>`;
    document.body.appendChild(h);
    await expect(getBindingsReady(root)).rejects.toThrow(/JSON|Unexpected|position/i);
  });
});

describe("R3-3: 外した <wcs-state> と getBindingsReady", () => {
  const race = (p: Promise<unknown>, ms: number) =>
    Promise.race([p.then(() => "resolved", () => "rejected"), new Promise((r) => setTimeout(() => r("pending"), ms))]);

  it("root を差し替えると（外した方が束ねていても）新しい root が決める: 失敗なら reject、状態を待つ間は待ち、受け取れば resolve", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`quality-replace-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state json='{"a":"A"}'></wcs-state><p>{{ a }}</p>`;
    document.body.appendChild(h);
    expect(await race(getBindingsReady(root), 100)).toBe("resolved");
    // replaced by a broken one
    root.innerHTML = `<wcs-state json='{oops'></wcs-state><p>{{ a }}</p>`;
    expect(await race(getBindingsReady(root), 100)).toBe("rejected");
    // replaced by one that waits for its state
    root.innerHTML = `<wcs-state></wcs-state><p>{{ a }}</p>`;
    const waiting = getBindingsReady(root);
    expect(await race(waiting, 50)).toBe("pending");
    (root.querySelector("wcs-state") as any).setInitialState({ a: "B" });
    expect(await race(waiting, 100)).toBe("resolved");
    expect(root.querySelector("p")!.textContent).toBe("B");
  });

  it("外して戻した（再接続した）要素は、また数に入る", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`quality-reattach-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state json='{"a":"A"}'></wcs-state><p>{{ a }}</p>`;
    document.body.appendChild(h);
    const el = root.querySelector("wcs-state")!;
    await getBindingsReady(root);
    el.remove();
    // a broken one comes meanwhile (the list leaves the removed one out)
    const broken = document.createElement("wcs-state");
    broken.setAttribute("json", "{oops");
    root.appendChild(broken);
    expect(await race(getBindingsReady(root), 100)).toBe("rejected");
    root.prepend(el);
    expect(await race(getBindingsReady(root), 100)).toBe("resolved");
  });
});

describe("H1: カスタム要素の on*:（委譲とバブルしないイベント）", () => {
  const card = (): string => {
    const t = `quality-card-${seq++}`;
    customElements.define(t, class extends HTMLElement {});
    return t;
  };

  for (const [label, wrap] of [
    ["ページの直下", (s: string) => s],
    ["行の中（カードが行の先頭）", (s: string) => `<template data-wcs="for: items">${s}</template>`],
    ["行の中（カードが入れ子）", (s: string) => `<ul><template data-wcs="for: items"><li>${s}</li></template></ul>`],
  ] as const) {
    it(`カードの中のボタンの #stop でカードのハンドラは呼ばれず、#stop が無ければ内側から順に呼ばれる（${label}）`, async () => {
      const t = card();
      const calls: string[] = [];
      const { root } = await page(wrap(`<${t} data-wcs="onclick: open"><button class="stop" data-wcs="onclick#stop: del">x</button><button class="go" data-wcs="onclick: del">y</button></${t}>`), {
        items: [1], open() { calls.push("open"); }, del() { calls.push("del"); },
      });
      (root.querySelector(".stop") as HTMLElement).click();
      expect(calls.splice(0)).toEqual(["del"]);
      (root.querySelector(".go") as HTMLElement).click();
      expect(calls.splice(0)).toEqual(["del", "open"]);
    });
  }

  it("バブルするイベントは委譲（currentTarget はルート）、バブルしないイベントは要素の上で。カード自身に出たバブルするイベントでもハンドラは 1 回", async () => {
    const t = card();
    const seen: [string, EventTarget | null][] = [];
    const { root } = await page(`<${t} data-wcs="onclick: hit; onchange: hit"></${t}>`, { hit(e: Event) { seen.push([e.type, e.currentTarget]); } });
    const el = root.querySelector(t)!;
    el.dispatchEvent(new Event("click", { bubbles: true }));
    el.dispatchEvent(new Event("change"));
    expect(seen).toEqual([["click", root], ["change", el]]);
  });
});

describe("H2: $connectedCallback が失敗した（束ね終えた）root の横の 2 本目", () => {
  it("束縛を作り終えた後に $connectedCallback が reject しても、2 本目は #47 で拒まれ、後から渡した本文は 1 本目の状態で束ねる", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`quality-cc-reject-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ msg }}</p><main></main>`;
    const first = root.querySelector("wcs-state") as any;
    first.setInitialState({ msg: "A", async $connectedCallback() { throw new Error("fetch failed"); } });
    document.body.appendChild(h);
    await expect(first.connectedCallbackPromise).rejects.toThrow("fetch failed");
    const second = document.createElement("wcs-state") as any;
    second.setInitialState({ msg: "B" });
    root.append(second);
    await expect(second.connectedCallbackPromise).rejects.toThrow(/#47/);
    const section = document.createElement("section");
    section.innerHTML = `<i>{{ msg }}</i>`;
    root.querySelector("main")!.append(section);
    (globalThis as any)[BINDER_KEY].bind(section);
    expect(section.textContent).toBe("A");
    await expect(getBindingsReady(root)).resolves.toBeUndefined();
  });
  it("部品の shadow root（bind-component の <wcs-state> が束ねた）に迷い込んだ 2 本目も #47 で拒まれる", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tag = `quality-cmp-second-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state = { a: "C" };
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><p>{{ a }}</p>`;
      }
    });
    const host = document.createElement(tag);
    document.body.appendChild(host);
    const root = host.shadowRoot!;
    await (root.querySelector("wcs-state") as any).connectedCallbackPromise;
    expect(root.querySelector("p")!.textContent).toBe("C");
    const stray = document.createElement("wcs-state") as any;
    stray.setInitialState({ a: "S" });
    root.appendChild(stray);
    await expect(stray.connectedCallbackPromise).rejects.toThrow(/#47/);
    const late = document.createElement("i");
    late.setAttribute("data-wcs", "textContent: a");
    root.appendChild(late);
    (globalThis as any)[BINDER_KEY].bind(late);
    expect(late.textContent).toBe("C");
  });
});

describe("H3: binder に渡したサブツリーの誤りと、それを含む要素", () => {
  it("誤りを含む要素（文書順で誤りより前）の束縛と誤りより前の子は束ね、誤りより後ろは束ねない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root } = await page(`<main></main>`, { msg: "m", on: true });
    const box = document.createElement("div");
    box.innerHTML = `<section data-wcs="class.on: on"><p class="a" data-wcs="text: msg"></p><p data-wcs="text msg"></p><p class="c" data-wcs="text: msg"></p></section>`;
    const section = box.firstElementChild!;
    root.querySelector("main")!.appendChild(section);
    (globalThis as any)[BINDER_KEY].bind(section);
    expect(section.classList.contains("on")).toBe(true);
    expect(section.querySelector(".a")!.textContent).toBe("m");
    expect(section.querySelector(".c")!.textContent).toBe("");
    expect(error.mock.calls.map((c) => String((c[0] as Error).message))).toEqual([expect.stringContaining("#101")]);
  });

  it("誤りの後で束ねた要素が中に描いた値も、束縛として読まない（渡し直しても）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tag = `quality-fill-bad-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      set body(v: string) { this.querySelector(".slot")!.innerHTML = v; }
    });
    const calls: string[] = [];
    const { root } = await page(`<main></main>`, {
      comment: `{{ secret }} <button data-wcs="onclick: wipe">win</button>`, secret: "s3cr3t", wipe() { calls.push("wiped"); },
    });
    const box = document.createElement("div");
    box.innerHTML = `<${tag} data-wcs="body: comment"><div class="slot"></div><p data-wcs="text msg"></p></${tag}>`;
    const el = box.firstElementChild!;
    root.querySelector("main")!.appendChild(el);
    const binder = (globalThis as any)[BINDER_KEY];
    binder.bind(el);
    binder.bind(el.querySelector(".slot")!);
    expect(el.querySelector(".slot")!.textContent).toBe("{{ secret }} win");
    (el.querySelector("button") as HTMLElement).click();
    expect(calls).toEqual([]);
  });
});

describe("H4: iframe 以外の attr.srcdoc:", () => {
  it("属性として書く（srcdoc 属性を見るカスタム要素に届き、値が無ければ属性を外す）", async () => {
    const tag = `quality-sandbox-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static observedAttributes = ["srcdoc"];
      seen: (string | null)[] = [];
      attributeChangedCallback(_n: string, _o: string | null, v: string | null): void { this.seen.push(v); }
    });
    const { root, el } = await page(`<${tag} data-wcs="attr.srcdoc: doc"></${tag}><div data-wcs="attr.srcdoc: doc"></div>`, { doc: "<b>x</b>" });
    const sandbox = root.querySelector(tag) as any;
    expect(sandbox.seen).toEqual(["<b>x</b>"]);
    expect(root.querySelector("div")!.getAttribute("srcdoc")).toBe("<b>x</b>");
    el.createState("writable", (s: any) => { s.doc = null; });
    await flush();
    expect(sandbox.seen).toEqual(["<b>x</b>", null]);
  });
});

describe("G1(b): 宣言の形が誤った再セット", () => {
  it("$commandTokens / $eventTokens / $on の誤りで投げた再セットは、古い状態をそのまま残す（束縛も古い状態のまま動く）", async () => {
    const { root, el } = await page(`<p>{{ n }}</p>`, { n: 1 });
    for (const bad of [{ $commandTokens: "go" }, { $eventTokens: ["a", "a"] }, { $eventTokens: ["a"], $on: { b() {} } }]) {
      expect(() => el.setInitialState({ n: 2, ...bad })).toThrow();
    }
    let n: unknown;
    el.createState("readonly", (s: any) => { n = s.n; });
    expect(n).toBe(1);
    el.createState("writable", (s: any) => { s.n = 3; });
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("3");
  });
});

describe("I1: DOM の無い環境での import", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("ブラウザでは HTMLElement を基底にする", async () => {
    const { HTMLElementBase, WcsState } = await import("../src/element");
    expect(HTMLElementBase).toBe(HTMLElement);
    expect(Object.getPrototypeOf(WcsState)).toBe(HTMLElement);
  });

  it("HTMLElement が無くても . と /core を import でき（要素のクラスは不活性な基底の上）、マニフェストや VERSION を読める", async () => {
    vi.stubGlobal("HTMLElement", undefined);
    vi.resetModules();
    const full = await import("../src/exports");
    const core = await import("../src/core");
    const { HTMLElementBase } = await import("../src/element");
    expect(typeof full.VERSION).toBe("string");
    expect(core.VERSION).toBe(full.VERSION);
    expect(typeof full.Ssr).toBe("function");
    expect(() => new HTMLElementBase()).not.toThrow();
  });
});

describe("I2: $connectedCallback が reject した（束ね終えた）root の再セット", () => {
  it("setInitialState で状態を置き換えられる（初期化に失敗した root は #14 のまま）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`quality-cc-reset-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p data-wcs="textContent: msg"></p><wcs-state json='{oops'></wcs-state>`;
    const [el, broken] = Array.from(root.querySelectorAll("wcs-state")) as any[];
    el.setInitialState({ msg: "a", async $connectedCallback() { throw new Error("network down"); } });
    document.body.appendChild(h);
    await expect(el.connectedCallbackPromise).rejects.toThrow("network down");
    el.setInitialState({ msg: "c" });
    expect(root.querySelector("p")!.textContent).toBe("c");
    await expect(broken.connectedCallbackPromise).rejects.toThrow();
    expect(() => broken.setInitialState({ msg: "x" })).toThrow(/#14/);
  });
});

describe("I4: formats アドオンの無いページの書式フィルタ", () => {
  afterEach(() => vi.resetModules());

  it("壁の文面は公開エントリの入れ方（installFeatures([formats]) と features/formats）を示す", async () => {
    vi.resetModules();
    const { resolveFilter } = await import("../src/filters/registry");
    expect(() => resolveFilter("upper", [], [])).toThrow(
      `"upper" is in the formats add-on — install it with installFeatures([formats]) from "@wcstack/state/features/formats".`,
    );
  });
});

describe("I6: パーサのエントリ（lint・拡張が使う）も __proto__ / prototype の段を拒む", () => {
  afterEach(() => vi.resetModules());

  it("実行時と同じ範囲で #120 で拒む: 解決するパス（ドット付きのハンドラ名を含む）は拒み、パスでない右辺（トークン名・単独のメソッド名）は通す", async () => {
    vi.resetModules();
    const parser = await import("../src/public/parser");
    for (const text of ["textContent: user.__proto__", "textContent: fn.prototype.x", "for: __proto__", "if: a.prototype", "onclick: tools.prototype"]) {
      expect(() => parser.parseBindTextsForElement(text), text).toThrow(/[wcs/binding-syntax].*"__proto__" or "prototype"/);
    }
    expect(() => parser.parseBindTextForEmbeddedNode("user.__proto__")).toThrow(/"__proto__" or "prototype"/);
    for (const text of ["onclick: prototype", "onclick: $command.prototype", "command.go: $command.prototype", "eventToken.value: prototype"]) {
      expect(() => parser.parseBindTextsForElement(text), text).not.toThrow();
    }
    expect(parser.getPathInfo("prototype").segments).toEqual(["prototype"]);
    expect(parser.parseBindTextsForElement("textContent: user.proto")[0].statePathInfo.segments).toEqual(["user", "proto"]);
  });

  it("（実行時）単独のメソッド名 prototype と command トークン prototype は動き、ドット付きのハンドラ名は #120 で拒む", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    const { root, el } = await page(
      `<button class="m" data-wcs="onclick: prototype">m</button><button class="c" data-wcs="onclick: $command.prototype">c</button><button class="d" data-wcs="onclick: tools.prototype">d</button>`,
      { prototype() { calls.push("method"); }, $commandTokens: ["prototype"], tools: {} },
    );
    el.createState("readonly", (s: any) => { s.$command.prototype.subscribe(() => calls.push("command")); });
    for (const c of ["m", "c", "d"]) (root.querySelector(`.${c}`) as HTMLElement).click();
    expect(calls).toEqual(["method", "command"]);
    expect(error.mock.calls.map((c) => String((c[0] as Error).message))).toEqual([expect.stringMatching(/#120/)]);
  });
});

describe("I8: 表示する for の無い一覧の失敗と $errorCallback の info.node", () => {
  it("$getAll だけが読む一覧が再セットで読めなくなると、for の失敗として node: null で報告する", async () => {
    const infos: { path: string; bindingType: string; node: Node | null }[] = [];
    const errorCallback = (_e: unknown, info: { path: string; bindingType: string; node: Node | null }) => { infos.push(info); };
    const { root, el } = await page(`<p data-wcs="textContent: total"></p>`, {
      items: [{ v: 1 }, { v: 2 }], $errorCallback: errorCallback,
      get total() { return (this as any).$getAll("items.*.v", []).length; },
    });
    expect(root.querySelector("p")!.textContent).toBe("2");
    el.setInitialState({
      $errorCallback: errorCallback,
      get items(): unknown { throw new Error("items unavailable"); },
      get total() { return 0; },
    });
    await flush();
    const forInfo = infos.find((i) => i.bindingType === "for")!;
    expect([forInfo.path, forInfo.node]).toEqual(["items", null]);
  });
});

describe("R7: コメント束縛（<!--@@: expr--> / <!--@@wcs-text: expr-->。3.x と同じ DOM）", () => {
  const nodes = (el: Element) => Array.from(el.childNodes, (n) => (n.nodeType === 3 ? `t:${(n as Text).data}` : n.nodeType === 8 ? `c:${(n as Comment).data}` : `e:${(n as Element).outerHTML}`));
  // what @wcstack/state 3.x (packages/state/src) gives for the same page, before and after the write
  const V3 = {"before":{"a":["t:Hello ","t:Alice","t:!"],"b":["t:Alice"],"c":["t:2"],"d":["c:@@route:/x","c:@@wcs-route-start:/x","c:@@wcs-text-start:x","c: plain ","c:@@:"],"e":["t:Alice"],"li":[["t:x","t: / ","t:x"],["t:y","t: / ","t:y"]],"span":[["t:Alice"]],"g":"xy"},"after":{"a":["t:Hello ","t:Bob","t:!"],"b":["t:Bob"],"c":["t:6"],"d":["c:@@route:/x","c:@@wcs-route-start:/x","c:@@wcs-text-start:x","c: plain ","c:@@:"],"e":["t:Bob"],"li":[["t:x","t: / ","t:x"],["t:y","t: / ","t:y"],["t:z","t: / ","t:z"]],"span":[["t:Bob"]],"g":"xyz"}};

  it("ページの直下と for: / if: の中で {{ }} と同じテキスト束縛になり（フィルタも）、コメントはテキストに置き換わる。ほかのキーワードのコメントは残る", async () => {
    const { root, el } = await page(
      `<p id="a">Hello <!--@@: name-->!</p>`
      + `<p id="b"><!--@@wcs-text:name--></p>`
      + `<p id="c"><!-- @@ : count|add(1) --></p>`
      + `<p id="d"><!--@@route:/x--><!--@@wcs-route-start:/x--><!--@@wcs-text-start:x--><!-- plain --><!--@@:--></p>`
      + `<p id="e"><!--@@ wcs-text : name --></p>`
      + `<ul><template data-wcs="for: items"><li><!--@@: .label--> / <!--@@wcs-text:.label--></li></template></ul>`
      + `<div id="f"><template data-wcs="if: show"><span><!--@@: name--></span></template></div>`
      + `<div id="g"><template data-wcs="for: items"><!--@@: .label--></template></div>`,
      { name: "Alice", count: 1, show: true, items: [{ label: "x" }, { label: "y" }] },
    );
    const snap = () => ({
      a: nodes(root.querySelector("#a")!), b: nodes(root.querySelector("#b")!), c: nodes(root.querySelector("#c")!),
      d: nodes(root.querySelector("#d")!), e: nodes(root.querySelector("#e")!),
      li: Array.from(root.querySelectorAll("li"), (li) => nodes(li)),
      span: Array.from(root.querySelectorAll("span"), (s) => nodes(s)),
      g: root.querySelector("#g")!.textContent,
    });
    expect(snap()).toEqual(V3.before);
    el.createState("writable", (s: any) => { s.name = "Bob"; s.count = 5; s.items = [...s.items, { label: "z" }]; });
    await flush();
    expect(snap()).toEqual(V3.after);
  });

  it("$behavior.enableMustache: false のページでも束ねる（{{ }} は文字のまま。3.x と同じ）", async () => {
    const { root } = await page(`<p id="m">{{ name }}</p><p id="n">Hi <!--@@: name--></p><ul><template data-wcs="for: items"><li>{{ .label }}<!--@@: .label--></li></template></ul>`, {
      name: "Alice", items: [{ label: "x" }], $behavior: { enableMustache: false },
    });
    expect({ m: nodes(root.querySelector("#m")!), n: nodes(root.querySelector("#n")!), li: nodes(root.querySelector("li")!) })
      .toEqual({ m: ["t:{{ name }}"], n: ["t:Hi ", "t:Alice"], li: ["t:{{ .label }}", "t:x"] });
  });

  it("値の中のコメントは束縛にしない: 中身を束縛する要素の値・作者の子・noscript / iframe・カスタム要素が中に描いた値（後順）", async () => {
    const tag = `quality-fill-comment-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      set body(v: string) { this.querySelector(".slot")!.innerHTML = v; }
    });
    const { root } = await page(
      `<div class="h" data-wcs="innerHTML: html"></div><p class="t" data-wcs="textContent: msg"><!--@@: secret--></p>`
      + `<noscript><!--@@: secret--></noscript><${tag} data-wcs="body: html"><div class="slot"></div><i><!--@@: msg--></i></${tag}>`,
      { html: `<b><!--@@: secret--></b>`, msg: "m", secret: "s3cr3t" },
    );
    expect(root.querySelector(".h")!.innerHTML).toBe("<b><!--@@: secret--></b>");
    expect(root.querySelector(".t")!.textContent).toBe("m");
    expect(root.querySelector(".slot")!.innerHTML).toBe("<b><!--@@: secret--></b>");
    // the author's own child of the element is bound (walked before the element's bindings)
    expect(root.querySelector(`${tag} i`)!.textContent).toBe("m");
    expect(root.innerHTML).not.toContain("s3cr3t");
  });

  it("<textarea> / <title> の中のコメントは束縛しない（ブラウザのパーサは文字にする。サーバの DOM はコメントにすることがある）: CSR でも SSR でも（data-wcs-raw にも載らない）", async () => {
    const make = () => {
      const ta = document.createElement("textarea");
      ta.append(document.createComment("@@: name"));
      const title = document.createElement("title");
      title.append(document.createComment("@@wcs-text: name"));
      return [ta, title];
    };
    const { root } = await page(`<main></main>`, { name: "Alice" });
    const [ta, title] = make();
    root.querySelector("main")!.append(ta, title);
    (globalThis as any)[BINDER_KEY].bind(root.querySelector("main")!);
    expect([ta.innerHTML, title.innerHTML]).toEqual(["<!--@@: name-->", "<!--@@wcs-text: name-->"]);
    // the server's DOM (happy-dom, as @wcstack/server's) parses a comment in a <textarea>
    const r = await ssrRoundTrip(`<textarea><!--@@: name--></textarea><p>{{ name }}</p>`, () => ({ name: "Alice" }));
    expect(r.server).not.toContain("data-wcs-raw");
    expect(r.root.querySelector("textarea")!.innerHTML).toBe("<!--@@: name-->");
    expect(r.root.querySelector("p")!.textContent).toBe("Alice");
    // with a mustache beside it, the comment goes to the client as the text a browser reads there
    const r2 = await ssrRoundTrip(`<textarea>{{ name }}<!-- note --></textarea>`, () => ({ name: "Alice" }));
    expect(r2.server).toContain(`data-wcs-raw="{{ name }}<!-- note -->"`);
    expect((r2.root.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Alice<!-- note -->");
  });

  it("SSR: サーバで値を描き、クライアントで束ね直す（enableMustache: false でも。{{ }} は従来どおり）", async () => {
    for (const mustache of [true, false]) {
      const { server, root, el } = await ssrRoundTrip(
        `<p class="c">Hi <!--@@: name-->!</p><p class="m">{{ name }}</p><ul><template data-wcs="for: items"><li><!--@@: .label--></li></template></ul>`,
        () => ({ name: "Alice", items: [{ label: "x" }], $behavior: { enableMustache: mustache } }),
      );
      expect(server).toContain("Alice");
      expect(server).not.toContain("@@: name");
      expect(root.querySelector(".c")!.textContent).toBe("Hi Alice!");
      expect(root.querySelector(".m")!.textContent).toBe(mustache ? "Alice" : "{{ name }}");
      el.createState("writable", (s: any) => { s.name = "Bob"; s.items = [...s.items, { label: "y" }]; });
      await flush();
      expect([root.querySelector(".c")!.textContent, root.querySelector(".m")!.textContent], String(mustache)).toEqual(["Hi Bob!", mustache ? "Bob" : "{{ name }}"]);
      expect(Array.from(root.querySelectorAll("li"), (li) => li.textContent)).toEqual(["x", "y"]);
    }
  });

  it("SSR: 値の中の <!--@@: secret--> は、サーバの出力からもクライアントでも束縛にならない（innerHTML: の値・カスタム要素が描いた値）", async () => {
    const tag = `quality-fill-comment-ssr-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      set body(v: string) { this.querySelector(".slot")!.innerHTML = v; }
    });
    const { server, root } = await ssrRoundTrip(
      `<div class="h" data-wcs="innerHTML: html"></div><${tag} data-wcs="body: html"><div class="slot"></div></${tag}>`,
      () => ({ html: `<b><!--@@: secret--></b>`, secret: "s3cr3t" }),
    );
    // (the state's data is in the snapshot's JSON: the page's markup is what the client walks)
    expect(server.replace(/<wcs-ssr[\s\S]*?<\/wcs-ssr>/, "")).not.toContain("s3cr3t");
    expect(server).toContain(`<div class="slot"></div>`);
    expect(root.innerHTML).not.toContain("s3cr3t");
    expect(root.querySelector(".h b")!.innerHTML).toBe("<!--@@: secret-->");
    expect(root.querySelector(".slot b")!.innerHTML).toBe("<!--@@: secret-->");
  });
});

describe("F4: on*#direct:（委譲せず要素に直接付ける。3.x と同じ）", () => {
  it("(a) #direct,stop はページ側のコードが祖先に付けたリスナーを止め、currentTarget は要素", async () => {
    const calls: string[] = [];
    const { root } = await page(`<div class="card"><button data-wcs="onclick#direct,stop: save">s</button></div>`, {
      save(e: Event) { calls.push(e.currentTarget === root.querySelector("button") ? "save@button" : "save@other"); },
    });
    root.querySelector(".card")!.addEventListener("click", () => calls.push("card"));
    (root.querySelector("button") as HTMLElement).click();
    expect(calls).toEqual(["save@button"]);
  });

  it("(b) 祖先が stopPropagation() しても呼ばれる（#direct の無い onclick: は呼ばれない）", async () => {
    const calls: string[] = [];
    const { root } = await page(`<div class="content"><button class="d" data-wcs="onclick#direct: save">d</button><button class="n" data-wcs="onclick: save">n</button></div>`, {
      save(e: Event) { calls.push((e.target as Element).className); },
    });
    root.querySelector(".content")!.addEventListener("click", (e) => e.stopPropagation());
    (root.querySelector(".d") as HTMLElement).click();
    (root.querySelector(".n") as HTMLElement).click();
    expect(calls).toEqual(["d"]);
  });

  it("(c) 別の root へ移した要素でも呼ばれる（F38。委譲の onclick: は呼ばれない）", async () => {
    const calls: string[] = [];
    const { root } = await page(`<button class="d" data-wcs="onclick#direct: save">d</button><button class="n" data-wcs="onclick: save">n</button>`, {
      save(e: Event) { calls.push((e.target as Element).className); },
    });
    const other = document.createElement(`quality-other-${seq++}`);
    const otherRoot = other.attachShadow({ mode: "open" });
    document.body.appendChild(other);
    otherRoot.append(root.querySelector(".d")!, root.querySelector(".n")!);
    (otherRoot.querySelector(".d") as HTMLElement).click();
    (otherRoot.querySelector(".n") as HTMLElement).click();
    expect(calls).toEqual(["d"]);
  });

  it("行の中: 行ごとに要素に付き（添字を渡す）、#prevent と組み合わせられ、行を消すと外れる", async () => {
    const calls: [number, boolean][] = [];
    const { root, el } = await page(`<ul><template data-wcs="for: items"><li><a href="#x" data-wcs="onclick#direct,prevent: pick">{{ . }}</a></li></template></ul>`, {
      items: ["a", "b", "c"],
      pick(e: Event, i: number) { calls.push([i, e.defaultPrevented]); },
    });
    root.querySelector("li")!.addEventListener("click", (e) => e.stopPropagation());
    const links = Array.from(root.querySelectorAll("a"));
    links[0].click();
    links[2].click();
    expect(calls.splice(0)).toEqual([[0, true], [2, true]]);
    el.createState("writable", (s: any) => { s.items = ["a", "c"]; });
    await flush();
    // the removed row's element: its listener went with the row
    links[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(calls).toEqual([]);
    (root.querySelectorAll("a")[1] as HTMLElement).click();
    expect(calls).toEqual([[1, true]]);
  });

  it("組み合わせ: 外側の #direct は中の委譲のハンドラより先に走り（DOM の順）、中の #stop で止めるには中も #direct にする", async () => {
    const calls: string[] = [];
    const { root } = await page(
      `<div data-wcs="onclick#direct: outer"><button class="n" data-wcs="onclick#stop: inner">n</button><button class="d" data-wcs="onclick#direct,stop: inner">d</button></div>`,
      { outer() { calls.push("outer"); }, inner() { calls.push("inner"); } },
    );
    (root.querySelector(".n") as HTMLElement).click();
    expect(calls.splice(0)).toEqual(["outer", "inner"]);
    (root.querySelector(".d") as HTMLElement).click();
    expect(calls).toEqual(["inner"]);
  });

  it("パーサと manifest も #direct を知っている", async () => {
    const { getWcsManifest } = await import("../src/public/manifest");
    expect(getWcsManifest().syntax.modifiers.flags).toContain("direct");
    const { parseBindTextsForElement } = await import("../src/parser/parseBindTextsForElement");
    expect(parseBindTextsForElement("onclick#direct,stop: save")[0].propModifiers).toEqual(["direct", "stop"]);
  });
});

describe("K2: テンプレートの中の outerHTML / outerText の名前（#203 は要素を置き換えるプロパティだけ）", () => {
  it("class.outerHTML: / attr.outerText: / on…: のイベントは for: の中でも拒まず、要素の子も走査する。.outerHTML: と outerText: は拒む", async () => {
    const calls: string[] = [];
    const { root, el } = await page(
      `<template data-wcs="for: items"><p data-wcs="class.outerHTML: .on; attr.outerText: .t; onouterHTML: hit"><b>{{ .t }}</b></p></template>`,
      { items: [{ on: true, t: "x" }], hit() { calls.push("hit"); } },
    );
    const p = root.querySelector("p")!;
    expect([p.classList.contains("outerHTML"), p.getAttribute("outerText"), p.textContent]).toEqual([true, "x", "x"]);
    p.dispatchEvent(new Event("outerHTML"));
    expect(calls).toEqual(["hit"]);
    const { compilePlan } = await import("../src/dom/plan");
    const engine = el.engine as Engine;
    for (const bind of [".outerHTML: html", "outerText: t"]) {
      const t = document.createElement("template");
      t.innerHTML = `<p data-wcs="${bind}"></p>`;
      expect(() => compilePlan(engine, t, null, false), bind).toThrow(/#203|replaces its element/);
    }
  });

  it("ページの直下の class.outerHTML: の要素の子は束ね、SSR のサーバも class.outerHTML: を外さない", async () => {
    const { root } = await page(`<div data-wcs="class.outerHTML: on"><i>{{ t }}</i></div>`, { on: true, t: "x" });
    expect([root.querySelector("div")!.className, root.querySelector("i")!.textContent]).toEqual(["outerHTML", "x"]);
    const r = await ssrRoundTrip(`<div data-wcs="class.outerHTML: on"><i>{{ t }}</i></div>`, () => ({ on: true, t: "x" }));
    expect(r.server).toContain(`class="outerHTML"`);
    expect([r.root.querySelector("div")!.className, r.root.querySelector("i")!.textContent]).toEqual(["outerHTML", "x"]);
  });
});

describe("#204 を緩める: binder の bind(subtree, { range: true })（挿入した側が範囲を持ち運ぶ宣言）", () => {
  const handOver = (root: ShadowRoot, html: string): Node[] => {
    const box = document.createElement("template");
    box.innerHTML = html;
    const nodes = [...box.content.childNodes];
    root.querySelector("main")!.append(...nodes);
    return nodes;
  };

  it("宣言付きで渡された直下の for: / if: を描き、別々に渡された if: と else: は 1 つの連鎖になる", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, el } = await page(`<main></main>`, { items: ["a", "b"], on: false });
    const binder = (globalThis as any)[BINDER_KEY];
    const nodes = handOver(root, `<template data-wcs="for: items"><p class="row">{{ . }}</p></template><template data-wcs="if: on"><b class="on">on</b></template><template data-wcs="else:"><b class="off">off</b></template>`);
    for (const n of nodes) binder.bind(n, { range: true });
    const main = root.querySelector("main")!;
    const show = () => Array.from(main.querySelectorAll(".row, .on, .off"), (n) => n.textContent).join(",");
    expect(show()).toBe("a,b,off");
    expect(main.querySelectorAll("template").length).toBe(0);
    el.createState("writable", (s: any) => { s.on = true; s.items = ["c"]; });
    await flush();
    expect(show()).toBe("c,on");
    // handed over again (a router does on every insertion): nothing more
    for (const n of nodes) binder.bind(n, { range: true });
    expect(show()).toBe("c,on");
    expect(error).not.toHaveBeenCalled();
  });

  it("宣言の無い bind（<wcs-head>、古い router）は従来どおり #204 で拒み、宣言が false でも同じ", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root } = await page(`<main></main>`, { items: ["a"] });
    const binder = (globalThis as any)[BINDER_KEY];
    const [a] = handOver(root, `<template data-wcs="for: items"><p class="row">{{ . }}</p></template>`);
    binder.bind(a);
    const [b] = handOver(root, `<template data-wcs="if: items"><p class="row">x</p></template>`);
    binder.bind(b, { range: false });
    expect(root.querySelectorAll("main .row").length).toBe(0);
    expect(error.mock.calls.map((c) => String((c[0] as Error).message))).toEqual([expect.stringContaining("#204"), expect.stringContaining("#204")]);
  });
});
