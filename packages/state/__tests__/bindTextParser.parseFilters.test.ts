import { describe, it, expect } from 'vitest';
import { parseFilters } from '../src/bindTextParser/parseFilters';
import { planFilters } from '../src/bindings/planFilters';
import { installFormats } from '../src/formats/install';

// 解析の段は名前と引数だけを作る（要件 D16）。実関数は束縛計画の段で登録簿から引く
installFormats();

describe('parseFilters', () => {
  it('引数なしのフィルターをパースできること', () => {
    const result = parseFilters(['uc'], 'output');
    expect(result.length).toBe(1);
    expect(result[0].filterName).toBe('uc');
    expect(result[0].args).toEqual([]);
    // 解析の段では実関数を持たない
    expect('filterFn' in result[0]).toBe(false);
  });

  it('引数ありのフィルターをパースできること', () => {
    const result = parseFilters(['gt(10)'], 'output');
    expect(result.length).toBe(1);
    expect(result[0].filterName).toBe('gt');
    expect(result[0].args).toEqual(['10']);
  });

  it('複数引数のフィルターをパースできること', () => {
    const result = parseFilters(['substr(0,5)'], 'output');
    expect(result.length).toBe(1);
    expect(result[0].filterName).toBe('substr');
    expect(result[0].args).toEqual(['0', '5']);
  });

  it('複数のフィルターをパースできること', () => {
    const result = parseFilters(['uc', 'trim', 'slice(2)'], 'output');
    expect(result.length).toBe(3);
    expect(result[0].filterName).toBe('uc');
    expect(result[1].filterName).toBe('trim');
    expect(result[2].filterName).toBe('slice');
    expect(result[2].args).toEqual(['2']);
  });

  it('閉じ括弧がない場合はエラーになること', () => {
    expect(() => parseFilters(['gt(10'], 'output')).toThrow(/missing closing parenthesis/);
  });

  it('開き括弧がない場合はエラーになること', () => {
    expect(() => parseFilters(['gt10)'], 'output')).toThrow(/missing opening parenthesis/);
  });

  it('束縛計画の段で解決した実関数が実行可能であること', () => {
    const planned = planFilters(parseFilters(['uc'], 'output'), 'output');
    expect(planned[0].filterFn('hello')).toBe('HELLO');
  });

  it('未知のフィルタは解析では落ちず、束縛計画の段で名指しで落ちること', () => {
    const parsed = parseFilters(['nosuchfilter'], 'output');
    expect(parsed[0].filterName).toBe('nosuchfilter');
    expect(() => planFilters(parsed, 'output')).toThrow(/\[wcs\/filter-unknown\] filter not found: nosuchfilter/);
  });

  it('チェーンしたフィルターが正しく動作すること', () => {
    const planned = planFilters(parseFilters(['trim', 'uc'], 'output'), 'output');
    let value: unknown = '  hello  ';
    for (const filter of planned) {
      value = filter.filterFn(value);
    }
    expect(value).toBe('HELLO');
  });

  it('ダブルクォート内のカンマを正しく扱えること', () => {
    const result = parseFilters(['defaults("Hello, World")'], 'output');
    expect(result[0].filterName).toBe('defaults');
    expect(result[0].args).toEqual(['Hello, World']);
  });

  it('シングルクォート内のカンマを正しく扱えること', () => {
    const result = parseFilters(["defaults('Hello, World')"], 'output');
    expect(result[0].filterName).toBe('defaults');
    expect(result[0].args).toEqual(['Hello, World']);
  });

  it('クォートなしとクォートありの引数を混在できること', () => {
    const result = parseFilters(['substr(0, 5)'], 'output');
    expect(result[0].args).toEqual(['0', '5']);
  });

  it('クォート付き引数と通常引数を混在できること', () => {
    const result = parseFilters(['pad(5,"0")'], 'output');
    expect(result[0].filterName).toBe('pad');
    expect(result[0].args).toEqual(['5', '0']);
  });
});
