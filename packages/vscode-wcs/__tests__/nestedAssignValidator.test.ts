import { describe, it, expect } from 'vitest';
import { validateNestedAssigns } from '../src/service/nestedAssignValidator';

function makeHtml(script: string): string {
  return `<wcs-state><script type="module">
export default {
${script}
};
  </script></wcs-state>`;
}

describe('validateNestedAssigns', () => {
  it('ネスト代入 this.user.name = を検出する', () => {
    const html = makeHtml(`
  user: { name: "Alice" },
  update() {
    this.user.name = "Bob";
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('this["user.name"]');
    expect(diags[0].message).toContain('リアクティブ更新をトリガーしません');
  });

  it('深いネスト this.user.profile.name = を検出する', () => {
    const html = makeHtml(`
  user: { profile: { name: "Alice" } },
  update() {
    this.user.profile.name = "Bob";
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('this["user.profile.name"]');
  });

  it('トップレベル代入 this.count = は OK', () => {
    const html = makeHtml(`
  count: 0,
  update() {
    this.count = 1;
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(0);
  });

  it('ドットパス代入 this["user.name"] = は OK', () => {
    const html = makeHtml(`
  user: { name: "Alice" },
  update() {
    this["user.name"] = "Bob";
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(0);
  });

  it('API 呼び出し this.$postUpdate は OK', () => {
    const html = makeHtml(`
  count: 0,
  update() {
    this.$postUpdate("count");
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(0);
  });

  it('比較演算子 this.user.name === は検出しない', () => {
    const html = makeHtml(`
  user: { name: "Alice" },
  check() {
    if (this.user.name === "Bob") {}
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(0);
  });

  it('!= も検出しない', () => {
    const html = makeHtml(`
  user: { name: "Alice" },
  check() {
    if (this.user.name != "Bob") {}
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(0);
  });

  it('複数のネスト代入を同時に検出する', () => {
    const html = makeHtml(`
  user: { name: "A", age: 0 },
  update() {
    this.user.name = "B";
    this.user.age = 25;
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(2);
  });

  it('wcs-state がない場合は空', () => {
    const html = '<div>hello</div>';
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(0);
  });

  it('複合代入 this.user.count += 1 を検出する', () => {
    const html = makeHtml(`
  user: { count: 0 },
  update() {
    this.user.count += 1;
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('this["user.count"]');
  });

  it('後置インクリメント this.user.count++ を検出する', () => {
    const html = makeHtml(`
  user: { count: 0 },
  update() {
    this.user.count++;
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(1);
  });

  it('前置インクリメント ++this.user.profile.n を検出する', () => {
    const html = makeHtml(`
  user: { profile: { n: 0 } },
  update() {
    ++this.user.profile.n;
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('this["user.profile.n"]');
  });

  it('式添字チェーン this.rows[this.i].name = を検出し <...> マーカーで提示する', () => {
    const html = makeHtml(`
  rows: [{ name: "a" }],
  i: 0,
  update() {
    this.rows[this.i].name = "b";
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('this["rows.<this.i>.name"]');
  });

  it('bracket-only チェーン this.items[0] = は検出しない（wcs/array-index-assign の担当）', () => {
    const html = makeHtml(`
  items: [1],
  update() {
    this.items[0] = 9;
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(0);
  });

  it('$ ルートのネスト代入 this.$a.b = は検出しない', () => {
    const html = makeHtml(`
  update() {
    this.$a.b = 1;
  }`);
    const diags = validateNestedAssigns(html);
    expect(diags).toHaveLength(0);
  });

  // Fixed by review（サイクル 5）— コメント・文字列リテラルの中の**例示**を実コードと
  // 同じに error で検出していた。リポジトリ自身の e2e フィクスチャは「`this.rows[0].name`
  // は set トラップを通らない」という注意書きをコメントで添えて直下に推奨形を書いており、
  // それが 7 件 error（`--errors-only` が exit 1）になっていた。
  describe('コメント・文字列リテラルの中は検出しない', () => {
    it('行コメントの中のネスト代入は検出せず、実コードだけを検出すること', () => {
      const html = makeHtml(`
  rows: [],
  // パス文字列で書く（\`this.rows[0].name = ...\` は set トラップを通らない）
  renameFirst() { this["rows.0.name"] = "Carol"; }`);
      expect(validateNestedAssigns(html)).toHaveLength(0);
    });

    it('ブロックコメントの中も検出しないこと', () => {
      const html = makeHtml(`
  user: { name: "a" },
  update() {
    /* NG: this.user.name = "Bob"; */
    this["user.name"] = "Bob";
  }`);
      expect(validateNestedAssigns(html)).toHaveLength(0);
    });

    it('文字列リテラルの中も検出しないこと', () => {
      const html = makeHtml(`
  msg: "docs say this.user.name = 'x' is wrong",
  tpl: \`also this.user.name = 1\`,
  user: { name: "a" }`);
      expect(validateNestedAssigns(html)).toHaveLength(0);
    });

    it('同じ行にコメントと実コードが並んでも実コードだけを検出すること（対照・レンジ確認）', () => {
      const html = makeHtml(`
  user: { name: "a" },
  update() { this.user.name = "Bob"; // this.user.other = 1 は例示
  }`);
      const diags = validateNestedAssigns(html);
      expect(diags).toHaveLength(1);
      expect(html.slice(diags[0].start, diags[0].end)).toBe('this.user.name =');
    });
  });
});
