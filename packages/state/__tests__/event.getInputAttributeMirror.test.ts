import { describe, it, expect, beforeAll } from "vitest";
import {
  applyMirrorAttribute,
  getInputAttributeMirror,
} from "../src/event/getInputAttributeMirror";
import type { IWcBindable } from "../src/event/types";

function defineCustomElement(tagName: string, bindable: IWcBindable | undefined): void {
  if (customElements.get(tagName)) return;
  class C extends HTMLElement {
    static wcBindable: IWcBindable | undefined = bindable;
  }
  customElements.define(tagName, C);
}

beforeAll(() => {
  defineCustomElement("mirror-input-ok", {
    protocol: "wc-bindable",
    version: 1,
    properties: [],
    inputs: [
      { name: "data", attribute: "data" },
      { name: "labelText", attribute: "label-text" },
      { name: "noMirror" }, // attribute なし → ミラー対象外
    ],
  });
  defineCustomElement("mirror-input-no-inputs", {
    protocol: "wc-bindable",
    version: 1,
    properties: [],
  });
  defineCustomElement("mirror-input-no-bindable", undefined);
  defineCustomElement("mirror-input-bad-protocol", {
    protocol: "other" as any,
    version: 1,
    properties: [],
    inputs: [{ name: "data", attribute: "data" }],
  });
});

describe("getInputAttributeMirror", () => {
  it("inputs に attribute 宣言がある名前は属性名を返すこと", () => {
    const el = document.createElement("mirror-input-ok");
    expect(getInputAttributeMirror(el, "data")).toBe("data");
    expect(getInputAttributeMirror(el, "labelText")).toBe("label-text");
  });

  it("inputs に存在しても attribute が無ければ null", () => {
    const el = document.createElement("mirror-input-ok");
    expect(getInputAttributeMirror(el, "noMirror")).toBeNull();
  });

  it("inputs 未宣言なら null", () => {
    const el = document.createElement("mirror-input-no-inputs");
    expect(getInputAttributeMirror(el, "data")).toBeNull();
  });

  it("ネイティブ要素は null", () => {
    const el = document.createElement("div");
    expect(getInputAttributeMirror(el, "data")).toBeNull();
  });

  it("カスタム要素だが wcBindable 自体が無いと null", () => {
    const el = document.createElement("mirror-input-no-bindable");
    expect(getInputAttributeMirror(el, "data")).toBeNull();
  });

  it("protocol が不正なら null", () => {
    const el = document.createElement("mirror-input-bad-protocol");
    expect(getInputAttributeMirror(el, "data")).toBeNull();
  });

  it("未定義のカスタム要素タグは null (例外を投げないこと)", () => {
    const el = document.createElement("mirror-input-undefined-tag");
    expect(getInputAttributeMirror(el, "data")).toBeNull();
  });

  it("inputs 内の attribute が空文字なら null (有効な属性名と見なさない)", () => {
    defineCustomElement("mirror-input-empty-attr", {
      protocol: "wc-bindable",
      version: 1,
      properties: [],
      inputs: [{ name: "x", attribute: "" }],
    });
    const el = document.createElement("mirror-input-empty-attr");
    expect(getInputAttributeMirror(el, "x")).toBeNull();
  });
});

describe("applyMirrorAttribute", () => {
  it("string をそのまま属性に書くこと", () => {
    const el = document.createElement("div");
    applyMirrorAttribute(el, "data-x", "hello");
    expect(el.getAttribute("data-x")).toBe("hello");
  });

  it("number を文字列化して書くこと", () => {
    const el = document.createElement("div");
    applyMirrorAttribute(el, "data-n", 42);
    expect(el.getAttribute("data-n")).toBe("42");
  });

  it("boolean true/false を文字列化して書くこと", () => {
    const el = document.createElement("div");
    applyMirrorAttribute(el, "data-b", true);
    expect(el.getAttribute("data-b")).toBe("true");
    applyMirrorAttribute(el, "data-b", false);
    expect(el.getAttribute("data-b")).toBe("false");
  });

  it("null は属性削除", () => {
    const el = document.createElement("div");
    el.setAttribute("data-x", "old");
    applyMirrorAttribute(el, "data-x", null);
    expect(el.hasAttribute("data-x")).toBe(false);
  });

  it("undefined は属性削除", () => {
    const el = document.createElement("div");
    el.setAttribute("data-x", "old");
    applyMirrorAttribute(el, "data-x", undefined);
    expect(el.hasAttribute("data-x")).toBe(false);
  });

  it("object は JSON.stringify されて書かれること", () => {
    const el = document.createElement("div");
    applyMirrorAttribute(el, "data-obj", { a: 1, b: "x" });
    expect(el.getAttribute("data-obj")).toBe('{"a":1,"b":"x"}');
  });

  it("array は JSON.stringify されて書かれること", () => {
    const el = document.createElement("div");
    applyMirrorAttribute(el, "data-arr", [1, 2, 3]);
    expect(el.getAttribute("data-arr")).toBe("[1,2,3]");
  });

  it("循環参照オブジェクトでも例外を投げず String() にフォールバックすること", () => {
    const el = document.createElement("div");
    const a: any = { x: 1 };
    a.self = a;
    expect(() => applyMirrorAttribute(el, "data-c", a)).not.toThrow();
    // String() で "[object Object]" 相当が入る
    expect(el.getAttribute("data-c")).toBe("[object Object]");
  });
});
