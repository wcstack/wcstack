/**
 * Regressions of the add-on review. Cycle 1 (B1–B9, BN1, S1, U1): volumes (row-level getters,
 * `$eqIndex`, a failed root, SSR), exported getters across a host re-set, the `$` declarations of a
 * mounted component, `$recursion` re-sets. Cycle 2 (D1, D2, C2, C7–C9): SSR adoption, `$listKeys`
 * field names, `$watch` under getters.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, diagnostics, getBindingsReady, installFeatures, listKeys, recursion, scopes, ssr, temporal } from "../src/index";
import { WatchRuntime } from "../src/temporal/watch";
import { Engine } from "../src/engine";
import { DirtyStrategy } from "../src/strategy/dirty";

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
    return `${rootFirst ? r + vol : vol + r}<p>{{ cart.n }}/{{ cart.double }}/{{ cart.where }}</p><button data-wcs="onclick: cart.add">+</button>`;
  };
  const volume = () => ({
    n: 1,
    where: "",
    get double() { return (this as any).n * 2; },
    add(this: any) { this.n++; },
    // the volume's own lifecycle runs on the client too, on the snapshot (3.x V7 / D14): a client write stays
    $connectedCallback(this: any) {
      if (document.documentElement.hasAttribute("data-wcs-server")) this.n = 10;
      else this.where = "client";
    },
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

  it.each([["根が先", true], ["volume が先", false]])("%s: クライアントの volume はサーバのデータを引き取り、メソッドと getter が動き、クライアントの $connectedCallback の書き込みが残る（G3）", async (_name, rootFirst) => {
    const server = await load(page(rootFirst), rootFirst, true);
    const html = server.root.innerHTML;
    server.h.remove();
    expect(html).toContain(`"cart":{"n":10,"where":""}`);
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      const { root } = await load(html, rootFirst, false);
      expect(text(root, "p")).toBe("10/20/client");
      (root.querySelector("button") as HTMLElement).click();
      await flush();
      expect(text(root, "p")).toBe("11/22/client");
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
  return { root, write, out };
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

// ---------------------------------------------------------------- cycle 3

describe("SSR: 値から描いた Light DOM の子（E2）", () => {
  beforeAll(() => {
    customElements.define("qa-text-srv", class extends HTMLElement {
      set body(v: string) { this.textContent = v; }
    });
    customElements.define("qa-html-srv", class extends HTMLElement {
      set markup(v: string) { this.innerHTML = v; }
    });
    customElements.define("qa-append-srv", class extends HTMLElement {
      set body(v: string) { this.append(Object.assign(document.createElement("span"), { textContent: v })); }
    });
    customElements.define("qa-y-srv", class extends HTMLElement {});
    customElements.define("qa-fill-srv", class extends HTMLElement {
      set body(v: string) { this.querySelector(".slot")!.innerHTML = v; }
    });
  });

  it("作者が書いた子（.slot）の中に値から描いたものも、サーバの出力に残らない（R3-5）", async () => {
    const calls: string[] = [];
    const { root, out } = await roundTrip(`<qa-fill-srv data-wcs="body: comment"><div class="slot"></div></qa-fill-srv><p>{{ count }}</p>`,
      () => ({ comment: `my token is {{ secret }} <button data-wcs="onclick: wipe">win</button><b data-wcs="nope nope">x</b>`, secret: "s3cr3t", count: 1, wipe() { calls.push("wiped"); } }));
    expect(out).toContain(`<qa-fill-srv data-wcs="body: comment"><div class="slot"></div></qa-fill-srv>`);
    root.querySelector("button")?.click();
    expect(calls).toEqual([]);
    expect(root.innerHTML).not.toContain("s3cr3t");
    expect(root.querySelector("p")!.textContent).toBe("1");
  });

  it("中身を束縛するカスタム要素（innerHTML:・textContent:）の値は、ネイティブの要素と同じくサーバの出力に残る（R3-6）", async () => {
    const { out } = await ssrRoundTrip(`<qa-x-srv data-wcs="innerHTML: html"></qa-x-srv><qa-y-srv data-wcs="textContent: text"></qa-y-srv>`,
      () => ({ html: "<b>bold</b>", text: "plain" }));
    expect(out).toContain(`<qa-x-srv data-wcs="innerHTML: html"><b>bold</b></qa-x-srv>`);
    expect(out).toContain(`<qa-y-srv data-wcs="textContent: text">plain</qa-y-srv>`);
  });
  /** The client: the elements' classes are not loaded yet (an autoloader page). */
  async function roundTrip(html: string, state: () => Record<string, any>) {
    let out = "";
    const { root, write } = await ssrRoundTrip(html, state, (r) => { out = r.innerHTML; r.innerHTML = out.replace(/-srv/g, "-cli"); });
    return { root, write, out };
  }

  it("利用者の文の {{ … }} はサーバの出力に残らず、クライアントで別のパスとして展開されない", async () => {
    const { root, out } = await roundTrip(`<qa-text-srv data-wcs="body: comment"></qa-text-srv>`, () => ({ comment: "my token is {{ secret }}", secret: "s3cr3t" }));
    // (the snapshot's JSON carries the value: it is data there, not markup)
    expect(out).toContain('<qa-text-srv data-wcs="body: comment"></qa-text-srv>');
    expect(root.innerHTML).not.toContain("s3cr3t");
  });

  it("サニタイズした HTML の data-wcs は、状態のメソッドに結ばれない", async () => {
    const calls: string[] = [];
    const { root, out } = await roundTrip(`<qa-html-srv data-wcs="markup: comment"></qa-html-srv>`,
      () => ({ comment: `<button data-wcs="onclick: deleteAccount">win</button>`, deleteAccount() { calls.push("deleted"); } }));
    expect(out).toContain('<qa-html-srv data-wcs="markup: comment"></qa-html-srv>');
    root.querySelector("button")?.click();
    expect(calls).toEqual([]);
  });

  it("要素が書いたマークアップ（{{ }}・for・if）は残り、引き取って動く。{{ を含まない値の文はサーバの出力に残る", async () => {
    const { root, write, out } = await roundTrip(
      `<qa-append-srv data-wcs="body: comment">Hi {{ name }}!<ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul><template data-wcs="if: show"><b>B</b></template></qa-append-srv>`
      + `<qa-text-srv data-wcs="body: note"></qa-text-srv>`,
      () => ({ comment: "{{ secret }}", secret: "s3cr3t", name: "Ann", items: ["x", "y"], show: true, note: "plain note" }),
    );
    expect(out).toContain("plain note");
    expect(root.innerHTML).not.toContain("s3cr3t");
    const host = root.querySelector("qa-append-cli")!;
    expect(host.textContent).toBe("Hi Ann!xyB");
    await write((s) => { s.name = "Bo"; s.items = ["z"]; s.show = false; });
    expect(host.textContent).toBe("Hi Bo!z");
  });
});

