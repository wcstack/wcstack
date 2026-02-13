import { describe, it, expect } from 'vitest';
import { outputBuiltinFilters, builtinFilterFn } from '../src/filters/builtinFilters';

const getFilter = (name: string, options: string[] = []) =>
  builtinFilterFn(name, options)(outputBuiltinFilters);

describe('builtinFilters', () => {
  describe('eq filter', () => {
    it('数値の等価比較ができること', () => {
      const fn = getFilter('eq', ['10']);
      expect(fn(10)).toBe(true);
      expect(fn(5)).toBe(false);
    });

    it('文字列の等価比較ができること', () => {
      const fn = getFilter('eq', ['hello']);
      expect(fn('hello')).toBe(true);
      expect(fn('world')).toBe(false);
    });

    it('数値以外は厳密比較すること', () => {
      const fn = getFilter('eq', ['x']);
      expect(fn({ a: 1 })).toBe(false);
    });
  });

  describe('ne filter', () => {
    it('数値の不等価比較ができること', () => {
      const fn = getFilter('ne', ['10']);
      expect(fn(10)).toBe(false);
      expect(fn(5)).toBe(true);
    });

    it('文字列の不等価比較ができること', () => {
      const fn = getFilter('ne', ['hello']);
      expect(fn('hello')).toBe(false);
      expect(fn('world')).toBe(true);
    });

    it('数値/文字列以外は厳密不等価で判定すること', () => {
      const fn = getFilter('ne', ['x']);
      expect(fn({ a: 1 })).toBe(true);
    });
  });

  describe('not filter', () => {
    it('booleanを反転できること', () => {
      const fn = getFilter('not');
      expect(fn(true)).toBe(false);
      expect(fn(false)).toBe(true);
    });
  });

  describe('comparison filters', () => {
    it('lt: 小さいか判定できること', () => {
      const fn = getFilter('lt', ['10']);
      expect(fn(5)).toBe(true);
      expect(fn(10)).toBe(false);
      expect(fn(15)).toBe(false);
    });

    it('le: 以下か判定できること', () => {
      const fn = getFilter('le', ['10']);
      expect(fn(5)).toBe(true);
      expect(fn(10)).toBe(true);
      expect(fn(15)).toBe(false);
    });

    it('gt: 大きいか判定できること', () => {
      const fn = getFilter('gt', ['10']);
      expect(fn(15)).toBe(true);
      expect(fn(10)).toBe(false);
      expect(fn(5)).toBe(false);
    });

    it('ge: 以上か判定できること', () => {
      const fn = getFilter('ge', ['10']);
      expect(fn(15)).toBe(true);
      expect(fn(10)).toBe(true);
      expect(fn(5)).toBe(false);
    });
  });

  describe('arithmetic filters', () => {
    it('inc: 加算できること', () => {
      const fn = getFilter('inc', ['5']);
      expect(fn(10)).toBe(15);
    });

    it('dec: 減算できること', () => {
      const fn = getFilter('dec', ['3']);
      expect(fn(10)).toBe(7);
    });

    it('mul: 乗算できること', () => {
      const fn = getFilter('mul', ['3']);
      expect(fn(10)).toBe(30);
    });

    it('div: 除算できること', () => {
      const fn = getFilter('div', ['2']);
      expect(fn(10)).toBe(5);
    });

    it('mod: 剰余を取得できること', () => {
      const fn = getFilter('mod', ['3']);
      expect(fn(10)).toBe(1);
    });
  });

  describe('string filters', () => {
    it('uc: 大文字に変換できること', () => {
      const fn = getFilter('uc');
      expect(fn('hello')).toBe('HELLO');
    });

    it('lc: 小文字に変換できること', () => {
      const fn = getFilter('lc');
      expect(fn('HELLO')).toBe('hello');
    });

    it('cap: 先頭を大文字にできること', () => {
      const fn = getFilter('cap');
      expect(fn('hello')).toBe('Hello');
    });

    it('cap: 空文字/1文字の分岐を通ること', () => {
      const fn = getFilter('cap');
      expect(fn('')).toBe('');
      expect(fn('a')).toBe('A');
    });

    it('trim: 前後の空白を除去できること', () => {
      const fn = getFilter('trim');
      expect(fn('  hello  ')).toBe('hello');
    });

    it('slice: 文字列をスライスできること', () => {
      const fn = getFilter('slice', ['2']);
      expect(fn('hello')).toBe('llo');
    });

    it('slice: 開始位置と終了位置を指定してスライスできること', () => {
      const fn = getFilter('slice', ['0', '7']);
      expect(fn('hello world')).toBe('hello w');
    });

    it('slice: 第2引数が不正な場合はエラーになること', () => {
      expect(() => getFilter('slice', ['0', 'abc'])).toThrow(/requires a number as option/);
    });

    it('substr: 位置と長さで切り出せること', () => {
      const fn = getFilter('substr', ['1', '3']);
      expect(fn('hello')).toBe('ell');
    });

    it('pad: 文字列をパディングできること', () => {
      const fn = getFilter('pad', ['5']);
      expect(fn('42')).toBe('00042');
    });

    it('pad: 文字指定でパディングできること', () => {
      const fn = getFilter('pad', ['4', '*']);
      expect(fn('7')).toBe('***7');
    });

    it('rep: 文字列を繰り返せること', () => {
      const fn = getFilter('rep', ['3']);
      expect(fn('ab')).toBe('ababab');
    });

    it('rev: 文字列を反転できること', () => {
      const fn = getFilter('rev');
      expect(fn('hello')).toBe('olleh');
    });
  });

  describe('number format filters', () => {
    it('fix: 固定小数点に変換できること', () => {
      const fn = getFilter('fix', ['2']);
      expect(fn(3.14159)).toBe('3.14');
    });

    it('fix: デフォルト桁数(0)で動作すること', () => {
      const fn = getFilter('fix');
      expect(fn(3.9)).toBe('4');
    });

    it('round/floor/ceil/percent: デフォルト桁数(0)で動作すること', () => {
      expect(getFilter('round')(3.6)).toBe(4);
      expect(getFilter('floor')(3.6)).toBe(3);
      expect(getFilter('ceil')(3.1)).toBe(4);
      expect(getFilter('percent')(0.12)).toBe('12%');
    });

    it('locale: 既定ロケールで数値をフォーマットできること', () => {
      const fn = getFilter('locale');
      expect(fn(1234.5)).toBe((1234.5).toLocaleString('en'));
    });

    it('round: 四捨五入できること', () => {
      const fn = getFilter('round', ['1']);
      expect(fn(3.14159)).toBe(3.1);
      expect(fn(3.15)).toBe(3.2);
    });

    it('floor: 切り捨てできること', () => {
      const fn = getFilter('floor', ['1']);
      expect(fn(3.19)).toBe(3.1);
    });

    it('ceil: 切り上げできること', () => {
      const fn = getFilter('ceil', ['1']);
      expect(fn(3.11)).toBe(3.2);
    });

    it('percent: パーセント表示に変換できること', () => {
      const fn = getFilter('percent', ['1']);
      expect(fn(0.1234)).toBe('12.3%');
    });
  });

  describe('type conversion filters', () => {
    it('int: 整数に変換できること', () => {
      const fn = getFilter('int');
      expect(fn('42')).toBe(42);
      expect(fn('3.14')).toBe(3);
    });

    it('float: 浮動小数点に変換できること', () => {
      const fn = getFilter('float');
      expect(fn('3.14')).toBe(3.14);
    });

    it('boolean: booleanに変換できること', () => {
      const fn = getFilter('boolean');
      expect(fn(1)).toBe(true);
      expect(fn(0)).toBe(false);
      expect(fn('hello')).toBe(true);
      expect(fn('')).toBe(false);
    });

    it('number: 数値に変換できること', () => {
      const fn = getFilter('number');
      expect(fn('42')).toBe(42);
    });

    it('string: 文字列に変換できること', () => {
      const fn = getFilter('string');
      expect(fn(42)).toBe('42');
    });

    it('null: 空文字列をnullに変換できること', () => {
      const fn = getFilter('null');
      expect(fn('')).toBe(null);
      expect(fn('hello')).toBe('hello');
    });
  });

  describe('truthy/falsy filters', () => {
    it('truthy: truthyな値を判定できること', () => {
      const fn = getFilter('truthy');
      expect(fn(1)).toBe(true);
      expect(fn('hello')).toBe(true);
      expect(fn(0)).toBe(false);
      expect(fn('')).toBe(false);
      expect(fn(null)).toBe(false);
      expect(fn(undefined)).toBe(false);
      expect(fn(Number.NaN)).toBe(false);
    });

    it('falsy: falsyな値を判定できること', () => {
      const fn = getFilter('falsy');
      expect(fn(0)).toBe(true);
      expect(fn('')).toBe(true);
      expect(fn(null)).toBe(true);
      expect(fn(undefined)).toBe(true);
      expect(fn(false)).toBe(true);
      expect(fn(Number.NaN)).toBe(true);
      expect(fn(1)).toBe(false);
      expect(fn('hello')).toBe(false);
    });

    it('defaults: falsyな値をデフォルト値に置換できること', () => {
      const fn = getFilter('defaults', ['N/A']);
      expect(fn('')).toBe('N/A');
      expect(fn(null)).toBe('N/A');
      expect(fn(undefined)).toBe('N/A');
      expect(fn(false)).toBe('N/A');
      expect(fn(0)).toBe('N/A');
      expect(fn(Number.NaN)).toBe('N/A');
      expect(fn('hello')).toBe('hello');
    });
  });

  describe('date filters', () => {
    it('ymd: 年月日フォーマットに変換できること', () => {
      const fn = getFilter('ymd', ['-']);
      const date = new Date(2026, 0, 30); // 2026-01-30
      expect(fn(date)).toBe('2026-01-30');
    });

    it('time/datetime: 既定ロケールで時間/日時をフォーマットできること', () => {
      const date = new Date(2026, 0, 30, 9, 5, 6);
      const timeFn = getFilter('time');
      const datetimeFn = getFilter('datetime');

      expect(timeFn(date)).toBe(date.toLocaleTimeString('en'));
      expect(datetimeFn(date)).toBe(date.toLocaleString('en'));
    });

    it('date: 既定ロケールで日付をフォーマットできること', () => {
      const date = new Date(2026, 0, 30, 9, 5, 6);
      const dateFn = getFilter('date');
      expect(dateFn(date)).toBe(date.toLocaleDateString('en'));
    });

    it('ymd: 既定の区切り文字を使えること', () => {
      const fn = getFilter('ymd');
      const date = new Date(2026, 0, 30);
      expect(fn(date)).toBe('2026-01-30');
    });
  });

  describe('validation errors', () => {
    it('存在しないフィルター名はエラーになること', () => {
      expect(() => builtinFilterFn('unknown', [])(outputBuiltinFilters)).toThrow(/filter not found/);
    });

    it('オプション必須のフィルターは未指定でエラーになること', () => {
      const names = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'inc', 'dec', 'mul', 'div', 'mod', 'slice', 'pad', 'rep', 'substr', 'defaults'];
      for (const name of names) {
        expect(() => getFilter(name)).toThrow(/requires at least one option/);
      }
    });

    it('数値オプションが不正な場合はエラーになること', () => {
      const invalid = 'abc';
      const names = ['lt', 'le', 'gt', 'ge', 'inc', 'dec', 'mul', 'div', 'mod', 'fix', 'round', 'floor', 'ceil', 'percent', 'slice', 'pad', 'rep'];
      for (const name of names) {
        expect(() => getFilter(name, [invalid])).toThrow(/requires a number as option/);
      }
      expect(() => getFilter('lt', [''])).toThrow(/requires a number as option/);
      expect(() => getFilter('substr', [invalid, '1'])).toThrow(/requires a number as option/);
      expect(() => getFilter('substr', ['1', invalid])).toThrow(/requires a number as option/);
    });

    it('数値系フィルターは数値以外を受け付けないこと', () => {
      const names = ['lt', 'le', 'gt', 'ge', 'inc', 'dec', 'mul', 'div', 'mod', 'fix', 'round', 'floor', 'ceil', 'percent', 'locale'];
      for (const name of names) {
        const fn = getFilter(name, ['1']);
        expect(() => fn('x' as unknown as number)).toThrow(/requires a number value/);
      }
    });

    it('eq/ne: 数値比較時は数値オプションが必要なこと', () => {
      const eqFn = getFilter('eq', ['abc']);
      const neFn = getFilter('ne', ['abc']);
      expect(() => eqFn(1)).toThrow(/requires a number as option/);
      expect(() => neFn(1)).toThrow(/requires a number as option/);
    });

    it('substr: 第2引数が必須なこと', () => {
      expect(() => getFilter('substr', ['1'])).toThrow(/requires at least one option/);
    });

    it('not: boolean以外はエラーになること', () => {
      const fn = getFilter('not');
      expect(() => fn('x' as unknown as boolean)).toThrow(/requires a boolean value/);
    });

    it('date/time/datetime/ymd: Date以外はエラーになること', () => {
      const names = ['date', 'time', 'datetime', 'ymd'];
      for (const name of names) {
        const fn = getFilter(name);
        expect(() => fn('2026-01-30' as unknown as Date)).toThrow(/requires a date value/);
      }
    });
  });

  describe('string filters (extra)', () => {
    it('slice/rep/padのオプションが正しく動くこと', () => {
      expect(getFilter('slice', ['1'])('abc')).toBe('bc');
      expect(getFilter('rep', ['2'])('x')).toBe('xx');
      expect(getFilter('pad', ['3', '_'])('a')).toBe('__a');
    });
  });
});
