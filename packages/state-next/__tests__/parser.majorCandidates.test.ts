/**
 * Parser-level cases ported from packages/state/__tests__/semantics.majorCandidates.test.ts
 * (B1 / B2 / B3 / B4 / B5 / B9). Only the expectations on the parse result are kept; the lines
 * that resolve filter functions (`resolveFilterFn`, arity tables) or mount a DOM are dropped.
 */
import { describe, it, expect } from "vitest";
import { parseBindTextsForElement } from "../src/parser/parseBindTextsForElement";
import { parseBindTextForEmbeddedNode } from "../src/parser/parseBindTextForEmbeddedNode";

const parseOne = (text: string) => parseBindTextsForElement(text)[0];

describe("B1 引用符と区切り（3.0 で採用: 引用符の中は区切らない）", () => {
  it("区切りを含まない引用符の引数は通ること", () => {
    expect(parseOne("textContent: x|join(', ')").outFilters[0].args).toEqual([", "]);
  });

  it("引用符の中の ; と | は引数のまま、外側の区切りは効くこと", () => {
    expect(parseOne("textContent: x|join(';')").outFilters[0].args).toEqual([";"]);
    expect(parseOne("textContent: x|join('|')").outFilters[0].args).toEqual(["|"]);
    const two = parseBindTextsForElement("textContent: x|join(';'); title: y|join(\"|\")|uc");
    expect(two.map((r) => r.propName)).toEqual(["textContent", "title"]);
    expect(two[1].outFilters.map((f) => [f.filterName, f.args])).toEqual([["join", ["|"]], ["uc", []]]);
    // (dropped: `output("join", [";"])(["X", "Y"])` — filter-function resolution)
  });
});

describe("B2 不正構文の受理（3.0 で採用: 拒否して名指しで診断する）", () => {
  it("閉じていない引用符を [wcs/binding-syntax] で拒否すること", () => {
    expect(() => parseBindTextsForElement("textContent: x|join('unterminated)")).toThrow(/\[wcs\/binding-syntax\] unterminated ' quote/);
  });

  it("value#ro#wo を拒否し、1 つの修飾子の並びへ誘導すること（未知の修飾子は従来どおり通る）", () => {
    expect(() => parseBindTextsForElement("value#ro#wo: x")).toThrow(/\[wcs\/binding-syntax\] "value#ro#wo": .* write "value#ro,wo"/);
    expect(parseOne("value#ro,wo: x").propModifiers).toEqual(["ro", "wo"]);
    expect(parseOne("value#unknown: x").propModifiers).toEqual(["unknown"]);
  });

  it("空のフィルタ（x| ・ x||y ・ x|(1)）を [wcs/binding-syntax] で拒否すること", () => {
    for (const text of ["textContent: x|", "textContent: x||uc", "textContent: x|(1)"]) {
      expect(() => parseBindTextsForElement(text), text).toThrow(/\[wcs\/binding-syntax\] an empty filter/);
    }
    expect(() => parseBindTextForEmbeddedNode("count | ")).toThrow(/\[wcs\/binding-syntax\] an empty filter/);
  });

  it("else: の右辺を拒否すること", () => {
    expect(() => parseBindTextsForElement("else: ignored")).toThrow(/\[wcs\/binding-syntax\] "else: ignored": "else" takes no value/);
    expect(parseOne("else:").bindingType).toBe("else");
  });
});

describe("B3 フィルタ引数", () => {
  it("解析の段は引数をそのまま運ぶこと（文法としては正しい — 個数の検査は解決の段）", () => {
    expect(parseOne("textContent: x|join(a,b)").outFilters[0].args).toEqual(["a", "b"]);
    // (dropped: the `[wcs/filter-arity]` expectations — filter-function resolution)
  });
});

describe("B4 修飾子とバインド種別（3.0 で採用: 修飾子は種別を変えない）", () => {
  it("radio#ro: / checkbox#ro: は radio / checkbox のまま修飾子を運ぶこと", () => {
    expect(parseOne("radio: x").bindingType).toBe("radio");
    const radio = parseOne("radio#ro: x");
    expect(radio.bindingType).toBe("radio");
    expect(radio.propName).toBe("radio");
    expect(radio.propModifiers).toEqual(["ro"]);
    expect(parseOne("checkbox#ro: x").bindingType).toBe("checkbox");
  });

  it("構造ディレクティブと spread に修飾子が付いたら拒否すること", () => {
    for (const text of ["for#ro: items", "if#ro: x", "elseif#x: y", "else#x:", "...#ro: slot"]) {
      expect(() => parseBindTextsForElement(text), text).toThrow(/\[wcs\/binding-syntax\] .* takes no modifiers/);
    }
  });
});

describe("B5 on 接頭辞（現状: on で始まる名前はすべてイベント）", () => {
  it("only: / online: がイベント束縛として解釈されること", () => {
    expect(parseOne("only: x").bindingType).toBe("event");
    expect(parseOne("online: x").bindingType).toBe("event");
    expect(parseOne("onclick: x").bindingType).toBe("event");
  });
});

describe("B9 フィルタのリテラル型（3.0 で採用: 引用符の無い true / false / null / 数値は型付き）", () => {
  it("パーサが引数ごとに型付きの値を作ること", () => {
    expect(parseOne("textContent: x|eq(true)").outFilters[0].literals).toEqual([true]);
    expect(parseOne("textContent: x|eq('true')").outFilters[0].literals).toEqual(["true"]);
    expect(parseOne("textContent: x|eq(null)").outFilters[0].literals).toEqual([null]);
    expect(parseOne("textContent: x|slice(-1, 2.5)").outFilters[0].literals).toEqual([-1, 2.5]);
    expect(parseOne("textContent: x|locale(ja-JP)").outFilters[0].literals).toEqual(["ja-JP"]);
  });
});
