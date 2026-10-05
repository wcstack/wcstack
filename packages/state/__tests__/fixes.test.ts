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

describe("F9 丸ごとのマウントの隣の深い部分対応は、最も長い接頭辞が勝つ（3.x と同じ）", () => {
  async function setup() {
    const tag = component(`<p class="ab">{{ a.b.v }}</p><p class="ac">{{ a.c }}</p>`, () => ({
      setC(this: any) { this["a.c"] = "from-component-c"; },
      setB(this: any) { this["a.b.v"] = "from-component-b"; },
    }));
    const p = await page(`<p class="host">{{ user.a.c }}|{{ user.a.b.v }}|{{ outer.b.v }}</p><${tag} data-wcs="state: user; state.a.b: outer.b"></${tag}>`, {
      user: { a: { b: { v: "user-a-b" }, c: "user-a-c" } },
      outer: { b: { v: "outer-b" } },
    });
    const c = p.root.querySelector(tag) as any;
    const shown = () => [c.shadowRoot.querySelector(".ab").textContent, c.shadowRoot.querySelector(".ac").textContent, p.root.querySelector(".host")!.textContent];
    return { ...p, c, shown };
  }

  it("a.b は深い対応（outer.b）、その隣の a.c は丸ごとのマウント（user.a.c）を読む", async () => {
    const { shown } = await setup();
    expect(shown()).toEqual(["outer-b", "user-a-c", "user-a-c|user-a-b|outer-b"]);
  });

  it("ホストの書き込みは、それぞれの対応を通って届く", async () => {
    const { write, shown } = await setup();
    await write((s) => { s["user.a.c"] = "c2"; s["user.a.b.v"] = "not-mapped"; });
    expect(shown()).toEqual(["outer-b", "c2", "c2|not-mapped|outer-b"]);
    await write((s) => { s["outer.b.v"] = "b2"; });
    expect(shown()).toEqual(["b2", "c2", "c2|not-mapped|b2"]);
    await write((s) => { s["user.a"] = { b: { v: "replaced" }, c: "c3" }; });
    expect(shown()).toEqual(["b2", "c3", "c3|replaced|b2"]);
  });

  it("コンポーネントの書き込みは、それぞれの対応の先に届く", async () => {
    const { c, shown } = await setup();
    c.state.setC();
    c.state.setB();
    await flush();
    await flush();
    expect(shown()).toEqual(["from-component-b", "from-component-c", "from-component-c|user-a-b|from-component-b"]);
  });
});

describe("F10 コンポーネント側のパスにワイルドカードのある対応は、黙って無視せず報告する", () => {
  it("state.list.*: items", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const tag = component(`<ul><template data-wcs="for: list"><li>{{ . }}</li></template></ul>`, () => ({ list: ["own"] }));
      await page(`<${tag} data-wcs="state.list.*: items"></${tag}>`, { items: ["a", "b"] });
      await flush();
      // (logged after the line that names the element)
      const messages = error.mock.calls.flatMap((c) => c.map((x) => String((x as Error)?.message ?? x)));
      expect(messages).toContain(`[@wcstack/state] <${tag}> maps "state.list.*": the component-side path of a mount cannot contain "*" — map the list itself ("state.list: <the host's list>").`);
    } finally {
      error.mockRestore();
    }
  });
});

describe("F16 wcBindable の無い要素の #init= は、初期の書き込みだけをしない（3.3 と同じ。次の変化から流れる）", () => {
  it.each(["none", "element"])("init=%s: 要素の値のまま。次の書き込みから流れる", async (init) => {
    const { root, write, read } = await page(`<input value="html" data-wcs="value#init=${init}: name">`, { name: "state" });
    const input = root.querySelector("input")!;
    expect(input.value).toBe("html");
    expect(read("name")).toBe("state");
    await write((s) => { s.name = "next"; });
    expect(input.value).toBe("next");
  });

  it("init=auto: 状態に値があれば書き、undefined なら要素の値のまま", async () => {
    const { root, write } = await page(`<input class="set" value="html" data-wcs="value#init=auto: a"><input class="unset" value="html" data-wcs="value#init=auto: b">`, { a: "state", b: undefined });
    const value = (c: string) => (root.querySelector(`.${c}`) as HTMLInputElement).value;
    expect([value("set"), value("unset")]).toEqual(["state", "html"]);
    await write((s) => { s.b = "later"; });
    expect(value("unset")).toBe("later");
  });

  it("getter に束ねても、次の変化が届く（getter は初めに読まれる）", async () => {
    const { root, write } = await page(`<p data-wcs="textContent#init=none: label">server</p>`, {
      n: 1,
      get label() { return `n=${(this as any).n}`; },
    });
    expect(root.querySelector("p")!.textContent).toBe("server");
    await write((s) => { s.n = 2; });
    expect(root.querySelector("p")!.textContent).toBe("n=2");
  });

  it("行の中でも同じ（スロットにしない）", async () => {
    const { root, write } = await page(`<template data-wcs="for: items"><p data-wcs="textContent#init=none: .v">keep</p></template>`, { items: [{ v: "a" }, { v: "b" }] });
    expect(texts(root, "p")).toEqual(["keep", "keep"]);
    await write((s) => { s["items.1.v"] = "B"; });
    expect(texts(root, "p")).toEqual(["keep", "B"]);
  });

  it("radio の init=none は初めに checked を変えない", async () => {
    const { root, write } = await page(`<input type="radio" value="red" checked data-wcs="radio#init=none: color"><input type="radio" value="blue" data-wcs="radio#init=none: color">`, { color: "blue" });
    const checked = () => Array.from(root.querySelectorAll("input")).map((i) => i.checked);
    expect(checked()).toEqual([true, false]);
    await write((s) => { s.color = "red"; });
    expect(checked()).toEqual([true, false]);
    await write((s) => { s.color = "blue"; });
    expect(checked()).toEqual([false, true]);
  });

  it("名前空間（class. / attr. / style.）は #init= を無視する（3.3 と同じ）", async () => {
    const { root } = await page(`<p data-wcs="class.on#init=none: flag; attr.title#init=none: t; style.color#init=none: c"></p>`, { flag: true, t: "tt", c: "red" });
    const p = root.querySelector("p")!;
    expect([p.classList.contains("on"), p.getAttribute("title"), p.style.color]).toEqual([true, "tt", "red"]);
  });

  it("wcBindable の無いカスタム要素も同じ", async () => {
    const tag = `fix-plain-${seq++}`;
    customElements.define(tag, class extends HTMLElement { value = "own"; });
    const { root, write } = await page(`<${tag} data-wcs="value#init=none: v"></${tag}>`, { v: "state" });
    const el = root.querySelector(tag) as any;
    expect(el.value).toBe("own");
    await write((s) => { s.v = "next"; });
    expect(el.value).toBe("next");
  });
});

