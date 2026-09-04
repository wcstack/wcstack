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

  it("フィルタ関数キャッシュも解放されること（クリア後は新しいクロージャ）", () => {
    // filterFnByKey は filterName(args):ioType キーのモジュールレベル Map。
    // 言語サーバー常駐では有効な編集中間フィルタ引数がキーごとに蓄積するため
    // clearParserCaches の解放対象に含まれる（含まれないと intern 解放が部分解決）。
    const [before] = parseBindTextsForElement("textContent: price | fix(2)");
    const beforeFn = before.outFilters[0].filterFn;
    // 同一キーはキャッシュされた同一クロージャを返す
    const [again] = parseBindTextsForElement("textContent: price | fix(2)");
    expect(again.outFilters[0].filterFn).toBe(beforeFn);
    clearParserCaches();
    const [after] = parseBindTextsForElement("textContent: price | fix(2)");
    expect(after.outFilters[0].filterFn).not.toBe(beforeFn);
    // 挙動は同一（クリアは意味論を変えない）
    expect(after.outFilters[0].filterFn(1.234)).toBe(beforeFn(1.234));
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