describe("SSR: 中身が文字の要素の {{ }}（E5）", () => {
  it("<textarea> の {{ }} はサーバでは値を出し、クライアントでは元のテンプレートから束ねる", async () => {
    let out = "";
    const { root, write } = await ssrRoundTrip(`<textarea>{{ comment }}</textarea>`,
      () => ({ comment: "hello {{ secret }}", secret: "s3cr3t" }), (r) => { out = r.innerHTML; });
    expect(out).toContain(`<textarea data-wcs-raw="{{ comment }}">hello {{ secret }}</textarea>`);
    const ta = root.querySelector("textarea")!;
    expect(ta.hasAttribute("data-wcs-raw")).toBe(false);
    expect(ta.textContent).toBe("hello {{ secret }}");
    await write((s) => { s.comment = "changed"; });
    expect(ta.textContent).toBe("changed");
  });

  it("文字と {{ }} の混ざった <title> も同じ。束ねる文字の無い中身が文字の要素（<style>）には印を付けない", async () => {
    let out = "";
    const { root, write } = await ssrRoundTrip(`<title>Shop - {{ page }}</title><style>p { color: red }</style>`,
      () => ({ page: "Top" }), (r) => { out = r.innerHTML; });
    expect(out).toContain(`<title data-wcs-raw="Shop - {{ page }}">Shop - Top</title><style>`);
    await write((s) => { s.page = "Cart"; });
    expect(root.querySelector("title")!.textContent).toBe("Shop - Cart");
  });
});

describe("SSR: 値の中の wcs- のコメント（E8）", () => {
  it.each([
    ["壊れたエスケープ", "<p>hi<!--wcs-t:%E0%A4%A--></p>"],
    ["引用符を含むテンプレートの印", "<p>hi<!--wcs-p:x\"]--></p>"],
    ["行の印の無い範囲", "<p><!--wcs-[--><b>x</b></p>"],
    ["不正な範囲の印", "<p><!--wcs-[x--><b>x</b><!--wcs-]--></p>"],
  ])("innerHTML: の値に%sがあっても、引き取りは止まらない", async (_n, html) => {
    const { root, write } = await ssrRoundTrip(`<div data-wcs="innerHTML: html"></div><p class="c">{{ count }}</p>`, () => ({ html, count: 1 }));
    await write((s) => { s.count = 2; });
    expect(root.querySelector("p.c")!.textContent).toBe("2");
  });
});

describe("SVG の中の構造テンプレートの SSR（F1・R3-7・R3-8）", () => {
  const SVG = "http://www.w3.org/2000/svg";
  /** `<svg>` with `<template data-wcs="for: groups"><g data-wcs="attr.data-k: .n"><template data-wcs="for: .pts"><circle data-wcs="attr.cx: .x"/>…` built with the DOM. */
  const build = (r: ShadowRoot) => {
    const el = (name: string, attrs: Record<string, string>, ...kids: Node[]) => {
      const e = document.createElementNS(SVG, name);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      e.append(...kids);
      return e;
    };
    r.append(el("svg", {}, el("template", { "data-wcs": "for: groups" },
      el("g", { "data-wcs": "attr.data-k: .n" }, el("template", { "data-wcs": "for: .pts" }, el("circle", { "data-wcs": "attr.cx: .x" }))))));
  };
  const shapes = (root: ShadowRoot) => Array.from(root.querySelectorAll("svg g, svg circle"), (e) =>
    `${e.localName}${e.getAttribute("data-k") ?? e.getAttribute("cx")}:${e.namespaceURI === SVG ? "svg" : "html"}`);

  it("入れ子の for を含む SVG のテンプレートも出力でき、client で SVG のまま戻って、innerHTML を使わずに引き取る", async () => {
    const html = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")!;
    let parsedByInnerHTML = 0;
    const { root, write, out } = await ssrRoundTrip(build, () => ({ groups: [{ n: "a", pts: [{ x: 1 }] }, { n: "b", pts: [{ x: 2 }, { x: 3 }] }] }), () => {
      // a Trusted Types sink: the client must not parse strings to restore the template
      Object.defineProperty(Element.prototype, "innerHTML", { ...html, set(v) { parsedByInnerHTML++; html.set!.call(this, v); } });
    });
    try {
      expect(out).toMatch(/<template id="wcs-s\d+" data-wcs="for: groups"><svg><g data-wcs="attr.data-k: .n"><template data-wcs="for: .pts"><circle/);
      expect(shapes(root)).toEqual(["ga:svg", "circle1:svg", "gb:svg", "circle2:svg", "circle3:svg"]);
      await write((s) => { s.groups = [...s.groups, { n: "c", pts: [{ x: 4 }] }]; });
      expect(shapes(root)).toEqual(["ga:svg", "circle1:svg", "gb:svg", "circle2:svg", "circle3:svg", "gc:svg", "circle4:svg"]);
      expect(parsedByInnerHTML).toBe(0);
    } finally {
      Object.defineProperty(Element.prototype, "innerHTML", html);
    }
  });
});

