// @vitest-environment node
/**
 * parser.test.ts — `@wcstack/state/parser` サブパスエントリ（src/parser.ts）の契約検証。
 *
 * このファイルだけ **node 環境**で実行する（先頭の @vitest-environment 指示）。
 * エントリの契約「DOM 非依存・純関数」を、happy-dom 抜きで import・実行できることで
 * 構造的に証明する — DOM に触る import がエントリの依存チェーンへ紛れ込むと、
 * このファイルの import 自体が落ちる。
 */
import { describe, it, expect } from "vitest";
import {
  parseBindTextsForElement,
  parseBindTextForEmbeddedNode,
  getPathInfo,
  clearParserCaches,
  splitBindTexts,
  indexOfOutsideQuotes,
} from "../src/parser";

describe("parseBindTextsForElement（正本パーサの公開契約）", () => {
  it("node 環境で実行されていること（@vitest-environment 指示の自己検証）", () => {
    // コメント形式の環境指示が将来の vitest で解釈されなくなると「DOM 非依存の
    // 構造的証明」が無言で蒸発するため、環境そのものを assert しておく。
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
    //（referenceIndex がこの差を既知乖離として文書化していた、そのランタイム実挙動）。
    expect(parseBindTextForEmbeddedNode("a; b").statePathName).toBe("a; b");
  });
});

describe("clearParserCaches（tooling 専用のキャッシュ解放）", () => {
  it("クリア後の getPathInfo は新しいインスタンスを返すこと（同一参照保証はクリアを跨がない）", () => {
    const before = getPathInfo("cache.test.path");
    expect(getPathInfo("cache.test.path")).toBe(before);
    clearParserCaches();
    const after = getPathInfo("cache.test.path");
    expect(after).not.toBe(before);
    expect(after.path).toBe(before.path);
    expect(after.cumulativePaths).toEqual(before.cumulativePaths);
  });

  it("フィルタは名前と引数だけで、実関数はパーサに現れないこと（要件 D16）", () => {
    // 解析の段は文法だけを見る。実関数は束縛計画の段で登録簿から引くので、
    // パーサだけを使う tooling は書式フィルタの実装を 1 バイトも引き込まない。
    const [parsed] = parseBindTextsForElement("textContent: price | fix(2)");
    // literals は引数の型付きの値（要件 B9）: 引用符の無い 2 は数値
    expect(parsed.outFilters).toEqual([{ filterName: "fix", args: ["2"], literals: [2] }]);
    expect("filterFn" in parsed.outFilters[0]).toBe(false);
  });

  it("フィルタの解析結果のキャッシュも解放されること", () => {
    // フィルタ列は filtersText をキーにモジュールレベルの Map へ載る。言語サーバー常駐では
    // 編集中間のフィルタ式がキーごとに蓄積するため clearParserCaches の解放対象に含まれる
    // （含まれないと intern 解放が部分解決になる）。解決済みの実関数のキャッシュは
    // 登録簿側にあり、同じ呼び出しで解放される（core.filterRegistry.test.ts）。
    const [before] = parseBindTextsForElement("textContent: price | fix(2)");
    const [again] = parseBindTextsForElement("textContent: price | fix(2)");
    expect(again.outFilters).toBe(before.outFilters);
    clearParserCaches();
    const [after] = parseBindTextsForElement("textContent: price | fix(2)");
    expect(after.outFilters).not.toBe(before.outFilters);
    // 中身は同一（クリアは意味論を変えない）
    expect(after.outFilters).toEqual(before.outFilters);
  });
});

describe("getPathInfo（パス解析の公開契約）", () => {
  it("親チェーン（cumulativePaths）とワイルドカード情報を返すこと", () => {
    const info = getPathInfo("users.*.name");
    expect(info.segments).toEqual(["users", "*", "name"]);
    expect(info.cumulativePaths).toEqual(["users", "users.*", "users.*.name"]);
    expect(info.parentPath).toBe("users.*");
    expect(info.wildcardCount).toBe(1);
    expect(info.wildcardPositions).toEqual([1]);
  });

  it("同一パスは同一インスタンスを返すこと（正規化キーとしての同一性）", () => {
    expect(getPathInfo("a.b.c")).toBe(getPathInfo("a.b.c"));
  });
});
