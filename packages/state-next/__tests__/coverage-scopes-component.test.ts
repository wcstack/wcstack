/**
 * Component mounts (`<wcs-state bind-component>`, src/scopes/component.ts): the entry shapes,
 * crossings, lifecycle and failures component.test.ts leaves out.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 3) => { for (let i = 0; i < n; i++) await flush(); };
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes]);
  bootstrapState();
});

/**
 * A component whose `<wcs-state bind-component="state">` sits in its shadow root; `methods` go on
 * the element's prototype (e.g. `$stateReadyCallback`).
 */
function define(markup: string, state: () => any, methods: Record<string, any> = {}): string {
  const tag = `cov-cmp-${seq++}`;
  const content = `<wcs-state bind-component="state"></wcs-state>${markup}`;
  const cls = class extends HTMLElement {
    state = state();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = content;
    }
  };
  Object.assign(cls.prototype, methods);
  customElements.define(tag, cls);
  return tag;
}

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`cov-cmp-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await settle(2);
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await settle(2);
  };
  const read = (path: string) => {
    let v: unknown;
    el.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  return { h, root, el, write, read };
}

const text = (c: Element | ShadowRoot | null | undefined, sel: string) => c!.querySelector(sel)!.textContent;
const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);
const messages = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String((c[0] as Error)?.message ?? c[0]));

describe("マウントの対応の形", () => {
  it("丸ごとのマウントの隣の部分マウント: 1 段の対応はツリーの同名のキーに勝ち、ツリーのそのキーへの書き込みは届かない。深い対応はその先を読み、入れ子の私有データは自分のまま", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const tag = define(
        `<p class="name">{{ name }}</p><p class="theme">{{ theme.mode }}</p><p class="deep">{{ a.b }}</p><p class="form">{{ form.draft }}</p>`,
        () => ({ form: { draft: "private" } }),
      );
      const { root, write } = await page(`<${tag} data-wcs="state: user; state.theme: theme; state.a.b: outer.b"></${tag}>`, {
        user: { name: "Al", theme: { mode: "user-theme" } },
        theme: { mode: "dark" },
        outer: { b: "outer-b" },
      });
      const sr = root.querySelector(tag)!.shadowRoot;
      expect([text(sr, ".name"), text(sr, ".theme"), text(sr, ".deep"), text(sr, ".form")]).toEqual(["Al", "dark", "outer-b", "private"]);
      // under the whole mount, "theme" is mapped elsewhere: the tree's user.theme does not reach it
      await write((s) => { s["user.theme.mode"] = "user-theme-2"; });
      expect(text(sr, ".theme")).toBe("dark");
      await write((s) => { s["theme.mode"] = "light"; s["outer.b"] = "outer-b-2"; s["user.name"] = "Bo"; });
      expect([text(sr, ".name"), text(sr, ".theme"), text(sr, ".deep"), text(sr, ".form")]).toEqual(["Bo", "light", "outer-b-2", "private"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("深い対応の頭をコンポーネントが自分で持つと、自分の側が勝って警告する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const tag = define(`<p>{{ a.b }}</p>`, () => ({ a: { b: "own" } }));
      const { root } = await page(`<${tag} data-wcs="state.a.b: outer.b"></${tag}>`, { outer: { b: "tree" } });
      expect(text(root.querySelector(tag)!.shadowRoot, "p")).toBe("own");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`"state.a.b" is hidden by the component's own "a"`));
    } finally {
      warn.mockRestore();
    }
  });

  it("コンポーネント側のパスにワイルドカードを含む対応はマウントしない（コンポーネントは自分のデータを読む）", async () => {
    const tag = define(`<ul><template data-wcs="for: list"><li>{{ . }}</li></template></ul>`, () => ({ list: ["own"] }));
    const { root } = await page(`<${tag} data-wcs="state.list.*: items"></${tag}>`, { items: ["a", "b"] });
    expect(texts(root.querySelector(tag)!.shadowRoot!, "li")).toEqual(["own"]);
  });

  it("丸ごとのマウントの値が最初は null でも、ホストがオブジェクトを書けば読む", async () => {
    const tag = define(`<p>{{ name }}</p>`, () => ({}));
    const { root, write } = await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: null });
    const sr = root.querySelector(tag)!.shadowRoot;
    expect(text(sr, "p")).toBe("");
    await write((s) => { s.user = { name: "late" }; });
    expect(text(sr, "p")).toBe("late");
  });
});

