import { describe, it, expect } from 'vitest';
import { parseBindTextsForElement } from '../src/bindTextParser/parseBindTextsForElement';

describe('parseBindTextsForElement', () => {
  it('propバインディングをパースできること', () => {
    const result = parseBindTextsForElement('textContent: message');
    expect(result).toHaveLength(1);
    expect(result[0].bindingType).toBe('prop');
    expect(result[0].propName).toBe('textContent');
    expect(result[0].statePathName).toBe('message');
  });

  it('eventバインディングをパースできること', () => {
    const result = parseBindTextsForElement('onclick: handleClick');
    expect(result).toHaveLength(1);
    expect(result[0].bindingType).toBe('event');
    expect(result[0].propName).toBe('onclick');
    expect(result[0].statePathName).toBe('handleClick');
  });

  it('ifバインディングをパースできること', () => {
    const result = parseBindTextsForElement('if: count');
    expect(result).toHaveLength(1);
    expect(result[0].bindingType).toBe('if');
    expect(result[0].statePathName).toBe('count');
  });

  it('elseバインディングをパースできること', () => {
    const result = parseBindTextsForElement('else:');
    expect(result).toHaveLength(1);
    expect(result[0].bindingType).toBe('else');
    expect(result[0].statePathName).toBe('');
  });

  it('forバインディングをパースできること', () => {
    const result = parseBindTextsForElement('for: items');
    expect(result).toHaveLength(1);
    expect(result[0].bindingType).toBe('for');
    expect(result[0].statePathName).toBe('items');
  });

  it('elseifバインディングをパースできること', () => {
    const result = parseBindTextsForElement('elseif: flag');
    expect(result).toHaveLength(1);
    expect(result[0].bindingType).toBe('elseif');
    expect(result[0].statePathName).toBe('flag');
  });

  it('区切り文字がない場合はエラーになること', () => {
    expect(() => parseBindTextsForElement('textContent message')).toThrow(/Missing ':' separator/);
  });

  it('構造バインディングが複数ある場合はエラーになること', () => {
    expect(() => parseBindTextsForElement('if: a; textContent: b')).toThrow(/must be single binding/);
  });

  it('構造バインディングが含まれない複数指定は許可されること', () => {
    const result = parseBindTextsForElement('value: name; class.active: isActive');
    expect(result).toHaveLength(2);
    expect(result[0].bindingType).toBe('prop');
    expect(result[1].bindingType).toBe('prop');
  });
});
