import { describe, it, expect } from 'vitest';
import { parseFilterArgs } from '../src/bindTextParser/parseFilterArgs';

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
      expect(parseFilterArgs('"  spaced  "')).toEqual(['spaced']);
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

    it('空のクォート文字列を扱えること', () => {
      expect(parseFilterArgs('""')).toEqual([]);
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
