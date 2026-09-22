/**
 * filters.canonicalNames.test.ts — 組み込みフィルタの正式名とエイリアス（要件 B12・docs/state-3x-naming.ja.md V1〜V9）。
 * 旧名は登録簿が正式名へ解決し、同じ実装・同じ引数の個数になること、新しい `padEnd` / `coalesce`、
 * 未知の名前の did-you-mean が正式名を提案することを固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { installFormats } from "../src/formats/install";
import { resolveFilterFn } from "../src/core/filterRegistry";
import { builtinFilterAliases } from "../src/filters/filterAliases";
import { builtinFilterArity } from "../src/formats/builtinFilters";

beforeAll(() => {
  installFormats();
});

const out = (name: string, args: string[] = [], literals?: unknown[]) => resolveFilterFn(name, args, "output", literals ?? args);

describe("正式名とエイリアス", () => {
  it.each([
    ["add", "inc", ["2"], 5, 7],
    ["sub", "dec", ["2"], 5, 3],
    ["toFixed", "fix", ["1"], 1.25, "1.3"],
    ["upper", "uc", [], "ab", "AB"],
    ["lower", "lc", [], "AB", "ab"],
    ["capitalize", "cap", [], "ab", "Ab"],
    ["repeat", "rep", ["2"], "ab", "abab"],
    ["reverse", "rev", [], "abc", "cba"],
    ["padStart", "pad", ["3"], "7", "007"],
    ["nullIfEmpty", "null", [], "", null],
  ])("%s と旧名 %s は同じ結果を返すこと", (canonical, alias, args, input, expected) => {
    expect(out(canonical, args as string[])(input)).toEqual(expected);
    expect(out(alias, args as string[])(input)).toEqual(expected);
  });

  it("エイリアスの行き先はすべて登録されていること", () => {
    for (const canonical of Object.values(builtinFilterAliases)) {
      const minArgs = builtinFilterArity[canonical][0];
      expect(() => out(canonical, Array<string>(minArgs).fill("1"))).not.toThrow();
    }
  });

  it("引数の個数は正式名の範囲で検査し、文言は書いた名前で出すこと", () => {
    expect(() => out("rep", ["1", "2"])).toThrow(/\[wcs\/filter-arity\] filter "rep" accepts at most 1/);
    expect(() => out("repeat", [])).toThrow(/\[wcs\/filter-arity\] filter "repeat" requires at least 1/);
  });

  it("未知の名前の did-you-mean は正式名を提案すること", () => {
    expect(() => out("uppr")).toThrow(/Did you mean "upper"\?/);
  });
});

describe("新しいフィルタ", () => {
  it("padEnd は末尾を埋め、既定の埋め文字は空白であること", () => {
    expect(out("padEnd", ["4", "."])("ab")).toBe("ab..");
    expect(out("padEnd", ["3"])("a")).toBe("a  ");
    expect(() => out("padEnd", ["x"])).toThrow(/padEnd/);
  });

  it("coalesce は null / undefined だけを置き換え、0・false・空文字は残すこと（defaults との違い）", () => {
    const fn = out("coalesce", ["0"], [0]);
    expect(fn(null)).toBe(0);
    expect(fn(undefined)).toBe(0);
    expect(fn(false)).toBe(false);
    expect(fn("")).toBe("");
    expect(fn(5)).toBe(5);
    expect(out("defaults", ["0"], [0])(false)).toBe(0);
    // 型付きの値が無い（引用符付き）なら文字列で置き換える
    expect(out("coalesce", ["—"], ["—"])(null)).toBe("—");
  });
});
