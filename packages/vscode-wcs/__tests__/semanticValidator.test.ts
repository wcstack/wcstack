/**
 * semanticValidator.test.ts
 *
 * 「構文は正しく、パスも実在するのに、意味論が噛み合っていない」取り違えの検査。
 *
 *   wcs/index-arity   — `$getAll` / `$resolve` の添字の本数 vs パス中の `*` の本数
 *   wcs/wildcard-rank — ワイルドカードの階数 vs for の段数（`$N` を含む）
 *   wcs/getter-cycle  — パス getter どうしの循環参照
 *
 * 精度方針は既存 validator と同じ「断定できるときだけ報告」。リテラルでない引数・
 * `@state` 越境・省略パスでは黙る（各 describe の末尾に固定）。
 */
import { describe, it, expect } from "vitest";
import { validateSemantics } from "../src/service/semanticValidator.js";
import { validateBindings } from "../src/service/bindingValidator.js";
import { validateTemplateSyntax } from "../src/service/templateSyntaxValidator.js";
import { WcsDiagnosticCode } from "../src/core/diagnostics.js";

function script(body: string): string {
  return `<wcs-state><script type="module">export default ${body};</script></wcs-state>`;
}

function codes(diagnostics: { code: string }[], code: string): { code: string; message: string }[] {
  return diagnostics.filter((d) => d.code === code) as { code: string; message: string }[];
}

describe("wcs/index-arity — 添字の本数", () => {
  const STATE = `{ items: [{ price: 1 }], matrix: [[1]], get total() { return 0; } }`;

  it("$resolve に本数を超えて渡したら報告すること（ランタイムでは黙って無視されていた）", () => {
    const html = script(`{ ...${STATE}, m() { return this.$resolve("items.*.price", [0, 1]); } }`);
    const found = codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.IndexArity);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('$resolve("items.*.price") requires exactly 1 index(es)');
    expect(found[0].message).toContain("but got 2");
  });

  it("$resolve に本数が足りなければ報告すること", () => {
    const html = script(`{ m() { return this.$resolve("matrix.*.*", [0]); } }`);
    const found = codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.IndexArity);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("requires exactly 2 index(es)");
  });

  it("$getAll は超過だけ報告すること（不足は接頭辞として正当）", () => {
    const over = script(`{ m() { return this.$getAll("items.*.price", [0, 1]); } }`);
    expect(codes(validateSemantics(over, "wcs-state", "en"), WcsDiagnosticCode.IndexArity)).toHaveLength(1);

    const under = script(`{ m() { return this.$getAll("matrix.*.*", [0]); } }`);
    expect(codes(validateSemantics(under, "wcs-state", "en"), WcsDiagnosticCode.IndexArity)).toHaveLength(0);

    const empty = script(`{ m() { return this.$getAll("items.*.price", []); } }`);
    expect(codes(validateSemantics(empty, "wcs-state", "en"), WcsDiagnosticCode.IndexArity)).toHaveLength(0);
  });

  it("$setAll も超過だけ報告すること（$getAll と同じ接頭辞の規則）", () => {
    const over = script(`{ m() { this.$setAll("items.*.price", [0, 1], 0); } }`);
    const found = codes(validateSemantics(over, "wcs-state", "en"), WcsDiagnosticCode.IndexArity);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('$setAll("items.*.price") requires at most 1 index(es)');

    const under = script(`{ m() { this.$setAll("matrix.*.*", [0], 0); } }`);
    expect(codes(validateSemantics(under, "wcs-state", "en"), WcsDiagnosticCode.IndexArity)).toHaveLength(0);

    const empty = script(`{ m() { this.$setAll("items.*.price", [], 0); } }`);
    expect(codes(validateSemantics(empty, "wcs-state", "en"), WcsDiagnosticCode.IndexArity)).toHaveLength(0);
  });

  it("報告レンジが添字の配列リテラルを指すこと", () => {
    const html = script(`{ m() { return this.$resolve("items.*.price", [0, 1]); } }`);
    const found = validateSemantics(html, "wcs-state", "en").filter((d) => d.code === WcsDiagnosticCode.IndexArity);
    expect(html.slice(found[0].start, found[0].end)).toBe("[0, 1]");
  });

  it("リテラルでない引数では黙ること（過小近似）", () => {
    const dynamicPath = script(`{ m(p) { return this.$resolve(p, [0, 1]); } }`);
    expect(codes(validateSemantics(dynamicPath, "wcs-state", "en"), WcsDiagnosticCode.IndexArity)).toHaveLength(0);

    const dynamicIndexes = script(`{ m(ix) { return this.$resolve("items.*.price", ix); } }`);
    expect(codes(validateSemantics(dynamicIndexes, "wcs-state", "en"), WcsDiagnosticCode.IndexArity)).toHaveLength(0);

    const spread = script(`{ m(rest) { return this.$resolve("items.*.price", [...rest]); } }`);
    expect(codes(validateSemantics(spread, "wcs-state", "en"), WcsDiagnosticCode.IndexArity)).toHaveLength(0);
  });

  it("正しい呼び出しでは黙ること", () => {
    const html = script(`{ m() { return this.$resolve("matrix.*.*", [0, 1]) + this.$getAll("items.*.price")[0]; } }`);
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.IndexArity)).toHaveLength(0);
  });
});

