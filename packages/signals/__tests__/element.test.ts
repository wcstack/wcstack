import { describe, it, expect, vi } from "vitest";
import { SignalsElement, h } from "../src/dom.js";
import { signal, flushSync, WriteSignal } from "../src/reactive.js";

// A real custom element built on the signals lifecycle base. Its render() reads a
// signal; `renderRuns` lets us observe when reactive bindings are alive vs torn
// down across connect/disconnect.
let renderProbe = 0;

class CounterElement extends SignalsElement {
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
});
