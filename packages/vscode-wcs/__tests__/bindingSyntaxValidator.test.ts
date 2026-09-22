import { describe, it, expect } from "vitest";
import { validateBindingSyntax } from "../src/service/bindingSyntaxValidator";
import { validateDocument } from "../src/core/validateDocument";

describe("wcs/binding-syntax（正本パーサと同じ判定 — @wcstack/state 3.0 の要件 B2 / B4）", () => {
  const codes = (html: string) => validateBindingSyntax(html, "data-wcs", "en");

  it("閉じていない引用符・2 つ目の # ・else: の値・構造ディレクティブの修飾子・空のフィルタを error で報告すること", () => {
    const cases = [
      `<p data-wcs="textContent: x|join('a)"></p>`,
      `<input data-wcs="value#ro#wo: x">`,
      `<template data-wcs="else: ignored"></template>`,
      `<template data-wcs="for#ro: items"></template>`,
      `<p data-wcs="textContent: x|"></p>`,
    ];
    for (const html of cases) {
      const d = codes(html);
      expect(d, html).toHaveLength(1);
      expect(d[0].code).toBe("wcs/binding-syntax");
      expect(d[0].severity).toBe("error");
      expect(d[0].message).toMatch(/^Binding syntax error \(the runtime throws at load time\): /);
      expect(d[0].message).not.toContain("Validate statically");
    }
  });

  it("範囲は壊れた式だけを指し、同じ属性の他の式は報告しないこと", () => {
    const html = `<input data-wcs="title: t; value#ro#wo: x ; class.on: y">`;
    const d = codes(html);
    expect(d).toHaveLength(1);
    expect(html.slice(d[0].start, d[0].end)).toBe("value#ro#wo: x");
  });

  it("引用符の中の ; と | は区切りとして扱わず、正しい式は報告しないこと（要件 B1）", () => {
    expect(codes(`<p data-wcs="textContent: x|join(';'); title: y|join(' | ')"></p>`)).toEqual([]);
    expect(codes(`<input data-wcs="radio#ro: choice">`)).toEqual([]);
    expect(codes(`<input data-wcs="value#ro,wo: x">`)).toEqual([]);
  });

  it("mustache の空のフィルタも報告し、位置は式を指すこと", () => {
    const html = `<p>{{ count | }}</p>`;
    const d = codes(html);
    expect(d).toHaveLength(1);
    expect(d[0].code).toBe("wcs/binding-syntax");
    expect(html.slice(d[0].start, d[0].end)).toBe("count |");
  });

  // Fixed by review — v3 移行 validator の撤去でコメントバインディングが検査対象から
  // 落ちていた（ランタイムは mustache と同じ経路で throw するのに lint だけ沈黙する退行）。
  it("コメントバインディング <!--@@:…--> も mustache と同じく報告し、位置は式を指すこと", () => {
    const unterminated = `<p><!--@@:name|join('a)--></p>`;
    const d = codes(unterminated);
    expect(d).toHaveLength(1);
    expect(d[0].code).toBe("wcs/binding-syntax");
    expect(d[0].severity).toBe("error");
    expect(unterminated.slice(d[0].start, d[0].end)).toBe("name|join('a)");

    const emptyFilter = `<p><!--@@:count | --></p>`;
    const e = codes(emptyFilter);
    expect(e).toHaveLength(1);
    expect(emptyFilter.slice(e[0].start, e[0].end)).toBe("count |");

    // 正式形（`<!--@@wcs-text:…-->`）も同じ経路で見る
    expect(codes(`<p><!--@@wcs-text:count|--></p>`)).toHaveLength(1);
    // 正しいコメントバインディングは報告しない
    expect(codes(`<p><!--@@:count|gt(0)--></p>`)).toEqual([]);
  });

  it("日本語のメッセージを返すこと", () => {
    const d = validateBindingSyntax(`<input data-wcs="value#ro#wo: x">`, "data-wcs", "ja");
    expect(d[0].message).toMatch(/^バインディングの構文エラー（ランタイムは読み込み時に throw します）: /);
  });

  it("validateDocument から報告されること", () => {
    const d = validateDocument(`<wcs-state><script type="module">export default { x: 1 };</script></wcs-state><input data-wcs="value#ro#wo: x">`, { locale: "en" });
    expect(d.some((x) => x.code === "wcs/binding-syntax")).toBe(true);
  });
});
