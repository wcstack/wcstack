/**
 * manifest.test.ts — 単一正本マニフェスト（route-a A2-1）のドリフト検出。
 *
 * - 実装（builtinFilters）から自動導出されることを保証。
 * - golden（vscode-wcs と同期すべき正準リスト）と一致することを保証＝フィルタ増減で CI が落ち、
 *   vscode-wcs の手リスト（completionData.ts BUILTIN_FILTERS）同期忘れを構造的に防ぐ。
 */
import { describe, it, expect } from "vitest";
import { getWcsManifest, WCS_MANIFEST_VERSION } from "../src/manifest";
import { outputBuiltinFilters } from "../src/filters/builtinFilters";
import { builtinFilterMeta } from "../src/filters/filterMeta";

describe("wcs-manifest（単一正本・A2-1）", () => {
  it("filters は実装（builtinFilters のキー）から自動導出される＝実装が唯一の正本", () => {
    expect(getWcsManifest().filters).toEqual(Object.keys(outputBuiltinFilters));
  });

  it("filters の golden（変更時は vscode-wcs の BUILTIN_FILTERS も必ず同期すること）", () => {
    // ★ このリストを変える＝フィルタを増減した、ということ。
    //   その場合は packages/vscode-wcs/src/service/completionData.ts の BUILTIN_FILTERS も
    //   同じ増減を反映すること（将来はこの manifest を import して手リストを撤去する）。
    expect(getWcsManifest().filters).toEqual([
      "eq", "ne", "not",
      "lt", "le", "gt", "ge",
      "inc", "dec", "mul", "div", "mod",
      "fix", "locale", "uc", "lc", "cap", "trim", "slice", "substr", "pad", "rep", "rev",
      "int", "float", "round", "floor", "ceil", "percent",
      "date", "time", "datetime", "ymd",
      "falsy", "truthy", "defaults",
      "boolean", "number", "string", "null",
    ]);
  });

  it("filterMeta は全フィルタを過不足なくカバーする（meta 書き忘れ・余剰を検出）", () => {
    // キー集合が builtinFilters と完全一致＝フィルタ追加時に meta 書き忘れると CI が落ちる。
    expect(Object.keys(builtinFilterMeta).sort()).toEqual(Object.keys(outputBuiltinFilters).sort());
    // manifest からも同じ meta が引ける。
    expect(getWcsManifest().filterMeta).toBe(builtinFilterMeta);
  });

  it("filterMeta の各エントリが妥当（minArgs<=maxArgs・hasArgs整合・argTypes長一致）", () => {
    for (const [name, m] of Object.entries(builtinFilterMeta)) {
      expect(m.minArgs, name).toBeLessThanOrEqual(m.maxArgs);
      expect(m.hasArgs, name).toBe(m.maxArgs > 0);
      if (m.argTypes) {
        expect(m.argTypes.length, name).toBe(m.maxArgs);
      }
    }
  });

  it("構文・予約名が config / define から導出される", () => {
    const m = getWcsManifest();
    expect(m.version).toBe(WCS_MANIFEST_VERSION);
    expect(m.syntax.bindAttribute).toBe("data-wcs");
    expect(m.syntax.tagName).toBe("wcs-state");
    expect(m.syntax.pathDelimiter).toBe(".");
    expect(m.syntax.wildcard).toBe("*");
    expect(m.syntax.delimiters).toEqual({
      binding: ";",
      propValue: ":",
      modifier: "#",
      stateName: "@",
      filter: "|",
    });
    expect([...m.syntax.structuralDirectives].sort()).toEqual(["else", "elseif", "for", "if"]);
    expect(m.reservedLifecycle).toContain("$connectedCallback");
    expect(m.reservedLifecycle).toContain("$updatedCallback");
    expect(m.reservedStateApi).toContain("$commandTokens");
    expect(m.reservedStateApi).toContain("$on");
  });
});
