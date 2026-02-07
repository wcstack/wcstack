import { describe, it, expect } from 'vitest';
import { parseStatePart } from '../src/bindTextParser/parseStatePart';

describe('parseStatePart', () => {
  it('statePathのみをパースできること', () => {
    const result = parseStatePart('user.name');
    expect(result.stateName).toBe('default');
    expect(result.statePathName).toBe('user.name');
    expect(result.statePathInfo?.path).toBe('user.name');
    expect(result.outFilters).toEqual([]);
  });

  it('stateNameをパースできること', () => {
    const result = parseStatePart('count@cart');
    expect(result.stateName).toBe('cart');
    expect(result.statePathName).toBe('count');
  });

  it('フィルタをパースできること', () => {
    const result = parseStatePart('count@cart|gt(0)|uc');
    expect(result.stateName).toBe('cart');
    expect(result.statePathName).toBe('count');
    expect(result.outFilters.length).toBe(2);
    expect(result.outFilters[0].filterName).toBe('gt');
    expect(result.outFilters[0].args).toEqual(['0']);
    expect(result.outFilters[1].filterName).toBe('uc');
    expect(result.outFilters[1].args).toEqual([]);
  });

  it('トリムが効くこと', () => {
    const result = parseStatePart('  count  @  cart  |  gt(0)  ');
    expect(result.stateName).toBe('cart');
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
