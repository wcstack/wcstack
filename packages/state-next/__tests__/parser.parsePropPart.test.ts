import { describe, it, expect } from 'vitest';
import { parsePropPart } from '../src/parser/parsePropPart';

describe('parsePropPart', () => {
  it('単一プロパティをパースできること', () => {
    const result = parsePropPart('value');
    expect(result.propName).toBe('value');
    expect(result.propSegments).toEqual(['value']);
    expect(result.propModifiers).toEqual([]);
    expect(result.inFilters).toEqual([]);
  });

  it('修飾子をパースできること', () => {
    const result = parsePropPart('value#ro,oninput');
    expect(result.propName).toBe('value');
    expect(result.propSegments).toEqual(['value']);
    expect(result.propModifiers).toEqual(['ro', 'oninput']);
    expect(result.inFilters).toEqual([]);
  });

  it('ドット区切りのプロパティをパースできること', () => {
    const result = parsePropPart('style.color');
    expect(result.propName).toBe('style.color');
    expect(result.propSegments).toEqual(['style', 'color']);
    expect(result.inFilters).toEqual([]);
  });

  it('トリムが効くこと', () => {
    const result = parsePropPart('  class.active  #  ro , wo  ');
    expect(result.propName).toBe('class.active');
    expect(result.propSegments).toEqual(['class', 'active']);
    expect(result.propModifiers).toEqual(['ro', 'wo']);
    expect(result.inFilters).toEqual([]);
  });

  it('inFilters をパースできること', () => {
    const result = parsePropPart('value|int');
    expect(result.propName).toBe('value');
    expect(result.propSegments).toEqual(['value']);
    expect(result.propModifiers).toEqual([]);
    expect(result.inFilters.length).toBe(1);
    expect(result.inFilters[0].filterName).toBe('int');
    expect(result.inFilters[0].args).toEqual([]);
  });

  it('複数の inFilters をパースできること', () => {
    const result = parsePropPart('value|trim|int');
    expect(result.propName).toBe('value');
    expect(result.inFilters.length).toBe(2);
    expect(result.inFilters[0].filterName).toBe('trim');
    expect(result.inFilters[1].filterName).toBe('int');
  });

  it('引数付き inFilters をパースできること', () => {
    const result = parsePropPart('value|slice(0,5)');
    expect(result.propName).toBe('value');
    expect(result.inFilters.length).toBe(1);
    expect(result.inFilters[0].filterName).toBe('slice');
    expect(result.inFilters[0].args).toEqual(['0', '5']);
  });

  it('inFilters と修飾子を同時にパースできること', () => {
    const result = parsePropPart('value#onchange|int');
    expect(result.propName).toBe('value');
    expect(result.propModifiers).toEqual(['onchange']);
    expect(result.inFilters.length).toBe(1);
    expect(result.inFilters[0].filterName).toBe('int');
  });

  it('同じフィルタ文字列はキャッシュされること', () => {
    const first = parsePropPart('value|uc');
    const second = parsePropPart('value|uc');
    expect(first.inFilters).toBe(second.inFilters);
  });

  it('inFilters 前後のトリムが効くこと', () => {
    const result = parsePropPart('  value  |  trim  |  int  ');
    expect(result.propName).toBe('value');
    expect(result.inFilters.length).toBe(2);
    expect(result.inFilters[0].filterName).toBe('trim');
    expect(result.inFilters[1].filterName).toBe('int');
  });
});

/**
 * 左辺は必ずプロパティを名指す（要件 B2 の並び）。空の左辺は `element[""] = value` の
 * expando を作って完全に沈黙し、末尾が空のセグメント（`foo.:`）は適用の段で素の
 * TypeError になっていた。どちらも解析の段で名指しで落とす。
 */
describe('parsePropPart — 左辺が空 / 空セグメント', () => {
  it.each(['', '#ro', '|trim', '  ', 'foo.', 'foo..bar'])(
    '"%s" を [wcs/binding-syntax] で拒否すること',
    (propPart) => {
      expect(() => parsePropPart(propPart))
        .toThrow(/\[wcs\/binding-syntax\].*the left side of a binding must name a property/);
    },
  );

  // 先頭のドットだけ（`.`）は明示のプロパティ形の空名なので、D34 の検査
  // （parseBindTextsForElement）が `leading "."` の語彙で受け持つ
  it('"." はここでは落とさず、明示のプロパティ形の検査へ渡すこと', () => {
    expect(parsePropPart('.').propSegments).toEqual(['', '']);
  });

  it('明示のプロパティ形（先頭のドット）は従来どおり通ること', () => {
    expect(parsePropPart('.online').propSegments).toEqual(['', 'online']);
    expect(parsePropPart('.detail.onset').propSegments).toEqual(['', 'detail', 'onset']);
  });
});
