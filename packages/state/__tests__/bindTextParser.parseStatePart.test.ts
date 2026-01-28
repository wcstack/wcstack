import { describe, it, expect } from 'vitest';
import { parseStatePart } from '../src/bindTextParser/parseStatePart';

describe('parseStatePart', () => {
  it('statePathのみをパースできること', () => {
    const result = parseStatePart('user.name');
    expect(result.stateName).toBe('default');
    expect(result.statePathName).toBe('user.name');
    expect(result.statePathInfo.path).toBe('user.name');
    expect(result.filterTexts).toEqual([]);
  });

  it('stateNameをパースできること', () => {
    const result = parseStatePart('count@cart');
    expect(result.stateName).toBe('cart');
    expect(result.statePathName).toBe('count');
  });

  it('フィルタをパースできること', () => {
    const result = parseStatePart('count@cart|gt,0|currency,JPY');
    expect(result.stateName).toBe('cart');
    expect(result.statePathName).toBe('count');
    expect(result.filterTexts).toEqual(['gt,0', 'currency,JPY']);
  });

  it('トリムが効くこと', () => {
    const result = parseStatePart('  count  @  cart  |  gt,0  ');
    expect(result.stateName).toBe('cart');
    expect(result.statePathName).toBe('count');
    expect(result.filterTexts).toEqual(['gt,0']);
  });
});
