/**
 * scriptAst.test.ts
 *
 * getter 本体から `this` 経由の読み取りを AST で集める部品の検査。
 * 対応表は docs/getter-dependency-ast-impl-plan.md §1。各行を最低 1 ケース固定する。
 * 「集めない」側（動的添字・`$untrackDependency` 内・入れ子 function・代入左辺・`$` ルート）
 * は偽陽性ゼロの根拠なので、陽性より厚く固定する。
 */
import { describe, it, expect } from "vitest";
import { collectGetterReads, type GetterRead } from "../src/service/scriptAst.js";

function reads(body: string): GetterRead[] {
  const out = collectGetterReads(body);
  if (out === null) throw new Error("parse failed: " + body);
  return out;
}

function paths(body: string): string[] {
  return reads(body).map((r) => r.path).sort();
}

describe("collectGetterReads — 集める形", () => {
  it("this.a / this?.a / this[\"a.b\"] / this?.[\"a.b\"] を path にすること", () => {
    expect(paths(`return this.a + this?.b + this["c.d"] + this?.["e.f"];`)).toEqual(["a", "b", "c.d", "e.f"]);
  });

  it("式なしテンプレートリテラル添字を文字列リテラルと同じに扱うこと", () => {
    expect(paths("return this[`a.b`];")).toEqual(["a.b"]);
  });

  it("$getAll / $resolve / $trackDependency の文字列リテラル第 1 引数を path にすること", () => {
    const found = reads(`this.$trackDependency("t.x"); return this.$getAll("items.*.price", [0]) + this.$resolve("m.*.*", [0, 1]);`);
    expect(found.map((r) => [r.path, r.form])).toEqual([
      ["t.x", "track"],
      ["items.*.price", "api"],
      ["m.*.*", "api"],
    ]);
    expect(found.every((r) => r.chain === null)).toBe(true);
  });

  it("$getAll の添字引数の中の this 読み取りも集めること", () => {
    expect(paths(`return this.$getAll("items.*.price", [this.cursor]);`)).toEqual(["cursor", "items.*.price"]);
  });

  it("分割代入 const { a, b: x, \"c.d\": y } = this を path にすること", () => {
    const found = reads(`const { a, b: x, "c.d": y } = this; return a + x + y;`);
    expect(found.map((r) => [r.path, r.form])).toEqual([["a", "destructure"], ["b", "destructure"], ["c.d", "destructure"]]);
  });

  it("ネストした分割代入 const { form: { name } } = this は chain [form, name] になること", () => {
    const found = reads(`const { form: { name } } = this; return name;`);
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe("form");
    expect(found[0].chain).toEqual(["form", "name"]);
  });

  it("this ルートのチェーンからの分割代入 const { name } = this.form は chain [form, name] になること", () => {
    const found = reads(`const { name, age: a = this.fallback } = this.form; return name + a;`);
    expect(found.map((r) => [r.chain, r.form])).toEqual([
      [["form", "name"], "destructure"],
      [["fallback"], "member"],
      [["form", "age"], "destructure"],
    ]);
  });

  it("動的添字チェーンからの分割代入は添字の式だけ走査すること", () => {
    expect(paths(`const { name } = this.rows[this.i]; return name;`)).toEqual(["i", "rows"]);
  });

  it("分割代入の既定値の中の this 読み取りも集めること", () => {
    expect(paths(`const { a = this.b } = this; return a;`)).toEqual(["a", "b"]);
  });

  it("this エイリアス（const self = this）経由の読み取りを集めること", () => {
    expect(paths(`const self = this; return [1].map(() => self.a);`)).toEqual(["a"]);
  });

  it("this.form.name は path form・chain [form, name] になること", () => {
    const found = reads(`return this.form.name;`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ path: "form", chain: ["form", "name"], form: "member", callee: false });
  });

  it("this[\"a.b\"].c は path a.b・chain [a.b, c] になること（ブラケットルート）", () => {
    const found = reads(`return this["a.b"].c;`);
    expect(found[0]).toMatchObject({ path: "a.b", chain: ["a.b", "c"] });
  });

  it("数値添字は文字列セグメントになること", () => {
    expect(reads(`return this.items[0].name;`)[0].chain).toEqual(["items", "0", "name"]);
  });

  it("呼び出しの callee のチェーンは callee: true で集めること", () => {
    const found = reads(`return this.form.name.trim() + this.list.map(x => x.id).length;`);
    expect(found.map((r) => [r.chain, r.callee])).toEqual([
      [["form", "name", "trim"], true],
      [["list", "map"], true],
    ]);
  });

  it("アロー関数の中の this は透過すること", () => {
    expect(paths(`return this.items.filter(() => this.filter === "all");`)).toEqual(["filter", "items"]);
  });

  it("await / yield / for await を含む本体をパースできること（ラッパーは超集合）", () => {
    expect(paths(`for await (const x of this.stream) { yield x; } return await this.p;`)).toEqual(["p", "stream"]);
  });

  it("オフセットが本体テキストの位置と一致すること", () => {
    const body = `  const x = 1;\n  return this.form.name;`;
    const [read] = reads(body);
    expect(body.slice(read.start, read.end)).toBe("this.form.name");
  });

  it("ブロックコメントと行コメントが混じっていてもオフセットがずれないこと", () => {
    const body = `// this.zzz は読みではない\n/* this.yyy */ return this.a;`;
    const [read] = reads(body);
    expect(paths(body)).toEqual(["a"]);
    expect(body.slice(read.start, read.end)).toBe("this.a");
  });
});

