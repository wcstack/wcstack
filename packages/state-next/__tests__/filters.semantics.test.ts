/**
 * filters.semantics.test.ts — 3.0 で採用したフィルタの意味論（B3 / B9 / B10 / B12）と、
 * 3.x で足した正式名（padEnd / coalesce）。
 * （@wcstack/state の semantics.majorCandidates.test.ts のフィルタ部分と
 *  filters.canonicalNames.test.ts のうち旧名に依らない部分の移植）
 *
 * B9 の型付きの値は、パーサ（`toLiteral`）が作るものをここで手で組む:
 * 引用符の無い true / false / null / 数値は型付き、引用符付きは文字列。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { installCoreFilters, coreFilters } from "../src/filters/core";
import { installFormats, formatFilters } from "../src/filters/formats";
import { resolveFilter } from "../src/filters/registry";

beforeAll(() => {
  installCoreFilters();
  installFormats();
});

/** 原文を型付きの値の代わりにする呼び出し（旧 `resolveFilterFn(name, args, "output")`） */
const output = (name: string, args: string[], literals: readonly unknown[] = args) => resolveFilter(name, args, literals);

describe("B3 フィルタ引数（3.0 で採用: 構造的なキャッシュキーと引数の個数の検査）", () => {
  it("['a,b'] と ['a'] を別の関数に解決すること", () => {
    expect(output("join", ["a,b"])).not.toBe(output("join", ["a"]));
    expect(output("join", ["a,b"])(["X", "Y"])).toBe("Xa,bY");
    expect(output("join", ["a"])(["X", "Y"])).toBe("XaY");
  });

  it("過剰な引数と不足した引数を、束縛計画の段で [wcs/filter-arity] として拒否すること", () => {
    expect(() => output("join", ["a", "b"])).toThrow(/\[wcs\/filter-arity\] filter "join" accepts at most 1 argument\(s\) \(2 given\)/);
    expect(() => output("clamp", ["0"])).toThrow(/\[wcs\/filter-arity\] filter "clamp" requires at least 2 argument\(s\) \(1 given\)/);
  });
});

describe("B9 フィルタのリテラル型（3.0 で採用: 引用符の無い true / false / null / 数値は型付き）", () => {
  // `eq(true)` → 原文 ["true"]・型付き [true]、`eq('true')` → 原文 ["true"]・型付き ["true"]
  it("eq / ne は真偽値と null を型付きで比べ、数値と文字列の比べ方は変えないこと", () => {
    expect(output("eq", ["true"], [true])(true)).toBe(true);
    expect(output("eq", ["true"], ["true"])(true)).toBe(false);
    expect(output("eq", ["false"], [false])(false)).toBe(true);
    expect(output("eq", ["null"], [null])(null)).toBe(true);
    expect(output("ne", ["true"], [true])(true)).toBe(false);
    // 数値の値は数として、文字列の値は原文と比べる（フォームの値 "1" と eq(1) は従来どおり一致）
    expect(output("eq", ["1"], [1])(1)).toBe(true);
    expect(output("eq", ["1"], [1])("1")).toBe(true);
    expect(output("eq", ["1"], ["1"])(1)).toBe(true);
  });

  it("defaults は型付きの値を返し、eq(1) と eq('1') は別の関数に解決されること", () => {
    expect(output("defaults", ["0"], [0])(undefined)).toBe(0);
    expect(output("defaults", ["0"], ["0"])(undefined)).toBe("0");
    expect(output("defaults", ["null"], [null])("")).toBeNull();
    expect(output("eq", ["1"], [1])).not.toBe(output("eq", ["1"], ["1"]));
  });
});

describe("B10 真偽判定（3.0 で採用: JavaScript の真偽判定に揃えた）", () => {
  it("truthy / falsy / boolean / defaults が 0n を含めて Boolean() と一致すること", () => {
    for (const value of [0n, 1n, 0, -0, NaN, "", "0", null, undefined, false, true, [], {}]) {
      expect(output("truthy", [])(value)).toBe(Boolean(value));
      expect(output("falsy", [])(value)).toBe(!value);
      expect(output("boolean", [])(value)).toBe(Boolean(value));
      expect(output("defaults", ["fallback"])(value)).toBe(value ? value : "fallback");
    }
  });
});

describe("B12 名前の正典化（値で確かめられるもの）", () => {
  it("defaults は 0 と空文字も置き換え、padStart は先頭側だけを埋めること", () => {
    expect(output("defaults", ["fallback"])(0)).toBe("fallback");
    expect(output("defaults", ["fallback"])("")).toBe("fallback");
    expect(output("padStart", ["5", "0"])("7")).toBe("00007");
  });

  it.each([
    ["add", ["2"], 5, 7],
    ["sub", ["2"], 5, 3],
    ["toFixed", ["1"], 1.25, "1.3"],
    ["upper", [], "ab", "AB"],
    ["lower", [], "AB", "ab"],
    ["capitalize", [], "ab", "Ab"],
    ["repeat", ["2"], "ab", "abab"],
    ["reverse", [], "abc", "cba"],
    ["padStart", ["3"], "7", "007"],
    ["nullIfEmpty", [], "", null],
  ] as const)("正式名 %s が期待どおりの結果を返すこと", (name, args, input, expected) => {
    expect(output(name, [...args])(input)).toEqual(expected);
  });

  it("引数の個数の文言は書いた名前で出すこと", () => {
    expect(() => output("repeat", [])).toThrow(/\[wcs\/filter-arity\] filter "repeat" requires at least 1/);
    expect(() => output("repeat", ["1", "2"])).toThrow(/\[wcs\/filter-arity\] filter "repeat" accepts at most 1/);
  });

  it("未知の名前の did-you-mean は正式名を提案すること", () => {
    expect(() => output("uppr", [])).toThrow(/Did you mean "upper"\?/);
  });
});

describe("padEnd / coalesce", () => {
  it("padEnd は末尾を埋め、既定の埋め文字は空白であること", () => {
    expect(output("padEnd", ["4", "."])("ab")).toBe("ab..");
    expect(output("padEnd", ["3"])("a")).toBe("a  ");
    expect(() => output("padEnd", ["x"])).toThrow(/padEnd/);
  });

  it("coalesce は null / undefined だけを置き換え、0・false・空文字は残すこと（defaults との違い）", () => {
    const fn = output("coalesce", ["0"], [0]);
    expect(fn(null)).toBe(0);
    expect(fn(undefined)).toBe(0);
    expect(fn(false)).toBe(false);
    expect(fn("")).toBe("");
    expect(fn(5)).toBe(5);
    expect(output("defaults", ["0"], [0])(false)).toBe(0);
    // 型付きの値が無い（引用符付き）なら文字列で置き換える
    expect(output("coalesce", ["—"], ["—"])(null)).toBe("—");
  });

  it("工場を直接呼ぶ経路でも、引数が無ければ名指しで落ち、型付きの値が無ければ原文を使うこと", () => {
    // 束縛計画の引数個数の検査を経ない呼び出し（tooling）でも黙って進まない
    expect(() => formatFilters.padEnd.factory([], [])).toThrow(/padEnd requires at least one option/);
    expect(() => coreFilters.coalesce.factory([], [])).toThrow(/coalesce requires at least one option/);
    expect(coreFilters.coalesce.factory(["0"], [])(null)).toBe("0");
  });
});