describe("F15 構造でない data-wcs を持つ <template> は、普通の要素として束縛する（3.3 と同じ）", () => {
  it("ページの直下と行の中で、template 要素の属性が束縛され、中身は描かれない", async () => {
    const { root, write } = await page(
      `<template class="top" data-wcs="attr.data-id: id"><p>never</p></template>`
      + `<ul><template data-wcs="for: items"><li><template data-wcs="attr.data-v: .v"><b>never</b></template></li></template></ul>`,
      { id: "t1", items: [{ v: "a" }] },
    );
    const top = root.querySelector("template.top")!;
    expect(top.getAttribute("data-id")).toBe("t1");
    expect(root.querySelector("li template")!.getAttribute("data-v")).toBe("a");
    expect(root.querySelector("p")).toBeNull();
    expect(root.querySelector("b")).toBeNull();
    await write((s) => { s.id = "t2"; s["items.0.v"] = "b"; });
    expect(top.getAttribute("data-id")).toBe("t2");
    expect(root.querySelector("li template")!.getAttribute("data-v")).toBe("b");
  });
});


describe("F17 マークアップの数値添字のパス（items.0.v）は、this[\"items.0.v\"] と同じく添字として読み書きする（#332）", () => {
  it("行の getter・添字のパスへの書き込み・要素の差し替え・並べ替えに追従する", async () => {
    const { root, write } = await page(
      `<span class="a" data-wcs="textContent: items.0.v"></span><span class="b">{{ items.1.v }}</span><span class="d" data-wcs="textContent: items.0.double"></span>`,
      { items: [{ v: 1 }, { v: 2 }], get "items.*.double"() { return (this as any)["items.*.v"] * 2; } },
    );
    const shown = () => [".a", ".b", ".d"].map((s) => root.querySelector(s)!.textContent);
    expect(shown()).toEqual(["1", "2", "2"]);
    await write((s) => { s["items.0.v"] = 7; });
    expect(shown()).toEqual(["7", "2", "14"]);
    await write((s) => { s["items.0"] = { v: 50 }; });
    expect(shown()).toEqual(["50", "2", "100"]);
    await write((s) => { s.items = [...s.items].reverse(); });
    expect(shown()).toEqual(["2", "50", "4"]);
    await write((s) => { s.items = [{ v: 9 }]; });
    expect(shown()).toEqual(["9", "", "18"]);
  });

  it("行の中の相対パス（.items.0.v）と、双方向の束縛の書き戻し", async () => {
    const { root, write, read } = await page(
      `<template data-wcs="for: groups"><p>{{ .items.0.v }}</p></template><input data-wcs="value: groups.1.items.0.v">`,
      { groups: [{ items: [{ v: "a" }] }, { items: [{ v: "b" }] }] },
    );
    expect(texts(root, "p")).toEqual(["a", "b"]);
    const input = root.querySelector("input")!;
    expect(input.value).toBe("b");
    input.value = "typed";
    input.dispatchEvent(new Event("input"));
    await flush();
    await flush();
    expect(read("groups.1.items.0.v")).toBe("typed");
    expect(texts(root, "p")).toEqual(["a", "typed"]);
    await write((s) => { s["groups.0.items.0.v"] = "A"; });
    expect(texts(root, "p")).toEqual(["A", "typed"]);
  });

  it("一覧でない入れ物の数値のキー（辞書）は、これまでどおり字面どおりに読む", async () => {
    const { root, write } = await page(`<span data-wcs="textContent: usersById.42.name"></span>`, { usersById: { 42: { name: "Ann" } } });
    expect(root.querySelector("span")!.textContent).toBe("Ann");
    await write((s) => { s.usersById = { 42: { name: "Bea" } }; });
    expect(root.querySelector("span")!.textContent).toBe("Bea");
  });
});

describe("F18 マークアップの $1（ループの添字）を束縛できる（3.3 の README のとおり）", () => {
  it("{{ $1|add(1) }} と textContent: $2 が、行の追加・並べ替え・削除に追従する", async () => {
    const { root, write } = await page(
      `<template data-wcs="for: groups"><section><b>{{ $1|add(1) }}</b><template data-wcs="for: .items"><i data-wcs="textContent: $2"></i><u>{{ $1 }}</u></template></section></template>`,
      { groups: [{ items: ["x", "y"] }, { items: ["z"] }] },
    );
    expect(texts(root, "b")).toEqual(["1", "2"]);
    expect(texts(root, "i")).toEqual(["0", "1", "0"]);
    expect(texts(root, "u")).toEqual(["0", "0", "1"]);
    await write((s) => { s.groups = [{ items: ["n"] }, ...s.groups]; });
    expect(texts(root, "b")).toEqual(["1", "2", "3"]);
    expect(texts(root, "u")).toEqual(["0", "1", "1", "2"]);
    await write((s) => { s.groups = [...s.groups].reverse(); });
    expect(texts(root, "b")).toEqual(["1", "2", "3"]);
    expect(texts(root, "u")).toEqual(["0", "1", "1", "2"]);
    await write((s) => { s["groups.0.items"] = []; });
    expect(texts(root, "i")).toEqual(["0", "1", "0"]);
  });

  it("ループの外の $1 は、ループが無いとして投げる", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(page(`<p>{{ $1 }}</p>`, {})).rejects.toThrow('[@wcstack/state] [wcs/wildcard-rank] #1401 "$1" 1');
    } finally {
      error.mockRestore();
    }
  });
});

describe("F19 表示のプロパティ（textContent / innerText）には文字列を書く（サーバの DOM の happy-dom でも 0 が出る）", () => {
  it("0 と数値が表示され、innerText も投げない", async () => {
    const { root, write } = await page(`<p class="t" data-wcs="textContent: n"></p><p class="i" data-wcs="innerText: n"></p>`, { n: 0 });
    expect([root.querySelector(".t")!.textContent, root.querySelector(".i")!.textContent]).toEqual(["0", "0"]);
    await write((s) => { s.n = 12; });
    expect([root.querySelector(".t")!.textContent, root.querySelector(".i")!.textContent]).toEqual(["12", "12"]);
  });
});

