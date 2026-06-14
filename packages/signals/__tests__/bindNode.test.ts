import { describe, it, expect } from "vitest";
import { bindNode, WcBindableDescriptor } from "../src/bindNode.js";
import { effect, flushSync } from "../src/reactive.js";

// A minimal wc-bindable-shaped node: EventTarget + properties (one with a custom
// getter reading event.detail, one read straight off the instance), one input,
// one command. Mirrors the shape of any wcstack async-IO node.
class FakeNode extends EventTarget {
  static wcBindable: WcBindableDescriptor = {
    properties: [
      { name: "value", event: "fake:response", getter: (e: Event) => (e as CustomEvent).detail },
      { name: "loading", event: "fake:loading-changed" },
    ],
    inputs: [{ name: "url" }],
    commands: [{ name: "run" }],
  };

  value: unknown = null;
  loading = false;
  url = "";
  ran: string[] = [];

  run(): void {
    this.ran.push(this.url);
    this.loading = true;
    this.dispatchEvent(new CustomEvent("fake:loading-changed"));
    this.value = `result:${this.url}`;
    this.dispatchEvent(new CustomEvent("fake:response", { detail: this.value }));
    this.loading = false;
    this.dispatchEvent(new CustomEvent("fake:loading-changed"));
  }
}

describe("bindNode", () => {
  it("properties をイベント購読でシグナル化する（getter 経由）", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    expect(bound.signals.value.peek()).toBeNull(); // 初期値はノードの現在値
    node.dispatchEvent(new CustomEvent("fake:response", { detail: "hello" }));
    expect(bound.signals.value.peek()).toBe("hello");
  });

  it("getter の無い property はインスタンスから直接読む", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    node.loading = true;
    node.dispatchEvent(new CustomEvent("fake:loading-changed"));
    expect(bound.signals.loading.peek()).toBe(true);
  });

  it("set で input を書き込める", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    bound.set("url", "/api/x");
    expect(node.url).toBe("/api/x");
  });

  it("command でメソッドを呼べる", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    bound.set("url", "/api/y");
    bound.command("run");
    expect(node.ran).toEqual(["/api/y"]);
  });

  it("descriptor 省略時は target.constructor.wcBindable を使う", () => {
    const node = new FakeNode();
    const bound = bindNode(node);
    node.dispatchEvent(new CustomEvent("fake:response", { detail: 99 }));
    expect(bound.signals.value.peek()).toBe(99);
  });

  it("descriptor が無ければ例外を投げる", () => {
    const bare = new EventTarget() as EventTarget & Record<string, any>;
    expect(() => bindNode(bare)).toThrow(/no wc-bindable descriptor/);
  });

  it("dispose 後はイベントでシグナルが更新されない", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    bound.dispose();
    node.dispatchEvent(new CustomEvent("fake:response", { detail: "after-dispose" }));
    expect(bound.signals.value.peek()).toBeNull();
  });

  it("dispose 後も set/command は node に届く（購読のみ切れる・規定挙動）", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    bound.dispose();
    // set/command は薄い転送であり購読ではないため、dispose 後も node に作用する。
    bound.set("url", "/after");
    expect(node.url).toBe("/after");
    bound.command("run");
    expect(node.ran).toEqual(["/after"]);
  });

  it("未宣言の input への set は例外を投げる", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    expect(() => bound.set("nope", 1)).toThrow(/not a declared input/);
  });

  it("未宣言の command 呼び出しは例外を投げる", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    expect(() => bound.command("nope")).toThrow(/not a declared command/);
  });

  it("宣言済みだが関数でない command は TypeError を投げる", () => {
    const node = new FakeNode() as FakeNode & Record<string, unknown>;
    const desc: WcBindableDescriptor = {
      properties: [],
      commands: [{ name: "notAFn" }],
    };
    (node as Record<string, unknown>).notAFn = 123; // 関数でない
    const bound = bindNode(node, desc);
    expect(() => bound.command("notAFn")).toThrow(TypeError);
  });

  it("購読後の再 seed で bindNode 時点のノード値を取りこぼさない", () => {
    const node = new FakeNode();
    node.loading = true; // bind 前にすでに値が立っている
    const bound = bindNode(node, FakeNode.wcBindable);
    // イベント無しでも、購読後の再 seed により現在値が反映される
    expect(bound.signals.loading.peek()).toBe(true);
  });

  it("inputs/commands を省略した descriptor でも未宣言名は弾く", () => {
    const node = new FakeNode();
    const desc: WcBindableDescriptor = { properties: [] }; // inputs/commands 無し
    const bound = bindNode(node, desc);
    expect(() => bound.set("url", "x")).toThrow(/not a declared input/);
    expect(() => bound.command("run")).toThrow(/not a declared command/);
  });

  it("シグナル → effect で DOM 更新まで通る（エンドツーエンド）", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    const el = document.createElement("div");

    effect(() => {
      el.textContent = String(bound.signals.value.get() ?? "");
    });
    flushSync();
    expect(el.textContent).toBe(""); // 初期 null

    bound.set("url", "/api/z");
    bound.command("run");
    flushSync();
    expect(el.textContent).toBe("result:/api/z");
  });
});
