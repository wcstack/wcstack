import { describe, it, expect } from 'vitest';
import { validateV3Migration } from '../src/service/v3MigrationValidator';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode } from '../src/core/diagnostics';

describe('validateV3Migration — @wcstack/state 3.0 への予告（wcs/v3-migration）', () => {
  it('属性の式ごとに、ランタイムと同じ判定を info で式の範囲に出す', () => {
    const html = `<input data-wcs="textContent: x; value#ro#wo: y">`;
    const diags = validateV3Migration(html, 'data-wcs', 'en');
    expect(diags).toHaveLength(1);
    const [d] = diags;
    expect(d.code).toBe(WcsDiagnosticCode.V3Migration);
    expect(d.severity).toBe('info');
    expect(html.slice(d.start, d.end)).toBe('value#ro#wo: y');
    expect(d.message).toBe('Preparing for 3.0 (this still runs on 2.x): "value#ro#wo": 3.0 rejects a second "#". Write "value#ro,wo".');
  });

  it('else の値・構造ディレクティブの修飾子・radio の修飾子・引用符の無い true を拾い、正しい書き方には黙る', () => {
    const html = [
      `<template data-wcs="else: x"></template>`,
      `<template data-wcs="for#ro: items"></template>`,
      `<input type="radio" data-wcs="radio#ro: choice">`,
      `<p data-wcs="hidden: flag|eq(true)"></p>`,
      `<p data-wcs="hidden: flag|eq('true'); value#ro,wo: y"></p>`,
      `<template data-wcs="else:"></template>`,
    ].join('\n');
    const messages = validateV3Migration(html, 'data-wcs', 'en').map((d) => d.message);
    expect(messages).toHaveLength(4);
    expect(messages[0]).toContain('3.0 rejects a value after "else:"');
    expect(messages[1]).toContain('3.0 rejects modifiers and filters on "for"');
    expect(messages[2]).toContain('3.0 keeps this a radio binding');
    expect(messages[3]).toContain(`Write eq('true') to keep the text.`);
  });

  it('mustache とコメントバインディングの式も見て、ja ではその前置きを付ける', () => {
    const html = `<p>{{ flag|ne(false) }}</p><!--@@: name|join('a) -->`;
    const diags = validateV3Migration(html, 'data-wcs', 'ja');
    expect(diags).toHaveLength(2);
    expect(html.slice(diags[0].start, diags[0].end)).toBe('flag|ne(false)');
    expect(diags[0].message.startsWith('3.0 への準備（2.x ではこのまま動きます）: "ne(false)"')).toBe(true);
    expect(diags[1].message).toContain('3.0 rejects the unterminated quote.');
  });

  it('フィルタの引数の超過は既存の wcs/filter-arity に任せて重ねない（validateDocument の集約でも出る）', () => {
    const html = `<p data-wcs="textContent: x|join(a,b)"></p>`;
    expect(validateV3Migration(html)).toEqual([]);
    const all = validateDocument(`<p data-wcs="value#ro#wo: x"></p>`, { locale: 'en' });
    expect(all.some((d) => d.code === WcsDiagnosticCode.V3Migration)).toBe(true);
  });
});
