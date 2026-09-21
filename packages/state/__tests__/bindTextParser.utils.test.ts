import { describe, it, expect } from "vitest";
import { indexOfOutsideQuotes, splitOutsideQuotes } from "../src/bindTextParser/utils";

describe("bindTextParser/utils — 引用符の外だけで区切る（要件 B1）", () => {
  it("indexOfOutsideQuotes は引用符の中の文字を飛ばし、外側の最初の位置を返すこと", () => {
    expect(indexOfOutsideQuotes("a|b", "|")).toBe(1);
    expect(indexOfOutsideQuotes("join('|')|uc", "|")).toBe(9);
    expect(indexOfOutsideQuotes('join("|")|uc', "|")).toBe(9);
    // 引用符の種類は開いたものと同じ文字でしか閉じない
    expect(indexOfOutsideQuotes(`join("'|")|uc`, "|")).toBe(10);
    expect(indexOfOutsideQuotes("abc", "|")).toBe(-1);
  });

  it("閉じていない引用符は末尾まで続く扱いになること（診断はフィルタ引数の段が出す）", () => {
    expect(indexOfOutsideQuotes("join('|", "|")).toBe(-1);
    expect(splitOutsideQuotes("a; join(';); b", ";")).toEqual(["a", " join(';); b"]);
  });

  it("splitOutsideQuotes は引用符の外の区切りだけで分けること", () => {
    expect(splitOutsideQuotes("a;b;c", ";")).toEqual(["a", "b", "c"]);
    expect(splitOutsideQuotes("x|join(';'); y|join(\"a;b\")", ";")).toEqual(["x|join(';')", " y|join(\"a;b\")"]);
    expect(splitOutsideQuotes("", ";")).toEqual([""]);
    expect(splitOutsideQuotes(";", ";")).toEqual(["", ""]);
  });
});
