/**
 * filters.builtin.test.ts — 組み込みフィルタ 48 本の主力単体テスト
 * （@wcstack/state の filters.builtinFilters.test.ts の移植）。
 *
 * 解決は実行時と同じ経路（`resolveFilter` — 登録簿 → 引数の個数の検査 → 工場）で行う。
 * 工場側の番人（`optionsRequired` — 引数の個数の検査が普通は前に倒すので実行時には届かない）は
 * 定義表の `factory` を直接呼んで固定する（旧 `builtinFilterFn` の経路の代わり）。
 *
 * 移植で変えたこと: 旧名（inc / dec / fix / uc / lc / cap / pad / rep / rev / null）は持ち込まない
 * ので、旧名で書かれていた期待は正式名で書き直した（期待値は同じ）。
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { installCoreFilters, coreFilters } from '../src/filters/core';
import { parseFilterArgsWithLiterals } from '../src/parser/parseFilterArgs';
import { installFormats, formatFilters } from '../src/filters/formats';
import { resolveFilter } from '../src/filters/registry';
import { config, setConfig } from '../src/config';
import { installFeatures } from "../src/hooks";
import { diagnostics } from "../src/features/diagnostics";

// the sentences are the diagnostics add-on's (the core alone gives the message number and the values)
installFeatures([diagnostics]);

beforeAll(() => {
  installCoreFilters();
  installFormats();
});

/** 実行時と同じ解決。型付きの値を渡さない呼び出しは原文を型付きの値の代わりにする（旧 `resolveFilterFn` の既定） */
const getFilter = (name: string, options: string[] = [], literals: readonly unknown[] = options) =>
  resolveFilter(name, options, literals);

