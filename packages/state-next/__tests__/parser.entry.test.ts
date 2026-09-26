// @vitest-environment node
/**
 * Ported from packages/state/__tests__/parser.test.ts (the `@wcstack/state/parser` entry contract).
 *
 * このファイルだけ **node 環境**で実行する（先頭の @vitest-environment 指示）。
 * 「DOM 非依存・純関数」を、happy-dom 抜きで import・実行できることで構造的に証明する。
 *
 * Dropped (removed parts of the old entry):
 *   - 「クリア後の getPathInfo は新しいインスタンスを返すこと」 (getPathInfo / clearParserCaches — tooling cache)
 *   - getPathInfo（パス解析の公開契約）の 2 件 (PathInfo is not part of the port)
 *   - the `clearParserCaches()` half of 「フィルタの解析結果のキャッシュも解放されること」
 *     (the cache-identity half is kept below)
 */
import { describe, it, expect } from "vitest";
import { parseBindTextsForElement, parseBindTextForEmbeddedNode } from "../src/parser";
import { splitBindTexts } from "../src/parser/parseBindTextsForElement";
import { indexOfOutsideQuotes, splitOutsideQuotes } from "../src/parser/utils";
import { installFeatures } from "../src/hooks";
import { diagnostics } from "../src/features/diagnostics";

// the sentences are the diagnostics add-on's (the core alone gives the code and the message number)
installFeatures([diagnostics]);

describe("parseBindTextsForElement（正本パーサの公開契約）", () => {
  it("node 環境で実行されていること（@vitest-environment 指示の自己検証）", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("単純な prop バインディングをパースすること", () => {
    const [r] = parseBindTextsForElement("textContent: user.name");
    expect(r.propName).toBe("textContent");
    expect(r.propSegments).toEqual(["textContent"]);
    expect(r.statePathName).toBe("user.name");
    expect(r.bindingType).toBe("prop");
    expect(r.propModifiers).toEqual([]);
    expect(r.outFilters).toEqual([]);
  });

  it("修飾子・フィルタ列を分解し、@state は v2 の parse error になること", () => {
    const [r] = parseBindTextsForElement("value#ro: price | fix(2)");
    expect(r.propModifiers).toEqual(["ro"]);
    expect(r.outFilters).toHaveLength(1);
    expect(r.outFilters[0].filterName).toBe("fix");
    expect(r.outFilters[0].args).toEqual(["2"]);
    expect(() => parseBindTextsForElement("value: price@cart")).toThrow(/removed in v2/);
  });

  it("`;` 区切りの複数バインディングを分割すること", () => {
    const results = parseBindTextsForElement("textContent: a; class.active: b");
    expect(results).toHaveLength(2);
    expect(results[1].propSegments).toEqual(["class", "active"]);
    expect(results[1].bindingType).toBe("prop");
  });

  it("bindingType を判別すること（event / eventToken / structural / else / spread）", () => {
    expect(parseBindTextsForElement("onclick: doIt")[0].bindingType).toBe("event");
    expect(parseBindTextsForElement("eventToken.value: changed")[0].bindingType).toBe("event");
    expect(parseBindTextsForElement("for: items")[0].bindingType).toBe("for");
    expect(parseBindTextsForElement("if: cond")[0].bindingType).toBe("if");
    expect(parseBindTextsForElement("else:")[0].bindingType).toBe("else");
    expect(parseBindTextsForElement("...: fetchX")[0].bindingType).toBe("spread");
  });

  it("不正構文は位置情報なしで throw すること（診断 range は消費側の責務 = D3 の契約固定）", () => {
    expect(() => parseBindTextsForElement("noSeparator")).toThrow(/Missing ':'/);
    expect(() => parseBindTextsForElement("if: a; textContent: b")).toThrow();
    expect(() => parseBindTextsForElement("...: target | uc")).toThrow(/filters are not allowed/);
    expect(() => parseBindTextsForElement("...:")).toThrow(/target path is required/);
  });
});

describe("splitBindTexts（属性値の区切りの正本 — 要件 B1）", () => {
  it("引用符の外の ; だけで区切り、前後の空白を残すこと（tooling が位置を数えられる）", () => {
    expect(splitBindTexts("a: x; b: y|join(';') ;")).toEqual(["a: x", " b: y|join(';') ", ""]);
    expect(parseBindTextsForElement("a: x; b: y|join(';') ;").map((r) => r.propName)).toEqual(["a", "b"]);
  });
});

describe("indexOfOutsideQuotes（区切り文字探索の正本 — 要件 B1）", () => {
  it("引用符の中の区切り文字を拾わないこと", () => {
    // 引数の中の `:`（位置 16）ではなく、左辺と右辺を分ける `:`（位置 19）を返す
    expect(indexOfOutsideQuotes("value|defaults(':'): path", ":")).toBe(19);
    expect(indexOfOutsideQuotes("a|join(';')", ";")).toBe(-1);
    expect(indexOfOutsideQuotes("a|b", "|")).toBe(1);
    expect(indexOfOutsideQuotes("abc", ":")).toBe(-1);
  });

  it("splitOutsideQuotes は同じ規則で区切ること（`;` 以外の区切りも正本で切れる）", () => {
    expect(splitOutsideQuotes("a: x; b: y|join(';')", ";")).toEqual(["a: x", " b: y|join(';')"]);
    expect(splitOutsideQuotes("x|join('|')|upper", "|")).toEqual(["x", "join('|')", "upper"]);
    expect(splitOutsideQuotes("abc", ";")).toEqual(["abc"]);
    // `splitBindTexts` は区切りを `;` に固定した同じ関数
    expect(splitOutsideQuotes("a: x; b: y", ";")).toEqual(splitBindTexts("a: x; b: y"));
  });

  it("splitBindTexts と同じ判定であること（tooling が写しを持たなくて済む）", () => {
    const text = "a: x; b: y|join(';')";
    expect(text.slice(0, indexOfOutsideQuotes(text, ";"))).toBe(splitBindTexts(text)[0]);
  });
});

describe("parseBindTextForEmbeddedNode（テキストバインディングの正本経路）", () => {
  it("式全体を 1 本のパスとして扱い `;` を分割しないこと（属性経路との規定差）", () => {
    const r = parseBindTextForEmbeddedNode("count | fix(0)");
    expect(r.propName).toBe("textContent");
    expect(r.bindingType).toBe("text");
    expect(r.statePathName).toBe("count");
    expect(r.outFilters[0].filterName).toBe("fix");
    // 属性経路（parseBindTextsForElement）は `;` で無条件分割するが、埋め込み経路は
    // parseStatePart 直行 = 分割しない。`a; b` は「a; b」という 1 本のパスになる
    expect(parseBindTextForEmbeddedNode("a; b").statePathName).toBe("a; b");
  });
});

describe("フィルタの解析結果（名前と引数だけ・キャッシュ）", () => {
  it("フィルタは名前と引数だけで、実関数はパーサに現れないこと（要件 D16）", () => {
    const [parsed] = parseBindTextsForElement("textContent: price | fix(2)");
    // literals は引数の型付きの値（要件 B9）: 引用符の無い 2 は数値
    expect(parsed.outFilters).toEqual([{ filterName: "fix", args: ["2"], literals: [2] }]);
    expect("filterFn" in parsed.outFilters[0]).toBe(false);
  });

  it("同じフィルタ列は同じ解析結果（同一配列）を返すこと", () => {
    const [before] = parseBindTextsForElement("textContent: price | fix(2)");
    const [again] = parseBindTextsForElement("textContent: price | fix(2)");
    expect(again.outFilters).toBe(before.outFilters);
  });
});