describe("wcs/getter-cycle — getter の循環参照", () => {
  it("相互参照を両方の getter に報告すること", () => {
    const html = script(`{ get a() { return this.b + 1; }, get b() { return this.a + 1; } }`);
    const found = codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle);
    expect(found).toHaveLength(2);
    expect(found[0].message).toMatch(/dependency cycle: (a -> b -> a|b -> a -> b)/);
  });

  it("自己参照を報告すること", () => {
    const html = script(`{ get a() { return this.a + 1; } }`);
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(1);
  });

  it("ブラケット記法のワイルドカード getter でも検出すること", () => {
    const html = script(
      `{ get "items.*.a"() { return this["items.*.b"]; }, get "items.*.b"() { return this["items.*.a"]; } }`,
    );
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(2);
  });

  it("3 段の循環も検出すること", () => {
    const html = script(`{ get a() { return this.b; }, get b() { return this.c; }, get c() { return this.a; } }`);
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(3);
  });

  it("非循環のチェーンでは黙ること", () => {
    const html = script(
      `{ price: 1, qty: 2, get sub() { return this.price * this.qty; }, get tax() { return this.sub * 0.1; }, get total() { return this.sub + this.tax; } }`,
    );
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(0);
  });

  it("データパスへの読みは辺にしないこと（親パスを読む getter を巻き込まない）", () => {
    const html = script(`{ cart: { items: [] }, get "cart.total"() { return this["cart.items"].length; } }`);
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(0);
  });

  it("$getAll 経由の読みも辺として数えること", () => {
    const html = script(
      `{ get "items.*.a"() { return this["items.*.b"]; }, get "items.*.b"() { return this.$getAll("items.*.a", []).length; } }`,
    );
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(2);
  });

  // --- AST 化で拾えるようになった形（正規表現では取りこぼしていた） ---

  it("分割代入経由の循環を検出すること", () => {
    const html = script(`{ get a() { const { b } = this; return b; }, get b() { return this.a; } }`);
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(2);
  });

  it("this エイリアス経由の循環を検出すること", () => {
    const html = script(`{ get a() { const self = this; return [1].map(() => self.b)[0]; }, get b() { return this.a; } }`);
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(2);
  });

  it("$trackDependency で明示登録した依存も辺として数えること", () => {
    const html = script(`{ get a() { this.$trackDependency("b"); return 0; }, get b() { return this.a; } }`);
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(2);
  });

  // --- AST 化で黙るようになった形（ランタイムが依存に登録しない読み） ---

  it("$untrackDependency の中の読みは辺にしないこと", () => {
    const html = script(`{ get a() { return this.$untrackDependency(() => this.b); }, get b() { return this.a; } }`);
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(0);
  });

  it("入れ子の function の中の this は辺にしないこと", () => {
    const html = script(`{ get a() { function f() { return this.b; } return f(); }, get b() { return this.a; } }`);
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(0);
  });

  it("setter の中の読みは辺にしないこと（get/set ペアでも get 側だけ報告すること）", () => {
    const html = script(`{ get a() { return 1; }, set a(v) { this.b; }, get b() { return this.a; } }`);
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(0);
    const cyc = script(`{ get a() { return this.b; }, set a(v) {}, get b() { return this.a; } }`);
    expect(codes(validateSemantics(cyc, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(2);
  });

  it("代入の左辺は辺にしないこと", () => {
    const html = script(`{ get a() { this.b = 1; return 0; }, get b() { return this.a; } }`);
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(0);
  });

  it("片方の getter が壊れていても他の循環は報告すること（本体単位のパース）", () => {
    const html = script(`{ get broken() { return this.a +; }, get a() { return this.b; }, get b() { return this.a; } }`);
    expect(codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterCycle)).toHaveLength(2);
  });
});

describe("wcs/getter-untracked-read — パス読み取りの先の素のプロパティアクセス", () => {
  const FORM = `form: { name: "", age: 0, addr: { city: "" } }, items: [{ name: "" }], get "form.label"() { return ""; }`;
  const EVIDENCE = `<input data-wcs="value: form.name">`;

  /** 既定の証拠は `value: form.name`（PR#245 で実際に踏まれた形）。 */
  function page(body: string, evidence: string = EVIDENCE): string {
    return script(`{ ${FORM}, ${body} }`) + evidence;
  }
  function found(body: string, evidence?: string) {
    return codes(validateSemantics(page(body, evidence), "wcs-state", "en"), WcsDiagnosticCode.GetterUntrackedRead);
  }

  it("this.form.name を報告し、this[\"form.name\"] を提案すること", () => {
    const out = found(`get g() { return this.form.name; }`);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('Only "form" is tracked here');
    expect(out[0].message).toContain('Read this["form.name"] instead');
  });

  it("ブラケットルート this[\"form\"].name と optional chain this?.form?.age も報告すること", () => {
    expect(found(`get g() { return this["form"].name + this?.form?.age; }`)).toHaveLength(2);
  });

  it("メソッド呼び出しの手前までを報告すること（this.form.name.trim() → form.name）", () => {
    const out = found(`get g() { return this.form.name.trim(); }`);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('this["form.name"]');
  });

  it("分割代入 const { name } = this.form も報告すること", () => {
    const out = found(`get g() { const { name } = this.form; return name; }`);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('this["form.name"]');
  });

  it("診断のレンジが読み取り式そのものを指すこと", () => {
    const html = page(`get g() { return 1 + this.form.name; }`);
    const [d] = codes(validateSemantics(html, "wcs-state", "en"), WcsDiagnosticCode.GetterUntrackedRead) as unknown as { start: number; end: number }[];
    expect(html.slice(d.start, d.end)).toBe("this.form.name");
  });

  it("日本語メッセージを出すこと", () => {
    const out = codes(validateSemantics(page(`get g() { return this.form.name; }`), "wcs-state", "ja"), WcsDiagnosticCode.GetterUntrackedRead);
    expect(out[0].message).toContain('this["form.name"] で読んでください');
  });

  // --- 証拠の形（入れ子書き込みが静的に断定できるもの） ---

  it("checked / radio / checkbox バインドを証拠にすること", () => {
    expect(found(`get g() { return this.form.age; }`, `<input data-wcs="checked: form.age">`)).toHaveLength(1);
    expect(found(`get g() { return this.form.age; }`, `<input data-wcs="radio: form.age">`)).toHaveLength(1);
    expect(found(`get g() { return this.form.age; }`, `<input data-wcs="checkbox: form.age">`)).toHaveLength(1);
  });

  it("spread（...: form）を証拠にすること", () => {
    expect(found(`get g() { return this.form.name; }`, `<wcs-fetch data-wcs="...: form"></wcs-fetch>`)).toHaveLength(1);
  });

  it("組み込み I/O タグの出力プロパティへのバインドを証拠にし、入力プロパティは証拠にしないこと", () => {
    expect(found(`get g() { return this.form.name; }`, `<wcs-fetch data-wcs="value: form.name"></wcs-fetch>`)).toHaveLength(1);
    expect(found(`get g() { return this.form.name; }`, `<wcs-fetch data-wcs="url: form.name"></wcs-fetch>`)).toHaveLength(0);
  });

  it("スクリプトの this[\"form.name\"] = / += / ++ を証拠にすること", () => {
    expect(found(`get g() { return this.form.name; }, m() { this["form.name"] = "x"; }`, "")).toHaveLength(1);
    expect(found(`get g() { return this.form.age; }, m() { this["form.age"] += 1; }`, "")).toHaveLength(1);
    expect(found(`get g() { return this.form.age; }, m() { ++this["form.age"]; }`, "")).toHaveLength(1);
  });

  it("$setAll と値付き $resolve を証拠にし、$getAll と値なし $resolve は証拠にしないこと", () => {
    expect(found(`get g() { return this.form.name; }, m() { this.$setAll("form.name", ["x"]); }`, "")).toHaveLength(1);
    expect(found(`get g() { return this.form.name; }, m() { this.$resolve("form.name", [], "x"); }`, "")).toHaveLength(1);
    expect(found(`get g() { return this.form.name; }, m() { this.$getAll("form.name", []); this.$resolve("form.name", []); }`, "")).toHaveLength(0);
  });

  it("mount= ボリュームをその接頭辞への証拠にすること", () => {
    const evidence = `<wcs-state mount="form"><script type="module">export default { name: "" };</script></wcs-state>`;
    expect(found(`get g() { return this.form.name; }`, evidence)).toHaveLength(1);
  });

  it("深い書き込み（form.addr.city）は中間の form.addr にも証拠を付けること", () => {
    const out = found(`get g() { return this["form.addr"].city; }`, `<input data-wcs="value: form.addr.city">`);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('this["form.addr.city"]');
  });

  // --- 黙る形 ---

  it("入れ子書き込みの証拠がなければ報告しないこと（読みバインドと mustache は証拠ではない）", () => {
    expect(found(`get g() { return this.form.name; }`, "")).toHaveLength(0);
    expect(found(`get g() { return this.form.name; }`, `<p data-wcs="textContent: form.name"></p>{{ form.name }}`)).toHaveLength(0);
  });

  it("ルート自身への出力バインド（丸ごと置換）は証拠にしないこと — router の typedParams / searchParams", () => {
    const evidence = `<wcs-router data-wcs="typedParams: form"></wcs-router>`;
    expect(found(`get g() { return this.form.name; }`, evidence)).toHaveLength(0);
  });

  it("素のプロパティ書き込み this.form.name = x は証拠にしないこと（wcs/nested-assign の担当）", () => {
    expect(found(`get g() { return this.form.name; }, m() { this.form.name = "x"; }`, "")).toHaveLength(0);
  });

  it("配列ルート（this.items[0].name / this.items.length）は報告しないこと", () => {
    expect(found(`get g() { return this.items[0].name + this.items.length; }`, `<input data-wcs="value: items.*.name">`)).toHaveLength(0);
  });

  it("未宣言ルート・getter ルート・プリミティブルートは報告しないこと", () => {
    const evidence = `<input data-wcs="value: unknown.x"><input data-wcs="value: form.label.x"><input data-wcs="value: count.x">`;
    expect(found(`count: 0, get g() { return this.unknown.x + this["form.label"].x + this.count.x; }`, evidence)).toHaveLength(0);
  });

  it("ルートのメソッド呼び出し this.form.hasOwnProperty() は報告しないこと", () => {
    expect(found(`get g() { return this.form.hasOwnProperty("name"); }`)).toHaveLength(0);
  });

  it("setter・メソッド・$watch ハンドラの中は報告しないこと", () => {
    expect(found(`set g(v) { this.x = this.form.name; }, m() { return this.form.name; }, $watch: { form() { return this.form.name; } }`)).toHaveLength(0);
  });

  it("$untrackDependency の中と入れ子 function の中は報告しないこと", () => {
    expect(found(`get g() { function f() { return this.form.name; } return this.$untrackDependency(() => this.form.name) + f(); }`)).toHaveLength(0);
  });

  it("代入左辺（this.form.name = x）は報告しないこと（wcs/nested-assign の担当）", () => {
    expect(found(`get g() { this.form.name = "x"; return 0; }`)).toHaveLength(0);
  });

  it("式添字を含むチェーン（this.form[key].x）は報告しないこと", () => {
    expect(found(`get g() { const key = "name"; return this.form[key].length; }`)).toHaveLength(0);
  });

  it("正しい形 this[\"form.name\"] は報告しないこと", () => {
    expect(found(`get g() { return this["form.name"] + this["form.name"].trim(); }`)).toHaveLength(0);
  });
});

describe("wcs/wildcard-rank — 階数 vs for の段数", () => {
  const STATE = script(`{ matrix: [[1, 2]], items: [{ n: 1 }] }`);

  it("data-wcs: 1 段の for の中で 2 階のパスを読んだら報告すること", () => {
    const html = `${STATE}<template data-wcs="for: matrix"><li data-wcs="textContent: matrix.*.*"></li></template>`;
    const found = codes(validateBindings(html, "data-wcs", "wcs-state", "en"), WcsDiagnosticCode.WildcardRank);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("needs 2 enclosing loop level(s) but the current scope provides 1");
  });

  it("data-wcs: 段数を超える $N を報告すること", () => {
    const html = `${STATE}<template data-wcs="for: items"><li data-wcs="textContent: $2"></li></template>`;
    const found = codes(validateBindings(html, "data-wcs", "wcs-state", "en"), WcsDiagnosticCode.WildcardRank);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('"$2" needs 2 enclosing loop level(s)');
  });

  it("mustache 側でも報告すること", () => {
    const html = `${STATE}<template data-wcs="for: items"><li>{{ $2 }}</li></template>`;
    const found = codes(validateTemplateSyntax(html, "wcs-state", "data-wcs", "en"), WcsDiagnosticCode.WildcardRank);
    expect(found).toHaveLength(1);
  });

  it("段数が足りていれば黙ること（入れ子 for でスコープが 2 段になる）", () => {
    const html = `${STATE}<template data-wcs="for: matrix"><template data-wcs="for: matrix.*">` +
      `<li data-wcs="textContent: matrix.*.*"></li></template></template>`;
    expect(codes(validateBindings(html, "data-wcs", "wcs-state", "en"), WcsDiagnosticCode.WildcardRank)).toHaveLength(0);
  });

  it("相対 for でも段数を正しく数えること", () => {
    const html = script(`{ categories: [{ products: [{ name: "x" }] }] }`) +
      `<template data-wcs="for: categories"><template data-wcs="for: .products">` +
      `<li data-wcs="textContent: categories.*.products.*.name"></li></template></template>`;
    expect(codes(validateBindings(html, "data-wcs", "wcs-state", "en"), WcsDiagnosticCode.WildcardRank)).toHaveLength(0);
  });

  it("for の外は既存の診断が担うので二重報告しないこと", () => {
    const html = `${STATE}<li data-wcs="textContent: matrix.*.*"></li>`;
    const diagnostics = validateBindings(html, "data-wcs", "wcs-state", "en");
    expect(codes(diagnostics, WcsDiagnosticCode.WildcardRank)).toHaveLength(0);
    // 既存の「for の外」診断は従来どおり出る
    expect(diagnostics.some((d) => d.message.includes("outside a <template for>"))).toBe(true);
  });

  it("省略パスと @state 越境では黙ること（過小近似）", () => {
    const shorthand = `${STATE}<template data-wcs="for: items"><li data-wcs="textContent: .n"></li></template>`;
    expect(codes(validateBindings(shorthand, "data-wcs", "wcs-state", "en"), WcsDiagnosticCode.WildcardRank)).toHaveLength(0);

    const crossState = `${STATE}<template data-wcs="for: items"><li data-wcs="textContent: other.*.*@sub"></li></template>`;
    expect(codes(validateBindings(crossState, "data-wcs", "wcs-state", "en"), WcsDiagnosticCode.WildcardRank)).toHaveLength(0);
  });
});

/**
 * 反応グラフの根が DOM にある、という予測可能性の穴の静的検出。
 *
 * 実例（examples/state-intersect-scroll/README.md に記録）: `$updatedCallback` は
 * binding 駆動なので、表示専用の `<b data-wcs="textContent: $streamStatus.pageResult">`
 * が購読の実体になっていた ── その `<b>` を消すとフィードの commit が止まった。
 * 「その画面に何が描かれているか」がプログラムの意味論を決めていた形で、
 * 契約（パス）には現れない。
 */
describe("wcs/updated-callback-unbound — 表示要素が購読の実体になる形", () => {
  const STREAM_STATE = `
    <wcs-state><script type="module">
      export default {
        page: 1,
        items: [],
        $streams: { pageResult: { source() {}, initial: null } },
        $updatedCallback(paths) {
          if (!paths.includes("$streamStatus.pageResult")) return;
          this.items = this.items.concat(this.pageResult.items);
        },
      };
    </script></wcs-state>`;

  it("バインドが無ければ、その分岐は走らないと報告すること（事故の再現形）", () => {
    const html = `${STREAM_STATE}<div data-wcs="textContent: page"></div>`;
    const found = codes(
      validateSemantics(html, "wcs-state", "en", "data-wcs"),
      WcsDiagnosticCode.UpdatedCallbackUnbound,
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('"$streamStatus.pageResult" is not bound anywhere');
    expect(found[0].message).toContain("$watch");
  });

  it("表示用でもバインドが 1 本あれば黙ること（＝それが load-bearing だという事実）", () => {
    const html = `${STREAM_STATE}<b data-wcs="textContent: $streamStatus.pageResult"></b>`;
    expect(codes(
      validateSemantics(html, "wcs-state", "en", "data-wcs"),
      WcsDiagnosticCode.UpdatedCallbackUnbound,
    )).toHaveLength(0);
  });

  it("報告レンジがリテラル本体を指すこと", () => {
    const html = `${STREAM_STATE}<div data-wcs="textContent: page"></div>`;
    const found = validateSemantics(html, "wcs-state", "en", "data-wcs")
      .filter((d) => d.code === WcsDiagnosticCode.UpdatedCallbackUnbound);
    expect(html.slice(found[0].start, found[0].end)).toBe("$streamStatus.pageResult");
  });

  it("=== 比較の形でも検出すること", () => {
    const html = `<wcs-state><script type="module">
      export default {
        page: 1, total: 0,
        $updatedCallback(paths) { for (const p of paths) { if (p === "total") this.page = 1; } },
      };
    </script></wcs-state><div data-wcs="textContent: page"></div>`;
    expect(codes(
      validateSemantics(html, "wcs-state", "en", "data-wcs"),
      WcsDiagnosticCode.UpdatedCallbackUnbound,
    )).toHaveLength(1);
  });

  it("for 短縮パス経由のバインドも「バインドあり」と数えること", () => {
    const html = `<wcs-state><script type="module">
      export default {
        items: [{ price: 1 }],
        $updatedCallback(paths) { if (paths.includes("items.*.price")) { this.page = 1; } },
      };
    </script></wcs-state>
    <template data-wcs="for: items"><li data-wcs="textContent: .price"></li></template>`;
    expect(codes(
      validateSemantics(html, "wcs-state", "en", "data-wcs"),
      WcsDiagnosticCode.UpdatedCallbackUnbound,
    )).toHaveLength(0);
  });

  it("読み取り（this[path]）は未バインドでも報告しないこと（読みは成立する）", () => {
    const html = `<wcs-state><script type="module">
      export default {
        page: 1, total: 0,
        $updatedCallback(paths) { if (paths.includes("page")) { const t = this["total"]; } },
      };
    </script></wcs-state><div data-wcs="textContent: page"></div>`;
    expect(codes(
      validateSemantics(html, "wcs-state", "en", "data-wcs"),
      WcsDiagnosticCode.UpdatedCallbackUnbound,
    )).toHaveLength(0);
  });

  it("宣言に無い文字列は判定しないこと（過小近似）", () => {
    const html = `<wcs-state><script type="module">
      export default {
        page: 1,
        $updatedCallback(paths) { if (paths.includes("not-a-declared-path")) { this.page = 1; } },
      };
    </script></wcs-state><div data-wcs="textContent: page"></div>`;
    expect(codes(
      validateSemantics(html, "wcs-state", "en", "data-wcs"),
      WcsDiagnosticCode.UpdatedCallbackUnbound,
    )).toHaveLength(0);
  });

  it("コメントアウトされたリテラルは拾わないこと", () => {
    const html = `<wcs-state><script type="module">
      export default {
        page: 1, total: 0,
        $updatedCallback(paths) { /* if (paths.includes("total")) {} */ if (paths.includes("page")) { this.page = 1; } },
      };
    </script></wcs-state><div data-wcs="textContent: page"></div>`;
    expect(codes(
      validateSemantics(html, "wcs-state", "en", "data-wcs"),
      WcsDiagnosticCode.UpdatedCallbackUnbound,
    )).toHaveLength(0);
  });

  it("$updatedCallback が無ければ何もしないこと", () => {
    const html = `<wcs-state><script type="module">export default { page: 1 };</script></wcs-state>`;
    expect(codes(
      validateSemantics(html, "wcs-state", "en", "data-wcs"),
      WcsDiagnosticCode.UpdatedCallbackUnbound,
    )).toHaveLength(0);
  });
});
