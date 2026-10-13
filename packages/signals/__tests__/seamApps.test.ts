import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __resetDevWarnings } from "../src/dev.js";
import { signal, effect, computed, onCleanup, createRoot } from "../src/reactive.js";
import { h, For } from "../src/dom.js";
import { bindNode } from "../src/bindNode.js";

// 継ぎ目アプリ（docs/seam-apps.md、signals-shop）で残っていたもの:
// 何も追跡しない computed / effect（開発モード）、定義前のカスタム要素へのオブジェクトの prop、
// 定義前の要素への bindNode の文言。

declare global {
  // eslint-disable-next-line no-var
  var __WCS_DEV__: boolean | undefined;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
const codes = () => warnSpy.mock.calls.map((c: unknown[]) => String(c[0]).match(/\]\[(\w+)\]/)?.[1]);

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  __resetDevWarnings();
});

afterEach(() => {
  globalThis.__WCS_DEV__ = undefined;
  warnSpy.mockRestore();
  __resetDevWarnings();
});

describe("開発モード: 最初の実行で signal を読まなかった computed / effect", () => {
  it("外で読んだ値・peek() だけの computed は UNTRACKED_COMPUTED を 1 回ずつ出す", () => {
    globalThis.__WCS_DEV__ = true;
    const query = signal("");
    const q = query.get();
    const a = computed(() => ["House Blend", "Matcha"].filter((x) => x.includes(q)));
    const b = computed(() => ["House Blend", "Matcha"].filter((x) => x.includes(query.peek())));
    a.get();
    a.get();
    b.get();
    expect(codes()).toEqual(["UNTRACKED_COMPUTED", "UNTRACKED_COMPUTED"]);
    expect(String(warnSpy.mock.calls[0][0])).toContain("never recomputes");
  });

  it("signal を読む computed と、開発モードでないときは出さない", () => {
    const query = signal("");
    computed(() => query.get()).get();
    globalThis.__WCS_DEV__ = true;
    computed(() => query.get().length).get();
    globalThis.__WCS_DEV__ = undefined;
    computed(() => 1).get();
    expect(codes()).toEqual([]);
  });

  it("peek() だけの作者の effect は UNTRACKED_EFFECT を出す。cleanup を返す・onCleanup・signal を読む effect は出さない", () => {
    globalThis.__WCS_DEV__ = true;
    const query = signal("");
    createRoot(() => {
      effect(() => { query.peek(); });
      effect(() => { query.get(); });
      effect(() => () => {});
      effect(() => { onCleanup(() => {}); });
    });
    expect(codes()).toEqual(["UNTRACKED_EFFECT"]);
    expect(String(warnSpy.mock.calls[0][0])).toContain("never runs again");
  });

  it("h() と For が作者の値のために作る effect では出さない（作者が書いていない）", () => {
    globalThis.__WCS_DEV__ = true;
    createRoot(() => {
      h("p", { title: () => "static" }, () => "static");
      For(() => [1, 2], (n) => h("li", null, String(n)));
    });
    expect(codes().filter((c: string | undefined) => c?.startsWith("UNTRACKED"))).toEqual([]);
  });
});

let tagSeq = 0;
/** A vanilla custom element with an object property behind a setter. */
function defineCard(tag: string): { seen: unknown[] } {
  const log = { seen: [] as unknown[] };
  customElements.define(tag, class extends HTMLElement {
    private _product: unknown = null;
    get product() { return this._product; }
    set product(v: unknown) { this._product = v; log.seen.push(v); }
  });
  return log;
}

/**
 * The page's case: the card's module runs after h() made the card. A browser upgrades the element in
 * place when the definition runs; happy-dom replaces a connected one instead (and leaves a detached
 * one as it is), so `define(els)` does the in-place part itself — the class's prototype — and then
 * runs the definition.
 */
function lateDefinition(tag: string): { log: { seen: unknown[] }; define: (...els: Element[]) => Promise<void> } {
  const log = { seen: [] as unknown[] };
  class Card extends HTMLElement {
    private _product: unknown = null;
    get product() { return this._product; }
    set product(v: unknown) { this._product = v; log.seen.push(v); }
  }
  return {
    log,
    define: async (...els: Element[]) => {
      for (const el of els) Object.setPrototypeOf(el, Card.prototype);
      customElements.define(tag, Card);
      await customElements.whenDefined(tag);
      await Promise.resolve();
    },
  };
}

describe("定義の前に h() が作ったカスタム要素へのオブジェクトの prop", () => {
  it("属性（[object Object]）にも own property にもせず、定義されたら setter で渡す", async () => {
    const tag = `late-card-${tagSeq++}`;
    const { log, define } = lateDefinition(tag);
    const product = { id: 3, name: "Matcha" };
    const el = h(tag, { product }) as HTMLElement & { product?: unknown };
    expect(el.hasAttribute("product")).toBe(false);
    expect(Object.hasOwn(el, "product")).toBe(false);
    expect(log.seen).toEqual([]);
    await define(el);
    expect(log.seen).toEqual([product]);
    expect(el.product).toBe(product);
    // defined: the next element gets its value through the setter at once
    const next = { id: 4 };
    h(tag, { product: next });
    expect(log.seen.at(-1)).toBe(next);
  });

  it("定義の前に値が変われば最後の値だけを渡し、プリミティブは今までどおり属性、null にすれば渡さない", async () => {
    const tag = `late-card-${tagSeq++}`;
    const { log, define } = lateDefinition(tag);
    const p = signal<unknown>({ id: 1 });
    const q = signal<unknown>({ id: 5 });
    const label = signal("a");
    let el!: HTMLElement;
    let el2!: HTMLElement;
    createRoot(() => {
      el = h(tag, { product: () => p.get(), label: () => label.get() }) as HTMLElement;
      el2 = h(tag, { product: () => q.get() }) as HTMLElement;
    });
    expect(el.getAttribute("label")).toBe("a");
    const last = { id: 2 };
    p.set(last);
    q.set(null);
    await Promise.resolve();
    await define(el, el2);
    expect(log.seen).toEqual([last]);
    // (el2 went to null before the definition: nothing is held for it, nor written as an attribute)
    expect(el2.hasAttribute("product")).toBe(false);
  });
});

describe("定義の前の要素への bindNode", () => {
  it("まだ定義されていないカスタム要素は、そう言い、読み込み方と待ち方を示す", () => {
    const tag = `wcs-not-yet-${tagSeq++}`;
    const el = document.createElement(tag);
    expect(() => bindNode(el)).toThrow(`bindNode: <${tag}> is not defined yet, so it has no wc-bindable descriptor`);
    expect(() => bindNode(el)).toThrow(/its \/auto entry, or the module that defines it\) before this code runs/);
    expect(() => bindNode(el)).toThrow(`await customElements.whenDefined("${tag}")`);
    const other = document.createElement(`my-not-yet-${tagSeq++}`);
    expect(() => bindNode(other)).toThrow(/\(or the module that defines it\)/);
  });

  it("カスタム要素でないもの・定義済みで記述子の無い要素は今までの文言", () => {
    expect(() => bindNode(document.createElement("div"))).toThrow("bindNode: no wc-bindable descriptor provided and none found on target.constructor.wcBindable");
    const tag = `plain-el-${tagSeq++}`;
    customElements.define(tag, class extends HTMLElement {});
    expect(() => bindNode(document.createElement(tag))).toThrow("none found on target.constructor.wcBindable");
  });
});


