import { describe, it, expect } from "vitest";
import { makeDebounceProperties } from "../src/wcBindableFactory";

/**
 * wc-bindable の observation semantics 宣言を固定する。
 * 分類の正本は docs/architecture-hardening/12-wc-bindable-observable-inventory.md。
 * `state` は現状あえて未注釈（未指定 = 読み手は現行動作を維持する）。
 */
describe("debounce / throttle の wc-bindable semantics", () => {
  const namesWith = (prefix: string, semantics: string): string[] =>
    makeDebounceProperties(prefix)
      .filter((p) => p.semantics === semantics)
      .map((p) => p.name)
      .sort();

  it("fired は event（coalesce された発火の occurrence）", () => {
    expect(namesWith("wcs-debounce", "event")).toEqual(["fired"]);
  });

  it("throttle も同じ分類を共有する", () => {
    expect(namesWith("wcs-throttle", "event")).toEqual(["fired"]);
  });

  it("handle に分類する property は無い", () => {
    expect(namesWith("wcs-debounce", "handle")).toEqual([]);
  });
});
