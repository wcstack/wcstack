/**
 * Regressions of the add-on review (cycle 1, B1–B9): volumes (row-level getters, `$eqIndex`, a
 * failed root, SSR), exported getters across a host re-set, and the `$` declarations of a mounted
 * component.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, listKeys, recursion, scopes, ssr } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  // scopes before ssr, as the full build installs them
  installFeatures([listKeys, scopes, recursion, ssr]);
  bootstrapState();
});

/** A shadow root with `html`; states handed to its <wcs-state> elements in document order. */
async function host(html: string, states: Record<string, any>[]) {
  const h = document.createElement(`quality-addon-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
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
