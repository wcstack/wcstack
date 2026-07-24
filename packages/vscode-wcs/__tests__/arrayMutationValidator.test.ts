/**
 * arrayMutationValidator のテスト。
 * 設計・検証の正本: docs/array-mutation-diagnostic-design.md（§5 検出仕様・§8 受け入れ基準）
 */
import { describe, it, expect } from 'vitest';
import { validateArrayMutations } from '../src/service/arrayMutationValidator';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode } from '../src/core/diagnostics';

function makeHtml(script: string): string {
  return `<wcs-state><script type="module">
export default {
${script}
};
  </script></wcs-state>`;
}

const DESTRUCTIVE_METHODS = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'] as const;

describe('validateArrayMutations: 破壊的メソッド呼び出し（wcs/array-mutation）', () => {
  it.each(DESTRUCTIVE_METHODS)('this.items.%s(...) を検出する', (method) => {
    const html = makeHtml(`
  items: [1, 2, 3],
  update() {
    this.items.${method}(0);
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.ArrayMutation);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].statePath).toBe('items');
    expect(diags[0].message).toContain(`"${method}"`);
  });

  it('メッセージにメソッド別の非破壊代替が含まれること（push → concat）', () => {
    const html = makeHtml(`
  items: [],
  add(item) {
    this.items.push(item);
  }`);
    const diags = validateArrayMutations(html);
    expect(diags[0].message).toContain('this.items = this.items.concat(item)');
    expect(diags[0].message).toContain('リアクティブ更新をトリガーしません');
  });

  it('range が this の先頭からメソッド名末尾まで（( は含まない）であること', () => {
    const html = makeHtml(`
  items: [],
  update() {
    this.items.push(1);
  }`);
    const diags = validateArrayMutations(html);
    const expectedStart = html.indexOf('this.items.push');
    expect(diags[0].start).toBe(expectedStart);
    expect(diags[0].end).toBe(expectedStart + 'this.items.push'.length);
  });

  it('チェーン形 this.a.b.sort(...) を検出し statePath と bracket 形アクセサを導出する', () => {
    const html = makeHtml(`
  a: { b: [] },
  update() {
    this.a.b.sort((x, y) => x - y);
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].statePath).toBe('a.b');
    expect(diags[0].message).toContain('this["a.b"] = this["a.b"].toSorted(...)');
  });

  it('添字チェーン形 this.items[0].push(...)（ネスト配列への破壊的呼び出し）を検出する', () => {
    const html = makeHtml(`
  items: [[1], [2]],
  update() {
    this.items[0].push(9);
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].statePath).toBe('items.0');
  });

  it('動的添字チェーン this.items[i].push(...) は <i> マーカーで表す', () => {
    const html = makeHtml(`
  items: [[1], [2]],
  update(i) {
    this.items[i].push(9);
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].statePath).toBe('items.<i>');
  });

  it('bracket ルート形 this["items"].push(...) を検出する', () => {
    const html = makeHtml(`
  items: [],
  update() {
    this["items"].push(1);
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.ArrayMutation);
    expect(diags[0].statePath).toBe('items');
  });

  it('ワイルドカードパス形 this["items.*.tags"].push(...) を検出する', () => {
    const html = makeHtml(`
  items: [{ tags: [] }],
  update() {
    this["items.*.tags"].push("x");
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].statePath).toBe('items.*.tags');
    expect(diags[0].message).toContain('this["items.*.tags"] = this["items.*.tags"].concat(item)');
  });

  it('getter 本体内の破壊的呼び出し（読み取り中の状態変異）も検出する', () => {
    const html = makeHtml(`
  items: [3, 1, 2],
  get sorted() {
    return this.items.sort((a, b) => a - b);
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('"sort"');
  });
});

describe('validateArrayMutations: インデックス代入（wcs/array-index-assign）', () => {
  it('リテラル添字 this.items[0] = を検出する', () => {
    const html = makeHtml(`
  items: [1, 2],
  update() {
    this.items[0] = 9;
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.ArrayIndexAssign);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].statePath).toBe('items.0');
    expect(diags[0].message).toContain('this["items.0"]');
  });

  it('識別子添字 this.items[i] = は <i> マーカーで提示する', () => {
    const html = makeHtml(`
  items: [1, 2],
  update(i) {
    this.items[i] = 9;
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].statePath).toBe('items.<i>');
    expect(diags[0].message).toContain('this["items.<i>"]');
  });

  it('多重添字 this.items[0][1] = を検出する', () => {
    const html = makeHtml(`
  items: [[1, 2]],
  update() {
    this.items[0][1] = 9;
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].statePath).toBe('items.0.1');
  });

  it('range が this の先頭から = まで（右辺は含まない）であること', () => {
    const html = makeHtml(`
  items: [1],
  update() {
    this.items[0] = 9;
  }`);
    const diags = validateArrayMutations(html);
    const expectedStart = html.indexOf('this.items[0] =');
    expect(diags[0].start).toBe(expectedStart);
    expect(diags[0].end).toBe(expectedStart + 'this.items[0] ='.length);
  });

  it('比較演算子 ==, ===, != は検出しない', () => {
    const html = makeHtml(`
  items: [1],
  check() {
    if (this.items[0] == 1) {}
    if (this.items[0] === 1) {}
    if (this.items[0] != 2) {}
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(0);
  });
});

describe('validateArrayMutations: 誤検出ガード（設計 doc §5.3）', () => {
  it('ローカル配列の変異 + 再代入イディオムは検出しない', () => {
    const html = makeHtml(`
  items: [],
  add(item) {
    const a = [...this.items];
    a.push(item);
    this.items = a;
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(0);
  });

  it('非破壊メソッド + 再代入（toSorted）は検出しない', () => {
    const html = makeHtml(`
  items: [3, 1, 2],
  update() {
    this.items = this.items.toSorted((a, b) => a - b);
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(0);
  });

  it('コピーしてからの破壊的呼び出し this.items.slice().sort(...) は検出しない', () => {
    const html = makeHtml(`
  items: [3, 1, 2],
  get sorted() {
    return this.items.slice().sort((a, b) => a - b);
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(0);
  });

  it('正しいドットパス代入 this["items.0"] = は検出しない', () => {
    const html = makeHtml(`
  items: [1, 2],
  update() {
    this["items.0"] = 9;
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(0);
  });

  it('$ API 呼び出しの戻り値への push は検出しない', () => {
    const html = makeHtml(`
  items: [{ p: 1 }],
  collect() {
    this.$getAll("items.*.p", []).push(0);
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(0);
  });

  it('$ 始まりの quoted パス this["$streams"].push は検出しない', () => {
    const html = makeHtml(`
  update() {
    this["$streams"].push("x");
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(0);
  });

  it('メソッド名の前方一致（pushAll 等）は検出しない', () => {
    const html = makeHtml(`
  items: [],
  update() {
    this.items.pushAll([1]);
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(0);
  });

  it('wcs-state 外の script は対象外', () => {
    const html = `<script type="module">this.items.push(1);</script><div>hello</div>`;
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(0);
  });

  it('wcs-state がない場合は空', () => {
    const diags = validateArrayMutations('<div>hello</div>');
    expect(diags).toHaveLength(0);
  });
});

describe('validateArrayMutations: 複数ブロック・オフセット', () => {
  it('複数の <wcs-state> ブロックそれぞれで検出し、オフセットが各ブロック内を指すこと', () => {
    const html = `<wcs-state name="a"><script type="module">
export default { items: [], f() { this.items.push(1); } };
</script></wcs-state>
<wcs-state name="b"><script type="module">
export default { rows: [], g() { this.rows[0] = 1; } };
</script></wcs-state>`;
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(2);
    const push = diags.find(d => d.code === WcsDiagnosticCode.ArrayMutation)!;
    const assign = diags.find(d => d.code === WcsDiagnosticCode.ArrayIndexAssign)!;
    expect(push.start).toBe(html.indexOf('this.items.push'));
    expect(assign.start).toBe(html.indexOf('this.rows[0] ='));
  });

  it('同一ブロック内の複数違反を全て検出する', () => {
    const html = makeHtml(`
  items: [],
  update() {
    this.items.push(1);
    this.items.pop();
    this.items[0] = 9;
  }`);
    const diags = validateArrayMutations(html);
    expect(diags).toHaveLength(3);
  });
});

describe('validateArrayMutations: ロケール', () => {
  it("locale: 'en' で英語メッセージになる", () => {
    const html = makeHtml(`
  items: [],
  update() {
    this.items.push(1);
    this.items[0] = 9;
  }`);
    const diags = validateArrayMutations(html, 'wcs-state', 'en');
    expect(diags[0].message).toContain('Destructive array method "push"');
    expect(diags[1].message).toContain('Assigning directly to an array index');
  });

  it('locale を変えても code / range / severity は不変', () => {
    const html = makeHtml(`
  items: [],
  update() {
    this.items.push(1);
  }`);
    const ja = validateArrayMutations(html);
    const en = validateArrayMutations(html, 'wcs-state', 'en');
    expect(en).toHaveLength(ja.length);
    expect(en[0].code).toBe(ja[0].code);
    expect(en[0].start).toBe(ja[0].start);
    expect(en[0].end).toBe(ja[0].end);
    expect(en[0].severity).toBe(ja[0].severity);
  });
});

describe('validateDocument 経由: wcs/nested-assign との境界（二重報告なし）', () => {
  it('ドット含みチェーン代入 this.items[0].name = は nested-assign のみ', () => {
    const html = makeHtml(`
  items: [{ name: "a" }],
  update() {
    this.items[0].name = "b";
  }`);
    const diags = validateDocument(html);
    const codes = diags.map(d => d.code);
    expect(codes).toContain(WcsDiagnosticCode.NestedAssign);
    expect(codes).not.toContain(WcsDiagnosticCode.ArrayIndexAssign);
    expect(codes).not.toContain(WcsDiagnosticCode.ArrayMutation);
  });

  it('bracket-only チェーン代入 this.items[0] = は array-index-assign のみ', () => {
    const html = makeHtml(`
  items: [1, 2],
  update() {
    this.items[0] = 9;
  }`);
    const diags = validateDocument(html);
    const codes = diags.map(d => d.code);
    expect(codes).toContain(WcsDiagnosticCode.ArrayIndexAssign);
    expect(codes).not.toContain(WcsDiagnosticCode.NestedAssign);
  });

  it('破壊的メソッド呼び出しは array-mutation のみ（nested-assign は発火しない）', () => {
    const html = makeHtml(`
  items: [],
  update() {
    this.items.push(1);
  }`);
    const diags = validateDocument(html);
    const codes = diags.map(d => d.code);
    expect(codes).toContain(WcsDiagnosticCode.ArrayMutation);
    expect(codes).not.toContain(WcsDiagnosticCode.NestedAssign);
  });
});