describe("マウントしたキーの下のホストの accessor", () => {
  it("ホストの getter / setter をコンポーネントのパスで読み書きし、範囲外の行は undefined を読む", async () => {
    const tag = define(
      `<p class="total">{{ cart.total }}</p><p class="qty">{{ cart.qty }}</p><ul><template data-wcs="for: list"><li>{{ .label }}</li></template></ul>`,
      () => ({
        setQty(this: any, n: number) { this["cart.qty"] = n; },
        peek(this: any) { return this["list.5.label"]; },
      }),
    );
    const { root, read } = await page(`<p class="host">{{ cart.total }}</p><${tag} data-wcs="state.cart: cart; state.list: items"></${tag}>`, {
      cart: { items: [1, 2] },
      items: [{ v: 1 }, { v: 2 }],
      get "items.*.label"() { return `L${(this as any)["items.*.v"]}`; },
      get "cart.total"() { return (this as any)["cart.items"].reduce((a: number, b: number) => a + b, 0); },
      get "cart.qty"() { return (this as any)["cart.items"].length; },
      set "cart.qty"(n: number) { (this as any)["cart.items"] = Array.from({ length: n }, (_, i) => i + 1); },
    });
    const c = root.querySelector(tag) as any;
    const sr = c.shadowRoot as ShadowRoot;
    expect([text(sr, ".total"), text(sr, ".qty"), ...texts(sr, "li")]).toEqual(["3", "2", "L1", "L2"]);
    c.state.setQty(3);
    await settle();
    // the host's setter ran: its data, its own view and the component's views follow
    expect(read("cart.items")).toEqual([1, 2, 3]);
    expect(text(root, ".host")).toBe("6");
    expect([text(sr, ".total"), text(sr, ".qty")]).toEqual(["6", "3"]);
    expect(c.state.peek()).toBeUndefined();
  });

  it("2 つの対応のうち 1 つの置き換えは、その対応から読むもの（行の getter も）だけを読み直す", async () => {
    let titleReads = 0;
    const tag = define(`<p class="title">{{ title }}</p><ul><template data-wcs="for: list"><li>{{ .label }}</li></template></ul>`, () => ({}));
    const { root, write } = await page(`<${tag} data-wcs="state.list: items; state.title: heading"></${tag}>`, {
      items: [{ v: 1 }, { v: 2 }],
      get heading() { titleReads++; return "T"; },
      get "items.*.label"() { return `L${(this as any)["items.*.v"]}`; },
    });
    const sr = root.querySelector(tag)!.shadowRoot!;
    expect([text(sr, ".title"), ...texts(sr, "li")]).toEqual(["T", "L1", "L2"]);
    const before = titleReads;
    await write((s) => { s.items = [{ v: 10 }, { v: 20 }, { v: 30 }]; });
    expect([text(sr, ".title"), ...texts(sr, "li")]).toEqual(["T", "L10", "L20", "L30"]);
    expect(titleReads).toBe(before);
  });
});

