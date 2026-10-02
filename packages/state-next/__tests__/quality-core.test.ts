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

describe("A3: カスタム要素の on*: は要素に直接付く", () => {
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
  it("オブジェクト（ページ自身の policy の TrustedHTML）は文字列にせず、state の policy も通さない", async () => {
    const seen: unknown[] = [];
    setTrustedTypesPolicy({ createHTML(s: string) { seen.push(s); return s; } });
    const trusted = { toString: () => "<b>trusted</b>" };
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
  });

  it("outerHTML: / srcdoc: の undefined は何も書かない（要素は DOM に残る）", async () => {
    const { root, proxy } = setup(`<p><b data-wcs="outerHTML: frag">old</b></p><iframe data-wcs="srcdoc: doc"></iframe>`, { frag: undefined, doc: "<i>d</i>" });
    await flush();
    expect(root.querySelector("p > b")!.textContent).toBe("old");
    proxy.doc = undefined;
    await flush();
    expect((root.querySelector("iframe") as HTMLIFrameElement).srcdoc).toBe("<i>d</i>");
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

  it("BN2: 定義が後から来るカスタム要素の innerHTML: の子は、値が入る前でも走査しない（定義の後に値が入る）", async () => {
    const tag = `quality-late-${seq++}`;
    let called = 0;
    const { root } = await page(
      `<${tag} data-wcs="innerHTML: html"><b>{{ secret }}</b><button data-wcs="onclick: danger">b</button></${tag}><p data-wcs="textContent: msg"><i>{{ secret }}</i></p>`,
      { secret: "SECRET", msg: "m", html: "<u>value</u>", danger() { called++; } },
    );
    (root.querySelector("button") as HTMLElement).click();
    expect(root.querySelector("b")!.textContent).toBe("{{ secret }}");
    expect(called).toBe(0);
    customElements.define(tag, class extends HTMLElement {});
    await flush();
    expect(root.querySelector(tag)!.innerHTML).toBe("<u>value</u>");
    expect(root.querySelector("p")!.textContent).toBe("m");
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

describe("C11: 描いている一覧のキーが無い状態への再セット", () => {
  it("その一覧の for の失敗として報告し、再セットは最後まで進む（reset の受け口が呼ばれ、以後の書き込みも描かれる）", async () => {
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
      expect(() => el.setInitialState({
        n: 1,
        $errorCallback(_e: unknown, info: { path: string; bindingType: string }) { reported.push([info.bindingType, info.path]); },
      })).not.toThrow();
      expect(reported).toEqual([["for", "items"]]);
      expect(phases).toContain("reset");
      expect(root.querySelector("p")!.textContent).toBe("1");
      el.createState("writable", (s: any) => { s.n = 2; });
      await flush();
      expect(root.querySelector("p")!.textContent).toBe("2");
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
