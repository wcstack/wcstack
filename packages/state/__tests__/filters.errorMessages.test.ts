import { describe, it, expect } from 'vitest';
import { 
  optionsRequired, 
  optionMustBeNumber, 
  valueMustBeNumber,
  valueMustBeString,
  valueMustBeBoolean,
  valueMustBeDate
} from '../src/filters/errorMessages';

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

  describe('valueMustBeString', () => {
    it('エラーメッセージにフィルター名が含まれること', () => {
      expect(() => valueMustBeString('testFilter')).toThrow(/testFilter/);
      expect(() => valueMustBeString('testFilter')).toThrow(/requires a string value/);
    });
  });

  describe('valueMustBeBoolean', () => {
    it('エラーメッセージにフィルター名が含まれること', () => {
      expect(() => valueMustBeBoolean('testFilter')).toThrow(/testFilter/);
      expect(() => valueMustBeBoolean('testFilter')).toThrow(/requires a boolean value/);
    });
  });

  describe('valueMustBeDate', () => {
    it('エラーメッセージにフィルター名が含まれること', () => {
      expect(() => valueMustBeDate('testFilter')).toThrow(/testFilter/);
      expect(() => valueMustBeDate('testFilter')).toThrow(/requires a date value/);
    });
  });
});
