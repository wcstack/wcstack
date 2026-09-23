import { describe, it, expect } from 'vitest';
// `valueMustBeString` / `valueMustBeBoolean` は 3.x で参照がゼロになったので削除した
// （`not` が真偽性ベースになった時点で最後の利用者が消えた）。この 2 つに対するテストは
// 死んだコードを生かしているだけで、カバレッジ 100% の偽の緑を作っていた。
import {
  optionsRequired,
  optionMustBeNumber,
  valueMustBeNumber,
  valueMustBeDate,
  valueMustBeArray
} from '../src/formats/errorMessages';

describe('filter errorMessages', () => {
  describe('optionsRequired', () => {
    it('エラーメッセージにフィルター名が含まれること', () => {
      expect(() => optionsRequired('testFilter')).toThrow(/testFilter/);
      expect(() => optionsRequired('testFilter')).toThrow(/requires at least one option/);
    });
  });

  describe('optionMustBeNumber', () => {
    it('エラーメッセージにフィルター名が含まれること', () => {
      expect(() => optionMustBeNumber('testFilter')).toThrow(/testFilter/);
      expect(() => optionMustBeNumber('testFilter')).toThrow(/requires a number as option/);
    });
  });

  describe('valueMustBeNumber', () => {
    it('エラーメッセージにフィルター名が含まれること', () => {
      expect(() => valueMustBeNumber('testFilter')).toThrow(/testFilter/);
      expect(() => valueMustBeNumber('testFilter')).toThrow(/requires a number value/);
    });
  });

  describe('valueMustBeDate', () => {
    it('エラーメッセージにフィルター名が含まれること', () => {
      expect(() => valueMustBeDate('testFilter')).toThrow(/testFilter/);
      expect(() => valueMustBeDate('testFilter')).toThrow(/requires a date value/);
    });
  });

  describe('valueMustBeArray', () => {
    it('エラーメッセージにフィルター名が含まれること', () => {
      expect(() => valueMustBeArray('testFilter')).toThrow(/testFilter/);
      expect(() => valueMustBeArray('testFilter')).toThrow(/requires an array value/);
    });
  });
});
