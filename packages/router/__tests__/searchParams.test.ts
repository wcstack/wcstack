import { describe, it, expect } from 'vitest';
import { parseSearchParams, queryEquals, queryIncludes, shallowEqualRecords } from '../src/searchParams';

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

describe('queryIncludes（wcs-link の active 判定 — docs/seam-apps.md、city-library）', () => {
  it('求めるクエリが空なら常に true', () => {
    expect(queryIncludes('', '')).toBe(true);
    expect(queryIncludes('?q=a', '')).toBe(true);
  });

  it('求める各パラメータが同じ値なら true、余分なパラメータは構わない', () => {
    expect(queryIncludes('?q=a&page=2', '?q=a&page=2')).toBe(true);
    expect(queryIncludes('?page=2&sort=new&q=a', '?q=a&page=2')).toBe(true);
  });

  it('パラメータが無い・値が違えば false', () => {
    expect(queryIncludes('?q=a', '?q=a&page=2')).toBe(false);
    expect(queryIncludes('?q=a&page=3', '?q=a&page=2')).toBe(false);
    expect(queryIncludes('', '?q=')).toBe(false);
    expect(queryIncludes('?q=', '?q=')).toBe(true);
  });

  it('重複キーは同じ値の組（順序は問わない）で比べる', () => {
    expect(queryIncludes('?tag=b&tag=a', '?tag=a&tag=b')).toBe(true);
    expect(queryIncludes('?tag=a', '?tag=a&tag=b')).toBe(false);
    expect(queryIncludes('?tag=a&tag=b', '?tag=a')).toBe(false);
  });

  it('値はデコードして比べる（+ と %20、%xx）', () => {
    expect(queryIncludes('?q=a%20b', '?q=a+b')).toBe(true);
    expect(queryIncludes('?q=%E6%9C%AC', '?q=本')).toBe(true);
  });
});

describe('queryEquals（wcs-link の aria-current="page" — docs/seam-apps.md、city-library の取り込み）', () => {
  it('同じパラメータを同じ値で持てば true（順序は問わない）', () => {
    expect(queryEquals('?page=2&q=a', '?q=a&page=2')).toBe(true);
    expect(queryEquals('?tag=b&tag=a', '?tag=a&tag=b')).toBe(true);
    expect(queryEquals('', '')).toBe(true);
  });

  it('どちらかに余分なパラメータがあれば false', () => {
    expect(queryEquals('?q=a&page=2', '?q=a')).toBe(false);
    expect(queryEquals('?q=a', '?q=a&page=2')).toBe(false);
    expect(queryEquals('?tag=a&tag=b', '?tag=a')).toBe(false);
  });
});
