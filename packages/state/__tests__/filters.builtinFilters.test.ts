/**
 * filters.builtinFilters.test.ts — 組み込みフィルタ 48 本の主力単体テスト。
 *
 * **解決は実行時と同じ経路（`resolveFilterFn`）で行う。** 以前はここが
 * `builtinFilterFn(name, options)(outputBuiltinFilters)` を通しており、それは
 * builtinFilters.ts の docstring 自身が「Test / tooling only. The binding pipeline never goes
 * through here」と書いている工場直呼びの経路だった。**引数の個数の検査（B3）を一度も通らない**
 * ため、arity 表と実装の食い違い（`date(ja-JP)` が実際には落ちる／`substr(0)` が的外れな文言で
 * 落ちる）をこのファイルは 1 件も検出できず、arity 表と filterMeta という 2 つの誤った表が
 * 互いをロックしているだけの偽の緑になっていた。
 *
 * 工場側の番人（`optionsRequired` — 引数の個数の検査が普通は前に倒すので実行時には届かない）は
 * `factory()` で明示的に呼び分けて固定する。
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { outputBuiltinFilters, builtinFilterFn } from '../src/formats/builtinFilters';
import { installFormats } from '../src/formats/install';
import { resolveFilterFn } from '../src/core/filterRegistry';
import { builtinFilterMeta } from '../src/filters/filterMeta';
import { getConfig, setConfig } from '../src/config';

beforeAll(() => {
  installFormats();
});

/** 実行時と同じ解決（登録簿 → 旧名の解決 → 引数の個数の検査 → 工場） */
const getFilter = (name: string, options: string[] = []) =>
  resolveFilterFn(name, options, 'output');

