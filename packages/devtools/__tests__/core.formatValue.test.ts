import { describe, it, expect } from 'vitest';
import { formatValue, formatArgs } from '../src/core/formatValue';

describe('formatValue', () => {
  it('primitiveをそのまま文字列化すること', () => {
    expect(formatValue(42)).toBe('42');
    expect(formatValue(true)).toBe('true');
    expect(formatValue(10n)).toBe('10');
    expect(formatValue(null)).toBe('null');
    expect(formatValue(undefined)).toBe('undefined');
  });

  it('文字列は引用し80文字で切ること', () => {
    expect(formatValue('abc')).toBe('"abc"');
    const long = 'x'.repeat(100);
    const formatted = formatValue(long);
    expect(formatted.length).toBeLessThan(90);
    expect(formatted.endsWith('…"')).toBe(true);
  });

  it('symbolとfunctionをタグ表示すること', () => {
    expect(formatValue(Symbol('s'))).toBe('Symbol(s)');
    expect(formatValue(() => 0)).toBe('[[Function]]');
  });

  it('配列は先頭3件+件数で要約すること', () => {
    expect(formatValue([1, 2])).toBe('[1, 2]');
    expect(formatValue([1, 2, 3, 4, 5])).toBe('[1, 2, 3, …(5)]');
  });

  it('深さ0の配列・objectは要約タグのみになること', () => {
    expect(formatValue([1, [2]], 0)).toBe('[[Array(2)]]');
    expect(formatValue({ a: 1 }, 0)).toBe('[[Object]]');
    // ネストは深さを消費する
    expect(formatValue([[1, 2, 3]], 1)).toBe('[[[Array(3)]]]');
  });

  it('plain objectは先頭3キー+キー数で要約すること', () => {
    expect(formatValue({ a: 1, b: 'x' })).toBe('{a: 1, b: "x"}');
    expect(formatValue({ a: 1, b: 2, c: 3, d: 4 })).toBe('{a: 1, b: 2, c: 3, …(4)}');
    expect(formatValue(Object.create(null))).toBe('{}');
  });

  it('classインスタンス・DOMノードはClassNameタグ表示のみになること', () => {
    class MediaStreamLike {}
    expect(formatValue(new MediaStreamLike())).toBe('[[MediaStreamLike]]');
    expect(formatValue(document.createElement('div'))).toBe('[[HTMLDivElement]]');
    // constructor情報が取れないオブジェクト
    const anon = Object.create(Object.create(null));
    expect(formatValue(anon)).toBe('[[Object]]');
  });

  it('循環参照でも深さ制限により停止すること', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(formatValue(cyclic)).toBe('{self: {self: [[Object]]}}');
    expect(formatValue(cyclic, 1)).toBe('{self: [[Object]]}');
  });
});

describe('formatArgs', () => {
  it('空引数は空文字を返すこと', () => {
    expect(formatArgs([])).toBe('');
  });

  it('3引数までを要約すること', () => {
    expect(formatArgs([1, 'a'])).toBe('1, "a"');
  });

  it('4引数以上は件数付きで省略すること', () => {
    expect(formatArgs([1, 2, 3, 4])).toBe('1, 2, 3, …(4)');
  });

  it('長い引数は80文字で切ること', () => {
    const result = formatArgs(['y'.repeat(200)]);
    expect(result.length).toBeLessThanOrEqual(81);
    expect(result.endsWith('…')).toBe(true);
  });
});
