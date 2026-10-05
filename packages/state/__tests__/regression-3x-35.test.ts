/**
 * regression-3x-35.test.ts — @wcstack/state 3.5.0 / 3.5.1 で 3.x に入った修正が 4.0（state-next）でも
 * 成り立つかを、3.x の回帰テスト（packages/state/__tests__）の形のまま確かめる。
 *
 * - #409（3.5.1）: binder は渡されたサブツリーの中だけを束ねる（自分に宣言を持つ要素の後ろの兄弟の
 *   for: / if: が描かれない、の修正）。3.x の integration.binder.test.ts の形。本物の router を通す形は
 *   regression-3x-binder-router.test.ts。
 * - #414（3.5.1）: 束ねたサブツリーをもう一度渡しても、行の中のノードのループ文脈を消さない。
 * - #411（3.5.0）: 読み込みに失敗した source は、投げられたエラーそのもので connectedCallbackPromise を
 *   reject する（包まない）。3.x の integration.initFailureDiagnostics.test.ts・dcc.State.test.ts の形。
 * - #405（3.5.0）: `[wcs/v4-migration]` の警告が「4.0 はこうする」と約束していることが、4.0 で本当に
 *   そうなっているか（警告の対象ごと）。3.x の v4Migration.test.ts の対象の表。
 *
 * 4.0 で当てはまらないもの（このファイルに置かない）: `[wcs/v4-migration]` の警告そのもの（4.0 は
 * 警告せず投げる）、3.x だけの「3.x の例外」（src="*.json" の失敗・見つからない state= を空の state で
 * 始める — 4.0 は reject。4.0 の振る舞いとして下で確かめる）、shadow root の構築の走査のやり直し（3.x の仕組み）。
 * `on*#direct:`（3.5 で 3.x にも書けるようになった）と Firefox の CSP の 1 タスクの待ち（3.5 の修正）は
 * quality-core.test.ts（F4）と coverage-element-load.test.ts にすでにある。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, config, diagnostics, getBindingsReady, installFeatures, scopes, ssr, temporal } from "../src/index";
import { formats } from "../src/features/formats";
import { getBinder } from "../src/protocol/binder";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes, ssr, formats]);
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`, after `markup`. */
async function page(state: Record<string, any>, markup = "") {
  const host = document.createElement(`r35-page-${seq++}`);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${markup}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(host);
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
  return { host, root, el, write, read };
}

const texts = (root: ParentNode, selector: string): string[] =>
  Array.from(root.querySelectorAll(selector), (node) => node.textContent ?? "");

/** What console.error received while `run` ran. */
async function collectErrors(run: () => Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map((a) => String((a as Error)?.message ?? a)).join(" "));
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return errors;
}

/** As the router does with route content: places `markup` in `parent`, then hands each top-level element over. */
function placeAndHand(parent: ParentNode, markup: string): Element[] {
  const holder = document.createElement("template");
  holder.innerHTML = markup;
  const placed = Array.from(holder.content.children);
  parent.append(holder.content);
  for (const node of placed) getBinder()?.bind(node);
  return placed;
}

/** How a promise settles. */
async function settle(p: Promise<unknown>): Promise<"resolved" | "rejected"> {
  return p.then(() => "resolved" as const, () => "rejected" as const);
}

/** The reason `p` rejects with (fails the test if it resolves). */
async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

