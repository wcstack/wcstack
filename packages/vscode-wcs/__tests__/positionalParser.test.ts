/**
 * positionalParser.test.ts — 正本パーサの tolerant・位置付きラッパーの契約検証。
 *
 * スパン断言は「slice したら元のトークン文字列が出る」形で固定する（オフセット
 * 演算の誤りは数値比較より slice 比較のほうが確実に露見する）。
 */
import { describe, it, expect } from 'vitest';
import { parseBindTextWithPositions } from '../src/core/parser/positionalParser';

const sliceOf = (text: string, range: { start: number; end: number } | null): string | null =>
  range === null ? null : text.slice(range.start, range.end);

describe('parseBindTextWithPositions', () => {
  it('単純な prop バインディングのスパンを返すこと', () => {
    const text = 'textContent: user.name';
    const [b] = parseBindTextWithPositions(text);
    expect(b.parsed?.bindingType).toBe('prop');
    expect(sliceOf(text, b.propRange)).toBe('textContent');
    expect(sliceOf(text, b.pathRange)).toBe('user.name');
    expect(sliceOf(text, b.exprRange)).toBe(text);
  });

  it('修飾子・フィルタ込みでも各トークンを正しく指し、@state は v2 の parse error になること', () => {
    const text = '  value#ro: price | fix(2)  ';
    const [b] = parseBindTextWithPositions(text);
    expect(sliceOf(text, b.propRange)).toBe('value');
    expect(sliceOf(text, b.pathRange)).toBe('price');
    expect(sliceOf(text, b.exprRange)).toBe('value#ro: price | fix(2)');

    const [broken] = parseBindTextWithPositions('value: price@cart');
    expect(broken.parsed).toBeNull();
    expect(broken.error).toContain('removed in v2');
  });

  it('複数バインディングを式単位に分割し、空要素はスキップすること', () => {
    const text = 'textContent: a; class.active: b;';
    const results = parseBindTextWithPositions(text);
    expect(results).toHaveLength(2);
    expect(sliceOf(text, results[1].propRange)).toBe('class.active');
    expect(sliceOf(text, results[1].pathRange)).toBe('b');
  });

  it('壊れた式だけを error にし、残りの式を生かすこと（tolerant）', () => {
    const text = 'noSeparator; textContent: ok';
    const results = parseBindTextWithPositions(text);
    expect(results).toHaveLength(2);
    expect(results[0].parsed).toBeNull();
    expect(results[0].error).toContain("Missing ':'");
    expect(sliceOf(text, results[0].exprRange)).toBe('noSeparator');
    expect(results[1].parsed?.statePathName).toBe('ok');
  });

  it('else / spread / eventToken の特殊形を正本どおりに扱うこと', () => {
    const elseText = 'else:';
    const [e] = parseBindTextWithPositions(elseText);
    expect(e.parsed?.bindingType).toBe('else');
    // `#else` は合成パス（原文に現れない）なので pathRange は null
    expect(e.pathRange).toBeNull();

    const spreadText = '...: fetchX';
    const [s] = parseBindTextWithPositions(spreadText);
    expect(s.parsed?.bindingType).toBe('spread');
    expect(sliceOf(spreadText, s.pathRange)).toBe('fetchX');

    const tokenText = 'eventToken.value: changed';
    const [t] = parseBindTextWithPositions(tokenText);
    expect(t.parsed?.bindingType).toBe('event');
    expect(sliceOf(tokenText, t.propRange)).toBe('eventToken.value');
    expect(sliceOf(tokenText, t.pathRange)).toBe('changed');
  });

  it('in-filter 付き左辺（value|number:）でも propName を正しく指すこと', () => {
    const text = 'value|number: count';
    const [b] = parseBindTextWithPositions(text);
    expect(sliceOf(text, b.propRange)).toBe('value');
    expect(sliceOf(text, b.pathRange)).toBe('count');
  });

  it('分割はランタイム同値（正本の splitBindTexts — 引用符の外の `;` だけで区切る）であること', () => {
    // @wcstack/state 3.0（要件 B1）でランタイムは引用符の中の `;` を区切らなくなった。このラッパーは
    // 正本の splitBindTexts をそのまま使うので、引用符の中の `;` では割れず、外の `;` では割れる。
    const quoted = "textContent: a | pad(5,';')";
    const one = parseBindTextWithPositions(quoted);
    expect(one).toHaveLength(1);
    expect(one[0].parsed?.outFilters[0].args).toEqual(["5", ";"]);
    const two = parseBindTextWithPositions("textContent: a | pad(5,';'); title: b");
    expect(two.map((r) => r.parsed?.propName)).toEqual(["textContent", "title"]);
    expect("textContent: a | pad(5,';'); title: b".slice(two[1].exprRange.start, two[1].exprRange.end)).toBe("title: b");
  });
});
