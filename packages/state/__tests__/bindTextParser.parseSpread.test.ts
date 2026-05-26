import { describe, it, expect } from 'vitest';
import { parseBindTextsForElement } from '../src/bindTextParser/parseBindTextsForElement';

describe('parseBindTextsForElement - spread (...)', () => {
  it('spread をパースできること', () => {
    const result = parseBindTextsForElement('...: fetchX');
    expect(result).toHaveLength(1);
    expect(result[0].bindingType).toBe('spread');
    expect(result[0].propName).toBe('...');
    expect(result[0].statePathName).toBe('fetchX');
    expect(result[0].stateName).toBe('default');
  });

  it('spread が @stateName を伝搬すること', () => {
    const result = parseBindTextsForElement('...: fetchX@store');
    expect(result).toHaveLength(1);
    expect(result[0].bindingType).toBe('spread');
    expect(result[0].statePathName).toBe('fetchX');
    expect(result[0].stateName).toBe('store');
  });

  it('spread が wildcard を含むパスを許容すること', () => {
    const result = parseBindTextsForElement('...: stores.*.fetch');
    expect(result).toHaveLength(1);
    expect(result[0].bindingType).toBe('spread');
    expect(result[0].statePathName).toBe('stores.*.fetch');
  });

  it('spread と通常 binding の混在を許容すること', () => {
    const result = parseBindTextsForElement('...: fetchX; value: users');
    expect(result).toHaveLength(2);
    expect(result[0].bindingType).toBe('spread');
    expect(result[1].bindingType).toBe('prop');
    expect(result[1].propName).toBe('value');
  });

  it('spread の右辺にフィルタを付けるとエラーになること', () => {
    expect(() => parseBindTextsForElement('...: fetchX|uc')).toThrow(/filters are not allowed/);
  });

  it('spread の右辺が空だとエラーになること', () => {
    expect(() => parseBindTextsForElement('...: ')).toThrow(/spread target path is required/);
  });

  it('spread を構造バインディングと同居させるとエラーになること', () => {
    expect(() => parseBindTextsForElement('for: items; ...: fetchX')).toThrow(/must be single binding/);
  });
});
