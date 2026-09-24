import { describe, it, expect } from 'vitest';
import { parseStatePart } from '../src/parser/parseStatePart';
import { parseBindTextsForElement } from '../src/parser/parseBindTextsForElement';

describe('parseStatePart', () => {
  it('statePathのみをパースできること', () => {
    const result = parseStatePart('user.name');
    expect(result.statePathName).toBe('user.name');
    // (dropped: `statePathInfo?.path` — the port returns no PathInfo; the engine resolves paths)
    expect(result.outFilters).toEqual([]);
  });

  it('@name は v2 で撤去 — 移行ヒント付きの parse error になること', () => {
    expect(() => parseStatePart('count@cart')).toThrow(/removed in v2/);
    expect(() => parseStatePart('count@cart')).toThrow(/mount/);
  });

  it('フィルタをパースできること', () => {
    const result = parseStatePart('count|gt(0)|uc');
    expect(result.statePathName).toBe('count');
    expect(result.outFilters.length).toBe(2);
    expect(result.outFilters[0].filterName).toBe('gt');
    expect(result.outFilters[0].args).toEqual(['0']);
    expect(result.outFilters[1].filterName).toBe('uc');
    expect(result.outFilters[1].args).toEqual([]);
  });

  it('トリムが効くこと', () => {
    const result = parseStatePart('  count  |  gt(0)  ');
    expect(result.statePathName).toBe('count');
    expect(result.outFilters.length).toBe(1);
    expect(result.outFilters[0].filterName).toBe('gt');
  });

  it('同じフィルタ文字列はキャッシュされること', () => {
    const first = parseStatePart('value|uc');
    const second = parseStatePart('value|uc');
    expect(first.outFilters).toBe(second.outFilters);
  });
});

/**
 * 右辺の空セグメント。左辺（`parsePropPart`）は 3.0 から「完全に沈黙するから解析の段で落とす」
 * と明記して弾くのに、右辺には同等の検査が無く `a.` / `a..b` は診断ゼロで
 * `["a","",""]` のまま intern され、`textContent:` は適用の段で「`Path ""` が無い」という
 * パス名が空の診断になっていた。
 *
 * **先頭の空セグメント（`.name`）はループ相対の短縮形として正当**（`expandShorthandPaths` /
 * `expandSpread` が生成する）なので、先頭だけ許して中間・末尾を落とす。
 */
describe('parseStatePart — 空セグメントの拒否（要件 B1・左辺と対称）', () => {
  it.each([
    ['末尾が空', 'a.'],
    ['中間が空', 'a..b'],
    ['末尾が 2 つ空', 'a..'],
    ['右辺が空', ''],
    ['ワイルドカードの後ろが空', 'items.*.'],
  ])('%s（"%s"）を [wcs/binding-syntax] で拒否すること', (_label, path) => {
    expect(() => parseStatePart(path)).toThrow(/\[wcs\/binding-syntax\]/);
    expect(() => parseStatePart(path)).toThrow(/a path segment cannot be empty/);
  });

  /**
   * ループ相対の短縮形は**判定の前に正規化**する。とくに `.` 単独は `["", ""]` に割れるので、
   * 「先頭は許すが末尾は拒否」と素朴に書くと落ちる — が、これは README と
   * `examples/recursive-tree/index.html` の `state: .`（行そのものをコンポーネントへマウント
   * する形）そのもので、拒否すれば明確な破壊的変更になる。
   */
  it.each([
    ['行そのもの', '.'],
    ['相対 1 段', '.name'],
    ['相対 2 段', '.a.b'],
    ['相対 + フィルタ', ".price|locale('ja-JP')"],
    ['相対の入れ子プロパティ', '.author.html_url'],
  ])('ループ相対の短縮形 %s（"%s"）は通すこと', (_label, path) => {
    expect(() => parseStatePart(path)).not.toThrow();
  });

  it('`.` 単独は「行そのもの」としてそのまま残ること', () => {
    expect(parseStatePart('.').statePathName).toBe('.');
  });

  it('フィルタだけで右辺が空の形も拒否すること', () => {
    expect(() => parseStatePart('|uc')).toThrow(/a path segment cannot be empty/);
  });

  it('普通のパスは従来どおり通ること', () => {
    expect(parseStatePart('users.*.name').statePathName).toBe('users.*.name');
    expect(parseStatePart('a|uc').statePathName).toBe('a');
  });
});

/**
 * **コーパスパリティ**: リポジトリの実ページに出てくる短縮形のバリエーションを、正本パーサが
 * 全部受け付けること。指摘 12（右辺の空セグメント拒否）の初版は `state: .` を落としており、
 * `packages/vscode-wcs` のコーパスパリティ 4 件が実際に赤になった。実在の書き方を拒否するのは
 * 破壊的変更なので、ここで機械的に押さえる
 * （収集元: `packages/state/examples` / `packages/state/__e2e__` / `e2e/fixtures` / `examples`）。
 */
describe('parseStatePart — 実ページに出てくる短縮形（コーパスパリティ）', () => {
  it.each([
    'state: .',
    'state.user: .',
    'state.message: .name',
    'value: .',
    'value: .id',
    'textContent: .name',
    "textContent: .price|locale('ja-JP')",
    'href: .author.html_url',
    'checked#ro: .done',
    'class.selected: .selected',
    'attr.aria-label: .deleteLabel',
    'style.backgroundColor: .hex',
    'valueAsNumber: .quantity',
    '...: .',
  ])('`%s` が解析を通ること', (bindText) => {
    expect(() => parseBindTextsForElement(bindText)).not.toThrow();
  });
});
