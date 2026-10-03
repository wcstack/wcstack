/**
 * Parser-level expectations that lived in other packages/state test files. Each block names
 * its origin. Where the original fed the parser through another function (the loop-relative
 * shorthand expander, `readVolumeInjections`), the parser is called directly with the string
 * that function passed on; the parts that need that function or filter resolution are dropped.
 */
import { describe, it, expect } from "vitest";
import { LINT_HINT } from "../src/diagnostics/guidance";
import { parseBindTextsForElement } from "../src/parser/parseBindTextsForElement";
import { parseFilters } from "../src/parser/parseFilters";
import { installFeatures } from "../src/hooks";
import { diagnostics } from "../src/features/diagnostics";

// messages as the full bundle shows them: the diagnostics add-on appends the guidance
installFeatures([diagnostics]);

describe("errorGuidance.test.ts — 構造型の単独バインディング違反", () => {
  it("構造型の単独バインディング違反: [wcs/template-syntax] + 正しい形 + lint 誘導", () => {
    let message = "";
    try {
      parseBindTextsForElement("for: items; textContent: a");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("[wcs/template-syntax]");
    expect(message).toContain('<template data-wcs="for: items">');
    expect(message).toContain(LINT_HINT);
  });
});

describe("integration.volumeInjection.test.ts — 空のキー", () => {
  it("空のキー（`state.:`）は解析の段の左辺検査で落ちること", () => {
    // original: readVolumeInjections("state.: settings.a", "cart"), which wraps this parser error
    expect(() => parseBindTextsForElement("state.: settings.a"))
      .toThrow(/\[wcs\/binding-syntax\] "state\.": the left side of a binding must name a property/);
  });
});

describe("structural.expandShorthandPaths.test.ts — 展開後の文字列がパーサを通ること", () => {
  it("@ 入り相対パスの展開結果はパース時に移行ヒント付き parse error になること", () => {
    // original: expandShorthandInBindAttribute('textContent: .name@cart', 'users')
    const expanded = 'textContent: users.*.name@cart';
    expect(() => parseBindTextsForElement(expanded)).toThrow(/removed in v2/);
    expect(() => parseBindTextsForElement(expanded)).toThrow(/mount/);
  });

  it("展開後がパーサを通ること（走査の規準が正本と一致していること）", () => {
    // original: expandShorthandInBindAttribute("value|defaults('00:00'): .startTime", 'items')
    const expanded = "value|defaults('00:00'): items.*.startTime";
    const [parsed] = parseBindTextsForElement(expanded);
    expect(parsed.statePathName).toBe('items.*.startTime');
    expect(parsed.inFilters[0].filterName).toBe('defaults');
    expect(parsed.inFilters[0].args).toEqual(['00:00']);
  });

  it("パーサは短縮形を展開しないこと（展開はエンジンの仕事）", () => {
    const [parsed] = parseBindTextsForElement("value|defaults('00:00'): .startTime");
    expect(parsed.statePathName).toBe('.startTime');
  });
});

describe("integration.filterUnit.test.ts — 引数の中の `:`", () => {
  it("左辺の入力フィルタ引数の中の `:` も区切りにならないこと", () => {
    const [result] = parseBindTextsForElement("value|defaults(':'): path");
    expect(result.propName).toBe("value");
    expect(result.statePathName).toBe("path");
    expect(result.inFilters[0]).toMatchObject({ filterName: "defaults", args: [":"] });
  });
});

describe("core.filterRegistry.test.ts — 解析は落とさない", () => {
  it("未知の名前も解析は落とさず、名前と引数だけを返すこと", () => {
    const parsed = parseFilters(["uc"], "output");
    expect(parsed).toEqual([{ filterName: "uc", args: [], literals: [] }]);
    // (dropped: `planFilters(parsed, "output")` throws filter-unknown — resolution is the engine's)
  });
});
