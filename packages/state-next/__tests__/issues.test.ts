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

describe("#2 リスト要素 getter の隣接項目（前の行の getter を読む累計）", () => {
  const html = `<ul><template data-wcs="for: items"><li>{{ .sum }}</li></template></ul>`;
  const sums = (root: ParentNode) => texts(root, "li").map(Number);

  it("数値のパス: 葉の書き込みで後ろの行がすべて再計算される", async () => {
    const { root, write } = await page(html, {
      items: [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }],
      get "items.*.sum"() {
        const self = this as any;
        const i = self.$1;
        return self["items.*.value"] + (i > 0 ? self[`items.${i - 1}.sum`] : 0);
      },
    });
    expect(sums(root)).toEqual([1, 3, 6, 10]);
    await write((s) => { s["items.0.value"] = 10; });
    expect(sums(root)).toEqual([10, 12, 15, 19]);
    await write((s) => { s["items.2.value"] = 0; });
    expect(sums(root)).toEqual([10, 12, 12, 16]);
  });

  it("$resolve: 同じく再計算され、行の追加・並べ替え・削除にも追従する", async () => {
    const { root, write } = await page(html, {
      items: [{ value: 1 }, { value: 2 }, { value: 3 }],
      get "items.*.sum"() {
        const self = this as any;
        const i = self.$1;
        return self["items.*.value"] + (i > 0 ? self.$resolve("items.*.sum", [i - 1]) : 0);
      },
    });
    expect(sums(root)).toEqual([1, 3, 6]);
    await write((s) => { s["items.1.value"] = 20; });
    expect(sums(root)).toEqual([1, 21, 24]);
    await write((s) => { s.items = [{ value: 100 }, ...s.items]; });
    expect(sums(root)).toEqual([100, 101, 121, 124]);
    await write((s) => { s.items = s.items.toReversed(); });
    expect(sums(root)).toEqual([3, 23, 24, 124]);
    await write((s) => { s.items = s.items.toSpliced(1, 1); });
    expect(sums(root)).toEqual([3, 4, 104]);
  });

  it("Issue の本文のまま（行 0 に守りが無い）: 無限ループにならず、行 0 だけが NaN、一覧は描かれる", async () => {
    const { root, write } = await page(html, {
      items: [{ value: 1 }, { value: 2 }],
      get "items.*.sum"() {
        const self = this as any;
        return self["items.*.value"] + self[`items.${self.$1 - 1}.sum`];
      },
    });
    expect(texts(root, "li")).toEqual(["NaN", "NaN"]);
    await write((s) => { s["items.1.value"] = 5; });
    expect(texts(root, "li")).toEqual(["NaN", "NaN"]);
  });
});

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
async function serverRender(html: string, state: Record<string, any>, wait = 0): Promise<string> {
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
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
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

// ---------------------------------------------------------------- #330 〜 #338（2026-09-26 に登録）

describe("#330 for / if のテンプレートの中の spread（...:）が、まだ定義されていない要素で失敗する", () => {
  it("for の行（...: . と ...: people.*）と if の枝の spread も、要素の定義を待って展開する", async () => {
    const tag = `issue-greet-${seq++}`;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root } = await page(
        `<ul class="dot"><template data-wcs="for: people"><li><${tag} data-wcs="...: ."></${tag}></li></template></ul>`
        + `<ul class="star"><template data-wcs="for: people"><li><${tag} data-wcs="...: people.*"></${tag}></li></template></ul>`
        + `<template data-wcs="if: show"><${tag} class="branch" data-wcs="...: one"></${tag}></template>`
        + `<${tag} class="root" data-wcs="...: one"></${tag}>`,
        { people: [{ name: "a", greeting: null }, { name: "b", greeting: null }], one: { name: "z", greeting: null }, show: true },
      );
      expect(root.querySelectorAll(`.dot ${tag}, .star ${tag}`).length).toBe(4);
      customElements.define(tag, class extends HTMLElement {
        static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "greeting", event: `${tag}:greeting` }], inputs: [{ name: "name" }] };
        n: unknown;
        set name(v: unknown) { this.n = v; this.textContent = `hello ${v}`; }
        get name(): unknown { return this.n; }
        get greeting(): string { return `hello ${this.n}`; }
      });
      await flush();
      await flush();
      expect(texts(root, `.dot ${tag}`)).toEqual(["hello a", "hello b"]);
      expect(texts(root, `.star ${tag}`)).toEqual(["hello a", "hello b"]);
      expect(texts(root, ".branch")).toEqual(["hello z"]);
      expect(texts(root, ".root")).toEqual(["hello z"]);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe("#331 bind-component のコンポーネントのメソッドを element.state から呼ぶ", () => {
  it("私有キーの書き込みは描き直され、ツリーのキーの書き込みはホストに届く", async () => {
    const tag = component(`<span class="name">{{ name }}</span><span class="mode">{{ mode }}</span>`, () => ({
      mode: "view",
      toggle(this: any) { this.mode = this.mode === "view" ? "edit" : "view"; },
      rename(this: any) { this.name = "Bob"; },
    }));
    const { root, read } = await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "Alice" } });
    const card = root.querySelector(tag) as any;
    const shown = () => [card.shadowRoot.querySelector(".name").textContent, card.shadowRoot.querySelector(".mode").textContent];
    card.state.toggle();
    await flush();
    await flush();
    expect(shown()).toEqual(["Alice", "edit"]);
    card.state.rename();
    await flush();
    await flush();
    expect(read("user.name")).toBe("Bob");
    expect(shown()).toEqual(["Bob", "edit"]);
  });
});