/** tooling 専用の工場直呼び。引数の個数の検査を経ないので、工場側の番人だけを見る */
const factory = (name: string, options: string[] = []) =>
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
      expect(() => getFilter('unknown')).toThrow(/\[wcs\/filter-unknown\] filter not found/);
      expect(() => factory('unknown')).toThrow(/filter not found/);
    });

    it('Object.prototype のメンバはフィルタとして通らないこと', () => {
      // 登録簿（core/filterRegistry）が Map を採っているのと同じ理由。素のオブジェクトへの
      // ブラケット参照だと `|toString` が `"[object Undefined]"` を返し、`|valueOf` は
      // 素の TypeError になっていた
      for (const name of ['toString', 'valueOf', 'constructor', 'hasOwnProperty']) {
        expect(() => factory(name), name).toThrow(/\[wcs\/filter-unknown\] filter not found/);
        expect(() => getFilter(name), name).toThrow(/\[wcs\/filter-unknown\] filter not found/);
      }
    });

    it('オプション必須のフィルターは、束縛計画の段で引数の個数として拒否されること', () => {
      const names = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'inc', 'dec', 'mul', 'div', 'mod', 'slice', 'pad', 'rep', 'substr', 'defaults'];
      for (const name of names) {
        expect(() => getFilter(name), name).toThrow(/\[wcs\/filter-arity\] filter ".+" requires at least \d+ argument\(s\) \(0 given\)/);
      }
    });

    it('工場を直接呼ぶ経路（tooling）では、工場側の番人が未指定を落とすこと', () => {
      // 引数の個数の検査を経ないので `optionsRequired` が最後の砦になる
      const names = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'inc', 'dec', 'mul', 'div', 'mod', 'slice', 'pad', 'rep', 'substr', 'defaults', 'clamp', 'unit', 'truncate'];
      for (const name of names) {
        expect(() => factory(name), name).toThrow(/requires at least one option/);
      }
      expect(() => factory('substr', ['1'])).toThrow(/requires at least one option/);
      expect(() => factory('clamp', ['0'])).toThrow(/requires at least one option/);
    });

    it('工場を直接呼ぶ経路には型付きの値が無いので、原文の引数で比較・置換すること', () => {
      // builtinFilterFn は原文の引数しか取らない（docstring にある通りの限界）。
      // 実行時は resolveFilterFn が型付きの値（B9）も渡す
      expect(factory('eq', ['10'])(10)).toBe(true);
      expect(factory('ne', ['10'])(10)).toBe(false);
      expect(factory('defaults', ['0'])('')).toBe('0');
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

    it('substr: 長さは省略できず、引数の個数として拒否されること', () => {
      // 実装は第 2 引数も読む。arity が [1, 2] だった頃は検査を素通りし、工場の
      // 「requires at least one option」という的外れな文言（[wcs/...] コード無し＝lint も
      // 検出できない）で落ちていた
      expect(() => getFilter('substr', ['1']))
        .toThrow(/\[wcs\/filter-arity\] filter "substr" requires at least 2 argument\(s\) \(1 given\)/);
      expect(getFilter('substr', ['0', '2'])('hello')).toBe('he');
    });

    it('not: boolean以外も真偽性で反転すること（core の実装と同一）', () => {
      const fn = getFilter('not');
      expect(fn('x' as unknown as boolean)).toBe(false);
      expect(fn(0 as unknown as boolean)).toBe(true);
      expect(fn('' as unknown as boolean)).toBe(true);
      expect(fn(undefined as unknown as boolean)).toBe(true);
      expect(fn(null as unknown as boolean)).toBe(true);
      expect(fn(true)).toBe(false);
      expect(fn(false)).toBe(true);
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

  describe('abs filter', () => {
    it('絶対値を返すこと', () => {
      const fn = getFilter('abs');
      expect(fn(-3)).toBe(3);
      expect(fn(3)).toBe(3);
      expect(fn(0)).toBe(0);
      expect(fn(-1.5)).toBe(1.5);
    });

    it('数値以外はエラーになること', () => {
      expect(() => getFilter('abs')('x' as unknown as number)).toThrow(/requires a number value/);
    });
  });

  describe('clamp filter', () => {
    it('範囲内に丸めること', () => {
      const fn = getFilter('clamp', ['0', '100']);
      expect(fn(-10)).toBe(0);
      expect(fn(50)).toBe(50);
      expect(fn(120)).toBe(100);
    });

    it('境界値はそのまま返すこと', () => {
      const fn = getFilter('clamp', ['0', '100']);
      expect(fn(0)).toBe(0);
      expect(fn(100)).toBe(100);
    });

    it('負の範囲や小数も扱えること', () => {
      expect(getFilter('clamp', ['-1', '1'])(-5)).toBe(-1);
      expect(getFilter('clamp', ['0', '1'])(0.5)).toBe(0.5);
    });

    it('オプションが不足しているとエラーになること', () => {
      expect(() => getFilter('clamp')).toThrow(/\[wcs\/filter-arity\] filter "clamp" requires at least 2 argument\(s\) \(0 given\)/);
      expect(() => getFilter('clamp', ['0'])).toThrow(/\[wcs\/filter-arity\] filter "clamp" requires at least 2 argument\(s\) \(1 given\)/);
    });

    it('オプションが数値でないとエラーになること', () => {
      expect(() => getFilter('clamp', ['a', '1'])).toThrow(/requires a number as option/);
      expect(() => getFilter('clamp', ['0', 'b'])).toThrow(/requires a number as option/);
    });

    it('数値以外はエラーになること', () => {
      const fn = getFilter('clamp', ['0', '1']);
      expect(() => fn('x' as unknown as number)).toThrow(/requires a number value/);
    });
  });

  describe('unit filter', () => {
    it('数値に単位を付けること', () => {
      expect(getFilter('unit', ['px'])(10)).toBe('10px');
      expect(getFilter('unit', ['%'])(50)).toBe('50%');
      expect(getFilter('unit', ['rem'])(1.5)).toBe('1.5rem');
    });

    // fix / percent は string を返すため、実用チェーンは string 入力になる。
    // ここで数値を要求すると「一番使いたい形」が通らなくなる
    it('文字列を返すフィルターの後ろに繋げられること', () => {
      const fix = getFilter('fix', ['1']);
      const unit = getFilter('unit', ['px']);
      expect(unit(fix(3.14159))).toBe('3.1px');
    });

    it('null / undefined は素通しすること', () => {
      const fn = getFilter('unit', ['px']);
      expect(fn(null)).toBe(null);
      expect(fn(undefined)).toBe(undefined);
    });

    it('オプション未指定はエラーになること', () => {
      expect(() => getFilter('unit')).toThrow(/\[wcs\/filter-arity\] filter "unit" requires at least 1 argument\(s\) \(0 given\)/);
    });
  });

  describe('join filter', () => {
    it('既定の区切り文字で連結すること', () => {
      expect(getFilter('join')(['a', 'b', 'c'])).toBe('a, b, c');
    });

    it('区切り文字を指定できること', () => {
      expect(getFilter('join', [' / '])(['a', 'b'])).toBe('a / b');
      expect(getFilter('join', [''])(['a', 'b'])).toBe('ab');
    });

    it('空配列は空文字になること', () => {
      expect(getFilter('join')([])).toBe('');
    });

    it('配列以外はエラーになること', () => {
      const fn = getFilter('join');
      expect(() => fn('abc' as unknown as unknown[])).toThrow(/requires an array value/);
    });
  });

  describe('truncate filter', () => {
    it('上限を超える文字列を切り詰めて省略記号を付けること', () => {
      expect(getFilter('truncate', ['3'])('abcdef')).toBe('abc…');
    });

    it('上限以下の文字列はそのまま返すこと', () => {
      expect(getFilter('truncate', ['3'])('abc')).toBe('abc');
      expect(getFilter('truncate', ['5'])('abc')).toBe('abc');
    });

    it('省略記号を指定できること', () => {
      expect(getFilter('truncate', ['3', '...'])('abcdef')).toBe('abc...');
      expect(getFilter('truncate', ['3', ''])('abcdef')).toBe('abc');
    });

    it('filterMeta が説明している既定の省略記号が、実装の既定と同じ文字であること', () => {
      // filterMeta は vscode-wcs の補完・ホバーの正本。説明が「既定は ...」（ASCII ドット 3 つ）
      // と書かれていた一方で実装は '…'（U+2026）で、エディタが誤った既定値を表示していた
      const defaultSuffix = (getFilter('truncate', ['1'])('abc') as string).slice(1);
      expect(defaultSuffix).toBe('…');
      expect(builtinFilterMeta.truncate.description).toContain(defaultSuffix);
    });

    it('オプションが不足・非数値だとエラーになること', () => {
      expect(() => getFilter('truncate')).toThrow(/\[wcs\/filter-arity\] filter "truncate" requires at least 1 argument\(s\) \(0 given\)/);
      expect(() => getFilter('truncate', ['x'])).toThrow(/requires a number as option/);
    });
  });

  describe('hms filter', () => {
    it('時分秒フォーマットに変換できること', () => {
      const fn = getFilter('hms', [':']);
      expect(fn(new Date(2026, 0, 30, 9, 5, 6))).toBe('09:05:06');
    });

    it('既定の区切り文字を使えること', () => {
      expect(getFilter('hms')(new Date(2026, 0, 30, 23, 59, 59))).toBe('23:59:59');
    });

    it('区切り文字を指定できること', () => {
      expect(getFilter('hms', ['-'])(new Date(2026, 0, 30, 1, 2, 3))).toBe('01-02-03');
    });

    it('Date以外はエラーになること', () => {
      expect(() => getFilter('hms')('09:05:06' as unknown as Date)).toThrow(/requires a date value/);
    });
  });
});

// date / time / datetime は最初からロケール引数を読んでいたのに、arity 表と filterMeta が
// [0, 0] / maxArgs: 0 だったため、README が規範として書いている `timestamp|date(ja-JP)` が
// 束縛計画の段で必ず [wcs/filter-arity] になっていた（2.x には検査自体が無く、3.0 の B7 で
// 入った検査が後方互換を壊していた）。エディタ（vscode-wcs）と lint も同じ表を読む。
describe('ロケール引数を取る日付フィルタ（要件 B3 の引数の個数）', () => {
  const DATE = new Date(2026, 0, 30, 9, 5, 6);

  it('date / time / datetime は locale と同じく引数を 1 つ受けること', () => {
    expect(getFilter('date', ['ja-JP'])(DATE)).toBe(DATE.toLocaleDateString('ja-JP'));
    expect(getFilter('time', ['en-US'])(DATE)).toBe(DATE.toLocaleTimeString('en-US'));
    expect(getFilter('datetime', ['en-US'])(DATE)).toBe(DATE.toLocaleString('en-US'));
  });

  it('2 つ以上は引数の個数として拒否されること', () => {
    expect(() => getFilter('date', ['ja-JP', 'x']))
      .toThrow(/\[wcs\/filter-arity\] filter "date" accepts at most 1 argument\(s\) \(2 given\)/);
  });
});

// B9 の型付きリテラルを eq / ne が無視していた。数値の値に対して `eq(null)` / `eq(true)` は
// 「一致しない」であって「オプションが数値でない」ではない。以前は**適用のたびに** throw し、
// null と数値の両方を取りうるパス（`selectedId|eq(null)`）はその束縛が値の型で壊れていた。
describe('eq / ne と型付きリテラル（要件 B9）', () => {
  const planned = (name: string, args: string[], literals: unknown[]) =>
    resolveFilterFn(name, args, 'output', literals);

  it('数値の値に対して true / false / null の型付きリテラルが例外にならないこと', () => {
    expect(planned('eq', ['null'], [null])(5)).toBe(false);
    expect(planned('eq', ['true'], [true])(5)).toBe(false);
    expect(planned('eq', ['false'], [false])(0)).toBe(false);
    expect(planned('ne', ['null'], [null])(5)).toBe(true);
    expect(planned('ne', ['true'], [true])(5)).toBe(true);
    expect(planned('ne', ['false'], [false])(0)).toBe(true);
  });

  it('null と数値を行き来するパスでも、値が数値になった瞬間に落ちないこと', () => {
    const fn = planned('eq', ['null'], [null]);
    expect(fn(null)).toBe(true);
    expect(fn(5)).toBe(false);
    expect(fn(null)).toBe(true);
  });

  it('数値の値と、数値リテラル・数値文字列の比べ方は変わらないこと', () => {
    expect(planned('eq', ['1'], [1])(1)).toBe(true);
    expect(planned('eq', ['1'], ['1'])(1)).toBe(true);
    expect(planned('eq', ['1'], [1])('1')).toBe(true);
    // 引用符なしの非数値（`eq(abc)`）は今も型の食い違いとして報告する。eq は値の型を選ばない
    // ので（`status|eq(active)` は正しい）、この検査は構築時には出せない
    expect(() => planned('eq', ['abc'], ['abc'])(1)).toThrow(/requires a number as option/);
    expect(() => planned('ne', ['abc'], ['abc'])(1)).toThrow(/requires a number as option/);
  });
});

// 要件 B8 の「表示面の空値」契約は、フィルタを 1 つ挟むと破れていた:
// `attr.title: x|trim` が title="undefined" を書き（フィルタ無しなら属性は消える）、
// `textContent: x|upper` が "UNDEFINED" を描いていた。
describe('表示面の空値契約（要件 B8）と書式フィルタ', () => {
  const stringFamily: ReadonlyArray<[string, string[]]> = [
    ['upper', []], ['lower', []], ['capitalize', []], ['trim', []], ['slice', ['1']],
    ['substr', ['0', '2']], ['padStart', ['3']], ['padEnd', ['3']], ['repeat', ['2']],
    ['reverse', []], ['truncate', ['3']], ['unit', ['px']],
  ];

  it.each(stringFamily)('%s は null / undefined を素通しすること', (name, args) => {
    const fn = getFilter(name, args);
    expect(fn(undefined)).toBeUndefined();
    expect(fn(null)).toBeNull();
    // 素通しは空値のときだけ。通常の値の書式は変わらない
    expect(typeof fn('ab')).toBe('string');
  });

  it('空値そのものが入力として意味を持つフィルタは素通ししないこと', () => {
    expect(getFilter('defaults', ['N/A'])(undefined)).toBe('N/A');
    expect(getFilter('coalesce', ['N/A'])(null)).toBe('N/A');
    expect(getFilter('boolean')(undefined)).toBe(false);
    expect(getFilter('truthy')(null)).toBe(false);
    expect(getFilter('falsy')(undefined)).toBe(true);
    expect(getFilter('not')(null)).toBe(true);
  });

  it('変換が仕事のフィルタは素通しせず変換すること（値が無いなら coalesce を前に置く）', () => {
    expect(getFilter('string')(undefined)).toBe('undefined');
    expect(getFilter('number')(null)).toBe(0);
    expect(getFilter('coalesce', ['0'])(null)).toBe('0');
  });

  it('値の型を検査するフィルタは今も落ちること（1 本に閉じ込められ $errorCallback に載る）', () => {
    expect(() => getFilter('toFixed', ['2'])(undefined)).toThrow(/requires a number value/);
    expect(() => getFilter('join')(undefined)).toThrow(/requires an array value/);
    expect(() => getFilter('date')(undefined)).toThrow(/requires a date value/);
  });
});

// ロケール依存フィルタ（locale / date / time / datetime）は、既定ロケールを
// **適用のたびに** 読む。以前は返り値の関数の外で解決していたため、バインド構築
// 時点の config.locale がクロージャに焼き込まれ、起動順序が少しでもずれると
// 「同じページの中で日付だけ既定ロケール」が永続して回復しなかった。
// 期待値は Intl そのものから作る（ICU の実装差に依存しないため）。
describe('ロケール依存フィルタの既定ロケール解決', () => {
  const original = getConfig().locale;
  const NUM = 1234567.89;
  const DATE = new Date(2026, 7, 26, 13, 5, 6);
  const A = 'de-DE';
  const B = 'en-US';

  afterEach(() => {
    setConfig({ locale: original });
  });

  const cases: ReadonlyArray<[string, unknown, (loc: string) => string]> = [
    ['locale',   NUM,  (loc) => NUM.toLocaleString(loc)],
    ['date',     DATE, (loc) => DATE.toLocaleDateString(loc)],
    ['time',     DATE, (loc) => DATE.toLocaleTimeString(loc)],
    ['datetime', DATE, (loc) => DATE.toLocaleString(loc)],
  ];

  it.each(cases)('%s: フィルタ生成後の config.locale 変更が次の適用に反映されること', (name, value, expected) => {
    // 2 ロケールの書式が同じだと、この検査は焼き込みを見逃しても通ってしまう。
    // ICU の実装が変わって差が消えたらここで落ちる。
    expect(expected(A)).not.toBe(expected(B));

    setConfig({ locale: A });
    const fn = getFilter(name);                  // 生成 ＝ バインド構築に相当
    expect(fn(value as never)).toBe(expected(A));

    setConfig({ locale: B });                    // 生成より後にロケールが変わる
    expect(fn(value as never)).toBe(expected(B));
  });

  it.each(cases)('%s: 明示引数は config.locale の変更に影響されないこと', (name, value, expected) => {
    setConfig({ locale: A });
    const fn = getFilter(name, [A]);             // 明示引数はバインド式の一部なので固定でよい
    setConfig({ locale: B });
    expect(fn(value as never)).toBe(expected(A));
  });
});
