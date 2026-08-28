import { describe, it, expect } from 'vitest';
import { parseSearchParams, shallowEqualRecords } from '../src/searchParams';

describe('parseSearchParams (§3.5)', () => {
  it('クエリ文字列を Record に変換すること', () => {
    expect(parseSearchParams('?page=2&q=hello')).toEqual({ page: '2', q: 'hello' });
  });

  it('先頭 `?` なしでも受理すること（URLSearchParams のセマンティクス）', () => {
    expect(parseSearchParams('page=2')).toEqual({ page: '2' });
  });

  it('キー重複は last-wins であること', () => {
    expect(parseSearchParams('?tag=a&tag=b')).toEqual({ tag: 'b' });
  });

  it('デコードは URLSearchParams に委ねること（+ → space を含む）', () => {
    expect(parseSearchParams('?q=a+b%20c')).toEqual({ q: 'a b c' });
  });

  it('クエリ無しは {} であること', () => {
    expect(parseSearchParams('')).toEqual({});
    expect(parseSearchParams('?')).toEqual({});
  });

  it('値なしキーは空文字列になること', () => {
    expect(parseSearchParams('?flag')).toEqual({ flag: '' });
  });

  it('露出オブジェクトは frozen であること（消費側の変異は loud failure）', () => {
    const result = parseSearchParams('?a=1');
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => {
      (result as any).b = '2';
    }).toThrow();
  });
});

describe('shallowEqualRecords', () => {
  it('同一内容なら true（挿入順に依存しない = 順序非依存の変化判定）', () => {
    expect(shallowEqualRecords({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
  });

  it('値が異なれば false', () => {
    expect(shallowEqualRecords({ a: '1' }, { a: '2' })).toBe(false);
  });

  it('キー数が異なれば false', () => {
    expect(shallowEqualRecords({ a: '1' }, { a: '1', b: '2' })).toBe(false);
  });

  it('キー集合が異なれば false', () => {
    expect(shallowEqualRecords({ a: '1' }, { b: '1' })).toBe(false);
  });

  it('両方空なら true', () => {
    expect(shallowEqualRecords({}, {})).toBe(true);
  });
});