describe("ホストとコンポーネントの間の行", () => {
  it("ホストが一覧の要素を置き換えると、コンポーネントの行が新しい要素を読む（行の中の入れ子の一覧も同期する）", async () => {
    const nested = define(`<ul><template data-wcs="for: list"><li><b>{{ .name }}</b><template data-wcs="for: .tags"><i>{{ . }}</i></template></li></template></ul>`, () => ({}));
    const flat = define(`<ul><template data-wcs="for: list"><li>{{ .name }}</li></template></ul>`, () => ({}));
    const { root, write } = await page(`<${nested} data-wcs="state.list: items"></${nested}><${flat} data-wcs="state.list: items"></${flat}>`,
      { items: [{ name: "a", tags: ["x"] }, { name: "b", tags: ["y"] }] });
    await write((s) => { s["items.1"] = { name: "B", tags: ["y1", "y2"] }; });
    expect(texts(root.querySelector(nested)!.shadowRoot!, "li")).toEqual(["ax", "By1y2"]);
    expect(texts(root.querySelector(flat)!.shadowRoot!, "li")).toEqual(["a", "B"]);
  });

  it("行の中のコンポーネントは、ホストが置き換えた行のものだけが読み直す", async () => {
    const tag = define(`<p>{{ city }}</p>`, () => ({}));
    const { root, write } = await page(`<template data-wcs="for: users"><${tag} data-wcs="state: .address"></${tag}></template>`,
      { users: [{ address: { city: "A" } }, { address: { city: "B" } }] });
    await write((s) => { s["users.1"] = { address: { city: "B2" } }; });
    expect(Array.from(root.querySelectorAll(tag)).map((c) => c.shadowRoot!.textContent)).toEqual(["A", "B2"]);
  });

  it("ホストが縮めた直後、まだ描き直していないコンポーネントの行は、ホストの行の getter を undefined と読み、その書き込みはホストに渡らない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const seen: unknown[] = [];
      const tag = define(`<ul><template data-wcs="for: list"><li data-wcs="onclick: rename">{{ .name }}</li></template></ul>`, () => ({
        rename(this: any) {
          seen.push(this["list.*.label"]);
          this["list.*.name"] = "renamed";
        },
      }));
      const { root, el, read } = await page(`<${tag} data-wcs="state.list: items"></${tag}>`, {
        items: [{ name: "a" }, { name: "b" }],
        get "items.*.label"() { return `L:${(this as any)["items.*.name"]}`; },
      });
      const sr = root.querySelector(tag)!.shadowRoot!;
      const lis = Array.from(sr.querySelectorAll("li")) as HTMLElement[];
      lis[0].click();
      el.createState("writable", (s: any) => { s.items = [{ name: "a" }]; });
      lis[1].click();
      await settle();
      expect(seen).toEqual(["L:a", undefined]);
      expect(read("items")).toEqual([{ name: "a" }]);
      expect(texts(sr, "li")).toEqual(["a"]);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("コンポーネントが縮めた直後、まだ描き直していないホストの行からの書き込みはコンポーネントに渡らない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const tag = define(`<ul><template data-wcs="for: list"><li>{{ .name }}</li></template></ul>`, () => ({
        shrink(this: any) { this.list = [this["list.0"]]; },
      }));
      const { root, read } = await page(
        `<ul class="host"><template data-wcs="for: items"><li data-wcs="onclick: rename">{{ .name }}</li></template></ul><${tag} data-wcs="state.list: items"></${tag}>`,
        { items: [{ name: "a" }, { name: "b" }], rename(this: any) { this["items.*.name"] = "renamed"; } },
      );
      const c = root.querySelector(tag) as any;
      const lis = Array.from(root.querySelectorAll(".host li")) as HTMLElement[];
      c.state.shrink();
      lis[1].click();
      await settle();
      expect(read("items")).toEqual([{ name: "a" }]);
      expect(texts(root, ".host li")).toEqual(["a"]);
      expect(texts(c.shadowRoot, "li")).toEqual(["a"]);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("同じデータに載る 2 つのうち 1 つを外しても、残る方にはホストの変更が届く", async () => {
    const tag = define(`<p>{{ name }}</p>`, () => ({}));
    const { root, write } = await page(`<div><${tag} class="one" data-wcs="state: user"></${tag}><${tag} class="two" data-wcs="state: user"></${tag}></div>`, { user: { name: "a" } });
    const one = root.querySelector(".one")!;
    const two = root.querySelector(".two")!;
    const box = one.parentElement!;
    one.remove();
    await write((s) => { s["user.name"] = "b"; });
    expect(two.shadowRoot!.textContent).toBe("b");
    box.appendChild(one);
    await settle();
    expect(one.shadowRoot!.textContent).toBe("b");
  });

  it("重なる 2 つの対応の上の方へのコンポーネントの書き込みは、ホストと、書いた対応に届く", async () => {
    const tag = define(`<p class="addr">{{ addr.city }}</p>`, () => ({
      move(this: any) { this.addr = { city: "Kyoto" }; },
    }));
    const { root, read } = await page(`<p class="host">{{ user.address.city }}</p><${tag} data-wcs="state.addr: user.address; state.city: user.address.city"></${tag}>`,
      { user: { address: { city: "Tokyo" } } });
    const c = root.querySelector(tag) as any;
    c.state.move();
    await settle();
    expect(read("user.address.city")).toBe("Kyoto");
    expect(text(root, ".host")).toBe("Kyoto");
    expect(text(c.shadowRoot, ".addr")).toBe("Kyoto");
  });
});

