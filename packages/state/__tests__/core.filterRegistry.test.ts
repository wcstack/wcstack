import { describe, it, expect } from "vitest";
import { clearFilterResolutionCache, knownFilterNames, registerFilters, resolveFilterFn } from "../src/core/filterRegistry";
import { planFilters } from "../src/bindings/planFilters";
import { parseFilters } from "../src/bindTextParser/parseFilters";

/**
 * フィルタ実関数の登録簿（core/filterRegistry.ts、要件 D16）の境界。
 * このファイルは `features/formats` を install しない（＝ 書式フィルタを入れないページ）。
 */
describe("core/filterRegistry — formats 未 install", () => {
  it("エンジンが差し込む not は core が答えること", () => {
    expect(resolveFilterFn("not", [], "output")(true)).toBe(false);
    expect(knownFilterNames("output")).toContain("not");
  });

  it("core の not も引数の個数を検査すること（arity は formats に依らない）", () => {
    expect(() => resolveFilterFn("not", ["1"], "output"))
      .toThrow(/\[wcs\/filter-arity\] filter "not" accepts at most 0 argument\(s\) \(1 given\)/);
  });

  it("書式フィルタは名指しで落ち、近い名前を示すこと", () => {
    expect(() => resolveFilterFn("uc", [], "output"))
      .toThrow(/\[wcs\/filter-unknown\] filter not found: uc/);
  });

  it("書式フィルタが 1 つも登録されていなければ、入れるエントリまで案内すること", () => {
    expect(() => resolveFilterFn("uc", [], "output"))
      .toThrow(/@wcstack\/state\/features\/formats/);
  });

  it("解析は落とさず、束縛計画の段で落ちること", () => {
    const parsed = parseFilters(["uc"], "output");
    expect(parsed).toEqual([{ filterName: "uc", args: [], literals: [] }]);
    expect(() => planFilters(parsed, "output")).toThrow(/filter-unknown/);
  });
});

describe("core/filterRegistry — 登録と解決", () => {
  it("登録した実関数を引数つきで解決し、同じキーは同じクロージャを返すこと", () => {
    registerFilters("output", { repeat: (options) => (value: unknown) => String(value).repeat(Number(options?.[0] ?? 1)) });
    const first = resolveFilterFn("repeat", ["3"], "output");
    expect(first("ab")).toBe("ababab");
    expect(resolveFilterFn("repeat", ["3"], "output")).toBe(first);
    // 引数が違えば別の答え
    expect(resolveFilterFn("repeat", ["2"], "output")("ab")).toBe("abab");
  });

  it("入出力は別の登録簿であること", () => {
    registerFilters("input", { onlyIn: () => (value: unknown) => value });
    expect(knownFilterNames("input")).toContain("onlyIn");
    expect(knownFilterNames("output")).not.toContain("onlyIn");
    expect(() => resolveFilterFn("onlyIn", [], "output")).toThrow(/filter-unknown/);
  });

  it("解決済みの答えは解放でき、同じ挙動の新しいクロージャになること", () => {
    registerFilters("output", { twice: () => (value: unknown) => Number(value) * 2 });
    const before = resolveFilterFn("twice", [], "output");
    clearFilterResolutionCache();
    const after = resolveFilterFn("twice", [], "output");
    expect(after).not.toBe(before);
    expect(after(21)).toBe(before(21));
  });
});

describe("core/filterRegistry — 解決済みキャッシュの鍵", () => {
  it("原文が違えば別の実関数になること（literals は同じでも）", () => {
    // `toLiteral` は `Number()` で正規化するので "1" / "1.0" / "01" は同じ literal（数値 1）に
    // なるが、原文を読む工場（truncate / unit / join / padStart …）には別物
    registerFilters("output", { suffix: (options) => (value: unknown) => `${value}${options?.[0] ?? ""}` });
    const a = resolveFilterFn("suffix", ["1"], "output", [1]);
    const b = resolveFilterFn("suffix", ["1.0"], "output", [1]);
    expect(a).not.toBe(b);
    expect(a("x")).toBe("x1");
    expect(b("x")).toBe("x1.0");
  });

  it("型付きの値が違えば別の実関数になること（原文は同じでも）", () => {
    registerFilters("output", { typed: (_options, literals) => (value: unknown) => `${value}:${typeof literals?.[0]}` });
    const num = resolveFilterFn("typed", ["1"], "output", [1]);
    const str = resolveFilterFn("typed", ["1"], "output", ["1"]);
    expect(num).not.toBe(str);
    expect(num("x")).toBe("x:number");
    expect(str("x")).toBe("x:string");
  });

  it("旧名と正式名は同じ実関数を共有すること（クロージャを二重に作らない）", () => {
    registerFilters("output", { canon: () => (value: unknown) => `c:${value}` }, undefined, { legacy: "canon" });
    expect(resolveFilterFn("legacy", [], "output")).toBe(resolveFilterFn("canon", [], "output"));
  });
});

describe("core/filterRegistry — 未知の名前", () => {
  it.each(["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"])(
    "Object.prototype のメンバ %s はフィルタとして通らないこと",
    (name) => {
      expect(() => resolveFilterFn(name, [], "output")).toThrow(/\[wcs\/filter-unknown\] filter not found/);
    },
  );
});

describe("core/filterRegistry — 旧名の掃除", () => {
  it("同じ正式名を旧名なしで登録し直すと、前の旧名が残らないこと（arity と同じ掃除）", () => {
    registerFilters("output", { cleanup: () => (value: unknown) => `a:${value}` }, undefined, { cu: "cleanup" });
    expect(resolveFilterFn("cu", [], "output")("x")).toBe("a:x");
    // 旧名を渡さずに登録し直す＝その旧名はもう無い
    registerFilters("output", { cleanup: () => (value: unknown) => `b:${value}` });
    expect(resolveFilterFn("cleanup", [], "output")("x")).toBe("b:x");
    expect(() => resolveFilterFn("cu", [], "output")).toThrow(/filter-unknown/);
  });

  it("他の正式名を指す旧名は、無関係な登録で消えないこと", () => {
    registerFilters("output", { keepMe: () => (v: unknown) => v }, undefined, { km: "keepMe" });
    registerFilters("output", { somethingElse: () => (v: unknown) => v });
    expect(resolveFilterFn("km", [], "output")).toBeTypeOf("function");
  });
});