describe("collectGetterReads — 集めない形（偽陽性ゼロの根拠）", () => {
  it("動的添字 this[key] は集めないこと（添字の式の中の this は集める）", () => {
    expect(paths(`return this[this.key];`)).toEqual(["key"]);
  });

  it("非ルートの動的添字は chain を null にしつつ path は集めること", () => {
    const found = reads(`return this.rows[this.i].name;`);
    expect(found.map((r) => [r.path, r.chain])).toEqual([["rows", null], ["i", ["i"]]]);
  });

  it("非ルートのドット入り添字（this.form[\"x.y\"]）は chain を null にすること", () => {
    expect(reads(`return this.form["x.y"];`)[0].chain).toBeNull();
  });

  it("$getAll の非リテラル引数は集めないこと", () => {
    expect(paths(`const p = "a"; return this.$getAll(p, []) + this.$getAll(\`a\${1}\`, []);`)).toEqual([]);
  });

  it("$untrackDependency の引数の中は集めないこと", () => {
    expect(paths(`return this.$untrackDependency(() => this.a + this.b.c) + this.d;`)).toEqual(["d"]);
  });

  it("$untrackDependency?.() の optional call でも集めないこと", () => {
    expect(paths(`return this.$untrackDependency?.(() => this.a);`)).toEqual([]);
  });

  it("入れ子の function / class の中の this は集めないこと", () => {
    const body = `
      function helper() { return this.a; }
      const o = { m() { return this.b; }, get g() { return this.c; } };
      class K { f() { return this.d; } }
      return helper.call(this) + this.e;
    `;
    expect(paths(body)).toEqual(["e"]);
  });

  it("単純代入の左辺は集めないこと（wcs/nested-assign の担当）", () => {
    expect(paths(`this.a.b = 1; this.c = this.x; return this.g;`)).toEqual(["g", "x"]);
  });

  it("複合代入・増減・論理代入の対象は読みとして集めること（ランタイムは get → set の順・written: true）", () => {
    const found = reads(`this.c += 2; this.d.e++; ++this.f; this.h ??= 1; return this.g;`);
    expect(found.map((r) => [r.path, r.written])).toEqual([["c", true], ["d", true], ["f", true], ["h", true], ["g", false]]);
    expect(found[1].chain).toEqual(["d", "e"]);
  });

  it("代入左辺の動的添字の中と右辺は集めること", () => {
    expect(paths(`this.rows[this.i] = this.draft; return 0;`)).toEqual(["draft", "i"]);
  });

  it("$ ルート（$1 / $stateElement / $command / $setAll）は集めないこと", () => {
    expect(paths(`this.$setAll("a.*", [1]); this.$command.play.emit(); return this.$1 + this.$stateElement.id;`)).toEqual([]);
  });

  it("this 以外のオブジェクトのメンバーは集めないこと", () => {
    expect(paths(`const o = { a: 1 }; return o.a + window.name + document.title;`)).toEqual([]);
  });

  it("this をそのまま渡す・比較するだけでは集めないこと", () => {
    expect(paths(`fn(this); return this === that;`)).toEqual([]);
  });

  it("通常の function の中でも、外側のエイリアスはクロージャ越しに state を指すので集めること", () => {
    expect(paths(`const self = this; function f() { return self.a + this.b; } return f();`)).toEqual(["a"]);
    expect(paths(`const self = this; class K { m() { return self.c + this.d; } } return new K().m();`)).toEqual(["c"]);
  });

  it("通常の function の中の const self = this は state のエイリアスではないこと", () => {
    expect(paths(`function f() { const self = this; return self.a; } return f();`)).toEqual([]);
  });

  it("アロー引数がエイリアスを影にすること（self => self.a の self は state ではない）", () => {
    expect(paths(`const self = this; return [{ a: 1 }].map(self => self.a)[0];`)).toEqual([]);
    expect(paths(`const self = this; return [{ a: 1 }].map(({ a }, i, self) => self.b)[0];`)).toEqual([]);
  });

  it("再代入・非 this 初期化・宣言のみ・catch 引数・関数宣言名がエイリアスを影にすること", () => {
    expect(paths(`let self = this; self = other; return self.a;`)).toEqual([]);
    expect(paths(`const self = this; { const self = other; } return self.a;`)).toEqual([]);
    expect(paths(`let self; self = this; return self.a;`)).toEqual([]);
    expect(paths(`const self = this; try {} catch (self) {} return self.a;`)).toEqual([]);
    expect(paths(`const self = this; { function self() {} } return self.a;`)).toEqual([]);
  });

  it("エイリアスの連鎖（const b = a）と代入によるエイリアス（self = this）を解くこと", () => {
    expect(paths(`const a = this; const b = a; return b.x;`)).toEqual(["x"]);
    expect(paths(`const c = this, d = c; return d.y;`)).toEqual(["y"]);
  });

  it("入れ子アローの中で作ったエイリアスは外側に漏れないこと", () => {
    expect(paths(`const f = () => { const self = this; return self.a; }; return self.b;`)).toEqual(["a"]);
  });

  it("private 名や空文字添字は集めないこと", () => {
    expect(paths(`return this[""] + this.x;`)).toEqual(["x"]);
  });
});

describe("collectGetterReads — パース失敗", () => {
  it("構文が壊れていれば null を返すこと（例外を外に出さない）", () => {
    expect(collectGetterReads(`return this.a +;`)).toBeNull();
    expect(collectGetterReads(`return this.a; }`)).toBeNull();
    expect(collectGetterReads(`{`)).toBeNull();
  });

  it("空の本体は空配列を返すこと", () => {
    expect(collectGetterReads(``)).toEqual([]);
    expect(collectGetterReads(`  \n  `)).toEqual([]);
  });
});
