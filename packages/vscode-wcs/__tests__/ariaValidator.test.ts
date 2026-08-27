/**
 * ariaValidator のテスト — `attr.aria-*` の属性名検査 (docs/a11y-design.md §8 / D9)。
 */
import { describe, it, expect } from 'vitest';
import { validateAriaAttributes } from '../src/service/ariaValidator.js';
import { validateDocument } from '../src/core/validateDocument.js';
import { runValidation } from '../src/core/cli/runValidation.js';
import { WcsDiagnosticCode } from '../src/core/diagnostics.js';

describe('validateAriaAttributes: 基本', () => {
  it('attr.aria-labels（タイポ）を warning で報告し、aria-label を提案する', () => {
    const html = `<button data-wcs="attr.aria-labels: itemLabel">x</button>`;
    const diags = validateAriaAttributes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.AriaAttrUnknown);
    // warning リテラル契約: error 昇格は smoke-test の対ケース更新が必須（#180/#183）
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].member).toBe('aria-labels');
    expect(diags[0].message).toContain('aria-label');
    // range はプロパティトークン全体を指す
    expect(html.slice(diags[0].start, diags[0].end)).toBe('attr.aria-labels');
  });

  it('正しい aria 属性は報告しない（deprecated 含む）', () => {
    const html = `<div data-wcs="attr.aria-label: a; attr.aria-labelledby: b; attr.aria-describedby: c; attr.aria-current: d; attr.aria-live: e; attr.aria-grabbed: f; attr.aria-valuenow: g"></div>`;
    expect(validateAriaAttributes(html)).toHaveLength(0);
  });

  it('aria- 以外の attr バインドと通常バインドは対象外', () => {
    const html = `<div data-wcs="attr.data-x: a; attr.title: b; textContent: c; class.on: d; for: items"></div>`;
    expect(validateAriaAttributes(html)).toHaveLength(0);
  });

  it('複合式の中でもオフセットが正しい', () => {
    const html = `<div data-wcs="textContent: t; attr.aria-lable: a"></div>`;
    const diags = validateAriaAttributes(html);
    expect(diags).toHaveLength(1);
    expect(html.slice(diags[0].start, diags[0].end)).toBe('attr.aria-lable');
    expect(diags[0].message).toContain('aria-label');
  });

  it('大文字小文字は正規化して照合する', () => {
    const html = `<div data-wcs="attr.ARIA-LABEL: a"></div>`;
    expect(validateAriaAttributes(html)).toHaveLength(0);
  });

  it('遠すぎるタイポには「もしかして」を付けない', () => {
    const html = `<div data-wcs="attr.aria-zzzzzzzzz: a"></div>`;
    const diags = validateAriaAttributes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).not.toContain('もしかして');
  });

  it('locale=en では英語メッセージと英語の提案が出る', () => {
    const html = `<div data-wcs="attr.aria-labels: a"></div>`;
    const diags = validateAriaAttributes(html, 'data-wcs', 'en');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('not a WAI-ARIA attribute');
    expect(diags[0].message).toContain('Did you mean "aria-label"');
  });
});

describe('validateAriaAttributes: IDE / CLI parity', () => {
  it('validateDocument 経由でも CLI runner 経由でも同一診断が出る', () => {
    const html = `<button data-wcs="attr.aria-labels: itemLabel">x</button>`;
    const ide = validateDocument(html).filter((d) => d.code === WcsDiagnosticCode.AriaAttrUnknown);
    const cli = runValidation([{ source: 'page.html', text: html, kind: 'html' }])
      .diagnosticsBySource.get('page.html')!
      .filter((d) => d.code === WcsDiagnosticCode.AriaAttrUnknown);
    expect(ide).toHaveLength(1);
    expect(cli).toEqual(ide);
  });
});
