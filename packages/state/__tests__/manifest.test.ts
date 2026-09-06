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
import { applyChangeByFirstSegment } from "../src/apply/applyChange";
import * as stateDefine from "../src/define";

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
      "inc", "dec", "mul", "div", "mod", "abs", "clamp",
      "fix", "locale", "uc", "lc", "cap", "trim", "slice", "substr", "pad", "rep", "rev", "truncate", "join",
      "int", "float", "round", "floor", "ceil", "percent", "unit",
      "date", "time", "datetime", "ymd", "hms",
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
      filter: "|",
    });
    expect([...m.syntax.structuralDirectives].sort()).toEqual(["else", "elseif", "for", "if"]);
    expect(m.reservedLifecycle).toContain("$connectedCallback");
    expect(m.reservedLifecycle).toContain("$updatedCallback");
    expect(m.reservedStateApi).toContain("$commandTokens");
    expect(m.reservedStateApi).toContain("$on");
    expect(m.reservedStateApi).toContain("$streams");
    expect(m.reservedStateApi).toContain("$streamStatus");
    expect(m.reservedStateApi).toContain("$streamError");
  });

  it("予約名は define.ts の `$` 定数を過不足なく網羅する（新しい予約キーの取りこぼしを検出）", () => {
    // define.ts に `$` 始まりの定数を足したら、必ず reservedLifecycle か reservedStateApi の
    // どちらかに入れること（vscode-wcs の validator もこの manifest を正本として追随する）。
    // 長さ 1 の "$" は INDEX_PARAM_PREFIX（接頭辞であり予約名ではない）なので除外する。
    const declared = Object.values(stateDefine)
      .filter((v): v is string => typeof v === "string" && v.length > 1 && v.startsWith("$"))
      .sort();
    const m = getWcsManifest();
    expect([...m.reservedLifecycle, ...m.reservedStateApi].sort()).toEqual(declared);
  });

  it("修飾子・インデックス参照・bindingType 語彙が define から導出される", () => {
    const m = getWcsManifest();
    expect(m.syntax.modifiers.flags).toEqual(["prevent", "stop", "ro"]);
    expect(m.syntax.modifiers.keyValue).toEqual(["init", "sync"]);
    // `#onchange` 等のイベント名上書き修飾子（README「Modifiers」記載の公開構文）
    expect(m.syntax.modifiers.eventNamePrefix).toBe("on");
    expect(m.syntax.indexParam).toEqual({ prefix: "$", maxDepth: 128 });
    // indexParam は $1..$N の実体（INDEX_BY_INDEX_NAME）と一致する
    expect(stateDefine.INDEX_BY_INDEX_NAME[`${m.syntax.indexParam.prefix}1`]).toBe(0);
    expect(
      stateDefine.INDEX_BY_INDEX_NAME[`${m.syntax.indexParam.prefix}${m.syntax.indexParam.maxDepth}`],
    ).toBe(m.syntax.indexParam.maxDepth - 1);
    expect(m.syntax.bindingTypes).toEqual({
      elseKeyword: "else",
      spread: "...",
      eventPropertyPrefix: "on",
      propNamespaces: {
        eventToken: "eventToken",
        command: "command",
        class: "class",
        attr: "attr",
        style: "style",
      },
    });
  });

  it("propNamespaces は apply 層のディスパッチキー集合と一致する（drift 検出）", () => {
    // manifest（DOM 非依存）は apply 層を import できないため、語彙は define.ts の定数を
    // 両者が共有し、集合の一致をこのテストが強制する。eventToken だけは listener attach
    // 経路（イベント層）で処理され applyChange を通らないため除外。
    const m = getWcsManifest();
    const { eventToken: _eventToken, ...applyNamespaces } = m.syntax.bindingTypes.propNamespaces;
    expect(Object.keys(applyChangeByFirstSegment).sort()).toEqual(Object.values(applyNamespaces).sort());
  });
});
