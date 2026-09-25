import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes]);
  bootstrapState();
});

/** A component whose `<wcs-state bind-component="state">` sits in its shadow root (or its children). */
function define(markup: string, state: () => Record<string, any>, light = false): string {
  const tag = `cmp-test-${seq++}`;
  const content = `<wcs-state bind-component="state"></wcs-state>${markup}`;
  customElements.define(tag, class extends HTMLElement {
    state = state();
    constructor() {
      super();
      if (!light) this.attachShadow({ mode: "open" }).innerHTML = content;
    }
    connectedCallback(): void {
      if (light && this.childElementCount === 0) this.innerHTML = content;
    }
  });
  return tag;
}

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`cmp-page-${seq++}`);
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
  return { h, root, el, write, read };
}

const text = (c: Element | ShadowRoot | null | undefined, sel: string) => c!.querySelector(sel)!.textContent;

describe("コンポーネントの mount の優先順位（R1）", () => {
  it("1 段の部分マウントはデータの既定値に勝ち、accessor・メソッドとは自分の側が勝って警告する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tag = define(`<p class="a">{{ a }}</p><p class="b">{{ b }}</p><p class="c">{{ c }}</p>`, () => ({
      a: "default",
      get b() { return "own getter"; },
      c() { return 1; },
    }));
    const { root } = await page(`<${tag} data-wcs="state.a: x; state.b: y; state.c: z"></${tag}>`, { x: "tree-a", y: "tree-b", z: "tree-c" });
    const sr = root.querySelector(tag)!.shadowRoot;
    expect(text(sr, ".a")).toBe("tree-a");
    expect(text(sr, ".b")).toBe("own getter");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[wcs/mount-own-key-shadow]"));
    warn.mockRestore();
  });

  it("丸ごとのマウントで自分のキーは私有（ツリーに同じキーがあれば警告）、宣言していないキーはツリーを読む", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tag = define(`<p class="name">{{ name }}</p><p class="mode">{{ mode }}</p>`, () => ({ mode: "mine" }));
    const { root, write, read } = await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "Al", mode: "tree" } });
    const c = root.querySelector(tag) as any;
    expect(text(c.shadowRoot, ".name")).toBe("Al");
    expect(text(c.shadowRoot, ".mode")).toBe("mine");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('its own "mode" hides "user.mode"'));
    c.state.mode = "changed";
    await flush();
    expect(read("user.mode")).toBe("tree");
    await write((s) => { s["user.mode"] = "tree2"; });
    expect(text(c.shadowRoot, ".mode")).toBe("changed");
    warn.mockRestore();
  });
});

describe("コンポーネントとホストの間の変更", () => {
  it("深い書き込み・$postUpdate は、ホストと、同じデータに載る別のコンポーネントに届く", async () => {
    const tag = define(`<p class="city">{{ address.city }}</p>`, () => ({
      move(this: any) { this["address.city"] = "Kyoto"; },
      touch(this: any) { this.address.city = "Nara"; this.$postUpdate("address"); },
    }));
    const { root, read } = await page(`<p class="host">{{ user.address.city }}</p><${tag} class="one" data-wcs="state: user"></${tag}><${tag} class="two" data-wcs="state: user"></${tag}>`,
      { user: { address: { city: "Tokyo" } } });
    const [one, two] = Array.from(root.querySelectorAll(tag)) as any[];
    one.state.move();
    await flush();
    expect(read("user.address.city")).toBe("Kyoto");
    expect(text(root, ".host")).toBe("Kyoto");
    expect(text(two.shadowRoot, ".city")).toBe("Kyoto");
    two.state.touch();
    await flush();
    expect(text(root, ".host")).toBe("Nara");
    expect(text(one.shadowRoot, ".city")).toBe("Nara");
  });

  it("行のマウントは、ホストが行の要素を置き換えると新しい行を読む", async () => {
    const tag = define(`<p>{{ name }}</p>`, () => ({}));
    const { root, write } = await page(`<template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template>`, { users: [{ name: "a" }, { name: "b" }] });
    await write((s) => { s["users.1"] = { name: "B" }; });
    expect(Array.from(root.querySelectorAll(tag)).map((c) => c.shadowRoot!.textContent)).toEqual(["a", "B"]);
  });

  it("ホストの getter に載せたマウントは、その依存が変わると読み直す", async () => {
    const tag = define(`<p>{{ total }}</p>`, () => ({}));
    const { root, write } = await page(`<${tag} data-wcs="state.total: cart.total"></${tag}>`, {
      cart: { items: [1, 2] },
      get "cart.total"() { return (this as any)["cart.items"].reduce((a: number, b: number) => a + b, 0); },
    });
    const c = root.querySelector(tag)!;
    expect(c.shadowRoot!.textContent).toBe("3");
    await write((s) => { s["cart.items"] = [1, 2, 10]; });
    expect(c.shadowRoot!.textContent).toBe("13");
  });

  it("2 段重ね: 中段が配列を渡すだけでも、最下段の行の書き込みがホストに届き、ホストの行の書き込みが最下段に届く", async () => {
    const leaf = define(`<ul><template data-wcs="for: list"><li>{{ .name }}</li></template></ul>`, () => ({
      rename(this: any) { this["list.0.name"] = "from-leaf"; },
    }));
    const mid = define(`<${leaf} data-wcs="state.list: items"></${leaf}>`, () => ({}));
    const { root, write, read } = await page(`<${mid} data-wcs="state.items: rows"></${mid}>`, { rows: [{ name: "a" }, { name: "b" }] });
    const bottom = root.querySelector(mid)!.shadowRoot!.querySelector(leaf) as any;
    const names = () => Array.from(bottom.shadowRoot.querySelectorAll("li")).map((li: any) => li.textContent);
    expect(names()).toEqual(["a", "b"]);
    await write((s) => { s["rows.1.name"] = "B"; });
    expect(names()).toEqual(["a", "B"]);
    bottom.state.rename();
    await flush();
    await flush();
    expect(read("rows.0.name")).toBe("from-leaf");
    expect(names()).toEqual(["from-leaf", "B"]);
  });
});

