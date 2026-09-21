import { describe, it, expect } from "vitest";
import { clearFilterResolutionCache, knownFilterNames, registerFilters, resolveFilterFn } from "../src/core/filterRegistry";
import { planFilters } from "../src/bindings/planFilters";
import { parseFilters } from "../src/bindTextParser/parseFilters";

/**
 * フィルタ実関数の登録簿（core/filterRegistry.ts、要件 D16）の境界。
 * このファイルは `features/formats` を install しない（＝ 書式フィルタを入れないページ）。
 */
describe("core/filterRegistry — formats 未 install", () => {
  it("エンジンが差し込む not は core が答えること", () => {
    expect(resolveFilterFn("not", [], "output")(true)).toBe(false);
    expect(knownFilterNames("output")).toContain("not");
  });

  it("書式フィルタは名指しで落ち、近い名前を示すこと", () => {
    expect(() => resolveFilterFn("uc", [], "output"))
      .toThrow(/\[wcs\/filter-unknown\] filter not found: uc/);
  });

  it("解析は落とさず、束縛計画の段で落ちること", () => {
    const parsed = parseFilters(["uc"], "output");
    expect(parsed).toEqual([{ filterName: "uc", args: [] }]);
    expect(() => planFilters(parsed, "output")).toThrow(/filter-unknown/);
  });
});

describe("core/filterRegistry — 登録と解決", () => {
  it("登録した実関数を引数つきで解決し、同じキーは同じクロージャを返すこと", () => {
    registerFilters("output", { repeat: (options) => (value: unknown) => String(value).repeat(Number(options?.[0] ?? 1)) });
    const first = resolveFilterFn("repeat", ["3"], "output");
    expect(first("ab")).toBe("ababab");
    expect(resolveFilterFn("repeat", ["3"], "output")).toBe(first);
    // 引数が違えば別の答え
    expect(resolveFilterFn("repeat", ["2"], "output")("ab")).toBe("abab");
  });

  it("入出力は別の登録簿であること", () => {
    registerFilters("input", { onlyIn: () => (value: unknown) => value });
    expect(knownFilterNames("input")).toContain("onlyIn");
    expect(knownFilterNames("output")).not.toContain("onlyIn");
    expect(() => resolveFilterFn("onlyIn", [], "output")).toThrow(/filter-unknown/);
  });

  it("解決済みの答えは解放でき、同じ挙動の新しいクロージャになること", () => {
    registerFilters("output", { twice: () => (value: unknown) => Number(value) * 2 });
    const before = resolveFilterFn("twice", [], "output");
    clearFilterResolutionCache();
    const after = resolveFilterFn("twice", [], "output");
    expect(after).not.toBe(before);
    expect(after(21)).toBe(before(21));
  });
});
