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

  // 4.0 の正本パーサはパスを指す右辺の `__proto__` / `prototype` の段を #120 で拒む（実行時と同じ範囲）
  it("パスの __proto__ / prototype の段を報告すること（4.0 の #120 — 属性・mustache・コメント束縛）", () => {
    const cases: [string, string][] = [
      [`<p data-wcs="textContent: a.__proto__.x"></p>`, "textContent: a.__proto__.x"],
      [`<p data-wcs="title: items.*.prototype"></p>`, "title: items.*.prototype"],
      [`<button data-wcs="onclick: handlers.__proto__"></button>`, "onclick: handlers.__proto__"],
      [`<p>{{ a.__proto__ }}</p>`, "a.__proto__"],
      [`<p><!--@@: Foo.prototype.bar--></p>`, "Foo.prototype.bar"],
    ];
    for (const [html, range] of cases) {
      const d = codes(html);
      expect(d, html).toHaveLength(1);
      expect(d[0].code).toBe("wcs/binding-syntax");
      expect(d[0].severity).toBe("error");
      expect(html.slice(d[0].start, d[0].end)).toBe(range);
      expect(d[0].message).toContain('cannot go through "__proto__" or "prototype"');
    }
  });

  it("#120 で拒まれたパスには存在の検査（wcs/binding-path-missing）を重ねないこと（属性・for の短縮パス・mustache）", () => {
    const html = `<wcs-state><script type="module">export default { obj: {}, items: [] };</script></wcs-state>
<p data-wcs="textContent: obj.__proto__.x"></p>
<template data-wcs="for: items"><b data-wcs="textContent: .__proto__"></b></template>
<p>{{ obj.prototype }}</p>
<p data-wcs="textContent: obj.missing"></p>`;
    const d = validateDocument(html, { locale: "en" });
    expect(d.filter((x) => x.code === "wcs/binding-syntax").map((x) => html.slice(x.start, x.end)))
      .toEqual(["textContent: obj.__proto__.x", "textContent: .__proto__", "obj.prototype"]);
    // 存在の検査は、拒まれていないパスだけに出る
    expect(d.filter((x) => x.code === "wcs/binding-path-missing").map((x) => html.slice(x.start, x.end))).toEqual(["obj.missing"]);
  });

  it("パスを指さない右辺（コマンドトークン・イベントトークン・単独のメソッド名）の __proto__ は報告しないこと（実行時と同じ）", () => {
    expect(codes(`<button data-wcs="onclick: $command.__proto__"></button>`)).toEqual([]);
    expect(codes(`<x-el data-wcs="eventToken.value: __proto__"></x-el>`)).toEqual([]);
    expect(codes(`<button data-wcs="onclick: __proto__"></button>`)).toEqual([]);
    // 段の名前に含まれるだけ（`__proto__x` / `prototypes`）は対象外
    expect(codes(`<p data-wcs="textContent: a.__proto__x; title: b.prototypes"></p>`)).toEqual([]);
  });

  // 4.0 の正本パーサは for: の出力フィルタを #121 で拒む（ランタイムは初期化で失敗する。#370 の判断 — spread の #105 と同じ形）
  it("for: の出力フィルタを error で報告し、位置は for の式を指すこと（4.0 の #121）", () => {
    for (const expr of ["for: items|take(2)", "for: .items|nosuch", "for: items | slice(0, 2)"]) {
      const html = `<ul><template data-wcs="${expr}"><li></li></template></ul>`;
      const d = codes(html);
      expect(d, expr).toHaveLength(1);
      expect(d[0].code).toBe("wcs/binding-syntax");
      expect(d[0].severity).toBe("error");
      expect(html.slice(d[0].start, d[0].end)).toBe(expr);
      expect(d[0].message).toContain('"for:" takes no filters');
      expect(d[0].message).not.toContain("Validate statically");
    }
    // フィルタの無い for: と、if: のフィルタは報告しない
    expect(codes(`<template data-wcs="for: items"></template><template data-wcs="if: items|not"></template>`)).toEqual([]);
    // validateDocument からも同じ 1 件が wcs/binding-syntax で届く
    const doc = validateDocument(`<wcs-state><script type="module">export default { items: [1, 2, 3] };</script></wcs-state>`
      + `<ul><template data-wcs="for: items|take(2)"><li></li></template></ul>`, { locale: "en" });
    expect(doc.filter((x) => x.code === "wcs/binding-syntax").map((x) => x.severity)).toEqual(["error"]);
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