describe("コンポーネントのライフサイクル", () => {
  it("切断中のホストの変更は再接続で追いつき、$connectedCallback / $disconnectedCallback は this でコンポーネントを見る", async () => {
    const calls: string[] = [];
    const tag = define(`<p>{{ name }}</p>`, () => ({
      $connectedCallback(this: any) { calls.push(`connected:${this.name}`); },
      $disconnectedCallback(this: any) { calls.push(`disconnected:${this.name}`); },
    }));
    const { root, write } = await page(`<div class="box"><${tag} data-wcs="state: user"></${tag}></div>`, { user: { name: "a" } });
    const c = root.querySelector(tag)!;
    const box = root.querySelector(".box")!;
    c.remove();
    await write((s) => { s["user.name"] = "b"; });
    box.appendChild(c);
    await flush();
    await flush();
    expect(c.shadowRoot!.textContent).toBe("b");
    expect(calls).toEqual(["connected:a", "disconnected:a", "connected:b"]);
  });

  it("コンポーネントの行が消えると登録も消え、ホストの再セットができる（載っている間は投げる）", async () => {
    const tag = define(`<p>{{ name }}</p>`, () => ({}));
    const { el, write } = await page(`<template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template>`, { users: [{ name: "a" }] });
    expect(() => el.setInitialState({ users: [] })).toThrow("mounted components");
    await write((s) => { s.users = []; });
    expect(() => el.setInitialState({ users: [] })).not.toThrow();
  });

  it("結線の無い Shadow のコンポーネントは独立した木で、$stateReadyCallback を受け、宣言も動く", async () => {
    const seen: unknown[] = [];
    const tag = `cmp-test-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state = { n: 1, $watch: { n(this: any, cur: number) { seen.push(cur); } } };
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><p>{{ n }}</p>`;
      }
      $stateReadyCallback(prop: string) { seen.push(prop); }
    });
    const { root } = await page(`<${tag}></${tag}>`, {});
    const c = root.querySelector(tag) as any;
    c.state.n = 2;
    await flush();
    expect(c.shadowRoot.textContent).toBe("2");
    expect(seen).toEqual(["state", 2]);
  });
});

describe("コンポーネントの誤り", () => {
  it("結線の無い Light DOM は捕まらない例外で報告し、中身はホストにも束ねられない", async () => {
    const tag = define(`<span class="inner" data-wcs="textContent: message"></span>`, () => ({ message: "x" }), true);
    // the page sees it as an uncaught error (a microtask that throws)
    const thrown: unknown[] = [];
    const queue = globalThis.queueMicrotask;
    const spy = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((cb) => queue(() => {
      try { cb(); } catch (e) { thrown.push(e); }
    }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root } = await page(`<${tag}></${tag}>`, {});
      await flush();
      expect(text(root, ".inner")).toBe("");
      expect(String((thrown[0] as Error)?.message ?? thrown[0])).toContain('plain (unwired) Light DOM "bind-component" is not supported');
      expect(error).not.toHaveBeenCalledWith(expect.stringContaining("binding"), expect.anything());
    } finally {
      spy.mockRestore();
      error.mockRestore();
    }
  });

  it("カスタム要素の直下にない bind-component・状態の読み込みとの併用・二重の対応は報告する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const tag = define(`<p>{{ a }}</p>`, () => ({}));
    await page(`<div><wcs-state bind-component="state"></wcs-state></div><${tag} data-wcs="state.a: x; state.a: y"></${tag}>`, { x: 1, y: 2 });
    const tag2 = `cmp-test-${seq++}`;
    customElements.define(tag2, class extends HTMLElement {
      state = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state" json='{"a":1}'></wcs-state>`;
      }
    });
    await page(`<${tag2}></${tag2}>`, {});
    const messages = error.mock.calls.map((c) => String((c[0] as Error)?.message ?? c[0]));
    expect(messages.some((m) => m.includes("direct child of a custom element"))).toBe(true);
    expect(messages.some((m) => m.includes('maps "state.a" twice'))).toBe(true);
    expect(messages.some((m) => m.includes("cannot also load one"))).toBe(true);
    error.mockRestore();
  });

  it("マウントしたコンポーネントの $watch などは動かないことを警告する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tag = define(`<p>{{ name }}</p>`, () => ({ $watch: { name() {} } }));
    await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "a" } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[wcs/mount-dollar-declaration]"));
    warn.mockRestore();
  });
});
