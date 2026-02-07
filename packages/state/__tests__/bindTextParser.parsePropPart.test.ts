import { describe, it, expect } from 'vitest';
import { parsePropPart } from '../src/bindTextParser/parsePropPart';

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