// state-next でも起きる（未修正）: マークアップの items.0.v は字面どおりのパターンになり、添字のパスへの書き込み
// （items.*.v の行 0）が届かない。数値添字の getter（items.0.double）は items.*.double の getter に当たらない。
// it.fails: 直ったらこの印を外す。
describe("#332 マークアップに書いた数値添字のパス（items.0.v）が、添字のパスでの書き込みに追従する", () => {
  it.fails.each([["for あり", true], ["for なし", false]])("%s", async (_name, withFor) => {
    const { root, write } = await page(
      `<span class="a" data-wcs="textContent: items.0.v"></span><span class="b">{{ items.1.v }}</span><span class="d" data-wcs="textContent: items.0.double"></span>`
      + (withFor ? `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>` : ""),
      { items: [{ v: 1 }, { v: 2 }], get "items.*.double"() { return (this as any)["items.*.v"] * 2; } },
    );
    const shown = () => [".a", ".b", ".d"].map((s) => root.querySelector(s)!.textContent);
    expect(shown()).toEqual(["1", "2", "2"]);
    await write((s) => { s["items.0.v"] = 7; });
    expect(shown()).toEqual(["7", "2", "14"]);
    await write((s) => { s["items.1.v"] = 8; });
    expect(shown()).toEqual(["7", "8", "14"]);
    await write((s) => { s["items.0"] = { v: 50 }; });
    expect(shown()).toEqual(["50", "8", "100"]);
    await write((s) => { s.items = [{ v: 100 }, { v: 200 }]; });
    expect(shown()).toEqual(["100", "200", "200"]);
    if (withFor) expect(texts(root, "li")).toEqual(["100", "200"]);
  });
});

describe("#333 for で描いていないリストの要素を this[\"items.0\"] = {…} で差し替えても、子のパスが新しい値を返す", () => {
  it("Issue の HTML: 差し替えの直後の読み・getter・$getAll が新しい値", async () => {
    const { root, read } = await page(
      `<b class="d">{{ doneCount }}</b><b class="f">{{ firstName }}</b><i>{{ seen }}</i>`
      + `<button class="r" data-wcs="onclick: rename"></button><button class="t" data-wcs="onclick: toggle"></button>`,
      {
        items: [{ name: "a", done: false }, { name: "b", done: false }],
        seen: "",
        get firstName() { return (this as any)["items.0.name"]; },
        get doneCount() { return (this as any).$getAll("items.*.done", []).filter(Boolean).length; },
        rename(this: any) {
          this["items.0"] = { ...this["items.0"], name: "z" };
          this.seen = this["items.0.name"];
        },
        toggle(this: any) { this["items.0"] = { ...this["items.0"], done: !this["items.0"].done }; },
      },
    );
    const shown = () => [".d", ".f", "i"].map((s) => root.querySelector(s)!.textContent);
    expect(shown()).toEqual(["0", "a", ""]);
    (root.querySelector(".r") as HTMLElement).click();
    await flush();
    await flush();
    expect(shown()).toEqual(["0", "z", "z"]);
    expect(read("items.0.name")).toBe("z");
    (root.querySelector(".t") as HTMLElement).click();
    await flush();
    await flush();
    expect(shown()).toEqual(["1", "z", "z"]);
    expect(read("items.0.done")).toBe(true);
  });

  it("createState だけの最小形", async () => {
    const { el } = await page("", { items: [{ v: 1 }, { v: 2 }] });
    const get = (fn: (s: any) => unknown) => {
      let v: unknown;
      el.createState("readonly", (s: any) => { v = fn(s); });
      return v;
    };
    expect(get((s) => s.$getAll("items.*.v", []))).toEqual([1, 2]);
    el.createState("writable", (s: any) => { s["items.1"] = { v: 77 }; });
    expect(get((s) => s["items.1.v"])).toBe(77);
    expect(get((s) => s.$getAll("items.*.v", []))).toEqual([1, 77]);
  });
});

