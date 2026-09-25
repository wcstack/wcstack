import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([scopes]);
  bootstrapState();
});

/** A shadow root with `html`; states handed to the <wcs-state> elements in document order. */
async function host(html: string, states: (Record<string, any> | null)[]) {
  const h = document.createElement(`scopes-test-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const els = Array.from(root.querySelectorAll("wcs-state")) as any[];
  els.forEach((el, i) => { if (states[i] != null) el.setInitialState(states[i]); });
  document.body.appendChild(h);
  await Promise.all(els.map((el) => el.connectedCallbackPromise));
  await getBindingsReady(root);
  await flush();
  const rootEl = els.find((el) => !el.hasAttribute("mount"));
  const write = async (fn: (s: any) => void) => {
    rootEl.createState("writable", fn);
    await flush();
  };
  const read = (path: string) => {
    let v: unknown;
    rootEl.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  return { h, root, els, rootEl, write, read };
}

const text = (root: ShadowRoot, sel: string) => root.querySelector(sel)!.textContent;

describe("volume <wcs-state mount>", () => {
  it("getter・メソッド・$connectedCallback の this はマウントパスに閉じ、依存も追う", async () => {
    const { root, read } = await host(
      `<wcs-state></wcs-state><wcs-state mount="i18n"></wcs-state><h1>{{ i18n.t.title }}</h1><button data-wcs="onclick: i18n.toJa">ja</button>`,
      [{}, {
        lang: "en",
        dict: { en: { title: "Hello" }, ja: { title: "こんにちは" } },
        connected: false,
        get t() { return (this as any).dict[(this as any).lang]; },
        toJa(this: any) { this.lang = "ja"; },
        $connectedCallback(this: any) { this.connected = true; },
      }],
    );
    expect(text(root, "h1")).toBe("Hello");
    expect(read("i18n.connected")).toBe(true);
    (root.querySelector("button") as HTMLElement).click();
    await flush();
    expect(text(root, "h1")).toBe("こんにちは");
    expect(read("i18n.lang")).toBe("ja");
  });

  it("根より先に置いた volume も、根ができた時点で（ページを結ぶ前に）接ぎ木される", async () => {
    const { root } = await host(
      `<wcs-state mount="cart"></wcs-state><wcs-state></wcs-state><p>{{ cart.total }}|{{ label }}</p>`,
      [{ items: [{ price: 2 }, { price: 3 }], get total() { return (this as any).$getAll("items.*.price", []).reduce((a: number, b: number) => a + b, 0); } },
        { get label() { return `total=${(this as any)["cart.total"]}`; } }],
    );
    expect(text(root, "p")).toBe("5|total=5");
  });

  it("volume の $getAll のパスはマウントパスからの相対", async () => {
    const { root, write } = await host(
      `<wcs-state></wcs-state><wcs-state mount="cart"></wcs-state><p>{{ cart.total }}</p>`,
      [{}, { items: [{ price: 2 }], get total() { return (this as any).$getAll("items.*.price", []).reduce((a: number, b: number) => a + b, 0); } }],
    );
    await write((s) => { s["cart.items"] = [{ price: 2 }, { price: 10 }]; });
    expect(text(root, "p")).toBe("12");
  });

  it.each([
    [{ $watch: {} }, "$watch is not run in a volume"],
    [{ $renderedCallback() {} }, "$renderedCallback is not run in a volume"],
    [{ $stream: {} }, "$stream is not run in a volume"],
  ])("volume で動かない宣言は、接ぎ木せずに報告し、connectedCallbackPromise は解決する（%#）", async (state, message) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { read } = await host(`<wcs-state></wcs-state><wcs-state mount="v"></wcs-state>`, [{}, { a: 1, ...state }]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(() => read("v")).toThrow("[wcs/binding-path-missing]");
    error.mockRestore();
  });

  it.each([
    [`<wcs-state mount="a.*"></wcs-state>`, "invalid mount path"],
    [`<wcs-state mount="v" data-wcs="state.k: x"></wcs-state>`, "injections"],
  ])("マウントパスの誤りと注入は報告する（%#）", async (volume, message) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await host(`<wcs-state></wcs-state>${volume}`, [{ x: 1 }, { a: 1 }]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(message));
    error.mockRestore();
  });

  it("同じパスの 2 つ目の volume と、根に既にあるキーへの volume は接ぎ木しない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { read } = await host(
      `<wcs-state></wcs-state><wcs-state mount="v"></wcs-state><wcs-state mount="v"></wcs-state><wcs-state mount="taken"></wcs-state>`,
      [{ taken: "root" }, { a: 1 }, { a: 2 }, { a: 3 }],
    );
    expect(read("v.a")).toBe(1);
    expect(read("taken")).toBe("root");
    expect(error).toHaveBeenCalledWith(expect.stringContaining('another volume already holds "v"'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('the root state already has "taken"'));
    error.mockRestore();
  });

  it("volume の再セットと、volume を持つ根の再セットは投げる", async () => {
    const { els } = await host(`<wcs-state></wcs-state><wcs-state mount="v"></wcs-state>`, [{}, { a: 1 }]);
    expect(() => els[1].setInitialState({ a: 2 })).toThrow("re-setting a volume is not supported");
    expect(() => els[0].setInitialState({})).toThrow("re-setting a root state with grafted volumes");
  });

  it("volume を含む祖先の書き換えは投げる（その下のパスは書ける）", async () => {
    const { rootEl, read, write } = await host(`<wcs-state></wcs-state><wcs-state mount="settings.cart"></wcs-state>`, [{ settings: { theme: "a" } }, { tax: 1 }]);
    expect(() => rootEl.createState("writable", (s: any) => { s.settings = {}; })).toThrow('would replace the volume grafted at "settings.cart"');
    await write((s) => { s["settings.theme"] = "b"; });
    expect(read("settings.theme")).toBe("b");
  });

  it("根の持ち物の宣言（$commandTokens など）は動かないことを警告する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await host(`<wcs-state></wcs-state><wcs-state mount="v"></wcs-state>`, [{}, { $commandTokens: ["x"] }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("$commandTokens is not run in a volume"));
    warn.mockRestore();
  });
});
