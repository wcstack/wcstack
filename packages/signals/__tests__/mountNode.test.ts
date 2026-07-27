import { describe, it, expect, vi, expectTypeOf } from "vitest";
import { mountNode } from "../src/dom.js";
import { DisposedError } from "../src/bindNode.js";
import type { WcBindableDescriptor, NodeShape } from "../src/bindNode.js";
import type { ReadSignal } from "../src/reactive.js";

// 実 custom element（happy-dom）で「生成 → 属性 → 束縛 → 接続」の順序契約を検証する。
// connectedCallback が (1) その時点で見えている属性を記録し (2) 即イベントを発火する
// 形にすることで、「属性は接続前に設定済み」「購読は接続より先」を直接証明できる。
class FakeIoElement extends HTMLElement {
  static wcBindable: WcBindableDescriptor = {
    properties: [
      { name: "value", event: "fake:change", getter: (e: Event) => (e as CustomEvent).detail },
    ],
    inputs: [{ name: "url" }],
    commands: [{ name: "run" }],
  };

  url = "";
  ran: string[] = [];
  connectedAttrs: Record<string, string | null> = {};

  connectedCallback(): void {
    this.connectedAttrs = {
      timeout: this.getAttribute("timeout"),
      raw: this.getAttribute("raw"),
      manual: this.getAttribute("manual"),
      tags: this.getAttribute("tags"),
    };
    this.dispatchEvent(new CustomEvent("fake:change", { detail: "connected" }));
  }

  run(): void {
    this.ran.push(this.url);
  }
}
customElements.define("fake-io", FakeIoElement);

describe("mountNode", () => {
  it("未定義タグは descriptor 無しでは原因の分かる Error を投げる（bindNode の汎用エラーではなく）", () => {
    expect(() => mountNode("never-defined-io")).toThrow(/"<never-defined-io>" is not defined/);
    // 誘導（import 順序・whenDefined・descriptor 逃げ道）がメッセージに含まれる
    expect(() => mountNode("never-defined-io")).toThrow(/whenDefined\("never-defined-io"\)/);
  });

  it("定義済みタグを生成して document.body に接続し、BoundNode サーフェスが機能する", () => {
    const m = mountNode("fake-io");
    try {
      const el = m.el as FakeIoElement;
      expect(el).toBeInstanceOf(FakeIoElement); // 生成時点で upgrade 済み
      expect(el.parentNode).toBe(document.body);
      m.set("url", "/api/x");
      m.command("run");
      expect(el.ran).toEqual(["/api/x"]);
    } finally {
      m.unmount();
    }
  });

  it("connectedCallback で発火したイベントを取りこぼさない（束縛が接続より先）", () => {
    const m = mountNode("fake-io");
    try {
      expect(m.signals.value.peek()).toBe("connected");
    } finally {
      m.unmount();
    }
  });

  it("attrs は接続前に設定される（true=空属性・false=属性なし・数値は文字列化）", () => {
    const m = mountNode("fake-io", {
      attrs: { timeout: 5000, raw: true, manual: false, tags: "a,b" },
    });
    try {
      const el = m.el as FakeIoElement;
      // connectedCallback 時点のスナップショットに反映済み = 接続より先に設定された
      expect(el.connectedAttrs).toEqual({ timeout: "5000", raw: "", manual: null, tags: "a,b" });
      expect(el.hasAttribute("manual")).toBe(false);
    } finally {
      m.unmount();
    }
  });

  it("parent 指定でその親に接続する", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const m = mountNode("fake-io", { parent: host });
    try {
      expect(m.el.parentNode).toBe(host);
    } finally {
      m.unmount();
      host.remove();
    }
  });

  it("descriptor 明示で非 custom element タグにも束縛できる（定義チェックはスキップ）", () => {
    const descriptor: WcBindableDescriptor = {
      properties: [
        { name: "x", event: "x:changed", getter: (e: Event) => (e as CustomEvent).detail },
      ],
    };
    const m = mountNode("div", { descriptor });
    try {
      m.el.dispatchEvent(new CustomEvent("x:changed", { detail: 7 }));
      expect(m.signals.x.peek()).toBe(7);
    } finally {
      m.unmount();
    }
  });

  it("大文字・混在ケースのタグ名も定義済みとして扱う（el.tagName 経由の入力）", () => {
    // レジストリは exact-key・createElement は ASCII 小文字化するので、正規化しないと
    // 「定義済みなのに not defined」と誤診する。HTML 文書の el.tagName は大文字。
    const m = mountNode("FAKE-IO");
    try {
      expect(m.el).toBeInstanceOf(FakeIoElement);
      expect(m.signals.value.peek()).toBe("connected");
    } finally {
      m.unmount();
    }
  });

  it("dispose は unmount のエイリアス（部分 teardown で要素と IO を残さない）", () => {
    const m = mountNode("fake-io");
    const el = m.el;
    m.dispose();
    expect(el.parentNode).toBeNull(); // アダプタだけでなく要素も除去される
    expect(() => m.command("run")).toThrow(DisposedError);
    expect(() => m.dispose()).not.toThrow(); // 冪等
  });

  it("unmount は要素を除去しアダプタを inert にする（冪等）", () => {
    const m = mountNode("fake-io");
    const el = m.el;
    m.unmount();
    expect(el.parentNode).toBeNull();
    expect(() => m.command("run")).toThrow(DisposedError);
    // dispose 済み: イベントが来てもシグナルは更新されない
    el.dispatchEvent(new CustomEvent("fake:change", { detail: "late" }));
    expect(m.signals.value.peek()).toBe("connected");
    expect(() => m.unmount()).not.toThrow(); // 冪等
  });

  it("NodeShape 型引数で MountedNode 全体が型付けされる", () => {
    interface Shape extends NodeShape {
      signals: { value: string };
      inputs: { url: string };
      commands: { run: () => void };
    }
    const m = mountNode<Shape>("fake-io");
    try {
      expectTypeOf(m.signals.value).toEqualTypeOf<ReadSignal<string>>();
      m.set("url", "/typed");
      m.command("run");
    } finally {
      m.unmount();
    }
  });

  it("document 不在の環境では分かりやすい Error（./dom は非 DOM 環境でも評価できる契約）", () => {
    vi.stubGlobal("document", undefined);
    try {
      expect(() => mountNode("fake-io")).toThrow(/mountNode requires a DOM/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("customElements 不在の環境でも同じく分かりやすい Error", () => {
    vi.stubGlobal("customElements", undefined);
    try {
      expect(() => mountNode("fake-io")).toThrow(/mountNode requires a DOM/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