describe("コンポーネントのライフサイクル", () => {
  it("$stateReadyCallback の失敗（同期の例外・拒否された Promise）は console.error に報告され、コンポーネントは動く", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const thrown = new Error("ready failed");
    const rejected = new Error("ready rejected");
    try {
      const sync = define(`<p>{{ n }}</p>`, () => ({ n: 1 }), { $stateReadyCallback() { throw thrown; } });
      const async = define(`<p>{{ n }}</p>`, () => ({ n: 2 }), { async $stateReadyCallback() { throw rejected; } });
      const { root } = await page(`<${sync}></${sync}><${async}></${async}>`, {});
      await settle();
      expect(error).toHaveBeenCalledWith(thrown);
      expect(error).toHaveBeenCalledWith(rejected);
      expect(root.querySelector(sync)!.shadowRoot!.textContent).toBe("1");
      expect(root.querySelector(async)!.shadowRoot!.textContent).toBe("2");
    } finally {
      error.mockRestore();
    }
  });

  it("結線の無い Shadow のコンポーネントは、切断で $watch が止まり、再接続でまた動く", async () => {
    const seen: number[] = [];
    const tag = define(`<p>{{ n }}</p>`, () => ({ n: 0, $watch: { n(cur: number) { seen.push(cur); } } }));
    const { root } = await page(`<div class="box"><${tag}></${tag}></div>`, {});
    const c = root.querySelector(tag) as any;
    const box = root.querySelector(".box")!;
    c.state.n = 1;
    await settle();
    c.remove();
    c.state.n = 2;
    await settle();
    box.appendChild(c);
    await settle();
    c.state.n = 3;
    await settle();
    expect(seen).toEqual([1, 3]);
    expect(c.shadowRoot.textContent).toBe("3");
  });

  it("コンポーネントの <wcs-state> の再セットは投げる", async () => {
    const tag = define(`<p>{{ n }}</p>`, () => ({ n: 1 }));
    const { root } = await page(`<${tag}></${tag}>`, {});
    const inner = root.querySelector(tag)!.shadowRoot!.querySelector("wcs-state") as any;
    expect(() => inner.setInitialState({ n: 2 })).toThrow(`re-setting a component's state is not supported: write <${tag}>.state instead.`);
  });

  it("shadow を描き直して新しい <wcs-state bind-component> を置くと、同じマウントで読み書きする", async () => {
    const tag = define(`<p>{{ name }}</p>`, () => ({}));
    const { root, write, read } = await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "a" } });
    const c = root.querySelector(tag) as any;
    c.shadowRoot.innerHTML = `<wcs-state bind-component="state"></wcs-state><p class="again">{{ name }}!</p>`;
    await (c.shadowRoot.querySelector("wcs-state") as any).connectedCallbackPromise;
    await settle();
    expect(text(c.shadowRoot, ".again")).toBe("a!");
    await write((s) => { s["user.name"] = "b"; });
    expect(text(c.shadowRoot, ".again")).toBe("b!");
    c.state.name = "c";
    await settle();
    expect(read("user.name")).toBe("c");
  });

  it("接続中の 2 つ目の <wcs-state bind-component> と、別の名前の <wcs-state bind-component> は報告する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const tag = define(`<p>{{ name }}</p>`, () => ({}));
      const { root } = await page(`<${tag} class="one" data-wcs="state: user"></${tag}><${tag} class="two" data-wcs="state: user"></${tag}>`, { user: { name: "a" } });
      const one = root.querySelector(".one") as any;
      const second = document.createElement("wcs-state") as any;
      second.setAttribute("bind-component", "state");
      one.shadowRoot.appendChild(second);
      await second.connectedCallbackPromise;
      const two = root.querySelector(".two") as any;
      two.shadowRoot.innerHTML = `<wcs-state bind-component="other"></wcs-state>`;
      await (two.shadowRoot.querySelector("wcs-state") as any).connectedCallbackPromise;
      expect(messages(error)).toEqual([
        `[@wcstack/state] <${tag}> already has a connected <wcs-state bind-component="state">.`,
        `[@wcstack/state] <${tag}> already has a <wcs-state bind-component="state">.`,
      ]);
      // the first mount keeps working
      expect(text(one.shadowRoot, "p")).toBe("a");
    } finally {
      error.mockRestore();
    }
  });

  it("独立して動き出した後に書き足した結線は、そのコンポーネントには当てない（自分の木のまま）", async () => {
    const tag = define(`<p>{{ name }}</p>`, () => ({ name: "own" }));
    const h = document.createElement(`cov-cmp-page-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><${tag}></${tag}><p class="host">{{ user.name }}</p>`;
    document.body.appendChild(h);
    const c = root.querySelector(tag) as any;
    await c.shadowRoot.querySelector("wcs-state").connectedCallbackPromise;
    // the page's state loads after the component started on its own
    c.setAttribute("data-wcs", "state: user");
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ user: { name: "tree" } });
    await el.connectedCallbackPromise;
    await settle();
    expect(text(root, ".host")).toBe("tree");
    expect(text(c.shadowRoot, "p")).toBe("own");
    expect(c.state.name).toBe("own");
  });
});

