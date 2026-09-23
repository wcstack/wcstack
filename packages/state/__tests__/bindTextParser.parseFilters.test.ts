import { describe, it, expect } from 'vitest';
import { parseFilters } from '../src/bindTextParser/parseFilters';
import { planFilters } from '../src/bindings/planFilters';
import { installFormats } from '../src/formats/install';
import { parseBindTextsForElement } from '../src/bindTextParser/parseBindTextsForElement';

// 解析の段は名前と引数だけを作る（要件 D16）。実関数は束縛計画の段で登録簿から引く
installFormats();

describe('parseFilters', () => {
  it('引数なしのフィルターをパースできること', () => {
    const result = parseFilters(['uc'], 'output');
    expect(result.length).toBe(1);
    expect(result[0].filterName).toBe('uc');
    expect(result[0].args).toEqual([]);
    // 解析の段では実関数を持たない
    expect('filterFn' in result[0]).toBe(false);
  });

  it('引数ありのフィルターをパースできること', () => {
    const result = parseFilters(['gt(10)'], 'output');
    expect(result.length).toBe(1);
    expect(result[0].filterName).toBe('gt');
    expect(result[0].args).toEqual(['10']);
  });

  it('複数引数のフィルターをパースできること', () => {
    const result = parseFilters(['substr(0,5)'], 'output');
    expect(result.length).toBe(1);
    expect(result[0].filterName).toBe('substr');
    expect(result[0].args).toEqual(['0', '5']);
  });

  it('複数のフィルターをパースできること', () => {
    const result = parseFilters(['uc', 'trim', 'slice(2)'], 'output');
    expect(result.length).toBe(3);
    expect(result[0].filterName).toBe('uc');
    expect(result[1].filterName).toBe('trim');
    expect(result[2].filterName).toBe('slice');
    expect(result[2].args).toEqual(['2']);
  });

  it('閉じ括弧がない場合はエラーになること', () => {
    expect(() => parseFilters(['gt(10'], 'output')).toThrow(/missing closing parenthesis/);
  });

  it('開き括弧がない場合はエラーになること', () => {
    expect(() => parseFilters(['gt10)'], 'output')).toThrow(/missing opening parenthesis/);
  });

  it('束縛計画の段で解決した実関数が実行可能であること', () => {
    const planned = planFilters(parseFilters(['uc'], 'output'), 'output');
    expect(planned[0].filterFn('hello')).toBe('HELLO');
  });

  it('未知のフィルタは解析では落ちず、束縛計画の段で名指しで落ちること', () => {
    const parsed = parseFilters(['nosuchfilter'], 'output');
    expect(parsed[0].filterName).toBe('nosuchfilter');
    expect(() => planFilters(parsed, 'output')).toThrow(/\[wcs\/filter-unknown\] filter not found: nosuchfilter/);
  });

  it('チェーンしたフィルターが正しく動作すること', () => {
    const planned = planFilters(parseFilters(['trim', 'uc'], 'output'), 'output');
    let value: unknown = '  hello  ';
    for (const filter of planned) {
      value = filter.filterFn(value);
    }
    expect(value).toBe('HELLO');
  });

  it('ダブルクォート内のカンマを正しく扱えること', () => {
    const result = parseFilters(['defaults("Hello, World")'], 'output');
    expect(result[0].filterName).toBe('defaults');
    expect(result[0].args).toEqual(['Hello, World']);
  });

  it('シングルクォート内のカンマを正しく扱えること', () => {
    const result = parseFilters(["defaults('Hello, World')"], 'output');
    expect(result[0].filterName).toBe('defaults');
    expect(result[0].args).toEqual(['Hello, World']);
  });

  it('クォートなしとクォートありの引数を混在できること', () => {
    const result = parseFilters(['substr(0, 5)'], 'output');
    expect(result[0].args).toEqual(['0', '5']);
  });

  it('クォート付き引数と通常引数を混在できること', () => {
    const result = parseFilters(['pad(5,"0")'], 'output');
    expect(result[0].filterName).toBe('pad');
    expect(result[0].args).toEqual(['5', '0']);
  });
});

/**
 * 文法エラーの語彙（要件 B2 / B4・三面同語彙）。vscode-wcs は `[wcs/binding-syntax]` を
 * 含むメッセージだけを診断に変換するので、構文エラーにはコードと lint への誘導を付ける。
 */
describe('parseFilters — 文法エラーの語彙', () => {
  it('括弧の不一致に [wcs/binding-syntax] と lint への誘導が付くこと', () => {
    expect(() => parseFilters(['truncate(3'], 'output'))
      .toThrow(/\[wcs\/binding-syntax\] Invalid filter format: missing closing parenthesis in "truncate\(3"/);
    expect(() => parseFilters(['truncate(3'], 'output')).toThrow(/npx @wcstack\/lint/);
    expect(() => parseFilters(['truncate3)'], 'output'))
      .toThrow(/\[wcs\/binding-syntax\] Invalid filter format: missing opening parenthesis in "truncate3\)"/);
  });

  /**
   * **実パイプライン（`parseBindTextsForElement`）で固定する。** `parseFilters` を直接叩いて
   * `sourceText` を手渡すテストは、呼び出し側が何を渡しているかを検証しないので false green に
   * なる（実際、呼び出し側が `|` より後ろだけを渡していた間もそのテストは通っていた）。
   */
  describe('空フィルタのメッセージに原文が入ること（実パイプライン）', () => {
    it.each([
      ['textContent: a|', 'a|'],
      ['value|: x', 'value|'],
      ['textContent: a||b', 'a||b'],
      ['textContent: a|b|', 'a|b|'],
    ])('%s のメッセージに "%s" が入ること', (bindText, source) => {
      expect(() => parseBindTextsForElement(bindText))
        .toThrow(`an empty filter in "${source}"`);
    });

    it('原文が空文字にならないこと（旧実装の join("|") との差）', () => {
      expect(() => parseBindTextsForElement('textContent: a|')).not.toThrow(/an empty filter in ""/);
    });
  });

  describe('フィルタ名に修飾子が飲まれた形（実パイプライン）', () => {
    it('左辺（入力フィルタ）では、修飾子の位置を名指しで示すこと', () => {
      expect(() => parseBindTextsForElement('value|trim#ro: x'))
        .toThrow(/\[wcs\/binding-syntax\] "trim#ro" is not a filter name: a modifier list "#ro" comes before the input filters/);
      expect(() => parseBindTextsForElement('value|trim#ro: x')).toThrow(/write "<property>#ro\|trim"/);
    });

    it('右辺（出力フィルタ）では、成立しない直し方を勧めないこと', () => {
      // 修飾子は左辺にしか存在しないので、右辺で「修飾子をフィルタより前に書け」と言うと
      // `textContent#ro|trim: x` を勧めることになり、`textContent` に `ro` は無意味
      expect(() => parseBindTextsForElement('textContent: x|trim#ro'))
        .toThrow(/\[wcs\/binding-syntax\] "trim#ro" is not a filter name: "#" cannot appear in one/);
      expect(() => parseBindTextsForElement('textContent: x|trim#ro'))
        .toThrow(/Modifiers belong on the left side of the binding, before the ":"/);
      expect(() => parseBindTextsForElement('textContent: x|trim#ro')).not.toThrow(/comes before the input filters/);
    });
  });
});
