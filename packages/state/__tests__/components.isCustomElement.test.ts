import { describe, it, expect } from "vitest";
import { isCustomElement } from "../src/components/isCustomElement";

describe("isCustomElement", () => {
  it("returns true for elements with hyphenated tag names", () => {
    const el = document.createElement("my-component");
    expect(isCustomElement(el)).toBe(true);
  });

  it("returns true for elements with 'is' attribute containing a hyphen", () => {
    const el = document.createElement("div");
    el.setAttribute("is", "my-div");
    expect(isCustomElement(el)).toBe(true);
  });

  it("returns false for elements with 'is' attribute without a hyphen", () => {
    const el = document.createElement("div");
    el.setAttribute("is", "special");
    expect(isCustomElement(el)).toBe(false);
  });

  it("returns false for standard elements without hyphen", () => {
    const el = document.createElement("div");
    expect(isCustomElement(el)).toBe(false);
  });

  it("returns false for non-element nodes (text node)", () => {
    const text = document.createTextNode("hello");
    expect(isCustomElement(text)).toBe(false);
  });

  it("returns cached value on second call", () => {
    const el = document.createElement("my-widget");
    expect(isCustomElement(el)).toBe(true);
    // second call should hit cache
    expect(isCustomElement(el)).toBe(true);
  });

  it("returns cached false on second call", () => {
    const el = document.createElement("span");
    expect(isCustomElement(el)).toBe(false);
    expect(isCustomElement(el)).toBe(false);
  });

  it("caches false when an exception occurs inside try (value remains undefined)", () => {
    // Create a node whose nodeType is ELEMENT_NODE but tagName throws
    const fakeNode = {
      nodeType: Node.ELEMENT_NODE,
      get tagName(): string {
        throw new Error("tagName error");
      },
    } as unknown as Node;
    expect(() => isCustomElement(fakeNode)).toThrow("tagName error");
    // After the throw, value was undefined so finally cached false
    // Second call hits cache and returns false
    expect(isCustomElement(fakeNode)).toBe(false);
  });
});
