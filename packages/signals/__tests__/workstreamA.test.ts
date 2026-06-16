import { describe, it, expect } from "vitest";
import { DisposedError, isDisposedError, bindNode, WcBindableDescriptor } from "../src/exports.js";
import { h } from "../src/dom.js";
import { signal, flushSync } from "../src/reactive.js";

// --- A2: DisposedError / isDisposedError を公開 export 経由で検証 -----------------

class DisposableNode extends EventTarget {
  static wcBindable: WcBindableDescriptor = {
    properties: [{ name: "value", event: "dn:value" }],
    inputs: [{ name: "url" }],
    commands: [{ name: "run" }],
  };
  url = "";
  run(): void {}
}

describe("A2: DisposedError / isDisposedError（公開 API）", () => {
  it("dispose 後の操作で投げる error は isDisposedError === true / instanceof DisposedError", () => {
    const node = new DisposableNode();
    const bound = bindNode(node, DisposableNode.wcBindable);
    bound.dispose();
    let err: unknown;
    try {
      bound.set("url", "/x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DisposedError);
    expect(isDisposedError(err)).toBe(true);
  });

  it("dispose 由来でない error は isDisposedError === false", () => {
    expect(isDisposedError(new Error("plain"))).toBe(false);
    expect(isDisposedError(null)).toBe(false);
    expect(isDisposedError("str")).toBe(false);
    expect(isDisposedError({})).toBe(false);
  });

  it("command の dispose 後例外も DisposedError として判別できる", () => {
    const node = new DisposableNode();
    const bound = bindNode(node, DisposableNode.wcBindable);
    bound.dispose();
    let err: unknown;
    try {
      bound.command("run");
    } catch (e) {
      err = e;
    }
    expect(isDisposedError(err)).toBe(true);
  });
});

// --- A3: 単一テキスト in-place 更新の fast-path -------------------------------

describe("A3: insertReactive 単一テキスト fast-path", () => {
  it("文字列 thunk の更新で Text ノードが再生成されず textContent だけ変わる", () => {
    const n = signal(0);
    const el = h("div", null, () => `count: ${n.get()}`) as HTMLElement;
    const firstText = el.firstChild as Text;
    expect(firstText.nodeType).toBe(3);
    expect(firstText.data).toBe("count: 0");

    n.set(5);
    flushSync();
    // 同一ノードが保持され、data だけ更新される（remove+createTextNode しない）。
    expect(el.firstChild).toBe(firstText);
    expect(firstText.data).toBe("count: 5");
  });

  it("数値 thunk でも同一 Text ノードを使い回す", () => {
    const n = signal(1);
    const el = h("div", null, () => n.get()) as HTMLElement;
    const firstText = el.firstChild as Text;
    expect(firstText.data).toBe("1");
    n.set(2);
    flushSync();
    expect(el.firstChild).toBe(firstText);
    expect(firstText.data).toBe("2");
  });

  it("fast-path に乗らない child で anchor 脱落後の更新は安全に no-op（host null 経路）", () => {
    // child が Node を返すので単一テキスト fast-path には乗らず、全 remove+insert 経路。
    const v = signal(0);
    const el = h("div", null, () => h("span", null, `v${v.get()}`)) as HTMLElement;
    expect(el.textContent).toBe("v0");
    el.textContent = ""; // anchor コメントごと全 child を除去
    v.set(1); // effect 再実行時 anchor.parentNode は null
    flushSync();
    expect(el.textContent).toBe(""); // 例外なく no-op
  });

  it("Text→Node→Text の遷移ではノードを差し替える（fast-path に乗らない経路）", () => {
    const v = signal<unknown>("hi");
    const el = h("div", null, () => v.get()) as HTMLElement;
    const firstText = el.firstChild as Text;
    expect(firstText.data).toBe("hi");

    // 次が Node（span）になる → 全 remove + insert 経路
    const span = h("span", null, "S");
    v.set(span);
    flushSync();
    expect(el.firstChild).toBe(span);

    // 再び文字列に戻る → current は単一 Text ではない（span）ので再生成
    v.set("back");
    flushSync();
    expect(el.textContent).toBe("back");
    expect((el.firstChild as Text).nodeType).toBe(3);
    expect(el.firstChild).not.toBe(firstText);
  });
});

// --- A4: isSettableProperty のメモ化 ----------------------------------------

describe("A4: isSettableProperty メモ化後も正しく判定する", () => {
  it("書き込み可能な DOM プロパティはプロパティ代入（id/value）", () => {
    const a = h("input", { id: "x", value: "v" }) as HTMLInputElement;
    expect(a.id).toBe("x");
    expect(a.value).toBe("v");
    // 同じプロトタイプの 2 つ目もキャッシュ経由で同じ判定になる。
    const b = h("input", { id: "y", value: "w" }) as HTMLInputElement;
    expect(b.id).toBe("y");
    expect(b.value).toBe("w");
  });

  it("read-only メンバーは属性経路へフォールバックする（キャッシュしても誤検知しない）", () => {
    // childNodes は read-only。プロパティ代入されず属性経路に落ちる。
    const el = h("div", { childNodes: "nope" }) as HTMLElement;
    expect(el.getAttribute("childNodes")).toBe("nope");
    // 2 つ目も同じ（キャッシュ経由）。
    const el2 = h("div", { childNodes: "again" }) as HTMLElement;
    expect(el2.getAttribute("childNodes")).toBe("again");
  });

  it("メモ化されても reactive 更新で正しくプロパティが書き換わる", () => {
    const id = signal("one");
    const el = h("div", { id: () => id.get() }) as HTMLElement;
    expect(el.id).toBe("one");
    id.set("two");
    flushSync();
    expect(el.id).toBe("two");
  });
});
