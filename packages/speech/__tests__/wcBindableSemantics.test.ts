import { describe, it, expect } from "vitest";
import { SpeakCore } from "../src/core/SpeakCore";
import { ListenCore } from "../src/core/ListenCore";

/**
 * wc-bindable の observation semantics 宣言を固定する。
 * 分類の正本は docs/architecture-hardening/12-wc-bindable-observable-inventory.md。
 * `state` は現状あえて未注釈（未指定 = 読み手は現行動作を維持する）。
 */
describe("speech の wc-bindable semantics", () => {
  const namesWith = (
    properties: readonly { name: string; semantics?: string }[],
    semantics: string,
  ): string[] =>
    properties
      .filter((p) => p.semantics === semantics)
      .map((p) => p.name)
      .sort();

  it("boundary 由来の 2 property は event（発生順に意味がある）", () => {
    expect(namesWith(SpeakCore.wcBindable.properties, "event")).toEqual(["charIndex", "spokenWord"]);
  });

  it("recognition の result は event（guard 無しで毎回発火する）", () => {
    expect(namesWith(ListenCore.wcBindable.properties, "event")).toEqual(["result"]);
  });

  it("handle に分類する property は無い", () => {
    expect(namesWith(SpeakCore.wcBindable.properties, "handle")).toEqual([]);
    expect(namesWith(ListenCore.wcBindable.properties, "handle")).toEqual([]);
  });
});
