import { describe, it, expect, vi } from "vitest";
import { SignalsElement, createSignalsElement, h } from "../src/dom.js";
import { signal, flushSync, effect, WriteSignal } from "../src/reactive.js";

// A real custom element built on the signals lifecycle base. Its render() reads a
// signal; `renderRuns` lets us observe when reactive bindings are alive vs torn
// down across connect/disconnect.
let renderProbe = 0;

// `createSignalsElement()` is the canonical (SSR-safe) way to obtain the base; the
// `SignalsElement` Proxy alias is exercised separately below.
const SignalsBase = createSignalsElement();

class CounterElement extends SignalsBase {
  count: WriteSignal<number> = signal(0);

  protected render(): Node {
    return h(
      "div",
      null,
      h("span", { class: "n" }, () => {
        renderProbe++;
        return String(this.count.get());
      }),
      h(
        "button",
        { onClick: () => this.count.set(this.count.peek() + 1) },
        "+",
      ),
    );
  }
}
customElements.define("wcs-counter-test", CounterElement);

function mount(): CounterElement {
  const el = document.createElement("wcs-counter-test") as CounterElement;
  document.body.appendChild(el);
  return el;
}

describe("SignalsElement: ライフサイクル", () => {
  it("connectedCallback で createRoot 配下に view を mount する", () => {
    renderProbe = 0;
    const el = mount();
    expect(el.querySelector(".n")?.textContent).toBe("0");
    el.remove();
  });

  it("接続中は signal 変化が DOM に反映される（ボタンで increment）", () => {
    const el = mount();
    const span = el.querySelector(".n")!;
    const button = el.querySelector("button")!;
    button.click();
    flushSync();
    expect(span.textContent).toBe("1");
    button.click();
    flushSync();
    expect(span.textContent).toBe("2");
    el.remove();
  });

  it("disconnectedCallback で dispose され、以降 signal 変化は反応しない", () => {
    const el = mount();
    const span = el.querySelector(".n")!;
    el.count.set(5);
    flushSync();
    expect(span.textContent).toBe("5");

    renderProbe = 0;
    el.remove(); // disconnected → root dispose、mountPoint クリア
    expect(el.children.length).toBe(0);

    el.count.set(9); // 切断後の変更
    flushSync();
    expect(renderProbe).toBe(0); // render の reactive binding はもう走らない
  });

  it("再接続すると fresh に再 mount される", () => {
    const el = mount();
    el.count.set(3);
    flushSync();
    expect(el.querySelector(".n")?.textContent).toBe("3");

    el.remove();
    expect(el.children.length).toBe(0);

    document.body.appendChild(el); // 再接続
    expect(el.querySelectorAll(".n").length).toBe(1); // 二重描画しない
    expect(el.querySelector(".n")?.textContent).toBe("3"); // signal は保持
    el.remove();
  });

  it("二重 connect は無視される（既に mount 済みなら no-op）", () => {
    const el = mount();
    el.connectedCallback(); // 明示的に再呼び出し
    expect(el.querySelectorAll(".n").length).toBe(1); // 二重 mount しない
    el.remove();
  });

  it("未 mount で disconnectedCallback を呼んでも安全", () => {
    const el = document.createElement("wcs-counter-test") as CounterElement;
    expect(() => el.disconnectedCallback()).not.toThrow();
  });

  it("render() が throw しても部分構築 effect はリークせず、後の disconnect も安全", () => {
    const probe = signal(0);
    let effectRuns = 0;
    class BrokenElement extends SignalsElement {
      protected render(): Node {
        // 先に effect を 1 つ作ってから throw する。
        effect(() => {
          effectRuns++;
          probe.get();
        });
        throw new Error("render-boom");
      }
    }
    customElements.define("wcs-broken-test", BrokenElement);

    const el = document.createElement("wcs-broken-test") as BrokenElement;
    expect(() => document.body.appendChild(el)).toThrow(/render-boom/);
    expect(effectRuns).toBe(1); // 初回のみ

    probe.set(1);
    flushSync();
    expect(effectRuns).toBe(1); // createRoot が throw 時に dispose → リークしない

    // 未 mount 扱いなので disconnect は安全に no-op
    expect(() => el.disconnectedCallback()).not.toThrow();
    el.remove();
  });
});

describe("SignalsElement: SSR/非DOM ガード（D2）", () => {
  it("createSignalsElement() は memoize され、毎回同じクラスを返す", () => {
    expect(createSignalsElement()).toBe(createSignalsElement());
  });

  it("createSignalsElement() の返すクラスは SignalsElement Proxy と同一の実体を指す", () => {
    // Proxy 経由のサブクラスと factory 経由のサブクラスが同じ基底を共有する。
    // getPrototypeOf / has / get の各トラップを併せて検証する。
    expect(Object.getPrototypeOf(SignalsElement)).toBe(Object.getPrototypeOf(createSignalsElement()));
    expect("prototype" in SignalsElement).toBe(true); // `has` トラップ
    expect((SignalsElement as unknown as { prototype: unknown }).prototype).toBe(
      createSignalsElement().prototype,
    ); // `get` トラップ
  });

  it("HTMLElement 不在の cold-start では分かりやすい Error を投げる（生の ReferenceError ではない）", async () => {
    // Re-evaluate the module with no DOM cache and no HTMLElement global so the
    // factory's guard branch runs. `vi.resetModules()` gives a fresh module instance
    // whose `cachedBase` is null; stubbing the global to undefined makes the
    // `typeof HTMLElement === "undefined"` guard fire.
    vi.resetModules();
    const g = globalThis as { HTMLElement?: unknown };
    const prev = g.HTMLElement;
    // simulate a non-DOM realm (SSR pre-pass / worker)
    delete g.HTMLElement;
    try {
      const mod = await import("../src/dom.js");
      expect(() => mod.createSignalsElement()).toThrow(/requires a DOM \(HTMLElement is not defined\)/);
      // The module itself EVALUATED fine (no top-level throw) — that is the SSR contract.
      expect(typeof mod.h).toBe("function");
    } finally {
      g.HTMLElement = prev;
      vi.resetModules();
    }
  });

  it("Proxy を直接呼び出すと（new/extends 無し）TypeError", () => {
    expect(() => (SignalsElement as unknown as () => void)()).toThrow(TypeError);
  });
});