describe("#334 サーバー描画中に空でないリストへ行を足しても、ハイドレーション後に一覧を書き換えられる", () => {
  const server = (items: { n: number }[], adds: { n: number }[][]) => ({
    items, count: 0,
    async $connectedCallback(this: any) {
      for (const add of adds) {
        await new Promise((r) => setTimeout(r, 5));
        this.items = [...this.items, ...add];
      }
    },
  });
  it.each([
    ["textContent: で描く", `<li data-wcs="textContent: .n"></li>`],
    ["マスタッシュで描く", `<li>{{ .n }}</li>`],
  ])("1 行ある一覧に 2 行足す（%s）", async (_name, row) => {
    const html = `<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: items">${row}</template></ul><p>{{ count }}</p>`;
    const out = await serverRender(html, server([{ n: 1 }], [[{ n: 2 }, { n: 3 }]]), 30);
    let serverRows: Element[] = [];
    const { root, write } = await hydrate(out, { items: [{ n: 1 }, { n: 2 }, { n: 3 }], count: 0 }, (r) => { serverRows = Array.from(r.querySelectorAll("li")); });
    expect(serverRows.length).toBe(3);
    expect(texts(root, "li")).toEqual(["1", "2", "3"]);
    for (const n of serverRows) expect(n.isConnected).toBe(true);
    await write((s) => { s.count = 1; });
    expect(texts(root, "li")).toEqual(["1", "2", "3"]);
    await write((s) => { s["items.1.n"] = 20; });
    expect(texts(root, "li")).toEqual(["1", "20", "3"]);
    await write((s) => { s.items = [...s.items, { n: 99 }]; });
    expect(texts(root, "li")).toEqual(["1", "20", "3", "99"]);
    await write((s) => { s.items = s.items.slice(1); });
    expect(texts(root, "li")).toEqual(["20", "3", "99"]);
    await write((s) => { s.items = [{ n: 7 }, { n: 8 }]; });
    expect(texts(root, "li")).toEqual(["7", "8"]);
  });

  it("空の一覧に 2 行ずつ 3 回足す（ページ送りの読み込み）", async () => {
    const html = `<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: items"><li data-wcs="textContent: .n"></li></template></ul>`;
    const pages = [[{ n: 1 }, { n: 2 }], [{ n: 3 }, { n: 4 }], [{ n: 5 }, { n: 6 }]];
    const out = await serverRender(html, server([], pages), 60);
    const { root, write } = await hydrate(out, { items: pages.flat(), count: 0 });
    expect(texts(root, "li")).toEqual(["1", "2", "3", "4", "5", "6"]);
    await write((s) => { s["items.1.n"] = 20; });
    expect(texts(root, "li")).toEqual(["1", "20", "3", "4", "5", "6"]);
    await write((s) => { s.items = s.items.slice(4); });
    expect(texts(root, "li")).toEqual(["5", "6"]);
  });
});