/** 工場の直呼び（tooling の経路）。引数の個数の検査も型付きの値も経ないので、工場側の番人だけを見る */
const factory = (name: string, options: string[] = []) =>
  ({ ...coreFilters, ...formatFilters })[name].factory(options, []);

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
    it('add: 加算できること', () => {
      const fn = getFilter('add', ['5']);
      expect(fn(10)).toBe(15);
    });

    it('sub: 減算できること', () => {
      const fn = getFilter('sub', ['3']);
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
    it('upper: 大文字に変換できること', () => {
      const fn = getFilter('upper');
      expect(fn('hello')).toBe('HELLO');
    });

    it('lower: 小文字に変換できること', () => {
      const fn = getFilter('lower');
      expect(fn('HELLO')).toBe('hello');
    });

    it('capitalize: 先頭を大文字にできること', () => {
      const fn = getFilter('capitalize');
      expect(fn('hello')).toBe('Hello');
    });

    it('capitalize: 空文字/1文字の分岐を通ること', () => {
      const fn = getFilter('capitalize');
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

    it('substr は 4.0 で外した（slice に一本化）: 名前は未知のフィルタ、同じ切り出しは slice(start, start + length)', () => {
      expect(() => getFilter('substr', ['1', '3'])).toThrow(/\[wcs\/filter-unknown\] filter not found: substr/);
      expect(getFilter('slice', ['1', '4'])('hello')).toBe('ell');
    });

    it('padStart: 文字列をパディングできること', () => {
      const fn = getFilter('padStart', ['5']);
      expect(fn('42')).toBe('00042');
    });

    it('padStart: 文字指定でパディングできること', () => {
      const fn = getFilter('padStart', ['4', '*']);
      expect(fn('7')).toBe('***7');
    });

    it('repeat: 文字列を繰り返せること', () => {
      const fn = getFilter('repeat', ['3']);
      expect(fn('ab')).toBe('ababab');
    });

    it('reverse: 文字列を反転できること', () => {
      const fn = getFilter('reverse');
      expect(fn('hello')).toBe('olleh');
    });
  });

  describe('number format filters', () => {
    it('toFixed: 固定小数点に変換できること', () => {
      const fn = getFilter('toFixed', ['2']);
      expect(fn(3.14159)).toBe('3.14');
    });

    it('toFixed: デフォルト桁数(0)で動作すること', () => {
      const fn = getFilter('toFixed');
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

    it('nullIfEmpty: 空文字列をnullに変換できること', () => {
      const fn = getFilter('nullIfEmpty');
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
    });

    it('Object.prototype のメンバはフィルタとして通らないこと', () => {
      // 登録簿が Map を採っている理由。素のオブジェクトへのブラケット参照だと `|toString` が
      // `"[object Undefined]"` を返し、`|valueOf` は素の TypeError になっていた
      for (const name of ['toString', 'valueOf', 'constructor', 'hasOwnProperty']) {
        expect(() => getFilter(name), name).toThrow(/\[wcs\/filter-unknown\] filter not found/);
      }
    });

    it('オプション必須のフィルターは、束縛計画の段で引数の個数として拒否されること', () => {
      const names = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'add', 'sub', 'mul', 'div', 'mod', 'slice', 'padStart', 'repeat', 'defaults'];
      for (const name of names) {
        expect(() => getFilter(name), name).toThrow(/\[wcs\/filter-arity\] filter ".+" requires at least \d+ argument\(s\) \(0 given\)/);
      }
    });

    it('工場を直接呼ぶ経路（tooling）では、工場側の番人が未指定を落とすこと', () => {
      // 引数の個数の検査を経ないので `optionsRequired` が最後の砦になる
      const names = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'add', 'sub', 'mul', 'div', 'mod', 'slice', 'padStart', 'repeat', 'defaults', 'clamp', 'unit', 'truncate'];
      for (const name of names) {
        expect(() => factory(name), name).toThrow(/requires at least one option/);
      }
      expect(() => factory('clamp', ['0'])).toThrow(/requires at least one option/);
    });

    it('工場を直接呼ぶ経路には型付きの値が無いので、原文の引数で比較・置換すること', () => {
      // 実行時は resolveFilter が型付きの値（B9）も渡す
      expect(factory('eq', ['10'])(10)).toBe(true);
      expect(factory('ne', ['10'])(10)).toBe(false);
      expect(factory('defaults', ['0'])('')).toBe('0');
    });

    it('数値オプションが不正な場合はエラーになること', () => {
      const invalid = 'abc';
      const names = ['lt', 'le', 'gt', 'ge', 'add', 'sub', 'mul', 'div', 'mod', 'toFixed', 'round', 'floor', 'ceil', 'percent', 'slice', 'padStart', 'repeat'];
      for (const name of names) {
        expect(() => getFilter(name, [invalid]), name).toThrow(/requires a number as option/);
      }
      expect(() => getFilter('lt', [''])).toThrow(/requires a number as option/);
      expect(() => getFilter('clamp', [invalid, '1'])).toThrow(/requires a number as option/);
      expect(() => getFilter('clamp', ['1', invalid])).toThrow(/requires a number as option/);
    });

    it('数値系フィルターは数値以外を受け付けないこと', () => {
      const names = ['lt', 'le', 'gt', 'ge', 'add', 'sub', 'mul', 'div', 'mod', 'toFixed', 'round', 'floor', 'ceil', 'percent', 'locale'];
      for (const name of names) {
        const fn = getFilter(name, ['1']);
        expect(() => fn('x'), name).toThrow(/requires a number value/);
      }
    });

    it('eq/ne: 数値比較時は数値オプションが必要なこと', () => {
      const eqFn = getFilter('eq', ['abc']);
      const neFn = getFilter('ne', ['abc']);
      expect(() => eqFn(1)).toThrow(/requires a number as option/);
      expect(() => neFn(1)).toThrow(/requires a number as option/);
    });

    it('not: boolean以外も真偽性で反転すること', () => {
      const fn = getFilter('not');
      expect(fn('x')).toBe(false);
      expect(fn(0)).toBe(true);
      expect(fn('')).toBe(true);
      expect(fn(undefined)).toBe(true);
      expect(fn(null)).toBe(true);
      expect(fn(true)).toBe(false);
      expect(fn(false)).toBe(true);
    });

    it('date/time/datetime/ymd: Date以外はエラーになること', () => {
      const names = ['date', 'time', 'datetime', 'ymd'];
      for (const name of names) {
        const fn = getFilter(name);
        expect(() => fn('2026-01-30'), name).toThrow(/requires a date value/);
      }
    });
  });

  describe('string filters (extra)', () => {
    it('slice/repeat/padStartのオプションが正しく動くこと', () => {
      expect(getFilter('slice', ['1'])('abc')).toBe('bc');
      expect(getFilter('repeat', ['2'])('x')).toBe('xx');
      expect(getFilter('padStart', ['3', '_'])('a')).toBe('__a');
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
      expect(() => getFilter('abs')('x')).toThrow(/requires a number value/);
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
      expect(() => fn('x')).toThrow(/requires a number value/);
    });
  });

  describe('unit filter', () => {
    it('数値に単位を付けること', () => {
      expect(getFilter('unit', ['px'])(10)).toBe('10px');
      expect(getFilter('unit', ['%'])(50)).toBe('50%');
      expect(getFilter('unit', ['rem'])(1.5)).toBe('1.5rem');
    });

    // toFixed / percent は string を返すため、実用チェーンは string 入力になる。
    // ここで数値を要求すると「一番使いたい形」が通らなくなる
    it('文字列を返すフィルターの後ろに繋げられること', () => {
      const toFixed = getFilter('toFixed', ['1']);
      const unit = getFilter('unit', ['px']);
      expect(unit(toFixed(3.14159))).toBe('3.1px');
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
      expect(() => fn('abc')).toThrow(/requires an array value/);
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

    it('既定の省略記号は U+2026 の 1 文字であること', () => {
      const defaultSuffix = (getFilter('truncate', ['1'])('abc') as string).slice(1);
      expect(defaultSuffix).toBe('…');
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
      expect(() => getFilter('hms')('09:05:06')).toThrow(/requires a date value/);
    });
  });
});

// date / time / datetime はロケール引数を 1 つ受ける（README の規範 `timestamp|date(ja-JP)`）。
// arity 表が [0, 0] だった頃は、束縛計画の段で必ず [wcs/filter-arity] になっていた。
describe('ロケール引数を取る日付フィルタ（要件 B3 の引数の個数）', () => {
  const DATE = new Date(2026, 0, 30, 9, 5, 6);

  it('date / time / datetime は locale と同じく引数を 1 つ受けること', () => {
    expect(getFilter('date', ['ja-JP'])(DATE)).toBe(DATE.toLocaleDateString('ja-JP'));
    expect(getFilter('time', ['en-US'])(DATE)).toBe(DATE.toLocaleTimeString('en-US'));
    expect(getFilter('datetime', ['en-US'])(DATE)).toBe(DATE.toLocaleString('en-US'));
  });

  it('4 つ以上は引数の個数として拒否されること（4.10 で 3 つ目にタイムゾーンを取る）', () => {
    expect(() => getFilter('date', ['ja-JP', 'long', 'Asia/Tokyo', 'x']))
      .toThrow(/\[wcs\/filter-arity\] filter "date" accepts at most 3 argument\(s\) \(4 given\)/);
  });
});

// 4.2: 2 つ目は書式（Intl の dateStyle / timeStyle）。書式だけなら既定のロケール
// （docs/seam-apps.md、router-admin — 「Oct 13, 2026」を出せなかった）
describe('日付フィルタの書式と currency（4.2）', () => {
  const DATE = new Date(2026, 9, 13, 9, 5, 6);

  it('date / time / datetime は 2 つ目に full / long / medium / short を取ること', () => {
    expect(getFilter('date', ['en-US', 'medium'])(DATE)).toBe('Oct 13, 2026');
    expect(getFilter('date', ['ja-JP', 'long'])(DATE)).toBe(DATE.toLocaleDateString('ja-JP', { dateStyle: 'long' }));
    expect(getFilter('time', ['en-US', 'short'])(DATE)).toBe(DATE.toLocaleTimeString('en-US', { timeStyle: 'short' }));
    expect(getFilter('datetime', ['en-US', 'full'])(DATE)).toBe(DATE.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'full' }));
    // without a style: the numeric format, as before
    expect(getFilter('date', ['en-US'])(DATE)).toBe('10/13/2026');
  });

  it('書式だけなら既定のロケールで書くこと', () => {
    expect(getFilter('date', ['medium'])(DATE)).toBe(DATE.toLocaleDateString(Intl.getCanonicalLocales(config.locale)[0], { dateStyle: 'medium' }));
  });

  it('知らない書式は束縛の計画の段で、取れる値を挙げて拒否されること', () => {
    expect(() => getFilter('date', ['en-US', 'huge'])).toThrow(/filter date takes a style of full, long, medium or short, not "huge"/);
    expect(() => getFilter('time', ['en-US', 'Medium'])).toThrow(/filter time takes a style/);
  });

  it('currency は ISO 4217 の通貨で書き、ロケールは 2 つ目（無ければ既定）であること', () => {
    expect(getFilter('currency', ['USD', 'en-US'])(1234.5)).toBe('$1,234.50');
    expect(getFilter('currency', ['JPY', 'ja-JP'])(1800)).toBe((1800).toLocaleString('ja-JP', { style: 'currency', currency: 'JPY' }));
    expect(getFilter('currency', ['EUR'])(5)).toBe((5).toLocaleString(Intl.getCanonicalLocales(config.locale)[0], { style: 'currency', currency: 'EUR' }));
  });

  it('currency は通貨が要り、Intl の取らない通貨は計画の段で、数でない値は適用で拒否されること', () => {
    expect(() => getFilter('currency')).toThrow(/\[wcs\/filter-arity\] filter "currency" requires at least 1 argument\(s\) \(0 given\)/);
    expect(() => getFilter('currency', ['yen'])).toThrow(/filter currency takes an ISO 4217 currency code \(JPY, USD, EUR\), not "yen"/);
    expect(() => getFilter('currency', ['dollar'])).toThrow(/not "dollar"/);
    expect(getFilter('currency', ['jpy', 'en-US'])(1800)).toBe('¥1,800');
    expect(() => getFilter('currency', ['JPY'])('1800')).toThrow(/filter currency requires a number value, not a string \("1800"\) — put \|number before \|currency/);
  });

  it('ISO 文字列の date は、受け取った値と直し方を言うこと', () => {
    expect(() => getFilter('date')('2026-10-13')).toThrow(/filter date requires a date value \(a Date\), not a string \("2026-10-13"\) — make the Date where it is read/);
  });

  it('日付だけの文字列には、new Date("YYYY-MM-DD") が UTC の真夜中になることを言う。時刻のある文字列には言わない（family-ledger）', () => {
    expect(() => getFilter('date')('2026-10-13')).toThrow(/A date-only string is a day, not a moment: new Date\("2026-10-13"\) is midnight UTC/);
    let message = '';
    try { getFilter('date')('2026-10-13T09:00'); } catch (e) { message = String((e as Error).message); }
    expect(message).toContain('make the Date where it is read');
    expect(message).not.toContain('date-only');
  });
});

