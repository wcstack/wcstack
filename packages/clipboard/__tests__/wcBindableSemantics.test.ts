import { describe, it, expect } from "vitest";
import { ClipboardCore } from "../src/core/ClipboardCore";

/**
 * wc-bindable の observation semantics 宣言を固定する。
 * 分類の正本は docs/architecture-hardening/12-wc-bindable-observable-inventory.md。
 * `state` は現状あえて未注釈（未指定 = 読み手は現行動作を維持する）。
 */
describe("ClipboardCore の wc-bindable semantics", () => {
  const namesWith = (semantics: string): string[] =>
    ClipboardCore.wcBindable.properties
      .filter((p) => p.semantics === semantics)
      .map((p) => p.name)
      .sort();

  it("read 結果と copy / cut / paste は event（同じ内容の再読も別 occurrence）", () => {
    expect(namesWith("event")).toEqual(["copied", "cut", "items", "pasted", "text"]);
  });

  it("handle に分類する property は無い", () => {
    expect(namesWith("handle")).toEqual([]);
  });
});
