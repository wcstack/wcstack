import { describe, it, expect } from 'vitest';
import { parseStatePart } from '../src/bindTextParser/parseStatePart';

describe('parseStatePart', () => {
  it('statePathのみをパースできること', () => {
    const result = parseStatePart('user.name');
    expect(result.statePathName).toBe('user.name');
    expect(result.statePathInfo?.path).toBe('user.name');
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