describe("コンポーネントの誤りと警告", () => {
  it.each([
    [null, "got null"],
    ["text", "got string"],
  ])("状態のプロパティがオブジェクトでなければ報告する（%#）", async (value, got) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const tag = define(`<p>{{ a }}</p>`, () => value);
      await page(`<${tag}></${tag}>`, {});
      await settle();
      expect(messages(error)).toContain(`[@wcstack/state] "bind-component": <${tag}>.state must be an object (the component's state), ${got}.`);
    } finally {
      error.mockRestore();
    }
  });

  it("同じタグの 2 つのインスタンスでも、同じ隠れ方の警告は 1 度だけ", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const tag = define(`<p>{{ mode }}</p>`, () => ({ mode: "mine" }));
      await page(`<${tag} data-wcs="state: user"></${tag}><${tag} data-wcs="state: user"></${tag}>`, { user: { mode: "tree" } });
      expect(warn.mock.calls.filter((c) => String(c[0]).includes(`its own "mode" hides "user.mode"`))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("動かない $ 宣言が 2 つ以上なら、まとめて 1 つの警告にする", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const tag = define(`<p>{{ name }}</p>`, () => ({ $watch: { name() {} }, $renderedCallback() {} }));
      await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "a" } });
      expect(warn).toHaveBeenCalledWith(`[@wcstack/state] [wcs/mount-dollar-declaration] <${tag}>: $watch, $renderedCallback are not run in a mounted component — declare it on the root state.`);
    } finally {
      warn.mockRestore();
    }
  });

  it("文書の直下の <wcs-state bind-component> は、カスタム要素の直下にないと報告する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = document.documentElement;
    const el = document.createElement("wcs-state") as any;
    el.setAttribute("bind-component", "state");
    try {
      // the document's own child: its parent node is the document itself
      document.removeChild(html);
      document.appendChild(el);
    } finally {
      if (el.parentNode === document) document.removeChild(el);
      if (html.parentNode !== document) document.appendChild(html);
    }
    try {
      await el.connectedCallbackPromise;
      expect(messages(error)).toEqual(['[@wcstack/state] "bind-component" requires <wcs-state> to be a direct child of a custom element.']);
    } finally {
      error.mockRestore();
    }
  });
});
