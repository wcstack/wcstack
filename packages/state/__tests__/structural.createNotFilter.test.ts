import { describe, it, expect } from 'vitest';
import { createNotFilter } from '../src/structural/createNotFilter';

describe('createNotFilter', () => {
  it('notフィルターを返すこと', () => {
    const filter = createNotFilter();
    expect(filter.filterName).toBe('not');
    expect(filter.args).toEqual([]);
    expect(typeof filter.filterFn).toBe('function');
  });

  it('trueをfalseに変換すること', () => {
    const filter = createNotFilter();
    expect(filter.filterFn(true)).toBe(false);
  });

  it('falseをtrueに変換すること', () => {
    const filter = createNotFilter();
    expect(filter.filterFn(false)).toBe(true);
  });

  it('キャッシュされた同じインスタンスを返すこと', () => {
    const filter1 = createNotFilter();
    const filter2 = createNotFilter();
    expect(filter1).toBe(filter2);
  });
});