describe("F17・F18 再セットの後も", () => {
  it("数値添字のパスと $1 は、新しい状態で書き込みと並べ替えに追従する", async () => {
    const { root, el, write } = await page(
      `<span class="a" data-wcs="textContent: items.0.v"></span><template data-wcs="for: items"><i>{{ $1 }}:{{ .v }}</i></template>`,
      { items: [{ v: 1 }, { v: 2 }] },
    );
    el.setInitialState({ items: [{ v: 5 }, { v: 6 }] });
    await flush();
    expect(root.querySelector(".a")!.textContent).toBe("5");
    expect(texts(root, "i")).toEqual(["0:5", "1:6"]);
    await write((s) => { s["items.0.v"] = 8; });
    expect(root.querySelector(".a")!.textContent).toBe("8");
    await write((s) => { s.items = [...s.items].reverse(); });
    expect(root.querySelector(".a")!.textContent).toBe("6");
    expect(texts(root, "i")).toEqual(["0:6", "1:8"]);
  });
});

describe("R6 コンポーネントのマウントの #ro（3.3 と同じ: コードの書き込みは [wcs/mount-readonly]、要素の書き戻しはしない）", () => {
  const ro = (tag: string, write: string, mount: string) =>
    `[@wcstack/state] [wcs/mount-readonly] <${tag}> cannot write "${write}": it is mounted read-only ("${mount}"). Write it on the host, or drop #ro from the mount.`;

  it("丸ごとのマウント（state#ro: user）: メソッド・element.state・$resolve・入れ子の書き込みは投げ、ホストは変わらない", async () => {
    const tag = component(`<p>{{ name }}</p><i>{{ addr.city }}</i>`, () => ({
      rename(this: any) { this.name = "Bo"; },
      move(this: any) { this["addr.city"] = "Kyoto"; },
      resolve(this: any) { this.$resolve("name", [], "Cy"); },
    }));
    const { root, read, write } = await page(`<${tag} data-wcs="state#ro: user"></${tag}>`, { user: { name: "Al", addr: { city: "Tokyo" } } });
    const c = root.querySelector(tag) as any;
    expect(() => c.state.rename()).toThrow(ro(tag, "name", "state#ro: user"));
    expect(() => c.state.move()).toThrow(ro(tag, "addr.city", "state#ro: user"));
    expect(() => c.state.resolve()).toThrow(ro(tag, "name", "state#ro: user"));
    expect(() => { c.state.name = "Dan"; }).toThrow(ro(tag, "name", "state#ro: user"));
    await flush();
    expect([read("user.name"), read("user.addr.city")]).toEqual(["Al", "Tokyo"]);
    // the host still writes it, and the component shows it
    await write((s) => { s["user.name"] = "Eve"; });
    expect(c.shadowRoot.querySelector("p").textContent).toBe("Eve");
  });

  it("部分のマウント: #ro の対応だけが読み取り専用で、ほかの対応と私有キーは書ける", async () => {
    const tag = component(`<p>{{ title }}</p>`, () => ({
      note: "",
      setTitle(this: any) { this.title = "T2"; },
      setBody(this: any) { this.body = "B2"; },
      setNote(this: any) { this.note = "N2"; },
    }));
    const { root, read } = await page(`<${tag} data-wcs="state.title#ro: doc.title; state.body: doc.body"></${tag}>`, { doc: { title: "T", body: "B" } });
    const c = root.querySelector(tag) as any;
    expect(() => c.state.setTitle()).toThrow(ro(tag, "title", "state.title#ro: doc.title"));
    c.state.setBody();
    c.state.setNote();
    await flush();
    expect([read("doc.title"), read("doc.body"), c.state.note]).toEqual(["T", "B2", "N2"]);
  });

  it("コンポーネントの中の双方向の入力は書き戻さない（投げない）", async () => {
    const tag = component(`<input data-wcs="value: name"><p>{{ name }}</p>`, () => ({}));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, read } = await page(`<${tag} data-wcs="state#ro: user"></${tag}>`, { user: { name: "Al" } });
      const input = (root.querySelector(tag) as any).shadowRoot.querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("Al");
      input.value = "typed";
      input.dispatchEvent(new Event("input"));
      await flush();
      expect(read("user.name")).toBe("Al");
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("行のマウント（state#ro: .）: 行のデータへの書き込みは投げる", async () => {
    const tag = component(`<p>{{ name }}</p>`, () => ({ rename(this: any) { this.name = "X"; } }));
    const { root, read } = await page(`<template data-wcs="for: users"><${tag} data-wcs="state#ro: ."></${tag}></template>`, { users: [{ name: "a" }, { name: "b" }] });
    const second = root.querySelectorAll(tag)[1] as any;
    expect(() => second.state.rename()).toThrow(ro(tag, "name", "state#ro: users.*"));
    expect(read("users.1.name")).toBe("b");
  });
});

describe("R6 #ro: コンポーネントの中の wc-bindable の要素", () => {
  it("出力メンバーの初期値もイベントも、読み取り専用の対応へは書かない（投げない）", async () => {
    const out = `fix-ro-out-${seq++}`;
    customElements.define(out, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${out}:status` }] };
      status = "from-element";
    });
    const tag = component(`<${out} data-wcs="status: name"></${out}><p>{{ name }}</p>`, () => ({}));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, read } = await page(`<${tag} data-wcs="state#ro: user"></${tag}>`, { user: { name: "Al" } });
      const inner = (root.querySelector(tag) as any).shadowRoot;
      expect(read("user.name")).toBe("Al");
      inner.querySelector(out).dispatchEvent(new CustomEvent(`${out}:status`, { detail: "emitted" }));
      await flush();
      expect(read("user.name")).toBe("Al");
      expect(inner.querySelector("p").textContent).toBe("Al");
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe("R6 エクスポートした getter（ツリーに無いキーは、そこにマウントしたコンポーネントの accessor が答える）", () => {
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) await flush(); };

  it("丸ごとのマウント: ホストが user.display を読み、依存（ツリーのキー・私有データ）が伝わる", async () => {
    const tag = component(`<p>{{ display }}</p>`, () => ({
      mode: "view",
      get display() { const s = this as any; return `${s.name}:${s.mode}`; },
      edit(this: any) { this.mode = "edit"; },
    }));
    const { root, write } = await page(`<${tag} data-wcs="state: user"></${tag}><span>{{ user.display }}</span>`, { user: { name: "Al" } });
    await settle();
    const span = () => root.querySelector("span")!.textContent;
    expect(span()).toBe("Al:view");
    await write((s) => { s["user.name"] = "Bo"; });
    expect(span()).toBe("Bo:view");
    (root.querySelector(tag) as any).state.edit();
    await settle();
    expect(span()).toBe("Bo:edit");
  });

  it("ツリーにあるキーはツリーが勝ち、一度だけ wcs/mount-export-shadowed を警告する", async () => {
    const tag = component(`<p>{{ name }}</p>`, () => ({ get display() { return "component"; } }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { root } = await page(`<${tag} data-wcs="state: user"></${tag}><span>{{ user.display }}</span>`, { user: { name: "Al", display: "tree" } });
      await settle();
      expect(root.querySelector("span")!.textContent).toBe("tree");
      expect(warn.mock.calls.map((c) => String(c[0]))).toContain(
        `[@wcstack/state] [wcs/mount-export-shadowed] <${tag}>.state.display is exported at "user.display" but the tree already has that key, so readers outside the component get the tree value. Remove the tree key or rename the accessor. See docs/state-overlay-export-design.md X1.`,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("行のマウント: 行ごとにエクスポートし、.display・$getAll・行の追加に追従する", async () => {
    const tag = component(`<p>{{ name }}</p>`, () => ({ get display() { return `<${(this as any).name}>`; } }));
    const { root, write } = await page(
      `<template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}><b>{{ .display }}</b></template><i>{{ all }}</i>`,
      { users: [{ name: "a" }, { name: "b" }], get all() { return (this as any).$getAll("users.*.display", []).join(","); } },
    );
    await settle();
    expect(texts(root, "b")).toEqual(["<a>", "<b>"]);
    expect(root.querySelector("i")!.textContent).toBe("<a>,<b>");
    await write((s) => { s["users.1.name"] = "B"; });
    expect(texts(root, "b")).toEqual(["<a>", "<B>"]);
    expect(root.querySelector("i")!.textContent).toBe("<a>,<B>");
    await write((s) => { s.users = [...s.users, { name: "c" }]; });
    await settle();
    expect(texts(root, "b")).toEqual(["<a>", "<B>", "<c>"]);
    expect(root.querySelector("i")!.textContent).toBe("<a>,<B>,<c>");
  });

  it("外からの書き込みは setter を呼び、getter だけなら投げる", async () => {
    const tag = component(`<p>{{ name }}</p>`, () => ({
      get display() { return (this as any).name; },
      get nick() { return (this as any).name; },
      set nick(v: string) { (this as any).name = v.toUpperCase(); },
    }));
    const { root, el, read } = await page(`<${tag} data-wcs="state: user"></${tag}><span>{{ user.nick }}</span>`, { user: { name: "Al" } });
    await settle();
    el.createState("writable", (s: any) => { s["user.nick"] = "bo"; });
    await settle();
    expect(read("user.name")).toBe("BO");
    expect(root.querySelector("span")!.textContent).toBe("BO");
    expect(() => el.createState("writable", (s: any) => { s["user.display"] = "x"; })).toThrow(
      `[@wcstack/state] Cannot write to "display" on mounted <${tag}>: the accessor has no setter. Add a setter or write to the underlying state paths instead.`,
    );
  });

  it("切断すると読めなくなり（undefined）、再接続でまた読める", async () => {
    const tag = component(`<p>{{ name }}</p>`, () => ({ get display() { return `[${(this as any).name}]`; } }));
    const { root } = await page(`<div class="box"><${tag} data-wcs="state: user"></${tag}></div><span>{{ user.display }}</span>`, { user: { name: "Al" } });
    await settle();
    const span = () => root.querySelector("span")!.textContent;
    expect(span()).toBe("[Al]");
    const c = root.querySelector(tag)!;
    c.remove();
    await settle();
    expect(span()).toBe("");
    root.querySelector(".box")!.appendChild(c);
    await settle();
    expect(span()).toBe("[Al]");
  });

  it("エクスポートしないもの: メソッド・私有データ・ワイルドカードの accessor", async () => {
    const tag = component(`<p>{{ name }}</p>`, () => ({
      mode: "private",
      act() { return 1; },
      get "tags.*.label"() { return "x"; },
    }));
    const { root } = await page(`<${tag} data-wcs="state: user"></${tag}><span>{{ user.mode }}|{{ user.act }}</span>`, { user: { name: "Al", tags: [] } });
    await settle();
    expect(root.querySelector("span")!.textContent).toBe("|");
  });

  it("同じインスタンスに同じキーをエクスポートする 2 つのコンポーネントは wcs/mount-export-ambiguous", async () => {
    const a = component(`<p>a</p>`, () => ({ get display() { return "a"; } }));
    const b = component(`<p>b</p>`, () => ({ get display() { return "b"; } }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await page(`<${a} data-wcs="state: user"></${a}><${b} data-wcs="state: user"></${b}><span>{{ user.display }}</span>`, { user: { name: "Al" } });
      await settle();
      const messages = error.mock.calls.map((c) => String(c[0]) + String(c[1] ?? ""));
      expect(messages.some((m) => m.includes(`[wcs/mount-export-ambiguous] "user.display" is exported by two mounted components on the same instance: <${a}> and <${b}>.`))).toBe(true);
    } finally {
      error.mockRestore();
    }
  });

  it("自己再帰のコンポーネント: 各段の total が子の total をエクスポートで読み、深い葉の変更が根まで届く", async () => {
    const tag = `fix-tree-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state = {
        get total() {
          const s = this as any;
          return s.value + s.$getAll("children.*.total", []).reduce((x: number, y: number | undefined) => x + (y ?? 0), 0);
        },
      };
      // the markup goes in on connect, as the README's user-card does: a DOM that constructs the
      // elements of a template's content (happy-dom) would otherwise recurse into itself
      connectedCallback() {
        const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
        if (root.firstChild === null) root.innerHTML = `<wcs-state bind-component="state"></wcs-state><p>{{ total }}</p><template data-wcs="for: children"><${tag} data-wcs="state: ."></${tag}></template>`;
      }
    });
    const tree = { value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }, { value: 4, children: [] }] };
    const { root, write } = await page(`<${tag} data-wcs="state: tree"></${tag}><span>{{ tree.total }}</span>`, { tree });
    await settle(8);
    expect(root.querySelector("span")!.textContent).toBe("10");
    await write((s) => { s["tree.children.0.children.0.value"] = 30; });
    await settle(4);
    expect(root.querySelector("span")!.textContent).toBe("37");
  });
});