describe("#409 binder は渡されたサブツリーの中だけを束ねる", () => {
  const ITEMS = () => ({ msg: "hi", items: ["a", "b"], on: true });

  it("自分に宣言を持つ要素の後ろの兄弟が含む for: / if: も描かれ、書き込みに追従する", async () => {
    const { host, root, write } = await page(ITEMS());
    const outlet = document.createElement("div");
    root.appendChild(outlet);
    const errors = await collectErrors(async () => {
      placeAndHand(outlet,
        `<span class="msg" data-wcs="textContent: msg"></span>` +
        `<ul><template data-wcs="for: items"><li class="row">{{ . }}</li></template></ul>` +
        `<p><template data-wcs="if: on"><b class="on">on</b></template></p>`);
      await flush();
    });
    expect(errors).toEqual([]);
    expect(texts(root, ".msg")).toEqual(["hi"]);
    expect(texts(root, ".row")).toEqual(["a", "b"]);
    expect(texts(root, ".on")).toEqual(["on"]);
    await write((s) => { s.items = ["c"]; s.on = false; });
    expect(texts(root, ".row")).toEqual(["c"]);
    expect(texts(root, ".on")).toEqual([]);
    host.remove();
  });

  it("ShadowRoot の直下（親が DocumentFragment）に置いて渡しても、後ろの兄弟の for: が描かれる", async () => {
    const { host, root } = await page(ITEMS());
    const errors = await collectErrors(async () => {
      placeAndHand(root,
        `<span class="msg" data-wcs="textContent: msg"></span>` +
        `<ul><template data-wcs="for: items"><li class="row">{{ . }}</li></template></ul>`);
      await flush();
    });
    expect(errors).toEqual([]);
    expect(texts(root, ".msg")).toEqual(["hi"]);
    expect(texts(root, ".row")).toEqual(["a", "b"]);
    host.remove();
  });

  it("渡されていない兄弟は束ねない（明示的に渡されたものだけ）", async () => {
    const { host, root } = await page(ITEMS());
    const outlet = document.createElement("div");
    outlet.innerHTML = `<i class="other" data-wcs="textContent: msg"></i>`;
    root.appendChild(outlet);
    placeAndHand(outlet, `<span class="msg" data-wcs="textContent: msg"></span>`);
    await flush();
    expect(texts(root, ".msg")).toEqual(["hi"]);
    expect(texts(root, ".other")).toEqual([""]);
    host.remove();
  });

  it("根が宣言を持ち、中に構造テンプレートを持つサブツリーは、根も中身も描かれる", async () => {
    const { host, root } = await page(ITEMS());
    const outlet = document.createElement("div");
    root.appendChild(outlet);
    const errors = await collectErrors(async () => {
      placeAndHand(outlet,
        `<section class="box" data-wcs="attr.data-msg: msg">` +
        `<ul><template data-wcs="for: items"><li class="row">{{ . }}</li></template></ul></section>`);
      await flush();
    });
    expect(errors).toEqual([]);
    expect(root.querySelector(".box")?.getAttribute("data-msg")).toBe("hi");
    expect(texts(root, ".row")).toEqual(["a", "b"]);
    host.remove();
  });

  it("宣言を根に持つ要素を兄弟と一緒に何度渡しても、1 回のクリックで 1 回だけ数え、行も重ならない", async () => {
    const { host, root, read } = await page({ count: 0, items: ["a", "b"], inc(this: any) { this.count++; } });
    const outlet = document.createElement("div");
    root.appendChild(outlet);
    const errors = await collectErrors(async () => {
      const placed = placeAndHand(outlet,
        `<button class="inc" data-wcs="onclick: inc">+</button>` +
        `<b class="count">{{ count }}</b>` +
        `<ul><template data-wcs="for: items"><li class="row">{{ . }}</li></template></ul>`);
      for (const node of placed) getBinder()?.bind(node);
      await flush();
      (root.querySelector(".inc") as HTMLButtonElement).click();
      await flush();
      await flush();
    });
    expect(errors).toEqual([]);
    expect(read("count")).toBe(1);
    expect(texts(root, ".count")).toEqual(["1"]);
    expect(texts(root, ".row")).toEqual(["a", "b"]);
    host.remove();
  });

  it("構築の前に渡され、構築の走査がアンカーに置き換えた構造テンプレート（文書から外れた根）は束ねず、行は 1 回だけ描かれる", async () => {
    // the router hands the landing route's content over before state has built its bindings
    const host = document.createElement(`r35-early-${seq++}`);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      `<wcs-state json='{"items":["a","b"]}'></wcs-state>` +
      `<template data-wcs="for: items"><i class="row">{{ . }}</i></template>`;
    const template = root.querySelector("template") as HTMLTemplateElement;
    document.body.appendChild(host);
    const errors = await collectErrors(async () => {
      getBinder()?.bind(template);
      await (root.querySelector("wcs-state") as any).connectedCallbackPromise;
      await getBindingsReady(root);
      await flush();
    });
    expect(errors).toEqual([]);
    expect(template.isConnected).toBe(false);
    expect(texts(root, ".row")).toEqual(["a", "b"]);
    host.remove();
  });

  it("文書に無いサブツリーは預からず、別のルートの構築が預かり分を流しても束ねない。文書に入れてから渡せば束ねる", async () => {
    const { host, root } = await page({ msg: "built" });
    const detached = document.createElement("span");
    detached.className = "detached";
    detached.setAttribute("data-wcs", "textContent: msg");
    getBinder()?.bind(detached);
    root.appendChild(detached);
    // another root's first build drains what was handed over early
    const other = await page({ msg: "other" });
    expect(texts(root, ".detached")).toEqual([""]);
    getBinder()?.bind(detached);
    await flush();
    expect(texts(root, ".detached")).toEqual(["built"]);
    other.host.remove();
    host.remove();
  });

  it("根が Light DOM のマウント（ホストから配線したコンポーネント）なら、根の配線だけを束ね、中身はコンポーネントのスコープに任せる", async () => {
    const tag = `r35-light-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state: Record<string, unknown> = {};
      connectedCallback() {
        if (this.childElementCount === 0) {
          this.innerHTML =
            `<wcs-state bind-component="state"></wcs-state>` +
            `<span class="inner" data-wcs="textContent: name"></span>` +
            `<ul><template data-wcs="for: tags"><li class="tag">{{ . }}</li></template></ul>`;
        }
      }
    });
    const { host, root, write } = await page({ user: { name: "Alice", tags: ["x", "y"] } });
    const outlet = document.createElement("div");
    root.appendChild(outlet);
    const errors = await collectErrors(async () => {
      const [component] = placeAndHand(outlet, `<${tag} data-wcs="state: user"></${tag}>`);
      await (component.querySelector("wcs-state") as any).connectedCallbackPromise;
      await flush();
      await flush();
    });
    expect(errors).toEqual([]);
    expect(texts(root, ".inner")).toEqual(["Alice"]);
    expect(texts(root, ".tag")).toEqual(["x", "y"]);
    await write((s) => { s["user.name"] = "Noa"; });
    expect(texts(root, ".inner")).toEqual(["Noa"]);
    host.remove();
  });
});

describe("#414 束ねたサブツリーをもう一度渡しても、行の中の if: を切り替えられる", () => {
  it("行の中の if:（ルートのパス）を、もう一度渡した後で切り替えられる（3.x の形）", async () => {
    const { host, root, write } = await page(
      { on: true, items: [{ name: "a" }, { name: "b" }] },
      `<ul id="rows"><template data-wcs="for: items"><li><template data-wcs="if: on"><b class="row">{{ .name }}</b></template></li></template></ul>`,
    );
    const errors = await collectErrors(async () => {
      getBinder()?.bind(root.getElementById("rows") as Element);
      await flush();
      await write((s) => { s.on = false; });
      expect(texts(root, ".row")).toEqual([]);
      await write((s) => { s.on = true; });
    });
    expect(errors).toEqual([]);
    expect(texts(root, ".row")).toEqual(["a", "b"]);
    host.remove();
  });

  it("行の中の if:（行のパス .on）を、もう一度渡した後で行ごとに切り替えられる", async () => {
    const { host, root, write } = await page(
      { items: [{ name: "a", on: true }, { name: "b", on: true }] },
      `<ul id="rows"><template data-wcs="for: items"><li><template data-wcs="if: .on"><b class="row">{{ .name }}</b></template></li></template></ul>`,
    );
    const errors = await collectErrors(async () => {
      getBinder()?.bind(root.getElementById("rows") as Element);
      // the rows themselves handed over too, as a router hands its content node by node
      for (const li of Array.from(root.querySelectorAll("li"))) getBinder()?.bind(li);
      await flush();
      await write((s) => { s["items.0.on"] = false; });
      expect(texts(root, ".row")).toEqual(["b"]);
      await write((s) => { s["items.0.on"] = true; });
    });
    expect(errors).toEqual([]);
    expect(texts(root, ".row")).toEqual(["a", "b"]);
    host.remove();
  });

  it("入れ子の for の内側の行の if: も、外側をもう一度渡した後で切り替えられる", async () => {
    const { host, root, write } = await page(
      { on: true, groups: [{ items: [{ name: "a" }, { name: "b" }] }, { items: [{ name: "c" }] }] },
      `<div id="outer"><template data-wcs="for: groups"><ul><template data-wcs="for: .items"><li><template data-wcs="if: on"><b class="row">{{ .name }}</b></template></li></template></ul></template></div>`,
    );
    const errors = await collectErrors(async () => {
      getBinder()?.bind(root.getElementById("outer") as Element);
      for (const ul of Array.from(root.querySelectorAll("ul"))) getBinder()?.bind(ul);
      await flush();
      await write((s) => { s.on = false; });
      expect(texts(root, ".row")).toEqual([]);
      await write((s) => { s.on = true; });
    });
    expect(errors).toEqual([]);
    expect(texts(root, ".row")).toEqual(["a", "b", "c"]);
    host.remove();
  });

  it("構築の前に渡された（構築の後で束ね直される）内容の、行の中の if: を切り替えられる（着地の形）", async () => {
    const host = document.createElement(`r35-landing-${seq++}`);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      `<wcs-state></wcs-state>` +
      `<ul id="rows"><template data-wcs="for: items"><li><template data-wcs="if: on"><b class="row">{{ .name }}</b></template></li></template></ul>`;
    const el = root.querySelector("wcs-state") as any;
    document.body.appendChild(host);
    const errors = await collectErrors(async () => {
      // handed over while the state is still loading: held until the first build, then bound again
      getBinder()?.bind(root.getElementById("rows") as Element);
      await flush();
      el.setInitialState({ on: true, items: [{ name: "a" }, { name: "b" }] });
      await el.connectedCallbackPromise;
      await getBindingsReady(root);
      await flush();
      expect(texts(root, ".row")).toEqual(["a", "b"]);
      el.createState("writable", (s: any) => { s.on = false; });
      await flush();
      expect(texts(root, ".row")).toEqual([]);
      el.createState("writable", (s: any) => { s.on = true; });
      await flush();
    });
    expect(errors).toEqual([]);
    expect(texts(root, ".row")).toEqual(["a", "b"]);
    host.remove();
  });

  it("SSR でハイドレートした行をもう一度渡しても、行の中の if: を切り替えられる", async () => {
    const markup = `<ul id="rows"><template data-wcs="for: items"><li><template data-wcs="if: .on"><b class="row">{{ .name }}</b></template></li></template></ul>`;
    const state = () => ({ items: [{ name: "a", on: true }, { name: "b", on: true }] });
    // the server's render (an orchestrated render, then the snapshot builder)
    document.documentElement.setAttribute("data-wcs-server", "orchestrated");
    let html: string;
    try {
      const sh = document.createElement(`r35-server-${seq++}`);
      const sroot = sh.attachShadow({ mode: "open" });
      sroot.innerHTML = `<wcs-state enable-ssr></wcs-state>${markup}`;
      const sel = sroot.querySelector("wcs-state") as any;
      sel.setInitialState(state());
      document.body.appendChild(sh);
      await sel.connectedCallbackPromise;
      await getBindingsReady(sroot);
      await flush();
      (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(sroot);
      html = sroot.innerHTML;
      sh.remove();
    } finally {
      document.documentElement.removeAttribute("data-wcs-server");
    }
    const host = document.createElement(`r35-client-${seq++}`);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = html;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state());
    document.body.appendChild(host);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    expect(texts(root, ".row")).toEqual(["a", "b"]);
    const errors = await collectErrors(async () => {
      getBinder()?.bind(root.getElementById("rows") as Element);
      for (const li of Array.from(root.querySelectorAll("li"))) getBinder()?.bind(li);
      await flush();
      el.createState("writable", (s: any) => { s["items.1.on"] = false; });
      await flush();
      expect(texts(root, ".row")).toEqual(["a"]);
      el.createState("writable", (s: any) => { s["items.1.on"] = true; });
      await flush();
    });
    expect(errors).toEqual([]);
    expect(texts(root, ".row")).toEqual(["a", "b"]);
    host.remove();
  });
});

describe("#411 読み込みに失敗した source は、投げられたエラーそのもので reject する", () => {
  /** A host whose shadow root holds `html`, connected. */
  function mountHost(html: string) {
    const host = document.createElement(`r35-fail-${seq++}`);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = html;
    document.body.appendChild(host);
    return { host, root, el: root.querySelector("wcs-state") as any };
  }

  it("json= のパース失敗: JSON.parse の SyntaxError のまま reject し、getBindingsReady も console.error も同じオブジェクト", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, root, el } = mountHost(`<wcs-state json='{bad'></wcs-state><p>{{ x }}</p>`);
    try {
      const reason = await rejection(el.connectedCallbackPromise);
      expect(reason).toBeInstanceOf(SyntaxError);
      await expect(getBindingsReady(root)).rejects.toBe(reason);
      await expect(el.initializePromise).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]).toContain(reason);
    } finally {
      error.mockRestore();
      host.remove();
    }
  });

  it("state= の JSON script のパース失敗: SyntaxError のまま reject する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = `r35-state-json-${seq++}`;
    const script = document.createElement("script");
    script.type = "application/json";
    script.id = id;
    script.textContent = "{bad";
    document.body.appendChild(script);
    const { host, root, el } = mountHost(`<wcs-state state="${id}"></wcs-state>`);
    try {
      const reason = await rejection(el.connectedCallbackPromise);
      expect(reason).toBeInstanceOf(SyntaxError);
      await expect(getBindingsReady(root)).rejects.toBe(reason);
    } finally {
      error.mockRestore();
      host.remove();
      script.remove();
    }
  });

  it("src=\"*.js\" のモジュールが投げた値は同じオブジェクトで reject する（Error でない値も包まない）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const probe = new RangeError("thrown while the state module evaluated");
    (globalThis as any).__r35Probe = probe;
    (globalThis as any).__r35Thrown = "module threw a string";
    try {
      for (const [expression, expected] of [["globalThis.__r35Probe", probe], ["globalThis.__r35Thrown", "module threw a string"]] as const) {
        const src = `data:text/javascript,${encodeURIComponent(`throw ${expression}; //${seq++}.js`)}`;
        const host = document.createElement(`r35-src-${seq++}`);
        const root = host.attachShadow({ mode: "open" });
        const el = document.createElement("wcs-state") as any;
        el.setAttribute("src", src);
        root.appendChild(el);
        document.body.appendChild(host);
        await expect(el.connectedCallbackPromise).rejects.toBe(expected);
        await expect(getBindingsReady(root)).rejects.toBe(expected);
        host.remove();
      }
    } finally {
      delete (globalThis as any).__r35Probe;
      delete (globalThis as any).__r35Thrown;
      error.mockRestore();
    }
  });

  it("内側の <script type=\"module\"> の失敗は、ローダーのエラー（[@wcstack/state] 付き、元は cause）で reject する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // (happy-dom under vitest cannot import a blob: URL: the real loader fails to evaluate)
    const { host, root, el } = mountHost(`<wcs-state><script type="module">export default { a: 1 };</script></wcs-state>`);
    try {
      const reason = await rejection(el.connectedCallbackPromise);
      expect(reason).toBeInstanceOf(Error);
      expect((reason as Error).message).toMatch(/^\[@wcstack\/state\] /);
      expect((reason as Error).cause).toBeDefined();
      await expect(getBindingsReady(root)).rejects.toBe(reason);
    } finally {
      error.mockRestore();
      host.remove();
    }
  });

  // 3.5 の「失敗の見出しが要素の source を名指す」（CHANGELOG 3.5.0 Changed）。4.0 は見出し #49 で要素と source を名指す
  // （element.ts の fail()。v4-remaining §3.2「初期化の失敗」(a)）。
  it("失敗の報告が src= を名指す（3.5: [@wcstack/state] <wcs-state src=\"…\"> failed to initialize.）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    (globalThis as any).__r35Probe2 = new RangeError("boom");
    const src = `data:text/javascript,${encodeURIComponent(`throw globalThis.__r35Probe2; //${seq++}.js`)}`;
    const host = document.createElement(`r35-header-${seq++}`);
    const root = host.attachShadow({ mode: "open" });
    const el = document.createElement("wcs-state") as any;
    el.setAttribute("src", src);
    root.appendChild(el);
    document.body.appendChild(host);
    try {
      await settle(el.connectedCallbackPromise);
      const logged = error.mock.calls.map((c) => c.map((a) => String((a as Error)?.message ?? a)).join(" ")).join("\n");
      expect(logged).toContain(src);
    } finally {
      delete (globalThis as any).__r35Probe2;
      error.mockRestore();
      host.remove();
    }
  });

  it("4.0 の振る舞い: src=\"*.json\" の HTTP エラーは src と status を示して reject する（3.x は空の state で解決）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found", json: async () => ({}) }));
    const { host, el } = mountHost(`<wcs-state src="./missing-state.json"></wcs-state>`);
    try {
      const reason = await rejection(el.connectedCallbackPromise);
      expect((reason as Error).message).toContain("./missing-state.json");
      expect((reason as Error).message).toContain("404");
    } finally {
      vi.unstubAllGlobals();
      error.mockRestore();
      host.remove();
    }
  });

  it("4.0 の振る舞い: state= の id がどこにも無ければ reject し、shadow root の中の JSON script は見つける（3.x は document だけを探して空の state）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = mountHost(`<wcs-state state="r35-nowhere-${seq++}"></wcs-state>`);
    const id = `r35-shadow-json-${seq++}`;
    const found = mountHost(`<script type="application/json" id="${id}">{"count":1}</script><wcs-state state="${id}"></wcs-state><p>{{ count }}</p>`);
    try {
      expect(await settle(missing.el.connectedCallbackPromise)).toBe("rejected");
      await found.el.connectedCallbackPromise;
      await flush();
      expect(found.root.querySelector("p")!.textContent).toBe("1");
    } finally {
      error.mockRestore();
      missing.host.remove();
      found.host.remove();
    }
  });

  // 3.x（3.5）の README は「DCC の設定・ロードの失敗は、元のエラーそのもので connectedCallbackPromise を reject する」と約束する。
  // 4.0 も claim の経路の失敗で reject する（ボリュームだけは resolve — Claimed.lenient。v4-remaining §3.2「初期化の失敗」(b)）。
  it("DCC の定義の state の読み込みに失敗すると、その SyntaxError で connectedCallbackPromise を reject する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const tag = `r35-dcc-${seq++}`;
    const def = document.createElement(tag);
    def.setAttribute("data-wc-definition", "");
    const shadow = def.attachShadow({ mode: "open" });
    shadow.innerHTML = `<p>{{ count }}</p><wcs-state json='{bad'></wcs-state>`;
    document.body.appendChild(def);
    const el = shadow.querySelector("wcs-state") as any;
    try {
      const reason = await rejection(el.connectedCallbackPromise);
      expect(reason).toBeInstanceOf(SyntaxError);
    } finally {
      error.mockRestore();
      def.remove();
    }
  });

  // 3.x の README の「scope ごとの表」: マウントしたコンポーネントの初期化の失敗は、そのコンポーネントの
  // connectedCallbackPromise を reject する。4.0 も同じ（上と同じ claim の経路）。
  it("bind-component の設定の誤り（ホストの state が object でない）は、コンポーネントの connectedCallbackPromise を reject する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const tag = `r35-bad-cmp-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state: unknown = null;
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><p>{{ n }}</p>`;
      }
    });
    const cmp = document.createElement(tag);
    document.body.appendChild(cmp);
    const el = cmp.shadowRoot!.querySelector("wcs-state") as any;
    try {
      expect(await settle(el.connectedCallbackPromise)).toBe("rejected");
    } finally {
      error.mockRestore();
      cmp.remove();
    }
  });

  it("（対照）4.0 でもマウントしたコンポーネントの設定の誤りは console.error で報告される", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const tag = `r35-bad-cmp-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state: unknown = null;
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><p>{{ n }}</p>`;
      }
    });
    const cmp = document.createElement(tag);
    document.body.appendChild(cmp);
    const el = cmp.shadowRoot!.querySelector("wcs-state") as any;
    try {
      await settle(el.connectedCallbackPromise);
      await flush();
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
      cmp.remove();
    }
  });
});

describe("#405 3.5 の [wcs/v4-migration] の警告が約束する 4.0 の振る舞い", () => {
  // 3.5 の警告が約束した 4.0 は `.` と `/auto`（診断の後付けを入れた形）。4.0.0-rc.3 の後で、旧名の検出と
  // メッセージの [wcs/<code>] はコアから診断の後付けへ移った: この describe（このファイルの最後）から入れる
  beforeAll(() => {
    installFeatures([diagnostics]);
  });

  /** How a page over `state` (and `markup`) initializes: "ok", or the failure's message. */
  async function init(state: Record<string, any>, markup = ""): Promise<string> {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement(`r35-init-${seq++}`);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state>${markup}`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(host);
    try {
      await el.connectedCallbackPromise;
      return "ok";
    } catch (e) {
      return String((e as Error)?.message ?? e);
    } finally {
      error.mockRestore();
      host.remove();
    }
  }

  it.each(["inc", "dec", "fix", "uc", "lc", "cap", "rep", "rev", "pad", "null", "substr"])(
    "旧名・外したフィルタ %s はページの初期化で投げる（wcs/filter-unknown）",
    async (name) => {
      const message = await init({ v: 1 }, `<p>{{ v|${name} }}</p>`);
      expect(message).toContain("[wcs/filter-unknown]");
    },
  );

  it("正式名のフィルタ（slice・inc の書き換え先 add）は通る", async () => {
    expect(await init({ v: "abcdef", n: 1 }, `<p>{{ v|slice(2,5) }}</p><p>{{ n|add(1) }}</p>`)).toBe("ok");
  });

  it.each(["$trackDependency", "$untrackDependency"])("%s は読んだ時点で投げる（wcs/name-alias）", async (name) => {
    const { host, el } = await page({ v: 1 });
    expect(() => el.createState("writable", (s: any) => s[name])).toThrow(/\[wcs\/name-alias\]/);
    host.remove();
  });

  it.each([
    ["$updatedCallback", { $updatedCallback() {} }, "[wcs/declaration-alias]"],
    ["$streams", { $streams: {} }, "[wcs/declaration-alias]"],
    ["$scan", { $scan: {} }, "$scan was removed (use $watch or $on)"],
  ])("宣言キー %s は state の読み込みで投げる", async (_name, decl, code) => {
    expect(await init({ v: 1, ...decl })).toContain(code);
  });

  it("値が undefined の $scan・$updatedCallback・$streams は投げない（3.5 も警告しない）", async () => {
    expect(await init({ v: 1, $scan: undefined, $updatedCallback: undefined, $streams: undefined })).toBe("ok");
  });

  it.each([
    [{ debug: false }],
    [{ commentTextPrefix: "wcs-text" }],
    [{ enablePropagationContext: false }],
    [{ enableMustache: false }],
    [{ sameValueGuard: false }],
    [{ enableDirectionalInitialSync: true }],
    [{ foo: 1 }],
    [{ locale: 5 }],
    [{ bindAttributeName: null }],
    [{ tagNames: [] }],
    [{ tagNames: "x-state" }],
    [{ enableContractAnalyzer: "yes" }],
    [{ tagNames: { state: 5 } }],
    [{ tagNames: { other: "x-other" } }],
  ])("bootstrapState(%j) は投げ、何も当てない", (options) => {
    const before = JSON.stringify(config);
    expect(() => bootstrapState(options as any)).toThrow(/\[@wcstack\/state\]/);
    // nothing applied
    expect(JSON.stringify(config)).toBe(before);
  });

  it("4.0 が受け取る設定と undefined の値は投げない", () => {
    expect(() => bootstrapState({
      bindAttributeName: "data-wcs",
      tagNames: { state: "wcs-state", ssr: "wcs-ssr" },
      enableContractAnalyzer: false,
      debug: undefined,
      enableMustache: undefined,
    } as any)).not.toThrow();
  });

  it("$behavior へ移った 3 つは state の $behavior で効く（sameValueGuard: false は同じ値の書き込みでも描き直す）", async () => {
    let renders = 0;
    const { host, write } = await page(
      { a: 1, $behavior: { sameValueGuard: false }, $renderedCallback() { renders++; } },
      `<span data-wcs="textContent: a"></span>`,
    );
    const before = renders;
    await write((s) => { s.a = 1; });
    expect(renders).toBeGreaterThan(before);
    host.remove();
  });

  it("$behavior: { enableMustache: false } は {{ }} を束ねない", async () => {
    const { host, root } = await page({ a: 1, $behavior: { enableMustache: false } }, `<p>{{ a }}</p>`);
    expect(root.querySelector("p")!.textContent).toBe("{{ a }}");
    host.remove();
  });

  it.each([
    [{ $behavior: true }],
    // (3.5 does not warn on these two: its check takes null for no $behavior and an array for an object)
    [{ $behavior: null }],
    [{ $behavior: [] }],
    [{ $behavior: { mustache: false } }],
    [{ $behavior: { enableMustache: "false" } }],
    [{ $features: "temporal" }],
    [{ $features: ["temporal", "watch"] }],
    [{ $features: null }],
  ])("4.0 が投げる宣言 %j は state の読み込みで投げる", async (decl) => {
    expect(await init({ v: 1, ...decl })).not.toBe("ok");
  });

  it("投げない $behavior / $features（3.5 も警告しない）: 既定と同じ値・{}・後付けの名前の配列・[]", async () => {
    for (const decl of [
      { $behavior: { enableMustache: true, sameValueGuard: true, enableDirectionalInitialSync: true } },
      { $behavior: {} },
      { $features: ["temporal"] },
      { $features: [] },
    ]) {
      expect(await init({ v: 1, ...decl })).toBe("ok");
    }
  });

  describe("4.0 が接ぎ木しないボリューム（警告は「4.0 does not graft」）", () => {
    async function mountVolume(volumeState: Record<string, any>, volumeBind = "") {
      const host = document.createElement(`r35-volume-${seq++}`);
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML =
        `<wcs-state mount="settings"${volumeBind ? ` data-wcs="${volumeBind}"` : ""}></wcs-state>` +
        `<wcs-state json='{"count":1,"settings2":{"tax":0.1}}'></wcs-state>`;
      document.body.appendChild(host);
      const volume = root.querySelector("wcs-state[mount]") as any;
      const rootEl = root.querySelector("wcs-state:not([mount])") as any;
      volume.setInitialState(volumeState);
      const volumeSettled = await settle(volume.connectedCallbackPromise);
      const rootSettled = await settle(rootEl.connectedCallbackPromise);
      await flush();
      let settings: unknown = "(threw)";
      try {
        rootEl.createState("readonly", (s: any) => { settings = s.settings; });
      } catch {
        // not grafted: the path is not on the tree
      }
      return { host, volumeSettled, rootSettled, settings };
    }

    it.each([
      ["$watch", { $watch: { theme() {} } }],
      ["$listKeys", { rows: [{ id: 1 }], $listKeys: { rows: "id" } }],
      ["$renderedCallback", { $renderedCallback() {} }],
      ["$behavior", { $behavior: { sameValueGuard: false } }],
      ["$features", { $features: ["temporal"] }],
    ])("%s を宣言するボリュームは接ぎ木せず console.error で報告し、connectedCallbackPromise は解決する", async (_name, decl) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { host, volumeSettled, rootSettled, settings } = await mountVolume({ theme: "dark", ...decl });
        expect(volumeSettled).toBe("resolved");
        expect(rootSettled).toBe("resolved");
        expect(error).toHaveBeenCalled();
        expect(settings).not.toEqual(expect.objectContaining({ theme: "dark" }));
        host.remove();
      } finally {
        error.mockRestore();
      }
    });

    it("ルートのパスを注入するボリューム（data-wcs=\"state.tax: settings2.tax\"）は接ぎ木せず console.error で報告する", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { host, volumeSettled, settings } = await mountVolume({ theme: "dark" }, "state.tax: settings2.tax");
        expect(volumeSettled).toBe("resolved");
        expect(error).toHaveBeenCalled();
        expect(settings).not.toEqual(expect.objectContaining({ theme: "dark" }));
        host.remove();
      } finally {
        error.mockRestore();
      }
    });

    it("（対照）どれも宣言しない（または undefined の）ボリュームは接ぎ木される", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { host, settings } = await mountVolume({ theme: "light", $behavior: undefined, $watch: undefined });
        expect(settings).toEqual(expect.objectContaining({ theme: "light" }));
        expect(error).not.toHaveBeenCalled();
        host.remove();
      } finally {
        error.mockRestore();
      }
    });
  });
});
