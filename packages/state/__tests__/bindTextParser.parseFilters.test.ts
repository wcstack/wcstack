import { describe, it, expect } from 'vitest';
import { parseFilters } from '../src/bindTextParser/parseFilters';

describe('parseFilters', () => {
  it('引数なしのフィルターをパースできること', () => {
    const result = parseFilters(['uc'], 'output');
    expect(result.length).toBe(1);
    expect(result[0].filterName).toBe('uc');
    expect(result[0].args).toEqual([]);
    expect(typeof result[0].filterFn).toBe('function');
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

  it('フィルター関数が実行可能であること', () => {
    const result = parseFilters(['uc'], 'output');
    expect(result[0].filterFn('hello')).toBe('HELLO');
  });

  it('チェーンしたフィルターが正しく動作すること', () => {
    const result = parseFilters(['trim', 'uc'], 'output');
    let value: unknown = '  hello  ';
    for (const filter of result) {
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
