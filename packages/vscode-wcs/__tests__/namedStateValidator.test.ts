/**
 * `wcs/named-state-deprecated`（warning）— 名前付き State の deprecation
 * （docs/state-mount-design.md D16、impl-plan P1-7 / T0）。
 */
import { describe, it, expect } from 'vitest';
import { validateNamedState, findStateSelector } from '../src/service/namedStateValidator';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode } from '../src/core/diagnostics';

const slice = (html: string, d: { start: number; end: number }) => html.slice(d.start, d.end);

describe('validateNamedState', () => {
  it('<wcs-state name="x"> の name 属性値に error を出し、mount= を指すこと', () => {
    const html = `<wcs-state name="cart" json='{"total":1}'></wcs-state>`;
    const diags = validateNamedState(html, 'data-wcs');
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.NamedStateDeprecated);
    expect(diags[0].severity).toBe('error');
    expect(slice(html, diags[0])).toBe('cart');
    expect(diags[0].message).toContain('mount="cart"');
    expect(diags[0].message).toContain('"cart.<path>"');
  });

  it('引用符なし・単引用符の name 属性にも同じ範囲で出ること', () => {
    const single = `<wcs-state name='cart'></wcs-state>`;
    expect(slice(single, validateNamedState(single, 'data-wcs')[0])).toBe('cart');
    const bare = `<wcs-state name=cart></wcs-state>`;
    expect(slice(bare, validateNamedState(bare, 'data-wcs')[0])).toBe('cart');
  });

  it('bind-component でも name 属性は error（v1 の Light DOM name 必須は撤去済み）', () => {
    const html = `<my-light><wcs-state bind-component="state" name="my-light"></wcs-state></my-light>`;
    const diags = validateNamedState(html, 'data-wcs');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
  });

  it('name の無い <wcs-state> には出さないこと', () => {
    const html = `<wcs-state json='{}'></wcs-state><div data-wcs="textContent: total"></div>`;
    expect(validateNamedState(html, 'data-wcs')).toHaveLength(0);
  });

  it('data-wcs の path@name に error を出し、接頭辞への置き換えを指すこと', () => {
    const html = `<div data-wcs="textContent: total@cart; class.on: flag"></div>`;
    const diags = validateNamedState(html, 'data-wcs');
    expect(diags).toHaveLength(1);
    expect(slice(html, diags[0])).toBe('@cart');
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toContain('v2 で撤去');
    expect(diags[0].message).toContain('"cart.<path>"');
  });

  it('英語ロケールでもメッセージが移行先を指すこと', () => {
    const html = `<div data-wcs="textContent: total@cart"></div>`;
    const diags = validateNamedState(html, 'data-wcs', 'wcs-state', 'en');
    expect(diags[0].message).toContain('removed in v2');
    expect(diags[0].message).toContain('"cart.<path>"');
  });

  it('@default は「外せ」と言うこと', () => {
    const html = `<div data-wcs="textContent: total@default"></div>`;
    const diags = validateNamedState(html, 'data-wcs');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('@default');
    expect(diags[0].message).not.toContain('default.<path>');
  });

  it('フィルタ引数の @ には出さないこと', () => {
    const html = `<div data-wcs="textContent: total|default(@)|prefix(@)"></div>`;
    expect(validateNamedState(html, 'data-wcs')).toHaveLength(0);
  });

  it('spread と shorthand の @name にも出ること', () => {
    const html = `<my-c data-wcs="...: obj@x"></my-c><template data-wcs="for: rows"><span data-wcs="textContent: .name@y"></span></template>`;
    const diags = validateNamedState(html, 'data-wcs');
    expect(diags.map((d) => slice(html, d))).toEqual(['@x', '@y']);
  });

  it('mustache {{ path@name }} に出ること', () => {
    const html = `<p>{{ name@user }}</p><p>{{ count }}</p>`;
    const diags = validateNamedState(html, 'data-wcs');
    expect(diags).toHaveLength(1);
    expect(slice(html, diags[0])).toBe('@user');
  });

  it('コメントバインディング <!--@@: path@name--> にも出ること（第 3 チャネル）', () => {
    // mustache は実 DOM でこの形へ変換される — 直書きも同じ runtime parse error
    const html = `<p><!--@@: total@cart--></p><p><!--@@: count--></p>`;
    const diags = validateNamedState(html, 'data-wcs');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(slice(html, diags[0])).toBe('@cart');
  });

  it('validateDocument が同じ code / severity で含めること', () => {
    const html = `<wcs-state name="cart" json='{"total":1}'></wcs-state><div data-wcs="textContent: total@cart"></div>`;
    const diags = validateDocument(html).filter((d) => d.code === WcsDiagnosticCode.NamedStateDeprecated);
    expect(diags).toHaveLength(2);
    expect(diags.every((d) => d.severity === 'error')).toBe(true);
  });
});

describe('findStateSelector', () => {
  it('@ の直後が空なら default 扱いで @ だけを範囲にすること', () => {
    const m = findStateSelector('textContent: total@');
    expect(m).toEqual({ start: 18, end: 19, name: 'default' });
  });

  it('@ の後ろの空白を範囲から除くこと', () => {
    const m = findStateSelector('textContent: total@ cart |uc');
    expect(m).not.toBeNull();
    expect('textContent: total@ cart |uc'.slice(m!.start, m!.end)).toBe('@ cart');
    expect(m!.name).toBe('cart');
  });

  it('@ が無ければ null', () => {
    expect(findStateSelector('textContent: total')).toBeNull();
    expect(findStateSelector('count', true)).toBeNull();
  });
});
