import { describe, it, expect } from 'vitest';
import { parseFilterArgsWithLiterals } from '../src/parser/parseFilterArgs';

/** 原文だけを見るケース用の薄いラッパ（かつては src 側にあったデッドエクスポート） */
const parseFilterArgs = (argsText: string): string[] => parseFilterArgsWithLiterals(argsText).args;

describe('parseFilterArgs', () => {
  describe('基本的なパース', () => {
    it('単一の引数をパースできること', () => {
      expect(parseFilterArgs('10')).toEqual(['10']);
    });

    it('複数の引数をパースできること', () => {
      expect(parseFilterArgs('0,5')).toEqual(['0', '5']);
    });

    it('空文字列は空配列を返すこと', () => {
      expect(parseFilterArgs('')).toEqual([]);
    });

    it('引数の前後の空白をトリムすること', () => {
      expect(parseFilterArgs('  10  ,  20  ')).toEqual(['10', '20']);
    });
  });

  describe('ダブルクォート', () => {
    it('ダブルクォートで囲まれた文字列をパースできること', () => {
      expect(parseFilterArgs('"hello"')).toEqual(['hello']);
    });

    it('ダブルクォート内のカンマを保持できること', () => {
      expect(parseFilterArgs('"hello, world"')).toEqual(['hello, world']);
    });

    it('ダブルクォート内のスペースを保持できること', () => {
      expect(parseFilterArgs('"  spaced  "')).toEqual(['  spaced  ']);
    });

    // クォートは「ここは literal」の宣言。中身をトリムしていたため
    // `pad(5, ' ')` が padStart(5, '') ＝ 無変化に化けていた
    it('空白だけのクォート引数が空文字に潰れないこと', () => {
      expect(parseFilterArgs("5, ' '")).toEqual(['5', ' ']);
      expect(parseFilterArgs("' / '")).toEqual([' / ']);
    });

    it('クォートの外側の空白はトリムすること', () => {
      expect(parseFilterArgs('  " x "  ')).toEqual([' x ']);
      expect(parseFilterArgs('  a  ,  " b "  ')).toEqual(['a', ' b ']);
    });

    it('クォートと素のテキストが混在しても内側だけ残ること', () => {
      expect(parseFilterArgs('a" b "c')).toEqual(['a b c']);
      expect(parseFilterArgs('  a" b "c  ')).toEqual(['a b c']);
    });

    it('ダブルクォートと通常引数を混在できること', () => {
      expect(parseFilterArgs('5,"hello, world"')).toEqual(['5', 'hello, world']);
    });
  });

  describe('シングルクォート', () => {
    it('シングルクォートで囲まれた文字列をパースできること', () => {
      expect(parseFilterArgs("'hello'")).toEqual(['hello']);
    });

    it('シングルクォート内のカンマを保持できること', () => {
      expect(parseFilterArgs("'hello, world'")).toEqual(['hello, world']);
    });

    it('シングルクォート内のダブルクォートを保持できること', () => {
      expect(parseFilterArgs("'He said \"Hi\"'")).toEqual(['He said "Hi"']);
    });
  });

  describe('混合ケース', () => {
    it('複数のクォート付き引数をパースできること', () => {
      expect(parseFilterArgs('"a,b","c,d"')).toEqual(['a,b', 'c,d']);
    });

    it('クォートなし、ダブルクォート、シングルクォートを混在できること', () => {
      expect(parseFilterArgs('10,"hello, world",\'test\'')).toEqual(['10', 'hello, world', 'test']);
    });

    it('空のダブルクォート文字列は空文字の引数として扱われること', () => {
      expect(parseFilterArgs('""')).toEqual(['']);
    });

    it('空のシングルクォート文字列は空文字の引数として扱われること', () => {
      expect(parseFilterArgs("''")).toEqual(['']);
    });

    it('クォート外の空要素も含まれること', () => {
      expect(parseFilterArgs('a,,b')).toEqual(['a', '', 'b']);
    });
  });

  describe('エッジケース', () => {
    it('カンマのみの場合は空文字列を返すこと', () => {
      expect(parseFilterArgs(',')).toEqual(['']);
    });

    it('複数のカンマのみの場合は空文字列を返すこと', () => {
      expect(parseFilterArgs(',,,')).toEqual(['', '', '']);
    });

    it('数値文字列をそのまま返すこと', () => {
      expect(parseFilterArgs('3.14')).toEqual(['3.14']);
    });

    it('負の数値文字列をそのまま返すこと', () => {
      expect(parseFilterArgs('-10')).toEqual(['-10']);
    });
  });
});

/**
 * 型付きの値（要件 B9）。引用符の無い `true` / `false` / `null` / 数値は型付き、
 * 引用符付きは文字列のまま。原文（args）だけを見ていると `eq(1)` と `eq('1')` を
 * 取り違えるので、`literals` まで固定する。
 */
describe('parseFilterArgsWithLiterals — 型付きの値', () => {
  it.each([
    ['1', 1],
    ['1.5', 1.5],
    ['-10', -10],
    ['+1', 1],
    ['1e3', 1000],
    ['true', true],
    ['false', false],
    ['null', null],
    ['abc', 'abc'],
  ])('引用符の無い %s は %s になること', (text, literal) => {
    expect(parseFilterArgsWithLiterals(text).literals).toEqual([literal]);
  });

  it.each(["'1'", '"1"', "'true'", "'null'"])('引用符付きの %s は文字列のままであること', (text) => {
    const { args, literals } = parseFilterArgsWithLiterals(text);
    expect(literals).toEqual(args);
    expect(typeof literals[0]).toBe('string');
  });

  it('原文と型付きの値が同じ個数・同じ並びであること', () => {
    const { args, literals } = parseFilterArgsWithLiterals("1, '2', true, x");
    expect(args).toEqual(['1', '2', 'true', 'x']);
    expect(literals).toEqual([1, '2', true, 'x']);
  });

  it('末尾の空引数だけが落ちること（先頭・中間は位置を保つ）', () => {
    expect(parseFilterArgsWithLiterals('a,').args).toEqual(['a']);
    expect(parseFilterArgsWithLiterals(',a').args).toEqual(['', 'a']);
    expect(parseFilterArgsWithLiterals(',').args).toEqual(['']);
    expect(parseFilterArgsWithLiterals(',,,').args).toEqual(['', '', '']);
    expect(parseFilterArgsWithLiterals('').args).toEqual([]);
  });
});
