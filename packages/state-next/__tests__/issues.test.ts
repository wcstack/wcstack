/**
 * issues.test.ts — 現行 @wcstack/state の未解決 Issue（#2 を除く）の再現手順を state-next で流す。
 * 各 Issue の「期待」を確かめる（現行はそこで失敗する）。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes, ssr } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([scopes, ssr]);
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`issue-page-${seq++}`);
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
  const tag = `issue-cmp-${seq++}`;
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

describe("#319 初期値を要素から受け取る wc-bindable メンバーを for の行に置くと、一覧ごと描画に失敗する", () => {
  it("出力専用のメンバー: 行が描かれ、行の値は要素の値で初期化される", async () => {
    const tag = `issue-output-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
      status = "ready";
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, read } = await page(
      `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span>{{ .st }}</span></li></template></ul>`,
      { rows: [{ st: "seed" }, { st: "s2" }] },
    );
    expect(texts(root, "li span")).toEqual(["ready", "ready"]);
    expect(read("rows.0.st")).toBe("ready");
    expect(read("rows.1.st")).toBe("ready");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("双方向のメンバーに #init=element: 行が描かれ、行の値は要素の値で初期化される", async () => {
    const tag = `issue-num-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "value", event: `${tag}:change` }], inputs: [{ name: "value" }] };
      value: unknown = 42;
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, read } = await page(
      `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="value#init=element: .n"></${tag}><span>{{ .n }}</span></li></template></ul>`,
      { rows: [{ n: 1 }, { n: 2 }] },
    );
    expect(texts(root, "li span")).toEqual(["42", "42"]);
    expect(read("rows.1.n")).toBe(42);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("最初は空の一覧に、後から行を足しても描かれる（クラスは定義済み）", async () => {
    const tag = `issue-output-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
      status = "ready";
    });
    const { root, write } = await page(
      `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span>{{ .st }}</span></li></template></ul>`,
      { rows: [] },
    );
    await write((s) => { s.rows = [{ st: "a" }]; });
    expect(texts(root, "li span")).toEqual(["ready"]);
  });
});

describe("#320 同じリストを別の for も描いているとき、if で消して戻した for が一覧に追従しない", () => {
  it("Issue の表のとおりに書き込むと、<ul> は <ol> と同じ一覧を描く", async () => {
    const { root, write } = await page(
      `<div><template data-wcs="if: showA"><ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul></template></div>`
      + `<ol><template data-wcs="for: items"><li>{{ .id }}:{{ .name }}</li></template></ol>`,
      { showA: true, items: [{ id: 1, name: "item 1" }, { id: 2, name: "item 2" }] },
    );
    const ul = () => texts(root, "ul li");
    const ol = () => texts(root, "ol li");
    await write((s) => { s.items = s.items.concat({ id: 3, name: "item 3" }); });
    expect(ul()).toEqual(["item 1", "item 2", "item 3"]);
    await write((s) => { s.showA = false; });
    expect(ul()).toEqual([]);
    await write((s) => { s.items = s.items.concat({ id: 4, name: "item 4" }); });
    expect(ol()).toEqual(["1:item 1", "2:item 2", "3:item 3", "4:item 4"]);
    await write((s) => { s.showA = true; });
    expect(ul()).toEqual(["item 1", "item 2", "item 3", "item 4"]);
    await write((s) => { s.items = s.items.toReversed(); });
    expect(ul()).toEqual(["item 4", "item 3", "item 2", "item 1"]);
    expect(ol()).toEqual(["4:item 4", "3:item 3", "2:item 2", "1:item 1"]);
  });
});

describe("#321 マウントしたコンポーネントのメソッドが私有キーに書いても描き直されない", () => {
  it("メソッド（イベントハンドラ）が私有キーに書くと、その回に描き直される", async () => {
    const tag = component(
      `<span class="name">{{ name }}</span> <span class="mode">{{ mode }}</span><button data-wcs="onclick: toggle">toggle</button>`,
      () => ({ mode: "view", toggle(this: any) { this.mode = this.mode === "view" ? "edit" : "view"; } }),
    );
    const { root } = await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "Alice" } });
    const card = root.querySelector(tag) as any;
    const sr = card.shadowRoot as ShadowRoot;
    expect(sr.querySelector(".name")!.textContent).toBe("Alice");
    (sr.querySelector("button") as HTMLElement).click();
    await flush();
    await flush();
    expect(card.state.mode).toBe("edit");
    expect(sr.querySelector(".mode")!.textContent).toBe("edit");
  });

  it("for の行のイベントハンドラが私有キーに書いても、その回に描き直される", async () => {
    const tag = component(
      `<ul><template data-wcs="for: items"><li data-wcs="onclick: pick">{{ .v }}</li></template></ul><p class="picked">{{ picked }}</p>`,
      () => ({ picked: -1, pick(this: any, _e: Event, i: number) { this.picked = i; } }),
    );
    const { root } = await page(`<${tag} data-wcs="state.items: items"></${tag}>`, { items: [{ v: "a" }, { v: "b" }] });
    const sr = (root.querySelector(tag) as any).shadowRoot as ShadowRoot;
    (sr.querySelectorAll("li")[1] as HTMLElement).click();
    await flush();
    await flush();
    expect(sr.querySelector(".picked")!.textContent).toBe("1");
  });
});

describe("#322 for の行の中にマウントしたコンポーネントの getter で $getAll が失敗する", () => {
  it("行ごとの合計（3 と 7）が表示される", async () => {
    const tag = component(
      `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul><p class="total">{{ total }}</p>`,
      () => ({ get total() { return (this as any).$getAll("items.*.v", []).reduce((a: number, b: number) => a + b, 0); } }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, write } = await page(
      `<template data-wcs="for: groups"><section><${tag} data-wcs="state.items: .items"></${tag}></section></template>`,
      { groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }, { v: 4 }] }] },
    );
    const totals = () => Array.from(root.querySelectorAll(tag)).map((c) => (c as any).shadowRoot.querySelector(".total").textContent);
    expect(totals()).toEqual(["3", "7"]);
    // the host's leaf write reaches the component's total
    await write((s) => { s["groups.1.items.0.v"] = 30; });
    expect(totals()).toEqual(["3", "34"]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("#323 for の行の中にマウントしたコンポーネントから this[\"items.0.v\"] に書くと投げる", () => {
  it("2 つ目の組のボタンで、ホストの groups.1.items.0.v が 13 になり、その行の表示も変わる", async () => {
    const tag = component(
      `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul><button data-wcs="onclick: bump">bump</button>`,
      () => ({ bump(this: any) { this["items.0.v"] = this["items.0.v"] + 10; } }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, read } = await page(
      `<template data-wcs="for: groups"><section><${tag} data-wcs="state.items: .items"></${tag}></section></template>`,
      { groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }, { v: 4 }] }] },
    );
    const cards = Array.from(root.querySelectorAll(tag)) as any[];
    (cards[1].shadowRoot.querySelector("button") as HTMLElement).click();
    await flush();
    await flush();
    expect(read("groups.1.items.0.v")).toBe(13);
    expect(read("groups.0.items.0.v")).toBe(1);
    expect(texts(cards[1].shadowRoot, "li")).toEqual(["13", "4"]);
    expect(texts(cards[0].shadowRoot, "li")).toEqual(["1", "2"]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("#324 for で描いていないリストの行を添字のパスで読み書きすると ListIndex not found で投げる", () => {
  it("Issue の手順: メソッドが最後まで走り、items[0].v が 7、count が 1 になる", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, read } = await page(`<p>{{ count }}</p><button data-wcs="onclick: bump">bump</button>`, {
      items: [{ v: 1 }, { v: 2 }],
      count: 0,
      bump(this: any) { this["items.0.v"] = 7; this.count++; },
    });
    (root.querySelector("button") as HTMLElement).click();
    await flush();
    await flush();
    expect(read("items.0.v")).toBe(7);
    expect(root.querySelector("p")!.textContent).toBe("1");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("描いていない形のどれでも、添字のパスで読み書きできる", async () => {
    const groups = () => ({ groups: [{ name: "a", items: [{ v: 1 }, { v: 2 }] }] });
    const shapes: [string, () => Record<string, any>, string][] = [
      ["最上位のリストを描かない", () => ({ items: [{ v: 1 }, { v: 2 }] }), "items.0.v"],
      ["外側だけ for で描く", groups, "groups.0.items.1.v"],
      ["どちらも描かない", groups, "groups.0.items.1.v"],
    ];
    for (const [label, state, path] of shapes) {
      const html = label === "外側だけ for で描く" ? `<template data-wcs="for: groups"><h2>{{ .name }}</h2></template>` : "";
      const { write, read } = await page(html, state());
      await write((s) => { s[path] = 5; });
      expect(read(path), label).toBe(5);
    }
  });
});

// ---------------------------------------------------------------- #258 (SSR hydration)

/** Renders `html` as the server does (an orchestrated render, then the snapshot builder); its HTML. */
async function serverRender(html: string, state: Record<string, any>): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  try {
    const h = document.createElement(`issue-server-${seq++}`);
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

/** Loads the server's HTML and hydrates it; `before` sees the page before the state loads. */
async function hydrate(html: string, state: Record<string, any>, before?: (root: ShadowRoot) => void) {
  const h = document.createElement(`issue-client-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  before?.(root);
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
  return { root, write };
}

/** Server-renders `html`, hydrates it, and checks the server's row nodes were adopted (not re-created). */
async function ssrPage(html: string, state: () => Record<string, any>, rowSel: string) {
  const out = await serverRender(`<wcs-state enable-ssr></wcs-state>${html}`, state());
  expect(out).toContain("<wcs-ssr");
  let serverRows: Element[] = [];
  const page = await hydrate(out, state(), (r) => { serverRows = Array.from(r.querySelectorAll(rowSel)); });
  expect(serverRows.length).toBeGreaterThan(0);
  for (const n of serverRows) expect(n.isConnected).toBe(true);
  return { ...page, out };
}

describe("#258 SSR ハイドレーション後、行の getter バインドが葉の更新に追従しない（X6）", () => {
  const nodes = () => ({
    nodes: [{ v: 1 }, { v: 2 }],
    get "nodes.*.double"() { return (this as any)["nodes.*.v"] * 2; },
  });

  it("行の getter（属性のバインディング）: 葉の更新に追従する", async () => {
    const { root, write } = await ssrPage(
      `<ul><template data-wcs="for: nodes"><li data-wcs="textContent: .double"></li></template></ul>`, nodes, "li");
    expect(texts(root, "li")).toEqual(["2", "4"]);
    await write((s) => { s["nodes.1.v"] = 10; });
    expect(texts(root, "li")).toEqual(["2", "20"]);
  });

  it("残り 1: 入れ子の for の内側の行", async () => {
    const state = () => ({
      groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }] }],
      get "groups.*.items.*.double"() { return (this as any)["groups.*.items.*.v"] * 2; },
    });
    const { root, write } = await ssrPage(
      `<template data-wcs="for: groups"><ol><template data-wcs="for: .items"><li>{{ .double }}</li></template></ol></template>`, state, "ol li");
    expect(texts(root, "ol li")).toEqual(["2", "4", "6"]);
    await write((s) => { s["groups.0.items.1.v"] = 10; s["groups.1.items.0.v"] = 20; });
    expect(texts(root, "ol li")).toEqual(["2", "20", "40"]);
  });

  it("残り 2: 行の中の mustache テキスト", async () => {
    const { root, write } = await ssrPage(
      `<ul><template data-wcs="for: nodes"><li><b>{{ .v }}</b> x2 = {{ .double }}</li></template></ul>`, nodes, "li");
    expect(texts(root, "li")).toEqual(["1 x2 = 2", "2 x2 = 4"]);
    await write((s) => { s["nodes.0.v"] = 7; });
    expect(texts(root, "li")).toEqual(["7 x2 = 14", "2 x2 = 4"]);
  });

  it("残り 3: if の中の for", async () => {
    // not { ...nodes() }: a spread evaluates the getter and copies its value
    const state = () => Object.defineProperties({ open: true }, Object.getOwnPropertyDescriptors(nodes()));
    const { root, write } = await ssrPage(
      `<template data-wcs="if: open"><ul><template data-wcs="for: nodes"><li>{{ .double }}</li></template></ul></template>`, state, "li");
    expect(texts(root, "li")).toEqual(["2", "4"]);
    await write((s) => { s["nodes.1.v"] = 5; });
    expect(texts(root, "li")).toEqual(["2", "10"]);
  });

  // サーバの出力では行の要素から data-wcs が外れる（行は計画の複製）。コンポーネントのクラスが
  // ハイドレーションより先に定義されていると、コンポーネントの <wcs-state bind-component> はホストが
  // 行を引き取る前に接続する。サーバが残す data-wcs-wired を手がかりに結線を待つ（無ければ独立した木に
  // なり、{{ d }} が binding-path-missing で失敗していた。Chromium でも同じ）。
  it("残り 4: 行の中の bind-component の子（クラスを先に定義）", async () => {
    const tag = component(`<span class="d">{{ d }}</span>`, () => ({}));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, write, out } = await ssrPage(
      `<ul><template data-wcs="for: nodes"><li><${tag} data-wcs="state.d: .double"></${tag}></li></template></ul>`, nodes, "li");
    // the server's rows carry no data-wcs, the marker instead; the client removes it
    expect(out).toContain(`<${tag} data-wcs-wired="state"></${tag}>`);
    expect(root.querySelector("[data-wcs-wired]")).toBeNull();
    const shown = () => Array.from(root.querySelectorAll(tag)).map((c) => (c as any).shadowRoot.querySelector(".d").textContent);
    expect(shown()).toEqual(["2", "4"]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    await write((s) => { s["nodes.0.v"] = 9; });
    expect(shown()).toEqual(["18", "4"]);
  });
});
