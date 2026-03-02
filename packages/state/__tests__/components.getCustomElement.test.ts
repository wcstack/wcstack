import { describe, it, expect } from "vitest";
import { getCustomElement } from "../src/getCustomElement";

describe("getCustomElement", () => {
  it("ハイフン付きタグ名の要素に対してタグ名を返す", () => {
    const el = document.createElement("my-component");
    expect(getCustomElement(el)).toBe("my-component");
  });

  it("ハイフンを含む'is'属性を持つ要素に対してis属性値を返す", () => {
    const el = document.createElement("div");
    el.setAttribute("is", "my-div");
    expect(getCustomElement(el)).toBe("my-div");
  });

  it("is属性のキャッシュが正しく動作する", () => {
    const el = document.createElement("p");
    el.setAttribute("is", "fancy-paragraph");
    expect(getCustomElement(el)).toBe("fancy-paragraph");
    expect(getCustomElement(el)).toBe("fancy-paragraph");
  });

  it("ハイフン付きタグにis属性がある場合はタグ名が優先される", () => {
    const el = document.createElement("my-element");
    el.setAttribute("is", "other-name");
    expect(getCustomElement(el)).toBe("my-element");
  });

  it("複数のハイフンを含むis属性値をそのまま返す", () => {
    const el = document.createElement("div");
    el.setAttribute("is", "my-custom-button");
    expect(getCustomElement(el)).toBe("my-custom-button");
  });

  it("ハイフンを含まない'is'属性を持つ要素に対してnullを返す", () => {
    const el = document.createElement("div");
    el.setAttribute("is", "special");
    expect(getCustomElement(el)).toBeNull();
  });

  it("ハイフンを含まないis属性のnullキャッシュが正しく動作する", () => {
    const el = document.createElement("span");
    el.setAttribute("is", "enhanced");
    expect(getCustomElement(el)).toBeNull();
    expect(getCustomElement(el)).toBeNull();
  });

  it("ハイフンなしの標準要素に対してnullを返す", () => {
    const el = document.createElement("div");
    expect(getCustomElement(el)).toBeNull();
  });

  it("非要素ノード（テキストノード）に対してnullを返す", () => {
    const text = document.createTextNode("hello");
    expect(getCustomElement(text)).toBeNull();
  });

  it("2回目の呼び出しでキャッシュされた値を返す", () => {
    const el = document.createElement("my-widget");
    expect(getCustomElement(el)).toBe("my-widget");
    // second call should hit cache
    expect(getCustomElement(el)).toBe("my-widget");
  });

  it("2回目の呼び出しでキャッシュされたnullを返す", () => {
    const el = document.createElement("span");
    expect(getCustomElement(el)).toBeNull();
    expect(getCustomElement(el)).toBeNull();
  });

  it("try内で例外が発生した場合nullをキャッシュする", () => {
    // Create a node whose nodeType is ELEMENT_NODE but tagName throws
    const fakeNode = {
      nodeType: Node.ELEMENT_NODE,
      get tagName(): string {
        throw new Error("tagName error");
      },
    } as unknown as Node;
    expect(() => getCustomElement(fakeNode)).toThrow("tagName error");
    // After the throw, value was null so finally cached null
    // Second call hits cache and returns null
    expect(getCustomElement(fakeNode)).toBeNull();
  });
});
