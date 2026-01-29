import { describe, it, expect } from 'vitest';
import { outputBuiltinFilters, builtinFilterFn } from '../src/filters/builtinFilters';

describe('builtinFilters', () => {
  describe('eq filter', () => {
    it('数値の等価比較ができること', () => {
      const fn = builtinFilterFn('eq', ['10'])(outputBuiltinFilters);
      expect(fn(10)).toBe(true);
      expect(fn(5)).toBe(false);
    });

    it('文字列の等価比較ができること', () => {
      const fn = builtinFilterFn('eq', ['hello'])(outputBuiltinFilters);
      expect(fn('hello')).toBe(true);
      expect(fn('world')).toBe(false);
    });
  });

  describe('ne filter', () => {
    it('数値の不等価比較ができること', () => {
      const fn = builtinFilterFn('ne', ['10'])(outputBuiltinFilters);
      expect(fn(10)).toBe(false);
      expect(fn(5)).toBe(true);
    });
  });

  describe('not filter', () => {
    it('booleanを反転できること', () => {
      const fn = builtinFilterFn('not', [])(outputBuiltinFilters);
      expect(fn(true)).toBe(false);
      expect(fn(false)).toBe(true);
    });
  });

  describe('comparison filters', () => {
    it('lt: 小さいか判定できること', () => {
      const fn = builtinFilterFn('lt', ['10'])(outputBuiltinFilters);
      expect(fn(5)).toBe(true);
      expect(fn(10)).toBe(false);
      expect(fn(15)).toBe(false);
    });

    it('le: 以下か判定できること', () => {
      const fn = builtinFilterFn('le', ['10'])(outputBuiltinFilters);
      expect(fn(5)).toBe(true);
      expect(fn(10)).toBe(true);
      expect(fn(15)).toBe(false);
    });

    it('gt: 大きいか判定できること', () => {
      const fn = builtinFilterFn('gt', ['10'])(outputBuiltinFilters);
      expect(fn(15)).toBe(true);
      expect(fn(10)).toBe(false);
      expect(fn(5)).toBe(false);
    });

    it('ge: 以上か判定できること', () => {
      const fn = builtinFilterFn('ge', ['10'])(outputBuiltinFilters);
      expect(fn(15)).toBe(true);
      expect(fn(10)).toBe(true);
      expect(fn(5)).toBe(false);
    });
  });

  describe('arithmetic filters', () => {
    it('inc: 加算できること', () => {
      const fn = builtinFilterFn('inc', ['5'])(outputBuiltinFilters);
      expect(fn(10)).toBe(15);
    });

    it('dec: 減算できること', () => {
      const fn = builtinFilterFn('dec', ['3'])(outputBuiltinFilters);
      expect(fn(10)).toBe(7);
    });

    it('mul: 乗算できること', () => {
      const fn = builtinFilterFn('mul', ['3'])(outputBuiltinFilters);
      expect(fn(10)).toBe(30);
    });

    it('div: 除算できること', () => {
      const fn = builtinFilterFn('div', ['2'])(outputBuiltinFilters);
      expect(fn(10)).toBe(5);
    });

    it('mod: 剰余を取得できること', () => {
      const fn = builtinFilterFn('mod', ['3'])(outputBuiltinFilters);
      expect(fn(10)).toBe(1);
    });
  });

  describe('string filters', () => {
    it('uc: 大文字に変換できること', () => {
      const fn = builtinFilterFn('uc', [])(outputBuiltinFilters);
      expect(fn('hello')).toBe('HELLO');
    });

    it('lc: 小文字に変換できること', () => {
      const fn = builtinFilterFn('lc', [])(outputBuiltinFilters);
      expect(fn('HELLO')).toBe('hello');
    });

    it('cap: 先頭を大文字にできること', () => {
      const fn = builtinFilterFn('cap', [])(outputBuiltinFilters);
      expect(fn('hello')).toBe('Hello');
    });

    it('trim: 前後の空白を除去できること', () => {
      const fn = builtinFilterFn('trim', [])(outputBuiltinFilters);
      expect(fn('  hello  ')).toBe('hello');
    });

    it('slice: 文字列をスライスできること', () => {
      const fn = builtinFilterFn('slice', ['2'])(outputBuiltinFilters);
      expect(fn('hello')).toBe('llo');
    });

    it('pad: 文字列をパディングできること', () => {
      const fn = builtinFilterFn('pad', ['5'])(outputBuiltinFilters);
      expect(fn('42')).toBe('00042');
    });

    it('rep: 文字列を繰り返せること', () => {
      const fn = builtinFilterFn('rep', ['3'])(outputBuiltinFilters);
      expect(fn('ab')).toBe('ababab');
    });

    it('rev: 文字列を反転できること', () => {
      const fn = builtinFilterFn('rev', [])(outputBuiltinFilters);
      expect(fn('hello')).toBe('olleh');
    });
  });

  describe('number format filters', () => {
    it('fix: 固定小数点に変換できること', () => {
      const fn = builtinFilterFn('fix', ['2'])(outputBuiltinFilters);
      expect(fn(3.14159)).toBe('3.14');
    });

    it('round: 四捨五入できること', () => {
      const fn = builtinFilterFn('round', ['1'])(outputBuiltinFilters);
      expect(fn(3.14159)).toBe(3.1);
      expect(fn(3.15)).toBe(3.2);
    });

    it('floor: 切り捨てできること', () => {
      const fn = builtinFilterFn('floor', ['1'])(outputBuiltinFilters);
      expect(fn(3.19)).toBe(3.1);
    });

    it('ceil: 切り上げできること', () => {
      const fn = builtinFilterFn('ceil', ['1'])(outputBuiltinFilters);
      expect(fn(3.11)).toBe(3.2);
    });

    it('percent: パーセント表示に変換できること', () => {
      const fn = builtinFilterFn('percent', ['1'])(outputBuiltinFilters);
      expect(fn(0.1234)).toBe('12.3%');
    });
  });

  describe('type conversion filters', () => {
    it('int: 整数に変換できること', () => {
      const fn = builtinFilterFn('int', [])(outputBuiltinFilters);
      expect(fn('42')).toBe(42);
      expect(fn('3.14')).toBe(3);
    });

    it('float: 浮動小数点に変換できること', () => {
      const fn = builtinFilterFn('float', [])(outputBuiltinFilters);
      expect(fn('3.14')).toBe(3.14);
    });

    it('boolean: booleanに変換できること', () => {
      const fn = builtinFilterFn('boolean', [])(outputBuiltinFilters);
      expect(fn(1)).toBe(true);
      expect(fn(0)).toBe(false);
      expect(fn('hello')).toBe(true);
      expect(fn('')).toBe(false);
    });

    it('number: 数値に変換できること', () => {
      const fn = builtinFilterFn('number', [])(outputBuiltinFilters);
      expect(fn('42')).toBe(42);
    });

    it('string: 文字列に変換できること', () => {
      const fn = builtinFilterFn('string', [])(outputBuiltinFilters);
      expect(fn(42)).toBe('42');
    });

    it('null: 空文字列をnullに変換できること', () => {
      const fn = builtinFilterFn('null', [])(outputBuiltinFilters);
      expect(fn('')).toBe(null);
      expect(fn('hello')).toBe('hello');
    });
  });

  describe('truthy/falsy filters', () => {
    it('truthy: truthyな値を判定できること', () => {
      const fn = builtinFilterFn('truthy', [])(outputBuiltinFilters);
      expect(fn(1)).toBe(true);
      expect(fn('hello')).toBe(true);
      expect(fn(0)).toBe(false);
      expect(fn('')).toBe(false);
      expect(fn(null)).toBe(false);
      expect(fn(undefined)).toBe(false);
    });

    it('falsy: falsyな値を判定できること', () => {
      const fn = builtinFilterFn('falsy', [])(outputBuiltinFilters);
      expect(fn(0)).toBe(true);
      expect(fn('')).toBe(true);
      expect(fn(null)).toBe(true);
      expect(fn(1)).toBe(false);
      expect(fn('hello')).toBe(false);
    });

    it('defaults: falsyな値をデフォルト値に置換できること', () => {
      const fn = builtinFilterFn('defaults', ['N/A'])(outputBuiltinFilters);
      expect(fn('')).toBe('N/A');
      expect(fn(null)).toBe('N/A');
      expect(fn('hello')).toBe('hello');
    });
  });

  describe('date filters', () => {
    it('ymd: 年月日フォーマットに変換できること', () => {
      const fn = builtinFilterFn('ymd', ['-'])(outputBuiltinFilters);
      const date = new Date(2026, 0, 30); // 2026-01-30
      expect(fn(date)).toBe('2026-01-30');
    });
  });

  describe('error handling', () => {
    it('存在しないフィルター名はエラーになること', () => {
      expect(() => builtinFilterFn('unknown', [])(outputBuiltinFilters)).toThrow(/filter not found/);
    });
  });
});
