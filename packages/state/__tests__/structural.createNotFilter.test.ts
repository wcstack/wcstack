import { describe, it, expect } from 'vitest';
import { createNotFilter } from '../src/structural/createNotFilter';
import { planFilters } from '../src/bindings/planFilters';

/**
 * `if` / `else` の反転としてエンジンが差し込むフィルタ。要件 D16 で解析の段は
 * 名前と引数だけになり、実関数は束縛計画の段で登録簿から引く。`not` だけは
 * `features/formats` を入れないページでも core が答える（core/filterRegistry.ts）。
 */
describe('createNotFilter', () => {
  it('解析の段の形（名前と引数だけ）を返すこと', () => {
    const filter = createNotFilter();
    expect(filter.filterName).toBe('not');
    expect(filter.args).toEqual([]);
    expect('filterFn' in filter).toBe(false);
  });

  it('formats を入れていなくても core が解決すること', () => {
    const [planned] = planFilters([createNotFilter()], 'output');
    expect(planned.filterFn(true)).toBe(false);
    expect(planned.filterFn(false)).toBe(true);
  });

  it('キャッシュされた同じインスタンスを返すこと', () => {
    const filter1 = createNotFilter();
    const filter2 = createNotFilter();
    expect(filter1).toBe(filter2);
  });
});
