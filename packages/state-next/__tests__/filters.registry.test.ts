/**
 * filters.registry.test.ts — フィルタの登録簿（src/filters/registry.ts）の境界
 * （@wcstack/state の core.filterRegistry.test.ts / structural.createNotFilter.test.ts の移植）。
 *
 * このファイルは formats を install しない（＝ 書式機能を入れないページ）。コアの集合は
 * エンジンと同じく `installCoreFilters()` で入れる。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { installCoreFilters, coreFilters } from "../src/filters/core";
import {
  clearFilterResolutionCache,
  filterArgsKey,
  FORMATS_FILTER_NAMES,
  hasFilter,
  knownFilterNames,
  registerFilters,
  resolveFilter,
} from "../src/filters/registry";
import { LINT_HINT } from "../src/diagnostics/guidance";
import { installFeatures } from "../src/hooks";
import { diagnostics } from "../src/features/diagnostics";

// messages as the full bundle shows them: the diagnostics add-on appends the guidance
installFeatures([diagnostics]);

const out = (name: string, args: string[] = [], literals: readonly unknown[] = args) => resolveFilter(name, args, literals);

// 宣言順に走る。この describe だけは installCoreFilters より前に置く
describe("filters/registry — installCoreFilters の前", () => {
  it("コアの集合も install するまでは登録簿に無いこと（エンジンが束縛計画の前に呼ぶ）", () => {
    expect(hasFilter("not")).toBe(false);
    expect(() => out("not")).toThrow(/\[wcs\/filter-unknown\] filter not found: not/);
  });
});

describe("filters/registry — formats 未 install", () => {
  beforeAll(() => {
    installCoreFilters();
  });

  it("エンジンが差し込む not はコアの集合が答えること", () => {
    expect(out("not")(true)).toBe(false);
    expect(out("not")(0)).toBe(true);
    expect(knownFilterNames()).toContain("not");
  });

  it("コアの not も引数の個数を検査すること（arity は formats に依らない）", () => {
    expect(() => out("not", ["1"]))
      .toThrow(/\[wcs\/filter-arity\] filter "not" accepts at most 0 argument\(s\) \(1 given\)/);
  });

  it("コアの 24 本はすべて formats なしで解決できること", () => {
    for (const [name, { arity }] of Object.entries(coreFilters)) {
      expect(hasFilter(name), name).toBe(true);
      expect(() => out(name, Array<string>(arity[0]).fill("1")), name).not.toThrow();
    }
    expect(knownFilterNames().sort()).toEqual(Object.keys(coreFilters).sort());
  });

  it("書式フィルタは名指しで落ち、formats 機能にあることを示すこと", () => {
    expect(hasFilter("upper")).toBe(false);
    expect(() => out("upper"))
      .toThrow(/\[wcs\/filter-unknown\] filter not found: upper\. "upper" is in the formats add-on — install it with installFormats\(\)\./);
  });

  it("書式フィルタ 24 本のどれを書いても formats 機能を案内すること", () => {
    for (const name of FORMATS_FILTER_NAMES) {
      expect(() => out(name), name).toThrow(`"${name}" is in the formats add-on`);
    }
  });

  it("書式フィルタが 1 つも登録されていなければ、打ち間違いにも formats 機能を案内すること", () => {
    let message = "";
    try {
      out("eqq");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("[wcs/filter-unknown] filter not found: eqq.");
    expect(message).toContain('Did you mean "eq"?');
    expect(message).toContain("No formatting filters are installed — add them with installFormats()");
    expect(message.endsWith(LINT_HINT)).toBe(true);
  });
});

describe("filters/registry — 登録と解決", () => {
  it("登録した実関数を引数つきで解決し、同じキーは同じクロージャを返すこと", () => {
    registerFilters({
      rep3: { factory: (options) => (value: unknown) => String(value).repeat(Number(options[0] ?? 1)), arity: [1, 1] },
    });
    const first = out("rep3", ["3"]);
    expect(first("ab")).toBe("ababab");
    expect(out("rep3", ["3"])).toBe(first);
    // 引数が違えば別の答え
    expect(out("rep3", ["2"])("ab")).toBe("abab");
  });

  it("解決済みの答えは解放でき、同じ挙動の新しいクロージャになること", () => {
    registerFilters({ twice: { factory: () => (value: unknown) => Number(value) * 2, arity: [0, 0] } });
    const before = out("twice");
    clearFilterResolutionCache();
    const after = out("twice");
    expect(after).not.toBe(before);
    expect(after(21)).toBe(before(21));
  });

  it("同じ名前を登録し直すと置き換わり、前の解決済みの答えは返らないこと", () => {
    registerFilters({ swap: { factory: () => (value: unknown) => `a:${value}`, arity: [0, 0] } });
    expect(out("swap")("x")).toBe("a:x");
    registerFilters({ swap: { factory: () => (value: unknown) => `b:${value}`, arity: [0, 0] } });
    expect(out("swap")("x")).toBe("b:x");
  });

  it("登録した引数の個数で検査し、文言は lint と同じ語彙であること", () => {
    registerFilters({ span: { factory: () => (value: unknown) => value, arity: [1, 2] } });
    expect(() => out("span")).toThrow(`[wcs/filter-arity] filter "span" requires at least 1 argument(s) (0 given).${LINT_HINT}`);
    expect(() => out("span", ["a", "b", "c"])).toThrow(`[wcs/filter-arity] filter "span" accepts at most 2 argument(s) (3 given).${LINT_HINT}`);
    expect(out("span", ["a"])("v")).toBe("v");
    expect(out("span", ["a", "b"])("v")).toBe("v");
  });

  it("工場は原文と型付きの値の両方を受け取ること", () => {
    let seen: unknown[] = [];
    registerFilters({
      spy: { factory: (options, literals) => { seen = [options, literals]; return (v: unknown) => v; }, arity: [0, 2] },
    });
    out("spy", ["1", "x"], [1, "x"]);
    expect(seen).toEqual([["1", "x"], [1, "x"]]);
  });
});

describe("filters/registry — 解決済みキャッシュの鍵", () => {
  it("原文が違えば別の実関数になること（literals は同じでも）", () => {
    // 型付けは `Number()` で正規化するので "1" / "1.0" / "01" は同じ literal（数値 1）に
    // なるが、原文を読む工場（truncate / unit / join / padStart …）には別物
    registerFilters({ suffix: { factory: (options) => (value: unknown) => `${value}${options[0] ?? ""}`, arity: [0, 1] } });
    const a = out("suffix", ["1"], [1]);
    const b = out("suffix", ["1.0"], [1]);
    expect(a).not.toBe(b);
    expect(a("x")).toBe("x1");
    expect(b("x")).toBe("x1.0");
  });

  it("型付きの値が違えば別の実関数になること（原文は同じでも）", () => {
    registerFilters({ typed: { factory: (_options, literals) => (value: unknown) => `${value}:${typeof literals[0]}`, arity: [0, 1] } });
    const num = out("typed", ["1"], [1]);
    const str = out("typed", ["1"], ["1"]);
    expect(num).not.toBe(str);
    expect(num("x")).toBe("x:number");
    expect(str("x")).toBe("x:string");
  });

  it("鍵は構造で作ること（['a,b'] と ['a', 'b'] は別の引数 — 要件 B3）", () => {
    registerFilters({ args: { factory: (options) => () => options.length, arity: [0, 2] } });
    expect(out("args", ["a,b"])).not.toBe(out("args", ["a", "b"]));
    expect(out("args", ["a,b"])(null)).toBe(1);
    expect(out("args", ["a", "b"])(null)).toBe(2);
  });

  it("filterArgsKey: 原文が同じで型付きの値が違えば別の鍵になること（要件 B9）", () => {
    expect(filterArgsKey(["0"], [0])).not.toBe(filterArgsKey(["0"], ["0"]));
  });

  it("filterArgsKey: 型付きの値が同じで原文が違えば別の鍵になること（Number() の正規化を跨がない）", () => {
    expect(filterArgsKey(["1"], [1])).not.toBe(filterArgsKey(["1.0"], [1]));
  });

  it("コアのフィルタも同じ鍵で同じクロージャを共有すること", () => {
    expect(out("eq", ["1"], [1])).toBe(out("eq", ["1"], [1]));
    expect(out("eq", ["1"], [1])).not.toBe(out("eq", ["1"], ["1"]));
  });
});

describe("filters/registry — 未知の名前", () => {
  it.each(["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"])(
    "Object.prototype のメンバ %s はフィルタとして通らないこと",
    (name) => {
      expect(hasFilter(name)).toBe(false);
      expect(() => out(name)).toThrow(/\[wcs\/filter-unknown\] filter not found/);
    },
  );

  it("旧名（3.x のエイリアス）は登録されていないこと", () => {
    for (const alias of ["inc", "dec", "fix", "uc", "lc", "cap", "pad", "rep", "rev", "null"]) {
      expect(hasFilter(alias), alias).toBe(false);
      expect(() => out(alias), alias).toThrow(/\[wcs\/filter-unknown\] filter not found/);
    }
  });
});