describe("#335 同じバッチで一覧を置き換えてから要素に書き込んでも、for が追従する", () => {
  it.each<[string, (s: any) => void, string[], string[], string[]]>([
    ["形 A（1 行足してから行 0 を差し替える）", (s) => { s.items = [...s.items, { id: 4 }]; s["items.0"] = { id: 99 }; }, ["99", "2", "3", "4"], ["4", "3", "2", "99"], ["4", "3", "2", "99", "5"]],
    ["形 B（写しで置き換えてから行 1 を差し替える）", (s) => { s.items = [...s.items]; s["items.1"] = { id: 99 }; }, ["1", "99", "3"], ["3", "99", "1"], ["3", "99", "1", "5"]],
  ])("%s", async (_name, first, afterFirst, afterReverse, afterAppend) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, write } = await page(`<ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>`, { items: [{ id: 1 }, { id: 2 }, { id: 3 }] });
      await write(first);
      expect(texts(root, "li")).toEqual(afterFirst);
      await write((s) => { s.items = [...s.items].reverse(); });
      expect(texts(root, "li")).toEqual(afterReverse);
      await write((s) => { s.items = [...s.items, { id: 5 }]; });
      expect(texts(root, "li")).toEqual(afterAppend);
      await write((s) => { s.items = [{ id: 7 }, { id: 8 }]; });
      expect(texts(root, "li")).toEqual(["7", "8"]);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe("#336 SSR のハイドレーションで、if の枝の中に if があっても、外側の else は外側の if と組になる", () => {
  const outer = (inner: string) => `<template data-wcs="if: a"><div class="a">A ${inner}</div></template><template data-wcs="else:"><p class="na">notA</p></template>`;
  const shown = (root: ParentNode) => ({ A: root.querySelector(".a") !== null, B: root.querySelector("i") !== null, notB: root.querySelector("s") !== null, notA: root.querySelector(".na") !== null });
  it.each([
    ["内側に else なし", outer(`<template data-wcs="if: b"><i>B</i></template>`)],
    ["内側に else あり", outer(`<template data-wcs="if: b"><i>B</i></template><template data-wcs="else:"><s>notB</s></template>`)],
  ])("%s", async (_name, html) => {
    const { root, write } = await ssrPage(html, () => ({ a: true, b: true }), ".a");
    expect(shown(root)).toEqual({ A: true, B: true, notB: false, notA: false });
    await write((s) => { s.a = false; });
    expect(shown(root)).toEqual({ A: false, B: false, notB: false, notA: true });
    await write((s) => { s.a = true; });
    expect(shown(root)).toEqual({ A: true, B: true, notB: false, notA: false });
    await write((s) => { s.b = false; });
    expect(shown(root)).toEqual({ A: true, B: false, notB: html.includes("notB"), notA: false });
    await write((s) => { s.b = true; });
    expect(shown(root)).toEqual({ A: true, B: true, notB: false, notA: false });
  });
});

describe("#337 行の要素の出力を行そのものに束ね、要素どうしが同じ値を返しても、一覧は壊れない", () => {
  it.each(["status: .", "status: rows.*"])("%s", async (binding) => {
    const tag = `issue-same-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
      get status(): string { return "ready"; }
    });
    const { root, write, read } = await page(
      `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="${binding}"></${tag}><span>{{ . }}</span><i>{{ .idx }}</i></li></template></ul>`,
      // $1 in markup is not supported by state-next (a gap of its own): read it through a row getter
      { rows: ["a", "b", "c"], get "rows.*.idx"() { return (this as any).$1; } },
    );
    expect(texts(root, "i")).toEqual(["0", "1", "2"]);
    expect(read("rows")).toEqual(["ready", "ready", "ready"]);
    await write((s) => { s.rows = ["x", "y"]; });
    expect(texts(root, "i")).toEqual(["0", "1"]);
    expect(root.querySelectorAll("li").length).toBe(2);
    await write((s) => { s.rows = []; });
    expect(root.querySelectorAll("li").length).toBe(0);
  });
});

describe("#338 行の要素の出力を、その一覧の元になるルートのキーへ束ねても、ページが固まらない", () => {
  it("要素ごとに違う値を返す: 32 回の打ち切りで止まって報告され、ページは固まらない", async () => {
    const tag = `issue-loop-${seq++}`;
    let c = 0;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
      i = ++c;
      get status(): string { return `m${this.i}`; }
    });
    let evals = 0;
    let macrotasks = 0;
    const timer = setInterval(() => { macrotasks++; }, 0);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root } = await page(`<ul><template data-wcs="for: view"><li><${tag} data-wcs="status: mode"></${tag}><span>{{ .m }}</span></li></template></ul>`, {
        mode: "init",
        rows: [{ k: 1 }, { k: 2 }],
        get view() {
          if (++evals > 5000) throw new Error("runaway-evals (cap 5000)");
          const m = (this as any).mode;
          return (this as any).rows.map((r: object) => ({ ...r, m }));
        },
      });
      await new Promise((r) => setTimeout(r, 20));
      const messages = error.mock.calls.map((x) => String((x[0] as Error)?.message ?? x[0]));
      // the drain is cut at MAX_DRAIN_PASSES (32) and reported (#11, no path named); the list shows the last pass
      expect(evals).toBeLessThanOrEqual(34);
      expect(messages).toEqual(["[@wcstack/state] #11"]);
      expect(texts(root, "span").length).toBe(2);
      expect(macrotasks).toBeGreaterThan(0);
    } finally {
      clearInterval(timer);
      error.mockRestore();
    }
  });
});
