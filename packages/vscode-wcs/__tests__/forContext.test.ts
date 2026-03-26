import { describe, it, expect } from 'vitest';
import { isInsideForTemplate } from '../src/service/forContext';

describe('isInsideForTemplate', () => {
  it('for テンプレート内は true', () => {
    const html = '<template data-wcs="for: users"><span data-wcs="textContent: .name"></span></template>';
    const spanPos = html.indexOf('<span');
    expect(isInsideForTemplate(html, spanPos)).toBe(true);
  });

  it('for テンプレート外は false', () => {
    const html = '<div data-wcs="textContent: count"></div><template data-wcs="for: users"></template>';
    const divPos = html.indexOf('<div');
    expect(isInsideForTemplate(html, divPos)).toBe(false);
  });

  it('for テンプレートの後は false', () => {
    const html = '<template data-wcs="for: users"><span></span></template><div data-wcs="textContent: count"></div>';
    const divPos = html.indexOf('<div');
    expect(isInsideForTemplate(html, divPos)).toBe(false);
  });

  it('ネストされた for の内側は true', () => {
    const html = `
<template data-wcs="for: categories">
  <template data-wcs="for: .products">
    <span data-wcs="textContent: .name"></span>
  </template>
</template>`;
    const spanPos = html.indexOf('<span');
    expect(isInsideForTemplate(html, spanPos)).toBe(true);
  });

  it('if テンプレート内は false', () => {
    const html = '<template data-wcs="if: active"><span></span></template>';
    const spanPos = html.indexOf('<span');
    expect(isInsideForTemplate(html, spanPos)).toBe(false);
  });

  it('for テンプレートなしは false', () => {
    const html = '<div data-wcs="textContent: count"></div>';
    expect(isInsideForTemplate(html, 5)).toBe(false);
  });

  it('カスタム属性名に対応', () => {
    const html = '<template data-bind="for: users"><span></span></template>';
    const spanPos = html.indexOf('<span');
    expect(isInsideForTemplate(html, spanPos, 'data-bind')).toBe(true);
    expect(isInsideForTemplate(html, spanPos, 'data-wcs')).toBe(false);
  });
});
