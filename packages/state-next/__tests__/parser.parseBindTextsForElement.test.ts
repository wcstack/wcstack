import { describe, it, expect } from 'vitest';
import { parseBindTextsForElement } from '../src/parser/parseBindTextsForElement';
import { installFeatures } from "../src/hooks";
import { diagnostics } from "../src/features/diagnostics";

// messages as the full bundle shows them: the diagnostics add-on appends the guidance
installFeatures([diagnostics]);

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

  it('eventTokenバインディングはevent型として分類されること', () => {
    const result = parseBindTextsForElement('eventToken.error: createFailed');
    expect(result).toHaveLength(1);
    expect(result[0].bindingType).toBe('event');
    expect(result[0].propSegments).toEqual(['eventToken', 'error']);
    expect(result[0].statePathName).toBe('createFailed');
  });

  it('eventTokenバインディングはmodifierを保持すること', () => {
    const result = parseBindTextsForElement('eventToken.error#prevent: createFailed');
    expect(result[0].bindingType).toBe('event');
    expect(result[0].propModifiers).toEqual(['prevent']);
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
    expect(result[0].statePathName).toBe('#else');
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

/**
 * 引用符の中は区切りではない（要件 B1）。`;` と `|` は 3.1 で対応済みだったが、
 * 左辺と右辺を分ける `:` だけが素の `indexOf` のままで、`defaults(':')` のような
 * 引数を書くとパースが壊れていた。
 */
describe('parseBindTextsForElement — 引用符の中の区切り文字', () => {
  it('左辺の入力フィルタ引数の中の `:` を区切りにしないこと', () => {
    const [result] = parseBindTextsForElement("value|defaults(':'): path");
    expect(result.propName).toBe('value');
    expect(result.statePathName).toBe('path');
    expect(result.inFilters[0]).toMatchObject({ filterName: 'defaults', args: [':'] });
  });

  it('右辺のフィルタ引数の中の `:` を区切りにしないこと', () => {
    const [result] = parseBindTextsForElement("textContent: parts|join(': ')");
    expect(result.propName).toBe('textContent');
    expect(result.statePathName).toBe('parts');
    expect(result.outFilters[0]).toMatchObject({ filterName: 'join', args: [': '] });
  });
});

describe('parseBindTextsForElement — 文法エラーの語彙', () => {
  it('`:` 欠落に [wcs/binding-syntax] と lint への誘導が付くこと', () => {
    expect(() => parseBindTextsForElement('textContent message'))
      .toThrow(/\[wcs\/binding-syntax\] Invalid bindText: "textContent message"\. Missing ':' separator/);
    expect(() => parseBindTextsForElement('textContent message')).toThrow(/npx @wcstack\/lint/);
  });

  it('spread の 2 つのエラーに [wcs/binding-syntax] と lint への誘導が付くこと', () => {
    expect(() => parseBindTextsForElement('...: target|uc'))
      .toThrow(/\[wcs\/binding-syntax\] Invalid spread binding ".*": filters are not allowed/);
    expect(() => parseBindTextsForElement('...: ')).toThrow(/\[wcs\/binding-syntax\] Invalid spread binding ".*": spread target path is required/);
    expect(() => parseBindTextsForElement('...: ')).toThrow(/npx @wcstack\/lint/);
  });
});