describe("R6 エクスポートした getter: 境界", () => {
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) await flush(); };

  it("点を含む名前: 私有データの下はエクスポートし、ツリーの下はしない。継承した accessor もエクスポートする", async () => {
    class Base { get inherited() { return "from-base"; } }
    class Card extends Base {
      form = { v: 1 };
      get inherited() { return "overridden"; }
      get "form.label"() { return `#${(this as any)["form.v"]}`; }
      get "info.upper"() { return String((this as any)["info.text"]).toUpperCase(); }
    }
    const tag = component(`<p>{{ name }}</p>`, () => new Card() as any);
    const { root } = await page(
      `<${tag} data-wcs="state: user"></${tag}><span class="f">{{ user.form.label }}</span><span class="i">{{ user.info.upper }}</span><span class="h">{{ user.inherited }}</span>`,
      { user: { name: "Al", info: { text: "t" } } },
    );
    await settle();
    expect(["f", "i", "h"].map((c) => root.querySelector(`.${c}`)!.textContent)).toEqual(["#1", "", "overridden"]);
  });

  it("ホスト自身の getter が勝つ。同じ位置のエクスポートしないコンポーネントは数えない", async () => {
    const a = component(`<p>a</p>`, () => ({ get display() { return "component"; }, get other() { return "o"; } }));
    const b = component(`<p>b</p>`, () => ({ get third() { return "t"; } }));
    const { root } = await page(`<${a} data-wcs="state: user"></${a}><${b} data-wcs="state: user"></${b}><span class="d">{{ user.display }}</span><span class="o">{{ user.other }}</span>`, {
      user: { name: "Al" },
      get "user.display"() { return "host"; },
    });
    await settle();
    expect([root.querySelector(".d")!.textContent, root.querySelector(".o")!.textContent]).toEqual(["host", "o"]);
  });

  it("外からの書き込み: ツリーにキーがあればツリーへ、コンポーネントがいなければツリーへ書く", async () => {
    const tag = component(`<p>{{ name }}</p>`, () => ({ get display() { return "c"; }, set display(_v: unknown) { throw new Error("not called"); } }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { root, el, read } = await page(`<div class="box"><${tag} data-wcs="state: user"></${tag}></div>`, { user: { name: "Al", display: "tree" } });
      await settle();
      el.createState("writable", (s: any) => { s["user.display"] = "tree 2"; });
      expect(read("user.display")).toBe("tree 2");
      const other = await page(`<div class="box"><${tag} data-wcs="state: user"></${tag}></div>`, { user: { name: "Al" } });
      await settle();
      other.root.querySelector(tag)!.remove();
      await settle();
      other.el.createState("writable", (s: any) => { s["user.display"] = "grown"; });
      expect(other.read("user.display")).toBe("grown");
      expect(root.querySelector(tag)).not.toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("F20・F21 行のブロックの直下の構造のテンプレート", () => {
  it("F20 行の直下が if: だけでも描かれ、追従する", async () => {
    const { root, write } = await page(`<ul><template data-wcs="for: items"><template data-wcs="if: .on"><li>{{ .n }}</li></template></template></ul>`,
      { items: [{ n: 1, on: true }, { n: 2, on: true }] });
    expect(texts(root, "li")).toEqual(["1", "2"]);
    await write((s) => { s["items.0.on"] = false; s.items = [...s.items, { n: 3, on: true }]; });
    expect(texts(root, "li")).toEqual(["2", "3"]);
  });

  it("F21 行の直下の if: の枝は、行と一緒に並べ替わり、行と一緒に消える", async () => {
    const { root, write } = await page(
      `<div><template data-wcs="for: items"><b>{{ .n }}</b><template data-wcs="if: .x"><i>x{{ .n }}</i></template></template></div>`,
      { items: [{ n: 1, x: true }, { n: 2, x: true }] },
    );
    const text = () => root.querySelector("div")!.textContent;
    expect(text()).toBe("1x12x2");
    await write((s) => { s.items = [...s.items].reverse(); });
    expect(text()).toBe("2x21x1");
    await write((s) => { s.items = s.items.slice(1); });
    expect(text()).toBe("1x1");
    await write((s) => { s.items = []; });
    expect(text()).toBe("");
  });

  it("F21 行の直下の for: の行も、外側の行と一緒に動く", async () => {
    const { root, write } = await page(
      `<div><template data-wcs="for: groups"><template data-wcs="for: .items"><i>{{ . }}</i></template><b>|</b></template></div>`,
      { groups: [{ items: ["a", "b"] }, { items: ["c"] }] },
    );
    const text = () => root.querySelector("div")!.textContent;
    expect(text()).toBe("ab|c|");
    await write((s) => { s.groups = [...s.groups].reverse(); });
    expect(text()).toBe("c|ab|");
    await write((s) => { s.groups = s.groups.slice(1); });
    expect(text()).toBe("ab|");
  });
});

describe("F30・async のイベントハンドラ", () => {
  it("ホストの行が消えた後のコンポーネントの書き込みは The host row of <tag> was removed. で拒み、消えた行のデータは変えない", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const tag = component(`<p>{{ name }}</p>`, () => ({ async later(this: any) { await gate; this.name = "late"; } }));
    const { root, write, read } = await page(`<template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template>`, { users: [{ name: "a" }, { name: "b" }] });
    const second = root.querySelectorAll(tag)[1] as any;
    const item = (read("users") as any[])[1];
    const pending = second.state.later();
    await write((s) => { s.users = [s.users[0]]; });
    release();
    await expect(pending).rejects.toThrow(`[@wcstack/state] The host row of <${tag}> was removed.`);
    expect(item.name).toBe("b");
    expect(read("users.0.name")).toBe("a");
  });

  it("async のイベントハンドラの失敗は console.error に報告する（未処理の拒否にしない）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failure = new Error("async handler failed");
      const { root } = await page(`<button data-wcs="onclick: go"></button>`, { async go() { throw failure; } });
      (root.querySelector("button") as HTMLElement).click();
      await flush();
      expect(error).toHaveBeenCalledWith(failure);
    } finally {
      error.mockRestore();
    }
  });
});

describe("async の $errorCallback", () => {
  it("失敗は console.error に報告する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failure = new Error("error callback failed");
      await page(`<p>{{ bad }}</p>`, {
        get bad() { throw new Error("bad"); },
        async $errorCallback() { throw failure; },
      });
      await flush();
      expect(error).toHaveBeenCalledWith(failure);
    } finally {
      error.mockRestore();
    }
  });
});

