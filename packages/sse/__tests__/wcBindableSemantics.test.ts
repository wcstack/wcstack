import { describe, it, expect } from "vitest";
import { SseCore } from "../src/core/SseCore";

/**
 * wc-bindable の observation semantics 宣言を固定する。
 * 分類の正本は docs/architecture-hardening/12-wc-bindable-observable-inventory.md。
 * `state` は現状あえて未注釈（未指定 = 読み手は現行動作を維持する）。
 */
describe("SseCore の wc-bindable semantics", () => {
  const namesWith = (semantics: string): string[] =>
    SseCore.wcBindable.properties
      .filter((p) => p.semantics === semantics)
      .map((p) => p.name)
      .sort();

  it("event に分類するのは message のみ（同一 payload でも別 occurrence）", () => {
    expect(namesWith("event")).toEqual(["message"]);
  });

  it("handle に分類する property は無い", () => {
    expect(namesWith("handle")).toEqual([]);
  });
});