// B9 の型付きリテラル。数値の値に対して `eq(null)` / `eq(true)` は「一致しない」であって
// 「オプションが数値でない」ではない（null と数値を行き来するパスが適用のたびに壊れていた）。
describe('eq / ne と型付きリテラル（要件 B9）', () => {
  const planned = (name: string, args: string[], literals: unknown[]) =>
    resolveFilter(name, args, literals);

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
// `attr.title: x|trim` が title="undefined" を書き、`textContent: x|upper` が "UNDEFINED" を描いていた。
describe('表示面の空値契約（要件 B8）と書式フィルタ', () => {
  const stringFamily: ReadonlyArray<[string, string[]]> = [
    ['upper', []], ['lower', []], ['capitalize', []], ['trim', []], ['slice', ['1']],
    ['padStart', ['3']], ['padEnd', ['3']], ['repeat', ['2']],
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
  });

  it('日付の系統は値の無いとき素通しし（後から届く日付）、別の型は今も落ちること', () => {
    for (const name of ['date', 'time', 'datetime', 'ymd', 'hms']) {
      expect(getFilter(name)(undefined), name).toBe(undefined);
      expect(getFilter(name)(null), name).toBe(null);
      expect(() => getFilter(name)('2026-10-13'), name).toThrow(/requires a date value/);
    }
  });
});

// 4.10: 3 つ目は IANA のタイムゾーン（Intl の timeZone）。無ければ実行環境のゾーン（読み手の、SSR ではサーバーの）で書く
// （docs/seam-apps.md、city-library — 東京の図書館の木曜 09:00〜20:00 が、ロサンゼルスからは水曜の 17:00 · 4:00 と読めた）。
// 瞬間は UTC で決め、期待値は Intl そのものから作る（テストを走らせる環境のゾーンと ICU の実装差に依らない）。
describe('日付フィルタのタイムゾーン（4.10）', () => {
  // 2026-10-29 (Thu) 09:00 / 20:00 in Tokyo (UTC+9) — 2026-10-28 (Wed) 17:00 / 04:00 in Los Angeles (PDT)
  const OPEN = new Date(Date.UTC(2026, 9, 29, 0, 0));
  const CLOSE = new Date(Date.UTC(2026, 9, 29, 11, 0));
  const TOKYO = 'Asia/Tokyo';
  const page = () => Intl.getCanonicalLocales(config.locale)[0];
  /** the options as the parser hands them over (a leading or middle empty argument keeps its place) */
  const args = (text: string) => parseFilterArgsWithLiterals(text).args;

  it('3 つ目のタイムゾーンで書き、読み手のゾーンに依らないこと（city-library の開館時刻）', () => {
    expect(getFilter('date', ['ja-JP', 'full', TOKYO])(OPEN)).toBe(OPEN.toLocaleDateString('ja-JP', { dateStyle: 'full', timeZone: TOKYO }));
    expect(getFilter('date', ['ja-JP', 'full', TOKYO])(OPEN)).toContain('10月29日木曜日');
    expect(getFilter('time', ['en-US', 'short', TOKYO])(OPEN)).toMatch(/^9:00\sAM$/);
    expect(getFilter('time', ['en-US', 'short', TOKYO])(CLOSE)).toMatch(/^8:00\sPM$/);
    expect(getFilter('datetime', ['en-US', 'medium', TOKYO])(OPEN)).toBe(OPEN.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium', timeZone: TOKYO }));
    // the same moment, where the reader is
    expect(getFilter('date', ['ja-JP', 'full', 'America/Los_Angeles'])(OPEN)).toContain('10月28日水曜日');
    expect(getFilter('time', ['en-US', 'short', 'America/Los_Angeles'])(OPEN)).toMatch(/^5:00\sPM$/);
  });

  it('タイムゾーンが無ければ、4.9 までと同じくオプションを渡さず実行環境のゾーンで書くこと', () => {
    const spies = [
      vi.spyOn(Date.prototype, 'toLocaleDateString'),
      vi.spyOn(Date.prototype, 'toLocaleTimeString'),
      vi.spyOn(Date.prototype, 'toLocaleString'),
    ];
    try {
      getFilter('date', ['ja-JP'])(OPEN);
      getFilter('time')(OPEN);
      getFilter('datetime', args(','))(OPEN);
      expect(spies[0]).toHaveBeenCalledWith('ja-JP', undefined);
      expect(spies[1]).toHaveBeenCalledWith(page(), undefined);
      expect(spies[2]).toHaveBeenCalledWith(page(), undefined);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(getFilter('date', ['ja-JP'])(OPEN)).toBe(OPEN.toLocaleDateString('ja-JP'));
  });

  it('空の引数は既定のままで、ロケールも書式も空にできること（4.9 までは Intl の中で毎回落ちた）', () => {
    expect(args(',,Asia/Tokyo')).toEqual(['', '', TOKYO]);
    expect(getFilter('datetime', args(',,Asia/Tokyo'))(OPEN)).toBe(OPEN.toLocaleString(page(), { timeZone: TOKYO }));
    expect(getFilter('date', args('ja-JP,,Asia/Tokyo'))(OPEN)).toBe(OPEN.toLocaleDateString('ja-JP', { timeZone: TOKYO }));
    expect(getFilter('time', args(',short,Asia/Tokyo'))(OPEN)).toBe(OPEN.toLocaleTimeString(page(), { timeStyle: 'short', timeZone: TOKYO }));
    expect(getFilter('date', args(',long'))(OPEN)).toBe(OPEN.toLocaleDateString(page(), { dateStyle: 'long' }));
    expect(getFilter('date', args(',,'))(OPEN)).toBe(OPEN.toLocaleDateString(page()));
    // the factory called without options (tooling) keeps every default too
    expect(formatFilters.date.factory(undefined as unknown as string[], [])(OPEN)).toBe(OPEN.toLocaleDateString(page()));
  });

  it('既定のロケールはタイムゾーンがあっても適用のたびに読むこと', () => {
    const original = config.locale;
    try {
      setConfig({ locale: 'de-DE' });
      const fn = getFilter('date', ['', 'long', TOKYO]);
      expect(fn(OPEN)).toBe(OPEN.toLocaleDateString('de-DE', { dateStyle: 'long', timeZone: TOKYO }));
      setConfig({ locale: 'en-US' });
      expect(fn(OPEN)).toBe(OPEN.toLocaleDateString('en-US', { dateStyle: 'long', timeZone: TOKYO }));
    } finally {
      setConfig({ locale: original });
    }
  });

  it('ロケールの場所の書式は今までどおり書式で、タイムゾーンを後に置けること', () => {
    expect(getFilter('date', ['long'])(OPEN)).toBe(OPEN.toLocaleDateString(page(), { dateStyle: 'long' }));
    expect(getFilter('time', args('short,,Asia/Tokyo'))(OPEN)).toBe(OPEN.toLocaleTimeString(page(), { timeStyle: 'short', timeZone: TOKYO }));
  });

  it('タイムゾーンだけ（"/" を含むものと UTC）なら、既定のロケールと書式のままで書くこと', () => {
    expect(getFilter('date', [TOKYO])(OPEN)).toBe(OPEN.toLocaleDateString(page(), { timeZone: TOKYO }));
    expect(getFilter('time', ['America/Los_Angeles'])(OPEN)).toBe(OPEN.toLocaleTimeString(page(), { timeZone: 'America/Los_Angeles' }));
    expect(getFilter('datetime', ['UTC'])(OPEN)).toBe(OPEN.toLocaleString(page(), { timeZone: 'UTC' }));
    expect(getFilter('date', ['Etc/GMT-9'])(OPEN)).toBe(OPEN.toLocaleDateString(page(), { timeZone: 'Etc/GMT-9' }));
    // "/" の無いほかのゾーンは 3 つ目に書く（ロケールの場所では言語タグとして読む）
    expect(getFilter('date', args(',,GMT'))(OPEN)).toBe(OPEN.toLocaleDateString(page(), { timeZone: 'GMT' }));
    expect(getFilter('date', ['en-GB'])(OPEN)).toBe(OPEN.toLocaleDateString('en-GB'));
  });

  it('Intl の取らないタイムゾーンは、束縛の計画の段で取れる値の例を挙げて拒否されること', () => {
    expect(() => getFilter('date', ['ja-JP', 'long', 'Asia/Tokio']))
      .toThrow(/filter date takes an IANA time zone \(Asia\/Tokyo, America\/New_York, UTC\), not "Asia\/Tokio"/);
    expect(() => getFilter('time', ['Asia/Tokio'])).toThrow(/filter time takes an IANA time zone .*not "Asia\/Tokio"/);
    expect(() => getFilter('datetime', args(',,Tokyo'))).toThrow(/filter datetime takes an IANA time zone .*not "Tokyo"/);
  });

  it('書式の場所に書いたタイムゾーンは、3 つ目に書くよう言われること', () => {
    const where = /filter date takes a style of full, long, medium or short, not "Asia\/Tokyo" — a time zone is the third argument, after the locale and the style, and an empty argument keeps its default: date\(,,Asia\/Tokyo\), date\(en-US,long,Asia\/Tokyo\)/;
    expect(() => getFilter('date', ['ja-JP', TOKYO])).toThrow(where);
    expect(() => getFilter('date', ['long', TOKYO])).toThrow(where);
    expect(() => getFilter('time', ['ja-JP', 'UTC'])).toThrow(/not "UTC" — a time zone is the third argument, .*time\(,,UTC\)/);
    // a style that is not a zone is told only the styles
    let message = '';
    try { getFilter('date', ['en-US', 'huge']); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('not "huge"');
    expect(message).not.toContain('time zone');
  });

  it('タイムゾーンがあっても、値の無いときは素通しし、別の型は落ちること', () => {
    for (const name of ['date', 'time', 'datetime']) {
      const fn = getFilter(name, ['', '', TOKYO]);
      expect(fn(undefined), name).toBe(undefined);
      expect(fn(null), name).toBe(null);
      expect(() => fn('2026-10-29'), name).toThrow(/requires a date value/);
    }
  });

  it('ymd / hms はタイムゾーンを取らず、実行環境のゾーンの年月日・時分秒を書くこと', () => {
    const local = new Date(2026, 9, 29, 9, 5, 6);
    expect(getFilter('ymd')(local)).toBe('2026-10-29');
    expect(getFilter('hms')(local)).toBe('09:05:06');
    expect(getFilter('ymd', ['/'])(new Date(987, 0, 2))).toBe('987/01/02');
    expect(() => getFilter('ymd', ['-', TOKYO])).toThrow(/\[wcs\/filter-arity\] filter "ymd" accepts at most 1 argument\(s\) \(2 given\)/);
  });
});

// ロケール依存フィルタ（locale / date / time / datetime）は、既定ロケールを**適用のたびに**読む。
// バインド構築時点の config.locale をクロージャに焼き込むと、起動順序が少しでもずれたとき
// 「同じページの中で日付だけ既定ロケール」が永続して回復しない。
// 期待値は Intl そのものから作る（ICU の実装差に依存しないため）。
describe('ロケール依存フィルタの既定ロケール解決', () => {
  const original = config.locale;
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
    expect(fn(value)).toBe(expected(A));

    setConfig({ locale: B });                    // 生成より後にロケールが変わる
    expect(fn(value)).toBe(expected(B));
  });

  it.each(cases)('%s: 明示引数は config.locale の変更に影響されないこと', (name, value, expected) => {
    setConfig({ locale: A });
    const fn = getFilter(name, [A]);             // 明示引数はバインド式の一部なので固定でよい
    setConfig({ locale: B });
    expect(fn(value)).toBe(expected(A));
  });
});