describe("F24・F25 同じ配列を持つ一覧は、書き込みを互いに届ける", () => {
  const html = `<ul class="src"><template data-wcs="for: todos"><li>{{ .t }}</li></template></ul>`
    + `<ul class="alias"><template data-wcs="for: shown"><li><input data-wcs="value: .t"></li></template></ul>`;
  const state = () => ({ todos: [{ t: "a" }, { t: "b" }], get shown() { return (this as any).todos; } });

  it("元のパスへの葉・要素の書き込みが、getter の一覧の行に届く", async () => {
    const { root, write } = await page(html, state());
    const alias = () => Array.from(root.querySelectorAll(".alias input")).map((i) => (i as HTMLInputElement).value);
    expect(alias()).toEqual(["a", "b"]);
    await write((s) => { s["todos.0.t"] = "A"; });
    expect(alias()).toEqual(["A", "b"]);
    await write((s) => { s["todos.1"] = { t: "B" }; });
    expect(alias()).toEqual(["A", "B"]);
  });

  it("getter の一覧の行の入力の書き戻しが、元の一覧の行に届く", async () => {
    const { root, read } = await page(html, state());
    const input = root.querySelectorAll(".alias input")[1] as HTMLInputElement;
    input.value = "typed";
    input.dispatchEvent(new Event("input"));
    await flush();
    await flush();
    expect(read("todos.1.t")).toBe("typed");
    expect(texts(root, ".src li")).toEqual(["a", "typed"]);
  });

  it("F25 数値添字のパスの for の行が描かれ、添字のパスの書き込みが届く", async () => {
    const { root, write } = await page(`<template data-wcs="for: groups.0.items"><i>{{ .v }}</i></template>`, { groups: [{ items: [{ v: 1 }, { v: 2 }] }] });
    expect(texts(root, "i")).toEqual(["1", "2"]);
    await write((s) => { s["groups.0.items.1.v"] = 9; });
    expect(texts(root, "i")).toEqual(["1", "9"]);
    await write((s) => { s["groups.0.items"] = [{ v: 7 }]; });
    expect(texts(root, "i")).toEqual(["7"]);
  });
});

