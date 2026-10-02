/**
 * Regressions of the add-on review. Cycle 1 (B1–B9, BN1, S1, U1): volumes (row-level getters,
 * `$eqIndex`, a failed root, SSR), exported getters across a host re-set, the `$` declarations of a
 * mounted component, `$recursion` re-sets. Cycle 2 (D1, D2, C2, C7–C9): SSR adoption, `$listKeys`
 * field names, `$watch` under getters.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, listKeys, recursion, scopes, ssr, temporal } from "../src/index";
import { WatchRuntime } from "../src/temporal/watch";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  // scopes before ssr, as the full build installs them
  installFeatures([temporal, listKeys, scopes, recursion, ssr]);
  bootstrapState();
});

/** A shadow root with `html`; states handed to its <wcs-state> elements in document order. */
async function host(html: string, states: Record<string, any>[], build?: (root: ShadowRoot) => void) {
  const h = document.createElement(`quality-addon-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  build?.(root);
  const els = Array.from(root.querySelectorAll("wcs-state")) as any[];
  els.forEach((el, i) => el.setInitialState(states[i]));
  document.body.appendChild(h);
  await Promise.all(els.map((el) => el.connectedCallbackPromise));
  await getBindingsReady(root);
  await flush();
  return { h, root, els };
}

const text = (c: ShadowRoot | Element | null | undefined, sel: string) => c!.querySelector(sel)!.textContent;

describe("volume の行の getter（B1）", () => {
  it("volume が宣言したワイルドカードの getter が行ごとに評価され、葉の変更に追従する", async () => {
    const { root, els } = await host(
      `<wcs-state></wcs-state><wcs-state mount="cart"></wcs-state><template data-wcs="for: cart.items"><p data-wcs="textContent: cart.items.*.sub"></p></template>`,
      [{}, {
        items: [{ price: 2, qty: 3 }, { price: 5, qty: 1 }],
        get "items.*.sub"() { return (this as any)["items.*.price"] * (this as any)["items.*.qty"]; },
      }],
    );
    expect(Array.from(root.querySelectorAll("p"), (p) => p.textContent)).toEqual(["6", "5"]);
    els[0].createState("writable", (s: any) => { s["cart.items.1.qty"] = 4; });
    await flush();
    expect(Array.from(root.querySelectorAll("p"), (p) => p.textContent)).toEqual(["6", "20"]);
  });
});

describe("$recursion を持つ根への volume の接ぎ木（BN1）", () => {
  it.each([
    ["データだけの", { n: 7 }, "7"],
    ["メソッドだけの", { go() {} }, ""],
    ["getter を持つ", { n: 2, get twice() { return (this as any).n * 2; } }, "2"],
  ])("根を束ねた後に読み込んだ%s volume が接ぎ木し、根の ** の族と ** の拒否はそのまま", async (_name, volume, expected) => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      const { root, els } = await host(
        `<wcs-state></wcs-state><p>{{ cart.n }}</p><template data-wcs="for: nodes"><i>{{ nodes.*.total }}</i></template>`,
        [{
          $recursion: { "nodes.*": "children.*" },
          nodes: [{ v: 1, children: [{ v: 2, children: [] }] }],
          get "nodes.**.total"() { return (this as any)["nodes.**.v"] + (this as any).$getAll("nodes.**.children.*.v").reduce((a: number, b: number) => a + b, 0); },
        }],
      );
      const v = document.createElement("wcs-state") as any;
      v.setAttribute("mount", "cart");
      v.setInitialState(volume);
      root.append(v);
      await v.connectedCallbackPromise;
      await flush();
      expect(errors).toEqual([]);
      expect(text(root, "p")).toBe(expected);
      expect(text(root, "i")).toBe("3");
      els[0].createState("writable", (s: any) => { s["nodes.0.children.0.v"] = 5; });
      await flush();
      expect(text(root, "i")).toBe("6");
      // a `**` path made later is still refused
      expect(() => els[0].createState("readonly", (s: any) => s.$resolve("nodes.**.w", [0]))).toThrow("[wcs/recursion-unsupported]");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("$recursion を外す再セット（S1）", () => {
  it("投げずに束縛を当て直し、族だったパスはデータを読み、新しい ** のパスは $recursion の無い状態と同じく拒む", async () => {
    const rec = { $recursion: { "nodes.*": "children.*" }, v: 1, nodes: [{ total: 9, children: [] }], get "nodes.**.total"() { return 1; } };
    const { root, els } = await host(`<wcs-state></wcs-state><p>{{ v }}</p><template data-wcs="for: nodes"><i>{{ .total }}</i></template>`, [rec]);
    expect(text(root, "p")).toBe("1");
    expect(text(root, "i")).toBe("1");
    expect(() => els[0].setInitialState({ v: 3, nodes: [{ total: 9, children: [] }], $commandTokens: ["go"] })).not.toThrow();
    await flush();
    expect(text(root, "p")).toBe("3");
    expect(text(root, "i")).toBe("9");
    // the new state's declarations are read
    let names: string[] = [];
    els[0].createState("readonly", (s: any) => { names = Object.keys(s.$command); });
    expect(names).toEqual(["go"]);
    expect(() => els[0].createState("readonly", (s: any) => s.$resolve("nodes.**.w", [0]))).toThrow("[wcs/recursion-unsupported]");
  });

  it("外した後は、以前宣言していた ** のパスも黙って undefined にならず拒む（U1）", async () => {
    const rec = { $recursion: { "nodes.*": "children.*" }, nodes: [], get "nodes.**.total"() { return 1; } };
    const { els } = await host(`<wcs-state></wcs-state>`, [rec]);
    els[0].setInitialState({ nodes: [] });
    for (const read of [(s: any) => s["nodes.**.total"], (s: any) => s.$resolve("nodes.**.total", []), (s: any) => s["nodes.**.other"]]) {
      expect(() => els[0].createState("readonly", read)).toThrow("[wcs/recursion-unsupported]");
    }
  });

  it("$recursion を保つ再セットの後に読み込んだ volume も接ぎ木する", async () => {
    const rec = (v: number) => ({ $recursion: { "nodes.*": "children.*" }, v, nodes: [{ children: [] }], get "nodes.**.total"() { return 1; } });
    const { root, els } = await host(`<wcs-state></wcs-state><p>{{ v }}/{{ cart.d }}</p>`, [rec(1)]);
    els[0].setInitialState(rec(2));
    const v = document.createElement("wcs-state") as any;
    v.setAttribute("mount", "cart");
    v.setInitialState({ n: 1, get d() { return (this as any).n * 2; } });
    root.append(v);
    await v.connectedCallbackPromise;
    await flush();
    expect(text(root, "p")).toBe("2/2");
  });
});

describe("volume の $eqIndex（B8）", () => {
  it("$eqIndex のパスはマウントからの相対で読む", async () => {
    const { root } = await host(
      `<wcs-state></wcs-state><wcs-state mount="cart"></wcs-state><template data-wcs="for: cart.items"><i data-wcs="textContent: cart.items.*.current"></i></template>`,
      [{ selected: 9 }, {
        selected: 1,
        items: [{}, {}],
        get "items.*.current"() { return (this as any).$eqIndex("selected"); },
      }],
    );
    expect(Array.from(root.querySelectorAll("i"), (i) => i.textContent)).toEqual(["false", "true"]);
  });
});

describe("根の初期化に失敗したときの volume（B4）", () => {
  it.each([
    ["volume が先", `<wcs-state mount="cart"></wcs-state><wcs-state></wcs-state>`, 1],
    ["根が先", `<wcs-state></wcs-state><wcs-state mount="cart"></wcs-state>`, 0],
  ])("%s: 待っている volume は報告して決着し、永久に待たない", async (_name, html, rootIndex) => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      const h = document.createElement(`quality-addon-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = html;
      const els = Array.from(root.querySelectorAll("wcs-state")) as any[];
      els[rootIndex].setInitialState({ $scan: {} });
      els[1 - rootIndex].setInitialState({ n: 1 });
      document.body.appendChild(h);
      await expect(els[rootIndex].connectedCallbackPromise).rejects.toThrow();
      // settles (a hang would time the test out)
      await els[1 - rootIndex].connectedCallbackPromise;
      await els[1 - rootIndex].initializePromise;
      expect(errors.filter((e) => e.includes(`<wcs-state mount="cart"> will not graft: the root state failed to initialize.`))).toHaveLength(1);
      // a volume that loads after the failure does not wait either
      const late = document.createElement("wcs-state") as any;
      late.setAttribute("mount", "later");
      late.setInitialState({ n: 1 });
      root.append(late);
      await late.connectedCallbackPromise;
      expect(errors.filter((e) => e.includes(`<wcs-state mount="later"> will not graft: the root state failed to initialize.`))).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("根より先に読み込んだ 2 つの volume は、どちらも根のエンジンができた時に接ぎ木する", async () => {
    const h = document.createElement(`quality-addon-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><wcs-state mount="a"></wcs-state><wcs-state mount="b"></wcs-state><p>{{ a.n }}/{{ b.n }}</p>`;
    const [rootEl, a, b] = Array.from(root.querySelectorAll("wcs-state")) as any[];
    a.setInitialState({ n: 1 });
    b.setInitialState({ n: 2 });
    document.body.appendChild(h);
    await flush();
    rootEl.setInitialState({});
    await Promise.all([rootEl, a, b].map((el) => el.connectedCallbackPromise));
    await flush();
    expect(text(root, "p")).toBe("1/2");
  });

  it("失敗した根の後に作り直した根には、後から来た volume が接ぎ木する", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const h = document.createElement(`quality-addon-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><p>{{ cart.n }}</p>`;
      const broken = root.querySelector("wcs-state") as any;
      broken.setInitialState({ $scan: {} });
      document.body.appendChild(h);
      await expect(broken.connectedCallbackPromise).rejects.toThrow();
      broken.remove();
      const fixed = document.createElement("wcs-state") as any;
      fixed.setInitialState({});
      root.prepend(fixed);
      await fixed.connectedCallbackPromise;
      const v = document.createElement("wcs-state") as any;
      v.setAttribute("mount", "cart");
      v.setInitialState({ n: 3 });
      root.append(v);
      await v.connectedCallbackPromise;
      await flush();
      expect(text(root, "p")).toBe("3");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("SSR と volume（B2）", () => {
  const page = (rootFirst: boolean) => {
    const vol = `<wcs-state mount="cart"></wcs-state>`;
    const r = `<wcs-state enable-ssr></wcs-state>`;
    return `${rootFirst ? r + vol : vol + r}<p>{{ cart.n }}/{{ cart.double }}</p><button data-wcs="onclick: cart.add">+</button>`;
  };
  const volume = () => ({
    n: 1,
    get double() { return (this as any).n * 2; },
    add(this: any) { this.n++; },
    $connectedCallback(this: any) { if (document.documentElement.hasAttribute("data-wcs-server")) this.n = 10; },
  });

  async function load(html: string, rootFirst: boolean, server: boolean) {
    if (server) document.documentElement.setAttribute("data-wcs-server", "orchestrated");
    try {
      const h = document.createElement(`quality-addon-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = html;
      const els = Array.from(root.querySelectorAll("wcs-state")) as any[];
      els[rootFirst ? 0 : 1].setInitialState({});
      els[rootFirst ? 1 : 0].setInitialState(volume());
      document.body.appendChild(h);
      await Promise.all(els.map((el) => el.connectedCallbackPromise));
      await getBindingsReady(root);
      await flush();
      if (server) (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(root);
      return { h, root };
    } finally {
      document.documentElement.removeAttribute("data-wcs-server");
    }
  }

  it.each([["根が先", true], ["volume が先", false]])("%s: クライアントの volume はサーバのデータを引き取り、メソッドと getter が動く", async (_name, rootFirst) => {
    const server = await load(page(rootFirst), rootFirst, true);
    const html = server.root.innerHTML;
    server.h.remove();
    expect(html).toContain(`"cart":{"n":10}`);
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      const { root } = await load(html, rootFirst, false);
      expect(text(root, "p")).toBe("10/20");
      (root.querySelector("button") as HTMLElement).click();
      await flush();
      expect(text(root, "p")).toBe("11/22");
      expect(errors).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("スナップショットの無い根では、volume のパスに根のキーがあれば従来どおり接ぎ木しない", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      await host(`<wcs-state enable-ssr></wcs-state><wcs-state mount="cart"></wcs-state>`, [{ cart: 1 }, { n: 1 }]);
      expect(errors).toContain(`[@wcstack/state] <wcs-state mount="cart"> will not graft: the root state already has "cart".`);
    } finally {
      spy.mockRestore();
    }
  });

  it("volume のメソッドは、根がマウントパスを丸ごと書き換えても残る", async () => {
    const { root, els } = await host(
      `<wcs-state></wcs-state><wcs-state mount="cart"></wcs-state><p>{{ cart.n }}</p><button data-wcs="onclick: cart.add">+</button>`,
      [{}, { n: 1, add(this: any) { this.n++; } }],
    );
    els[0].createState("writable", (s: any) => { s.cart = { n: 5 }; });
    await flush();
    (root.querySelector("button") as HTMLElement).click();
    await flush();
    expect(text(root, "p")).toBe("6");
  });
});

/** A component whose `<wcs-state bind-component="state">` sits in its shadow root. */
function define(markup: string, state: () => Record<string, any>): string {
  const tag = `quality-cmp-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    state = state();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${markup}`;
    }
  });
  return tag;
}

async function settle() {
  for (let i = 0; i < 4; i++) await flush();
}

describe("ホストの再セットとエクスポートした getter（B6）", () => {
  it("コンポーネントを外して再セットし、戻すと、ホストがまたエクスポートを読む", async () => {
    const tag = define(`<i>{{ display }}</i>`, () => ({ get display() { return `<${(this as any).name}>`; } }));
    const { root, els } = await host(
      `<wcs-state></wcs-state><template data-wcs="if: show"><${tag} data-wcs="state: user"></${tag}></template><p>{{ user.display }}</p>`,
      [{ show: true, user: { name: "a" } }],
    );
    await settle();
    expect(text(root, "p")).toBe("<a>");
    els[0].createState("writable", (s: any) => { s.show = false; });
    await settle();
    els[0].setInitialState({ show: false, user: { name: "b" } });
    els[0].createState("writable", (s: any) => { s.show = true; });
    await settle();
    expect(text(root, "p")).toBe("<b>");
    expect(text(root.querySelector(tag)!.shadowRoot, "i")).toBe("<b>");
  });

  it("外している間にホストを再セットし、同じ要素をつなぎ直すと、ホストがまたエクスポートを読む", async () => {
    const tag = define(`<i>{{ display }}</i>`, () => ({ get display() { return `(${(this as any).name})`; } }));
    const { root, els } = await host(
      `<wcs-state></wcs-state><div><${tag} data-wcs="state: user"></${tag}></div><p>{{ user.display }}</p>`,
      [{ user: { name: "a" } }],
    );
    await settle();
    expect(text(root, "p")).toBe("(a)");
    const c = root.querySelector(tag)!;
    c.remove();
    await settle();
    els[0].setInitialState({ user: { name: "b" } });
    root.querySelector("div")!.append(c);
    await settle();
    expect(text(root, "p")).toBe("(b)");
  });

  it("再セットの後に新しくマウントしたコンポーネントのエクスポートも読める", async () => {
    const tag = define(`<i>{{ display }}</i>`, () => ({ get display() { return `[${(this as any).name}]`; } }));
    const { root, els } = await host(
      `<wcs-state></wcs-state><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template><p>{{ users.0.display }}</p>`,
      [{ users: [{ name: "a" }] }],
    );
    await settle();
    expect(text(root, "p")).toBe("[a]");
    els[0].createState("writable", (s: any) => { s.users = []; });
    await settle();
    els[0].setInitialState({ users: [] });
    els[0].createState("writable", (s: any) => { s.users = [{ name: "c" }]; });
    await settle();
    expect(text(root, "p")).toBe("[c]");
  });
});

describe("マウントしたコンポーネントの $ 宣言（B9）", () => {
  it("$listKeys はコンポーネント自身の一覧に効き、動かないという警告を出さない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const first = { id: 1, v: "a" };
      const tag = define(`<template data-wcs="for: items"><b>{{ .v }}</b></template>`, () => ({ items: [first], $listKeys: { items: "id" } }));
      const { root } = await host(`<wcs-state></wcs-state><${tag} data-wcs="state.x: x"></${tag}>`, [{ x: 1 }]);
      await settle();
      const c = root.querySelector(tag) as any;
      c.state.items = [{ id: 1, v: "b" }];
      await settle();
      expect(c.state.items[0]).toBe(first);
      expect(text(c.shadowRoot, "b")).toBe("b");
      expect(warn.mock.calls.filter((m) => String(m[0]).includes("[wcs/mount-dollar-declaration]"))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("$recursion はマウントしたコンポーネントでは拒否して報告する", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      const tag = define(`<p>{{ x }}</p>`, () => ({ nodes: [], $recursion: { "nodes.*": "children.*" } }));
      const { root } = await host(`<wcs-state></wcs-state><${tag} data-wcs="state.x: x"></${tag}>`, [{ x: 1 }]);
      await settle();
      const el = root.querySelector(tag)!.shadowRoot!.querySelector("wcs-state") as any;
      await el.connectedCallbackPromise;
      expect(errors.some((e) => e.includes(`[wcs/mount-dollar-declaration] <${tag}>: $recursion is not run in a mounted component`))).toBe(true);
      expect(el.engine).toBe(null);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------- cycle 2

/** Renders `html` on the "server" and hydrates its output; `before` sees the parsed page before the state loads. */
async function ssrRoundTrip(html: string | ((root: ShadowRoot) => void), state: () => Record<string, any>, before?: (root: ShadowRoot) => void) {
  document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  let out: string;
  try {
    // (a function builds the page with the DOM: happy-dom's parser moves a <tr> out of a <template> in a <table>)
    const server = typeof html === "string"
      ? await host(`<wcs-state enable-ssr></wcs-state>${html}`, [state()])
      : await host(`<wcs-state enable-ssr></wcs-state>`, [state()], html);
    (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(server.root);
    out = server.root.innerHTML;
    server.h.remove();
  } finally {
    document.documentElement.removeAttribute("data-wcs-server");
  }
  const h = document.createElement(`quality-addon-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = out;
  before?.(root);
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state());
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
  };
  return { root, write };
}

describe("SSR の引き取り: 隣り合う if の連鎖（D1）", () => {
  it("行の中の別々の if: の連鎖は、それぞれ自分の枝を引き取り、以後の変更も自分のノードに届く", async () => {
    const { root, write } = await ssrRoundTrip(
      `<ul><template data-wcs="for: items"><li><template data-wcs="if: .a"><span>A</span></template>
      <template data-wcs="if: .b"><em>B</em></template></li></template></ul>`,
      () => ({ items: [{ a: true, b: true }] }),
    );
    expect(root.querySelectorAll("span").length).toBe(1);
    expect(root.querySelectorAll("em").length).toBe(1);
    await write((s) => { s["items.0.a"] = false; });
    expect(root.querySelectorAll("span").length).toBe(0);
    expect(root.querySelectorAll("em").length).toBe(1);
  });

  it("ページ直下の隣り合う連鎖も、サーバのノードをそのまま引き取る", async () => {
    let em: Element | null = null;
    let i: Element | null = null;
    const { root } = await ssrRoundTrip(
      `<template data-wcs="if: a"><i>A</i></template><template data-wcs="else:"><i>notA</i></template>
      <template data-wcs="if: b"><em>B</em></template>`,
      () => ({ a: false, b: true }),
      (r) => { em = r.querySelector("em"); i = r.querySelector("i"); },
    );
    expect(Array.from(root.querySelectorAll("i,em"), (n) => n.textContent)).toEqual(["notA", "B"]);
    expect(root.querySelector("em")).toBe(em);
    expect(root.querySelector("i")).toBe(i);
  });
});

describe("SSR の引き取り: 行の形の検査（D2）", () => {
  it("行の中の Light DOM の要素が子を先頭に足していると、行を作り直し、束縛は正しいノードに付く", async () => {
    const tag = `quality-card-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() {
        if (!this.querySelector("h2")) this.prepend(Object.assign(document.createElement("h2"), { textContent: "card" }));
      }
    });
    const { root, write } = await ssrRoundTrip(
      `<ul><template data-wcs="for: items"><li><${tag}><span data-wcs="textContent: .name"></span></${tag}></li></template></ul>`,
      () => ({ items: [{ name: "Bob" }] }),
    );
    await write((s) => { s["items.0.name"] = "Ann"; });
    expect(Array.from(root.querySelectorAll("li"), (li) => li.textContent)).toEqual(["cardAnn"]);
  });

  it("<tbody> を書かない表の行（パーサが <tbody> を補う）も、行の数と束縛が合う", async () => {
    const { root, write } = await ssrRoundTrip(
      (r) => {
        const table = document.createElement("table");
        const t = document.createElement("template");
        t.setAttribute("data-wcs", "for: items");
        t.content.append(Object.assign(document.createElement("tr"), { innerHTML: `<td data-wcs="textContent: .name"></td>` }));
        table.append(t);
        r.append(table);
      },
      () => ({ items: [{ name: "a" }, { name: "b" }] }),
      // (the same parser quirk empties the snapshot's <template> of its <tr>: put it back as a browser parses it)
      (r) => {
        const t = r.querySelector("wcs-ssr template") as HTMLTemplateElement;
        t.content.append(Object.assign(document.createElement("tr"), { innerHTML: `<td data-wcs="textContent: .name"></td>` }));
        // the parser put the rows and the region's end marker in a <tbody>, its start marker outside
        expect(r.querySelector("table > tbody")).not.toBe(null);
      },
    );
    expect(Array.from(root.querySelectorAll("td"), (td) => td.textContent)).toEqual(["a", "b"]);
    await write((s) => { s["items.1.name"] = "B"; });
    expect(Array.from(root.querySelectorAll("td"), (td) => td.textContent)).toEqual(["a", "B"]);
  });

  it("形の合う行は、これまでどおりサーバのノードを引き取る", async () => {
    let li: Element | null = null;
    const { root, write } = await ssrRoundTrip(
      `<ul><template data-wcs="for: items"><li><b data-wcs="textContent: .name"></b></li></template></ul>`,
      () => ({ items: [{ name: "a" }] }),
      (r) => { li = r.querySelector("li"); },
    );
    expect(root.querySelector("li")).toBe(li);
    await write((s) => { s["items.0.name"] = "z"; });
    expect(root.querySelector("b")!.textContent).toBe("z");
  });
});

describe("$listKeys の取り直しのフィールド名（C2）", () => {
  const listHost = (items: unknown[]) => host(
    `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li>{{ .name }}/{{ .double }}</li></template></ul>`,
    [{ items, $listKeys: { items: "id" }, get "items.*.double"() { return (this as any)["items.*.n"] * 2; } }],
  );
  const write = async (el: any, fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
  };

  it("__proto__ を含む名前（JSON の \"__proto__.polluted\"）でも Object.prototype を汚さない", async () => {
    const { els } = await listHost([{ id: 1, name: "a", n: 1 }]);
    await write(els[0], (s) => { s.items = JSON.parse(`[{"id":1,"name":"a","n":1,"__proto__.polluted":"yes"}]`); });
    const polluted = ({} as any).polluted;
    delete (Object.prototype as any).polluted;
    expect(polluted).toBeUndefined();
    let kept: any;
    els[0].createState("readonly", (s: any) => { kept = s.items[0]; });
    expect(kept["__proto__.polluted"]).toBe("yes");
  });

  it("JSON の自前の __proto__ キーは、残した行のプロトタイプを差し替えない", async () => {
    const { els } = await listHost([{ id: 1, name: "a", n: 1 }]);
    await write(els[0], (s) => { s.items = JSON.parse(`[{"id":1,"name":"a","n":1,"__proto__":{"isAdmin":true}}]`); });
    let row: any;
    els[0].createState("readonly", (s: any) => { row = s.items[0]; });
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(row.isAdmin).toBeUndefined();
  });

  it("1 段のパスにならない名前（@odata.etag・2fa）と行の getter と同じ名前は、行にそのまま入り、行が描き直される", async () => {
    const first = { id: 1, name: "a", n: 1, "@odata.etag": "W/1", "2fa": false };
    const { root, els } = await listHost([first]);
    await write(els[0], (s) => { s.items = [{ id: 1, name: "A", n: 2, "@odata.etag": "W/2", "2fa": true, double: 99 }]; });
    let row: any;
    els[0].createState("readonly", (s: any) => { row = s.items[0]; });
    expect(row).toBe(first);
    expect([row["@odata.etag"], row["2fa"], row.double]).toEqual(["W/2", true, 99]);
    // the getter still answers the binding
    expect(root.querySelector("li")!.textContent).toBe("A/4");
  });
});

describe("$watch と getter（C7・C8・C9）", () => {
  it("getter の下のパスへの watch が、getter が変わると発火する（C7）", async () => {
    const calls: unknown[] = [];
    const { els } = await host(`<wcs-state></wcs-state>`, [{
      items: [{ name: "a" }, { name: "b" }],
      sel: 0,
      get current() { return (this as any).items[(this as any).sel]; },
      $watch: { "current.name"(cur: unknown, prev: unknown) { calls.push([cur, prev]); } },
    }]);
    els[0].createState("writable", (s: any) => { s.sel = 1; });
    await flush();
    expect(calls).toEqual([["b", "a"]]);
  });

  it("行の getter の下のパスへの watch も、その行の葉の変更で発火する（C7）", async () => {
    const calls: unknown[] = [];
    const { els } = await host(`<wcs-state></wcs-state>`, [{
      items: [{ name: "a" }, { name: "b" }],
      get "items.*.info"() { return { label: String((this as any)["items.*.name"]).toUpperCase() }; },
      $watch: { "items.*.info.label"(cur: unknown, prev: unknown, i: number) { calls.push([cur, prev, i]); } },
    }]);
    els[0].createState("writable", (s: any) => { s["items.1.name"] = "z"; });
    await flush();
    expect(calls).toEqual([["Z", "B", 1]]);
  });

  it("行の getter への watch が、行のオブジェクトの差し替えと $postUpdate でも発火する（C8）", async () => {
    const calls: unknown[] = [];
    const { els } = await host(`<wcs-state></wcs-state>`, [{
      items: [{ v: 1 }, { v: 2 }],
      get "items.*.double"() { return (this as any)["items.*.v"] * 2; },
      $watch: { "items.*.double"(cur: unknown, prev: unknown, i: number) { calls.push([cur, prev, i]); } },
    }]);
    const write = async (fn: (s: any) => void) => { els[0].createState("writable", fn); await flush(); };
    await write((s) => { s["items.0.v"] = 3; });
    await write((s) => { s["items.1"] = { v: 5 }; });
    await write((s) => { s.items[0].v = 7; s.$postUpdate("items.0"); });
    expect(calls).toEqual([[6, 2, 0], [10, 4, 1], [14, 6, 0]]);
  });

  it("行の getter への watch は、取り除いた行を強く持たない（C9）", async () => {
    let rt: any = null;
    const orig = WatchRuntime.prototype.drained;
    WatchRuntime.prototype.drained = function (this: any) { rt = this; return orig.call(this); };
    try {
      const calls: unknown[] = [];
      const { els } = await host(`<wcs-state></wcs-state>`, [{
        items: [{ v: 1 }],
        get "items.*.double"() { return (this as any)["items.*.v"] * 2; },
        $watch: { "items.*.double"(cur: unknown) { calls.push(cur); } },
      }]);
      for (let i = 0; i < 3; i++) {
        els[0].createState("writable", (s: any) => { s.items = [{ v: i }, { v: i + 1 }]; });
        await flush();
      }
      expect(rt.watches[0].last).toBeInstanceOf(WeakMap);
      expect(calls).toEqual([0, 2, 2, 4, 4, 6]);
    } finally {
      WatchRuntime.prototype.drained = orig;
    }
  });
});

describe("lint への誘導を付けないメッセージ（#203・#204）", () => {
  it("#204 と #203 には lint への誘導を付けず、lint が見る template-syntax の誤りには付ける", async () => {
    const { explain, render } = await import("../src/diagnostics/explain");
    const { M } = await import("../src/messages");
    for (const [id, args] of [[M.TemplateHandedOver, ["for"]], [M.OuterInTemplate, ["outerHTML"]]] as const) {
      const message = render(id, args);
      expect(message).toContain("[wcs/template-syntax]");
      expect(explain(message)).not.toContain("npx @wcstack/lint");
    }
    expect(explain(render(M.ElseWithoutIf, ["else"]))).toContain("npx @wcstack/lint");
  });
});