describe("根の失敗とマークアップで結線するコンポーネント（E7）", () => {
  it("ページの状態の初期化に失敗すると、結線を待つコンポーネントも報告して決着する", async () => {
    const tag = define(`<b>{{ name }}</b>`, () => ({ name: "" }));
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      const h = document.createElement(`quality-addon-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><${tag} data-wcs="state: user"></${tag}>`;
      const rootEl = root.querySelector("wcs-state") as any;
      rootEl.setInitialState({ user: { name: "a" }, $scan: {} });
      document.body.appendChild(h);
      await expect(rootEl.connectedCallbackPromise).rejects.toThrow();
      const inner = root.querySelector(tag)!.shadowRoot!.querySelector("wcs-state") as any;
      await inner.connectedCallbackPromise;
      await inner.initializePromise;
      expect(errors.some((e) => e.includes(`<${tag}>.state will not mount: the root state failed to initialize.`))).toBe(true);
      // one that starts waiting after the failure gives up at once
      const late = document.createElement(tag);
      late.setAttribute("data-wcs", "state: user");
      root.append(late);
      await (late.shadowRoot!.querySelector("wcs-state") as any).connectedCallbackPromise;
      expect(errors.filter((e) => e.includes("will not mount")).length).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("サイクル 3 の再検証（R3-9・R3-10・R3-11）", () => {
  it("onRootFailed の待ちは、戻り値で外せる（外した後の失敗では呼ばれない。R3-9）", async () => {
    const { onRootFailed, watchRoot } = await import("../src/scopes/volume");
    const root = document.createElement("div");
    const calls: string[] = [];
    const stop = onRootFailed(root, () => calls.push("a"));
    onRootFailed(root, () => calls.push("b"));
    expect(stop()).toBe(true);
    const failed = Promise.reject(new Error("x"));
    watchRoot({ connectedCallbackPromise: failed } as any, root);
    await failed.catch(() => {});
    await flush();
    expect(calls).toEqual(["b"]);
  });

  it("同じ root の 2 本目の <wcs-state>（#47）は、生きた根の root を失敗にしない。後から来た volume も接ぎ木する（R3-10）", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      const h = document.createElement(`quality-addon-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state json='{"a":1}'></wcs-state><p>{{ cart.n }}</p>`;
      document.body.appendChild(h);
      const first = root.querySelector("wcs-state") as any;
      await first.connectedCallbackPromise;
      const stray = document.createElement("wcs-state") as any;
      stray.setAttribute("json", '{"b":1}');
      root.append(stray);
      await expect(stray.connectedCallbackPromise).rejects.toThrow();
      await flush();
      const v = document.createElement("wcs-state") as any;
      v.setAttribute("mount", "cart");
      v.setInitialState({ n: 5 });
      root.append(v);
      await v.connectedCallbackPromise;
      await flush();
      expect(text(root, "p")).toBe("5");
      expect(errors.filter((e) => e.includes("will not graft"))).toEqual([]);
      // what waits on the root there (a component, for its wiring) is not told it failed
      const { onRootFailed } = await import("../src/scopes/volume");
      let failed = false;
      onRootFailed(root, () => { failed = true; })();
      expect(failed).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("$listKeys の取り直しで prototype というフィールドが変わっても、投げずに行へそのまま入る（R3-11）", async () => {
    const first = { id: 1, name: "a", prototype: "x" };
    const { root, els } = await host(`<wcs-state></wcs-state><ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>`, [{ items: [first], $listKeys: { items: "id" } }]);
    els[0].createState("writable", (s: any) => { s.items = [{ id: 1, name: "b", prototype: "y" }]; });
    await flush();
    let row: any;
    els[0].createState("readonly", (s: any) => { row = s.items[0]; });
    expect(row).toBe(first);
    expect(row.prototype).toBe("y");
    expect(text(root, "li")).toBe("b");
  });
});

describe("サイクル 3 の再検証 2（S3-1〜S3-5）", () => {
  beforeAll(() => {
    customElements.define("qa-self-srv", class extends HTMLElement {
      set body(v: string) { this.innerHTML = v; }
    });
    customElements.define("qa-wrap", class extends HTMLElement {});
    customElements.define("qa-kid", class extends HTMLElement { state = {}; });
  });

  it.each([
    ["<textarea>", `<textarea>my token is {{ secret }}</textarea>`],
    ["構造テンプレート", `<template data-wcs="if: secret"><button data-wcs="onclick: wipe">win</button></template>`],
    ["壊れた構造テンプレート", `<template data-wcs="else:"></template>`],
  ])("値の中の%sもサーバの出力に残らず、展開・メソッド・初期化の失敗が起きない（S3-1）", async (_n, comment) => {
    const calls: string[] = [];
    let out = "";
    const { root } = await ssrRoundTrip(`<qa-self-srv data-wcs="body: comment"></qa-self-srv><p>{{ count }}</p>`,
      () => ({ comment, secret: "s3cr3t", count: 1, wipe() { calls.push("wiped"); } }),
      (r) => { out = r.innerHTML; r.innerHTML = out.replace(/qa-self-srv/g, "qa-self-cli"); });
    expect(out).toContain(`<qa-self-srv data-wcs="body: comment"></qa-self-srv>`);
    root.querySelector("button")?.click();
    expect(calls).toEqual([]);
    expect(root.innerHTML).not.toContain("s3cr3t");
    expect(root.querySelector("p")!.textContent).toBe("1");
  });

  it("束縛したカスタム要素の中の Light DOM コンポーネントも、SSR で印を失わず引き取って動く（S3-2）", async () => {
    const { root, write } = await ssrRoundTrip(
      `<qa-wrap data-wcs="attr.title: t"><qa-kid data-wcs="state.x: v; state.items: items"><wcs-state bind-component="state"></wcs-state><b>{{ x }}</b><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul></qa-kid></qa-wrap>`,
      () => ({ t: "T", v: "one", items: ["a", "b"] }),
    );
    await flush();
    const kid = root.querySelector("qa-kid")!;
    expect(kid.querySelector("b")!.textContent + Array.from(kid.querySelectorAll("li"), (li) => li.textContent).join("")).toBe("oneab");
    await write((s) => { s.v = "two"; s.items = ["a", "b", "c"]; });
    await flush();
    expect(kid.querySelector("b")!.textContent + Array.from(kid.querySelectorAll("li"), (li) => li.textContent).join("")).toBe("twoabc");
  });

  it("<foreignObject> の中のテンプレートは HTML のまま戻り、行も HTML の要素になる（S3-3）", async () => {
    const { root, write, out } = await ssrRoundTrip(`<svg><foreignObject><template data-wcs="for: items"><div>{{ . }}</div></template></foreignObject></svg>`,
      () => ({ items: ["a", "b"] }));
    expect(out).toMatch(/<template id="wcs-t\d+" data-wcs="for: items"><div>/);
    await write((s) => { s.items = ["a", "b", "c"]; });
    const divs = Array.from(root.querySelectorAll("foreignObject div"));
    expect(divs.map((d) => `${d.textContent}:${d.namespaceURI === "http://www.w3.org/1999/xhtml" ? "html" : "svg"}`)).toEqual(["a:html", "b:html", "c:html"]);
  });

  it("<svg> の中の <foreignObject> の中の入れ子のテンプレートは、空にならずに出力される（S3-3）", async () => {
    const { out } = await ssrRoundTrip(`<svg><template data-wcs="for: pts"><g><foreignObject><template data-wcs="if: .on"><div>{{ .n }}</div></template></foreignObject></g></template></svg>`,
      () => ({ pts: [{ on: true, n: "x" }] }));
    expect(out).toMatch(/<template id="wcs-s\d+" data-wcs="for: pts"><svg><g><foreignObject><template data-wcs="if: .on"><div>/);
  });

  it("mustache を切った状態では、束縛したカスタム要素の中の作者の {{ を含む文字が SSR で消えない（S3-4）", async () => {
    let out = "";
    await ssrRoundTrip(`<qa-wrap data-wcs="attr.title: t"><code>Write {{ name }} here</code> and {{ x }}</qa-wrap>`,
      () => ({ t: "T", $behavior: { enableMustache: false } }), (r) => { out = r.innerHTML; });
    expect(out).toContain(`<code>Write {{ name }} here</code> and {{ x }}`);
  });

  it("中身を束縛するカスタム要素（html:・innerText:）の値も、サーバの出力に残る（S3-5・H5: dom/plan の setsContent）", async () => {
    const { out } = await ssrRoundTrip(`<qa-x-srv data-wcs="html: html"></qa-x-srv><qa-y-srv data-wcs="innerText: text"></qa-y-srv>`,
      () => ({ html: "<b>bold</b>", text: "plain" }));
    expect(out).toContain(`<qa-x-srv data-wcs="html: html"><b>bold</b></qa-x-srv>`);
    expect(out).toContain(`<qa-y-srv data-wcs="innerText: text">plain</qa-y-srv>`);
  });
});

describe("サイクル 3 の再検証 3: 作者が書いた子を値で書き換える（E2 の残り）", () => {
  beforeAll(() => {
    // the text node the author wrote, updated in place
    customElements.define("qa-label-srv", class extends HTMLElement {
      set body(v: string) { (this.firstChild as Text).data = v; }
    });
    // the <textarea> the author wrote, filled (defaultValue and textContent replace its text)
    customElements.define("qa-editor-srv", class extends HTMLElement {
      set body(v: string) { this.querySelector("textarea")!.defaultValue = v; }
    });
    customElements.define("qa-editor2-srv", class extends HTMLElement {
      set body(v: string) { this.querySelector("textarea")!.textContent = v; }
    });
  });

  it.each([
    ["作者の文字をその場で書き換える", `<qa-label-srv data-wcs="body: comment">loading</qa-label-srv>`, `<qa-label-srv data-wcs="body: comment"></qa-label-srv>`],
    ["作者の <textarea> に defaultValue で書く", `<qa-editor-srv data-wcs="body: comment"><textarea></textarea></qa-editor-srv>`, `<qa-editor-srv data-wcs="body: comment"><textarea></textarea></qa-editor-srv>`],
    ["作者の <textarea> に textContent で書く", `<qa-editor2-srv data-wcs="body: comment"><textarea>draft</textarea></qa-editor2-srv>`, `<qa-editor2-srv data-wcs="body: comment"><textarea></textarea></qa-editor2-srv>`],
  ])("%s値の {{ … }} はサーバの出力に残らず、クライアントで展開されない", async (_n, markup, expected) => {
    let out = "";
    const { root } = await ssrRoundTrip(`${markup}<p>{{ count }}</p>`, () => ({ comment: "my token is {{ secret }}", secret: "s3cr3t", count: 1 }),
      (r) => { out = r.innerHTML; r.innerHTML = out.replace(/-srv/g, "-cli"); });
    expect(out).toContain(expected);
    expect(root.innerHTML).not.toContain("s3cr3t");
    expect(root.querySelector("p")!.textContent).toBe("1");
  });

  it("作者の文字を {{ を含まない値に書き換えたものは、サーバの出力に残る", async () => {
    let out = "";
    await ssrRoundTrip(`<qa-label-srv data-wcs="body: comment">loading</qa-label-srv>`, () => ({ comment: "plain" }),
      (r) => { out = r.innerHTML; r.innerHTML = out.replace(/-srv/g, "-cli"); });
    expect(out).toContain(`<qa-label-srv data-wcs="body: comment">plain</qa-label-srv>`);
  });

  it("束縛したカスタム要素の中の、{{ }} を持つ <textarea> はテンプレートを失わない（値が歩いた後に変わっても）", async () => {
    let out = "";
    const { root, write } = await ssrRoundTrip(`<qa-wrap data-wcs="attr.title: t"><textarea>Re: {{ c }}</textarea></qa-wrap>`,
      () => ({ t: "T", c: "first", secret: "s3cr3t", async $connectedCallback(this: any) { this.c = "later {{ secret }}"; } }),
      // (a browser parses the textarea's content as text)
      (r) => { out = r.innerHTML; const t = r.querySelector("textarea")!; t.textContent = `${t.textContent}`; });
    expect(out).toContain(`<textarea data-wcs-raw="Re: {{ c }}">Re: later {{ secret }}</textarea>`);
    const ta = root.querySelector("textarea")!;
    expect(ta.textContent).toBe("Re: later {{ secret }}");
    await write((s) => { s.c = "new"; });
    expect(ta.textContent).toBe("Re: new");
  });

  it("束縛したカスタム要素の中の {{ }} の値は、{{ を含んでも（歩いた後に変わっても）印の間に残り、クライアントで展開されない", async () => {
    let out = "";
    const { root, write } = await ssrRoundTrip(`<qa-wrap data-wcs="attr.title: t"><i>{{ comment }}</i></qa-wrap>`,
      () => ({ t: "T", comment: "first", secret: "s3cr3t", async $connectedCallback(this: any) { this.comment = "my token is {{ secret }}"; } }),
      (r) => { out = r.innerHTML; });
    expect(out).toContain(`<i><!--wcs-t:comment-->my token is {{ secret }}<!--wcs-/t--></i>`);
    const i = root.querySelector("i")!;
    expect(i.textContent).toBe("my token is {{ secret }}");
    await write((s) => { s.comment = "changed"; });
    expect(i.textContent).toBe("changed");
  });
});

describe("サイクル 3 の再検証 4: 印のコメントを捨てる要素と mustache の文字（R4-1）", () => {
  beforeAll(() => {
    // tidies its light DOM: drops the comments in it
    customElements.define("qa-strip-srv", class extends HTMLElement {
      set mode(_v: string) { for (const n of Array.from(this.childNodes)) if (n.nodeType === 8) n.remove(); }
    });
    // re-appends its children without the comments
    customElements.define("qa-tidy-srv", class extends HTMLElement {
      set mode(_v: string) { this.replaceChildren(...Array.from(this.childNodes).filter((n) => n.nodeType !== 8)); }
    });
    // puts a mark of its own (not the page's) before a text with {{
    customElements.define("qa-forge-srv", class extends HTMLElement {
      set mode(v: string) { this.prepend(document.createComment("wcs-t:x"), v); }
    });
  });

  /** The client: the elements' classes are not loaded yet (an autoloader page). */
  async function roundTrip(html: string, state: () => Record<string, any>) {
    let out = "";
    const r = await ssrRoundTrip(html, state, (root) => { out = root.innerHTML; root.innerHTML = out.replace(/-srv/g, "-cli"); });
    // (the element's part: the snapshot's JSON carries the value as data)
    return { ...r, out: /<qa-\w+-srv[\s\S]*<\/qa-\w+-srv>/.exec(out)![0] };
  }

  it.each([["qa-strip"], ["qa-tidy"]])("印を失った mustache の値（%s）はサーバの出力に残らず、クライアントで展開されない", async (tag) => {
    const { root, out } = await roundTrip(`<${tag}-srv data-wcs="mode: mode">Hi {{ comment }}!</${tag}-srv><p>{{ count }}</p>`,
      () => ({ mode: "m", comment: "my token is {{ secret }}", secret: "s3cr3t", count: 1 }));
    expect(out).not.toContain("{{ secret }}");
    expect(root.querySelector(`${tag}-cli`)!.textContent).toBe("Hi !");
    expect(root.innerHTML).not.toContain("s3cr3t");
    expect(root.querySelector("p")!.textContent).toBe("1");
  });

  it("印を失った値の、走査で失敗する式（{{ a.* }}）で、クライアントの初期化が失敗しない", async () => {
    const { root, out } = await roundTrip(`<qa-tidy-srv data-wcs="mode: mode">Hi {{ comment }}!</qa-tidy-srv><p>{{ count }}</p>`,
      () => ({ mode: "m", comment: "{{ a.* }}", a: [], count: 1 }));
    expect(out).not.toContain("{{ a.* }}");
    // (a failed initialization would reject the round trip's connectedCallbackPromise)
    expect(root.querySelector("p")!.textContent).toBe("1");
  });

  it("要素が自分で置いた wcs-t: のコメントの後ろの {{ を含む文字も、サーバの出力に残らない", async () => {
    const { root, out } = await roundTrip(`<qa-forge-srv data-wcs="mode: mode"><b>x</b></qa-forge-srv><p>{{ count }}</p>`,
      () => ({ mode: "my token is {{ secret }}", secret: "s3cr3t", count: 1 }));
    expect(out).toContain(`<qa-forge-srv data-wcs="mode: mode"><b>x</b></qa-forge-srv>`);
    expect(root.innerHTML).not.toContain("s3cr3t");
  });
});

describe("サイクル 3 の再検証 5: 中身が文字の要素の外へ移された mustache の文字（R5-1）", () => {
  beforeAll(() => {
    // turns the <textarea> it was given into its own content (its text nodes moved into it)
    customElements.define("qa-rte-srv", class extends HTMLElement {
      set mode(_v: string) { const ta = this.querySelector("textarea")!; this.append(...Array.from(ta.childNodes)); ta.remove(); }
    });
  });

  it("<textarea> の {{ }} の値が要素の外へ移されると、サーバの出力に残らず、クライアントで展開されない", async () => {
    let out = "";
    const { root } = await ssrRoundTrip(`<qa-rte-srv data-wcs="mode: mode"><textarea>{{ comment }}</textarea></qa-rte-srv><p>{{ count }}</p>`,
      () => ({ mode: "m", comment: "my token is {{ secret }}", secret: "s3cr3t", count: 1 }),
      (r) => { out = r.innerHTML; r.innerHTML = out.replace(/-srv/g, "-cli"); });
    expect(out).toContain(`<qa-rte-srv data-wcs="mode: mode"></qa-rte-srv>`);
    expect(root.innerHTML).not.toContain("s3cr3t");
    expect(root.querySelector("p")!.textContent).toBe("1");
  });
});

// ---------------------------------------------------------------- cycle 4

describe("scopes が拒んだ再セット（G1(a)）", () => {
  it("接ぎ木した volume のある根の再セットを拒んでも、古い状態の $watch と $listKeys は動き続ける", async () => {
    const calls: unknown[] = [];
    const first = { id: 1, v: "a" };
    const { root, els } = await host(
      `<wcs-state></wcs-state><wcs-state mount="cart"></wcs-state><p>{{ count }}</p><ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`,
      [{ count: 0, items: [first], $listKeys: { items: "id" }, $watch: { count(cur: unknown) { calls.push(cur); } } }, { n: 1 }],
    );
    expect(() => els[0].setInitialState({ count: 100, items: [], $watch: { count() { calls.push("new"); } } })).toThrow(/grafted volumes/);
    els[0].createState("writable", (s: any) => { s.count = 2; });
    await flush();
    expect(text(root, "p")).toBe("2");
    expect(calls).toEqual([2]);
    els[0].createState("writable", (s: any) => { s.items = [{ id: 1, v: "b" }]; });
    await flush();
    let row: any;
    els[0].createState("readonly", (s: any) => { row = s.items[0]; });
    expect(row).toBe(first);
  });

  it("マウントした部品のある根の再セットを拒んでも、古い状態の $watch は動き続ける", async () => {
    const tag = define(`<b>{{ name }}</b>`, () => ({}));
    const calls: unknown[] = [];
    const { root, els } = await host(`<wcs-state></wcs-state><${tag} data-wcs="state.name: who"></${tag}><p>{{ who }}</p>`,
      [{ who: "a", $watch: { who(cur: unknown) { calls.push(cur); } } }]);
    await settle();
    expect(() => els[0].setInitialState({ who: "x" })).toThrow(/mounted components/);
    els[0].createState("writable", (s: any) => { s.who = "b"; });
    await settle();
    expect([text(root, "p"), calls]).toEqual(["b", ["b"]]);
  });
});

describe("活性化の後に getter になったパスの $watch（G2）", () => {
  it.each([["先に定義した", false], ["後から定義した", true]])("%s部品のエクスポートした getter を見る $watch が、変わると発火する", async (_n, late) => {
    const tag = `qa-g2-${seq++}`;
    const make = () => customElements.define(tag, class extends HTMLElement {
      state = { get display() { return `<${(this as any).name}>`; } };
      constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><i>{{ display }}</i>`; }
    });
    if (!late) make();
    const seen: unknown[] = [];
    const { root, els } = await host(`<wcs-state></wcs-state><${tag} data-wcs="state: user"></${tag}><p>{{ user.display }}</p>`,
      [{ user: { name: "a" }, $watch: { "user.display"(cur: unknown) { seen.push(cur); } } }]);
    if (late) { await settle(); make(); }
    await settle();
    els[0].createState("writable", (s: any) => { s["user.name"] = "b"; });
    await settle();
    expect([text(root, "p"), seen]).toEqual(["<b>", ["<a>", "<b>"]]);
  });

  it("根の接続の後に接ぎ木した volume の getter を見る $watch が、変わると発火する", async () => {
    const h = document.createElement(`quality-addon-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><wcs-state mount="cart"></wcs-state><p>{{ cart.total }}</p>`;
    const [el, vol] = Array.from(root.querySelectorAll("wcs-state")) as any[];
    const seen: unknown[] = [];
    el.setInitialState({ $watch: { "cart.total"(cur: unknown) { seen.push(cur); } } });
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await flush();
    vol.setInitialState({ qty: 1, price: 10, get total() { return (this as any).qty * (this as any).price; } });
    await vol.connectedCallbackPromise;
    await flush();
    seen.length = 0;
    el.createState("writable", (s: any) => { s["cart.qty"] = 3; });
    await flush();
    expect([text(root, "p"), seen]).toEqual(["30", [30]]);
  });
});

describe("結線した部品の shadow root の中の volume（G4: 拒む）", () => {
  const WIRED = "will not graft: its component is wired to its host.";

  it.each([["部品より先に状態が届く", false], ["部品の後に状態が届く", true]])("%s volume は明示のエラーで決着し、接ぎ木しない。ホストの状態は変わらない", async (_n, late) => {
    const tag = `qa-g4-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><wcs-state mount="i18n"${late ? "" : ` json='{"hello":"Hi"}'`}></wcs-state><b>{{ i18n.hello }}|{{ name }}</b>`;
      }
    });
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      const { root, els } = await host(`<wcs-state></wcs-state><${tag} data-wcs="state: user"></${tag}>`, [{ user: { name: "ann" } }]);
      await settle();
      const c = root.querySelector(tag)!;
      const vol = c.shadowRoot!.querySelectorAll("wcs-state")[1] as any;
      if (late) vol.setInitialState({ hello: "Hi" });
      await vol.connectedCallbackPromise;
      await settle();
      expect(errors.some((e) => e.includes(`<wcs-state mount="i18n"> ${WIRED}`))).toBe(true);
      expect(c.shadowRoot!.querySelector("b")!.textContent).toBe("|ann");
      let user = "";
      els[0].createState("readonly", (s: any) => { user = JSON.stringify(s.user); });
      expect(user).toBe(JSON.stringify({ name: "ann" }));
    } finally {
      spy.mockRestore();
    }
  });

  it("結線していない部品の中の volume は、従来どおり部品の木に接ぎ木する", async () => {
    const tag = define(`<wcs-state mount="i18n" json='{"hello":"Hi"}'></wcs-state><b>{{ i18n.hello }} {{ name }}</b>`, () => ({ name: "own" }));
    const { root } = await host(`<wcs-state></wcs-state><${tag}></${tag}>`, [{}]);
    await settle();
    const c = root.querySelector(tag)!;
    await (c.shadowRoot!.querySelectorAll("wcs-state")[1] as any).connectedCallbackPromise;
    await settle();
    expect(c.shadowRoot!.querySelector("b")!.textContent).toBe("Hi own");
  });
});

describe("束ねた後に $connectedCallback が失敗した根（H2: watchRoot）", () => {
  it("後から定義した Light DOM の部品は、根の失敗として拒まれずにマウントする", async () => {
    const tag = `qa-h2-${seq++}`;
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      const h = document.createElement(`quality-addon-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><${tag} data-wcs="state: user"><wcs-state bind-component="state"></wcs-state><b>{{ name }}</b></${tag}><p>{{ user.name }}</p>`;
      const el = root.querySelector("wcs-state") as any;
      el.setInitialState({ user: { name: "a" }, async $connectedCallback() { await 0; throw new Error("initial fetch failed"); } });
      document.body.appendChild(h);
      await el.connectedCallbackPromise.catch(() => {});
      await flush();
      expect(text(root, "p")).toBe("a");
      customElements.define(tag, class extends HTMLElement { state = {}; });
      await (root.querySelector(`${tag} > wcs-state`) as any).connectedCallbackPromise;
      await settle();
      expect(errors.filter((e) => e.includes("will not mount") || e.includes("will not graft"))).toEqual([]);
      expect(text(root, "b")).toBe("a");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("サイクル 4 の再検証（R4C-3・R4C-4）", () => {
  it.each([["ページの根の初期化が失敗する", false], ["部品の状態がオブジェクトでない", true]])("結線した部品がマウントされない（%s）とき、その shadow root の中の volume は報告して決着する", async (_n, bad) => {
    const tag = `qa-r4c3-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state: any = bad ? null : {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><wcs-state mount="i18n" json='{"hello":"Hi"}'></wcs-state>`;
      }
    });
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      const h = document.createElement(`quality-addon-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><${tag} data-wcs="state: user"></${tag}>`;
      const el = root.querySelector("wcs-state") as any;
      // ($scan: removed in 4.0, the root fails)
      el.setInitialState(bad ? { user: { name: "a" } } : { user: { name: "a" }, $scan: {} });
      document.body.appendChild(h);
      await el.connectedCallbackPromise.catch(() => {});
      const [inner, vol] = Array.from(root.querySelector(tag)!.shadowRoot!.querySelectorAll("wcs-state")) as any[];
      await inner.connectedCallbackPromise;
      const settled = await Promise.race([vol.connectedCallbackPromise.then(() => "settled"), new Promise((r) => setTimeout(() => r("pending"), 200))]);
      expect(settled).toBe("settled");
      expect(errors).toContain(`[@wcstack/state] <wcs-state mount="i18n"> will not graft: the root state failed to initialize.`);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([["$listKeys", { $listKeys: "nope" }], ["$recursion", { $recursion: "nope" }]])("再セットした状態の %s の誤りで投げた後も、古い状態の $listKeys は効き、切断・再接続で拒まれた状態の $watch は動かない", async (_n, bad) => {
    const log: string[] = [];
    const first = { id: 1, v: "a" };
    const { h, els } = await host(`<wcs-state></wcs-state><p>{{ count }}</p><ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`,
      [{ count: 0, items: [first], $listKeys: { items: "id" }, $watch: { count(c: unknown) { log.push(`kept:${c}`); } } }]);
    expect(() => els[0].setInitialState({ count: 100, items: [], $watch: { count(c: unknown) { log.push(`refused:${c}`); } }, ...bad })).toThrow();
    h.remove();
    document.body.appendChild(h);
    await flush();
    els[0].createState("writable", (s: any) => { s.count = 5; s.items = [{ id: 1, v: "b" }]; });
    await flush();
    let row: any;
    els[0].createState("readonly", (s: any) => { row = s.items[0]; });
    expect(log.filter((l) => l.startsWith("refused"))).toEqual([]);
    expect(row).toBe(first);
  });
});

describe("拒まれた再セットの後の $stream（R4D-2）", () => {
  const stream = (tag: string) => ({ feed: { initial: "-", args: (s: any) => s.q, async *source(q: unknown) { yield `${tag}:${q}`; } } });
  const wait = () => new Promise((r) => setTimeout(r, 10));

  it("残った状態の args の入力が変わっても、拒まれた状態の stream は動かない", async () => {
    const { root, els } = await host(`<wcs-state></wcs-state><p>{{ feed }}</p>`, [{ q: "a", $stream: stream("kept") }]);
    await wait();
    expect(text(root, "p")).toBe("kept:a");
    expect(() => els[0].setInitialState({ q: "x", $listKeys: "bad", $stream: stream("refused") })).toThrow();
    els[0].createState("writable", (s: any) => { s.q = "b"; });
    await wait();
    expect(text(root, "p")).not.toBe("refused:b");
  });

  it("その後に要素を外しても、拒まれた状態の stream は残った状態に書かない（例外にならない）", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a); });
    try {
      const { h, els } = await host(`<wcs-state></wcs-state><p>{{ q }}</p>`, [{ q: "a" }]);
      expect(() => els[0].setInitialState({ q: "x", $listKeys: "bad", $stream: stream("refused") })).toThrow();
      expect(() => h.remove()).not.toThrow();
      await flush();
      expect(errors).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("拒まれた再セットの後、外した間に直した再セットをしても、stream は戻すまで動かず、戻すと動く", async () => {
    const { h, root, els } = await host(`<wcs-state></wcs-state><p>{{ feed }}</p>`, [{ q: "a", $stream: stream("one") }]);
    await wait();
    expect(() => els[0].setInitialState({ q: "x", $listKeys: "bad", $stream: stream("refused") })).toThrow();
    h.remove();
    els[0].setInitialState({ q: "c", $stream: stream("fixed") });
    await wait();
    expect(text(root, "p")).toBe("-");
    document.body.appendChild(h);
    await wait();
    expect(text(root, "p")).toBe("fixed:c");
  });
});

// (last: the diagnostics add-on, installed here, stays installed for what follows in this file)
describe("後から状態が届く volume のパスの診断（G6）", () => {
  beforeAll(() => installFeatures([diagnostics]));

  it("マウントパスの配下は binding-path-missing を出さず、それ以外の宣言の無いパスは従来どおり警告する", async () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a) => { warns.push(a.map(String).join(" ")); });
    try {
      const h = document.createElement(`quality-addon-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><wcs-state mount="shop.cart"></wcs-state><p>{{ shop.cart.count }}</p><i>{{ user.nmae }}</i>`;
      const [el, vol] = Array.from(root.querySelectorAll("wcs-state")) as any[];
      el.setInitialState({ user: { name: "a" } });
      document.body.appendChild(h);
      await el.connectedCallbackPromise;
      // the volume's module is still loading when the paths are checked
      await new Promise((r) => setTimeout(r, 20));
      vol.setInitialState({ count: 3 });
      await vol.connectedCallbackPromise;
      await flush();
      expect(text(root, "p")).toBe("3");
      const missing = warns.filter((w) => w.includes("binding-path-missing"));
      expect(missing.length).toBe(1);
      expect(missing[0]).toContain(`"user.nmae"`);
    } finally {
      spy.mockRestore();
    }
  });

  it("volume のマウントパスの配下の宣言の無いパスは、読み込みが終わるまでは警告せず、終わった後に警告する（R4D-1）", async () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a) => { warns.push(a.map(String).join(" ")); });
    const missing = () => warns.filter((w) => w.includes("binding-path-missing")).map((w) => /"([^"]+)" does not/.exec(w)![1]);
    try {
      const h = document.createElement(`quality-addon-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><wcs-state mount="user" json='{"name":"a"}'></wcs-state><wcs-state mount="cart"></wcs-state><p>{{ user.nmae }}</p><b>{{ cart.count }}</b><i>{{ cart.cuont }}</i>`;
      const [el, , cart] = Array.from(root.querySelectorAll("wcs-state")) as any[];
      el.setInitialState({});
      document.body.appendChild(h);
      await el.connectedCallbackPromise;
      await new Promise((r) => setTimeout(r, 20));
      // a volume that grafted: its typo is warned; one still loading: nothing yet
      expect(missing()).toEqual(["user.nmae"]);
      cart.setInitialState({ count: 3 });
      await cart.connectedCallbackPromise;
      await flush();
      await flush();
      expect(text(root, "b")).toBe("3");
      expect(missing()).toEqual(["user.nmae", "cart.cuont"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("mount 属性を持つ volume 以外の要素は、その配下の警告を黙らせない（R4C-1）", async () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a) => { warns.push(a.map(String).join(" ")); });
    try {
      await host(`<wcs-state></wcs-state><x-portal mount="settings"></x-portal><p>{{ settings.titel }}</p>`, [{ settings: { title: "t" } }]);
      await flush();
      expect(warns.filter((w) => w.includes("binding-path-missing") && w.includes(`"settings.titel"`)).length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("3.x のコメント束縛（<!--@@: path-->・<!--@@wcs-text:path-->）を、全部入りでも 3.x と同じく束ねる（R7 の決定: 支える）", async () => {
    const { root } = await host(`<wcs-state></wcs-state><p>Hello <!--@@: user.name-->!</p><i><!--@@wcs-text:user.name--></i>`, [{ user: { name: "a" } }]);
    expect(text(root, "p")).toBe("Hello a!");
    expect(text(root, "i")).toBe("a");
    expect(root.querySelector("p")!.innerHTML).toBe("Hello a!");
  });

  it("書式フィルタの壁（formats を入れていない）には lint への誘導を付けず、打ち間違いには新しい入れ方を案内する（I4）", async () => {
    const { explain } = await import("../src/diagnostics/explain");
    const { LINT_HINT } = await import("../src/diagnostics/guidance");
    const wall = explain(`[wcs/filter-unknown] filter not found: upper. "upper" is in the formats add-on — install it with installFeatures([formats]) from "@wcstack/state/features/formats".`, "upper", []);
    expect(wall.endsWith(LINT_HINT)).toBe(false);
    expect(wall).toBe(` On a split auto page: features="formats" on the root, or "$features": ["formats"].`);
    const typo = explain("[wcs/filter-unknown] filter not found: eqq.", "eqq", ["eq"]);
    expect(typo).toContain(`add the formats add-on: installFeatures([formats]) from "@wcstack/state/features/formats" (a split auto page: features="formats", or "$features").`);
    expect(typo.endsWith(LINT_HINT)).toBe(true);
  });

  it("まだページを持たないエンジン（root が null）でも、宣言の無い $watch のパスは警告する", async () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a) => { warns.push(a.map(String).join(" ")); });
    try {
      new Engine({ $watch: { "a.b"() {} } }, new DirtyStrategy());
      await flush();
      expect(warns.filter((w) => w.includes("watch-path-missing") && w.includes(`"a.b"`)).length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