describe("F26 getter が 2 つの配列に置いたオブジェクトは、どちらの行から書いても、それを持つところへ届く", () => {
  const todos = () => [{ title: "a", done: false }, { title: "b", done: false }, { title: "c", done: true }];
  /** filter / todos / shown (a copy filtered by `filter`, or `todos` itself for "all") / left ($getAll), plus `extra` (accessors kept). */
  const filtered = (extra: object = {}) => Object.defineProperties({
    filter: "active",
    todos: todos(),
    get shown() {
      const s = this as any;
      return s.filter === "all" ? s.todos : s.todos.filter((t: any) => t.done === (s.filter === "done"));
    },
    get left() { return (this as any).$getAll("todos.*.done", []).filter((d: boolean) => !d).length; },
  }, Object.getOwnPropertyDescriptors(extra));
  const SHOWN = `<ul class="shown"><template data-wcs="for: shown"><li><input type="checkbox" data-wcs="checked: .done"><span>{{ .title }}:{{ .done }}</span></li></template></ul>`;
  const TODOS = `<ul class="todos"><template data-wcs="for: todos"><li><span>{{ .title }}:{{ .done }}</span></li></template></ul>`;
  const LEFT = `<b>{{ left }}</b>`;
  const rowsOf = (root: ParentNode, cls: string) => texts(root, `ul.${cls} span`).join(",");
  /** Ticks (or unticks) the checkbox of row `i` of `for: shown`, as the user does. */
  const tick = async (root: ParentNode, i: number, on: boolean) => {
    const box = root.querySelectorAll("ul.shown input")[i] as HTMLInputElement;
    box.checked = on;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await flush();
  };

  it("TodoMVC の絞り込み（active）: 写しの行の checkbox が for: todos の行・$getAll の集計・絞り込みそのものに届く", async () => {
    const { root, read } = await page(LEFT + SHOWN + TODOS, filtered());
    expect([texts(root, "b")[0], rowsOf(root, "shown"), rowsOf(root, "todos")]).toEqual(["2", "a:false,b:false", "a:false,b:false,c:true"]);
    await tick(root, 0, true);
    expect(read("todos.0.done")).toBe(true);
    // the ticked row leaves the "active" view
    expect([texts(root, "b")[0], rowsOf(root, "shown"), rowsOf(root, "todos")]).toEqual(["1", "b:false", "a:true,b:false,c:true"]);
  });

  it("TodoMVC の絞り込み（done）: 写しの行の checkbox を外すと、その行が done の一覧から抜ける", async () => {
    const { root } = await page(LEFT + SHOWN + TODOS, filtered({ filter: "done" }));
    expect(rowsOf(root, "shown")).toBe("c:true");
    await tick(root, 0, false);
    expect([texts(root, "b")[0], rowsOf(root, "shown"), rowsOf(root, "todos")]).toEqual(["3", "", "a:false,b:false,c:false"]);
  });

  it("元のパスへの書き込み（todos.0.title・todos.1.done）が写しの行に届き、絞り込みを評価し直す（for: todos を描かなくても）", async () => {
    const { root, write } = await page(SHOWN, filtered());
    await write((s) => { s["todos.0.title"] = "A"; });
    expect(rowsOf(root, "shown")).toBe("A:false,b:false");
    await write((s) => { s["todos.1.done"] = true; });
    expect(rowsOf(root, "shown")).toBe("A:false");
  });

  it("対照: 写しが持たないオブジェクトへの書き込みでは絞り込みを評価し直さない（getter は配列を読み、そのオブジェクトは読んでいない）。$getAll で読む絞り込みは追従する", async () => {
    const plain = await page(SHOWN, filtered({ filter: "done" }));
    await plain.write((s) => { s["todos.0.done"] = true; });
    expect(rowsOf(plain.root, "shown")).toBe("c:true");
    const tracked = await page(SHOWN, filtered({
      filter: "done",
      get shown() {
        const s = this as any;
        const done = s.$getAll("todos.*.done", []);
        return s.todos.filter((_: any, i: number) => done[i] === (s.filter === "done"));
      },
    }));
    await tracked.write((s) => { s["todos.0.done"] = true; });
    expect(rowsOf(tracked.root, "shown")).toBe("a:true,c:true");
  });

  it("対照: 配列を読んで数を返す getter（this.todos.filter(...).length）は、行への書き込みで評価し直さない（依存の境界のまま）", async () => {
    const { root } = await page(`<i>{{ remaining }}</i>${SHOWN}`, filtered({
      get remaining() { return (this as any).todos.filter((t: any) => !t.done).length; },
    }));
    await tick(root, 0, true);
    expect([texts(root, "i")[0], rowsOf(root, "shown")]).toEqual(["2", "b:false"]);
  });

  it("getter の連鎖（todos → active → shown）: 写しの行への書き込みが途中の getter も評価し直す", async () => {
    const { root, write } = await page(`<p>{{ active.length }}</p>${SHOWN}${TODOS}`, {
      filter: "active",
      todos: todos(),
      get active() { return (this as any).todos.filter((t: any) => !t.done); },
      get shown() { const s = this as any; return s.filter === "active" ? s.active : s.todos; },
    });
    await tick(root, 1, true);
    expect([texts(root, "p")[0], rowsOf(root, "shown"), rowsOf(root, "todos")]).toEqual(["1", "a:false", "a:false,b:true,c:true"]);
    await write((s) => { s["todos.0.title"] = "A"; });
    expect(rowsOf(root, "shown")).toBe("A:false");
    await write((s) => { s.filter = "all"; });
    expect(rowsOf(root, "shown")).toBe("A:false,b:true,c:true");
  });

  describe("1 つの更新で 2 つの行に書く（先の書き込みで評価し直しを待つ getter の、引き継ぐ行にも届く）", () => {
    const chain = () => ({
      filter: "active",
      todos: todos(),
      get active() { return (this as any).todos.filter((t: any) => !t.done); },
      get shown() { const s = this as any; return s.filter === "all" ? s.todos : s.todos.filter((t: any) => !t.done); },
      // a copy of a getter's copy: reached through `active`, which the walk evaluates again first
      get firstOfActive() { return (this as any).active.slice(0, 2); },
    });
    const html = `${SHOWN}<ol><template data-wcs="for: firstOfActive"><li>{{ .title }}</li></template></ol>`;

    it.each<[string, (s: any) => void]>([
      ["元のパスから", (s) => { s["todos.0.title"] = "A"; s["todos.1.title"] = "B"; }],
      ["写しの行のパスから", (s) => { s["shown.0.title"] = "A"; s["shown.1.title"] = "B"; }],
    ])("%s", async (_name, fn) => {
      const { root, write } = await page(html, chain());
      await write(fn);
      expect([rowsOf(root, "shown"), texts(root, "ol li").join(",")]).toEqual(["A:false,B:false", "A,B"]);
    });
  });

  it("同じ配列の別の写し（for: shown と for: firstTwo）: 片方の行への書き込みがもう片方の行に届く", async () => {
    const { root } = await page(`${SHOWN}<ol><template data-wcs="for: firstTwo"><li>{{ .title }}:{{ .done }}</li></template></ol>`, filtered({
      filter: "all",
      get firstTwo() { return (this as any).todos.slice(0, 2); },
    }));
    await tick(root, 1, true);
    expect([rowsOf(root, "shown"), texts(root, "ol li").join(",")]).toEqual(["a:false,b:true,c:true", "a:false,b:true"]);
  });

  it("並べ替えた写し（sorted）: 元のパスへの書き込みで並べ替え直し、行（入力欄）は使い回す", async () => {
    const { root, write } = await page(`<ul><template data-wcs="for: sorted"><li><span>{{ .title }}</span><input class="i"></li></template></ul>`, {
      todos: [{ title: "b" }, { title: "c" }, { title: "a" }],
      get sorted() { return [...(this as any).todos].sort((x: any, y: any) => x.title.localeCompare(y.title)); },
    });
    expect(texts(root, "span").join(",")).toBe("a,b,c");
    (root.querySelectorAll(".i")[0] as HTMLInputElement).value = "typed";
    await write((s) => { s["todos.2.title"] = "d"; });
    expect(texts(root, "span").join(",")).toBe("b,c,d");
    expect((root.querySelectorAll(".i")[2] as HTMLInputElement).value).toBe("typed");
  });

  it("対照: 新しいオブジェクトを返す getter（map）の行への書き込みでは getter を評価し直さず、行を作り直さない", async () => {
    let evaluated = 0;
    const { root, write, read } = await page(`<ul><template data-wcs="for: rows"><li><span>{{ .n }}</span><input class="i"></li></template></ul>`, {
      items: [{ n: "a" }, { n: "b" }],
      get rows() { evaluated++; return (this as any).items.map((x: any) => ({ ...x })); },
    });
    (root.querySelectorAll(".i")[1] as HTMLInputElement).value = "typed";
    const before = evaluated;
    await write((s) => { s["rows.1.n"] = "B"; });
    expect([texts(root, "span").join(","), evaluated - before, (root.querySelectorAll(".i")[1] as HTMLInputElement).value, read("items.1.n")])
      .toEqual(["a,B", 0, "typed", "b"]);
  });

  it("行の getter（todos.*.label・shown.*.label）も、どちらの行から書いても評価し直す", async () => {
    const label = (list: string) => function (this: any) { return `${this[`${list}.*.title`]}${this[`${list}.*.done`] ? "!" : ""}`; };
    const { root, write } = await page(
      `<ul class="shown"><template data-wcs="for: shown"><li><input type="checkbox" data-wcs="checked: .done"><span>{{ .label }}</span></li></template></ul>` +
      `<ul class="todos"><template data-wcs="for: todos"><li><span>{{ .label }}</span></li></template></ul>`,
      Object.defineProperties(filtered(), { "shown.*.label": { get: label("shown") }, "todos.*.label": { get: label("todos") } }),
    );
    await tick(root, 0, true);
    expect([rowsOf(root, "shown"), rowsOf(root, "todos")]).toEqual(["b", "a!,b,c!"]);
    await write((s) => { s["todos.1.title"] = "B"; });
    expect([rowsOf(root, "shown"), rowsOf(root, "todos")]).toEqual(["B", "a!,B,c!"]);
  });

  it("配列をそのまま返す getter（filter = all）は評価し直さず、書いた行の行 getter だけを評価し直す", async () => {
    const calls: number[] = [];
    const { root, write } = await page(`<ul><template data-wcs="for: shown"><li>{{ .label }}</li></template></ul>`, Object.defineProperties(filtered({ filter: "all" }), {
      "shown.*.label": { get(this: any) { calls.push(this.$1); return this["shown.*.title"]; } },
    }));
    calls.length = 0;
    await write((s) => { s["todos.1.title"] = "B"; });
    expect([texts(root, "li").join(","), calls]).toEqual(["a,B,c", [1]]);
  });

  it("#362 の取りこぼし: 同じ写しを持つ 2 つの一覧の片方が先に元の配列へ移った後の書き込みも、もう片方の行に届く", async () => {
    const { root, write } = await page(`${SHOWN}<ol><template data-wcs="for: shown2"><li>{{ .title }}:{{ .done }}</li></template></ol>`, {
      f1: "active",
      f2: "active",
      todos: todos(),
      get active() { return (this as any).todos.filter((t: any) => !t.done); },
      get shown() { const s = this as any; return s.f1 === "all" ? s.todos : s.active; },
      get shown2() { const s = this as any; return s.f2 === "all" ? s.todos : s.active; },
    });
    await write((s) => { s.f2 = "all"; });
    await write((s) => { s["shown2.0.title"] = "A"; });
    expect(rowsOf(root, "shown")).toBe("A:false,b:false");
    await write((s) => { s.f1 = "all"; });
    expect([rowsOf(root, "shown"), texts(root, "ol li").join(",")]).toEqual(["A:false,b:false,c:true", "A:false,b:false,c:true"]);
  });

  it("写しの行で入れ子の配列を差し替えると、同じオブジェクトを持つ for: todos の行の入れ子の一覧も描き直す", async () => {
    const { root, write } = await page(
      `<ul class="shown"><template data-wcs="for: shown"><li>{{ .title }}</li></template></ul>` +
      `<ul class="todos"><template data-wcs="for: todos"><li>{{ .title }}:<template data-wcs="for: .tags"><i>{{ . }}</i></template></li></template></ul>`,
      filtered({ todos: [{ title: "a", done: false, tags: ["p"] }, { title: "b", done: true, tags: [] }] }),
    );
    await write((s) => { s["shown.0.tags"] = ["x", "y"]; });
    expect(texts(root, "ul.todos i")).toEqual(["x", "y"]);
  });

  it("$watch(\"todos.*.done\") は、写しの行から書いた todos の行でも呼ばれる", async () => {
    const seen: unknown[][] = [];
    const { root } = await page(SHOWN + TODOS, filtered({
      $watch: { "todos.*.done"(cur: unknown, _prev: unknown, i: number) { seen.push([i, cur]); } },
    }));
    await tick(root, 1, true);
    expect(seen).toEqual([[1, true]]);
  });

  it("その場の変更を写しの行のパスで知らせる $postUpdate(\"shown.0.title\") も、for: todos の行に届く", async () => {
    const { root, write } = await page(SHOWN + TODOS, filtered());
    await write((s) => { s.todos[1].title = "B"; s.$postUpdate("shown.1.title"); });
    expect([rowsOf(root, "shown"), rowsOf(root, "todos")]).toEqual(["a:false,B:false", "a:false,B:false,c:true"]);
  });

  it("評価ごとに互いを読む getter（読む向きが入れ替わる）でも、行への書き込みは止まる", async () => {
    const { root, write } = await page(`<ul><template data-wcs="for: x"><li>{{ .title }}</li></template></ul><ol><template data-wcs="for: y"><li>{{ .title }}</li></template></ol>`, {
      flip: false,
      todos: todos(),
      get x() { const s = this as any; return s.flip ? s.y : s.todos.slice(0, 2); },
      get y() { const s = this as any; return s.flip ? s.todos.slice(1) : s.x; },
    });
    await write((s) => { s.flip = true; });
    expect([texts(root, "ul li").join(","), texts(root, "ol li").join(",")]).toEqual(["b,c", "b,c"]);
    await write((s) => { s["x.0.title"] = "B"; });
    expect([texts(root, "ul li").join(","), texts(root, "ol li").join(",")]).toEqual(["B,c", "B,c"]);
  });

  it("getter が読む配列でないパス（opts.min、getter の下の limits.max）と数を返す getter は、写しの行への書き込みで評価し直さない", async () => {
    let counted = 0;
    const { root, write } = await page(`<p>{{ count }}</p><ul><template data-wcs="for: big"><li>{{ .v }}</li></template></ul>`, {
      opts: { min: 2 },
      items: [{ v: 1 }, { v: 2 }, { v: 3 }],
      get limits() { return { max: 9 }; },
      get big() { const s = this as any; return s.items.filter((x: any) => x.v >= s["opts.min"] && x.v <= s["limits.max"]); },
      get count() { counted++; return (this as any).items.length; },
    });
    const before = counted;
    await write((s) => { s["big.0.v"] = 1; });
    expect([texts(root, "li").join(","), texts(root, "p")[0], counted - before]).toEqual(["3", "3", 0]);
  });

  it("volume（mount=\"cart\"）の中の絞り込み: 写しの行の checkbox が cart.todos の行と絞り込みに届く", async () => {
    const h = document.createElement(`fix-page-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><wcs-state mount="cart"></wcs-state>`
      + SHOWN.replace("for: shown", "for: cart.shown") + TODOS.replace("for: todos", "for: cart.todos");
    const [el, volume] = Array.from(root.querySelectorAll("wcs-state")) as any[];
    el.setInitialState({});
    volume.setInitialState(filtered());
    document.body.appendChild(h);
    await Promise.all([el.connectedCallbackPromise, volume.connectedCallbackPromise]);
    await getBindingsReady(root);
    await flush();
    await flush();
    await tick(root, 0, true);
    expect([rowsOf(root, "shown"), rowsOf(root, "todos")]).toEqual(["b:false", "a:true,b:false,c:true"]);
  });
});

describe("F29 要素の登録簿（customElementRegistry）", () => {
  it("行の要素は、置かれた後の登録簿で定義を待つ（happy-dom に無いプロパティを足して確かめる。実物は e2e）", async () => {
    const tag = `fix-scoped-${seq++}`;
    // the row elements' registry once placed (a stand-in for a scoped one: it answers from the global)
    const scoped = {
      get: (t: string) => customElements.get(t),
      whenDefined: (t: string) => customElements.whenDefined(t),
      upgrade: (e: Element) => customElements.upgrade(e),
    };
    const seen: unknown[] = [];
    Object.defineProperty(HTMLElement.prototype, "customElementRegistry", {
      configurable: true,
      get(this: Element) {
        if (this.localName === tag) seen.push(this.isConnected ? "scoped" : "global");
        return this.isConnected ? scoped : customElements;
      },
    });
    try {
      const { root } = await page(`<ul><template data-wcs="for: items"><li><${tag} data-wcs="name: .n"></${tag}></li></template></ul>`, { items: [{ n: "a" }] });
      expect(seen).toContain("global");
      expect(seen).toContain("scoped");
      customElements.define(tag, class extends HTMLElement {
        static wcBindable = { protocol: "wc-bindable", version: 1, inputs: [{ name: "name" }] };
        set name(v: unknown) { this.textContent = String(v); }
      });
      await flush();
      await flush();
      expect(texts(root, tag)).toEqual(["a"]);
    } finally {
      delete (HTMLElement.prototype as any).customElementRegistry;
    }
  });
});
