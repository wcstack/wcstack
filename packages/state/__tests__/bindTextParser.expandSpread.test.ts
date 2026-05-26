import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { expandSpread, hasUnresolvedSpread } from '../src/bindTextParser/expandSpread';
import { parseBindTextsForElement } from '../src/bindTextParser/parseBindTextsForElement';
import { setConfig } from '../src/config';

let tagCounter = 0;
function uniqueTagName(): string {
  return `wcs-spread-test-${++tagCounter}`;
}

function defineElement(tag: string, wcBindable: any) {
  class TestEl extends HTMLElement {
    static wcBindable = wcBindable;
  }
  customElements.define(tag, TestEl);
  return TestEl;
}

function createElement(tag: string): Element {
  return document.createElement(tag);
}

describe('expandSpread', () => {
  beforeEach(() => {
    setConfig({ debug: false });
  });
  afterEach(() => {
    setConfig({ debug: false });
  });

  it('spread を含まなければそのまま返すこと', () => {
    const results = parseBindTextsForElement('value: name');
    const out = expandSpread(document.createElement('div'), results);
    expect(out).toEqual(results);
  });

  it('properties を一括展開すること', () => {
    const tag = uniqueTagName();
    defineElement(tag, {
      protocol: 'wc-bindable',
      version: 1,
      properties: [
        { name: 'value', event: `${tag}:value-changed` },
        { name: 'loading', event: `${tag}:loading-changed` },
      ],
    });
    const el = createElement(tag);
    const results = parseBindTextsForElement('...: fetchX');
    const out = expandSpread(el, results);
    expect(out).toHaveLength(2);
    expect(out[0].propName).toBe('value');
    expect(out[0].statePathName).toBe('fetchX.value');
    expect(out[0].bindingType).toBe('prop');
    expect(out[1].propName).toBe('loading');
    expect(out[1].statePathName).toBe('fetchX.loading');
  });

  it('inputs も合わせて展開すること', () => {
    const tag = uniqueTagName();
    defineElement(tag, {
      protocol: 'wc-bindable',
      version: 1,
      properties: [{ name: 'value', event: `${tag}:value-changed` }],
      inputs: [{ name: 'url' }, { name: 'method' }],
    });
    const el = createElement(tag);
    const results = parseBindTextsForElement('...: fetchX');
    const out = expandSpread(el, results);
    expect(out.map(r => r.propName)).toEqual(['value', 'url', 'method']);
    expect(out.map(r => r.statePathName)).toEqual(['fetchX.value', 'fetchX.url', 'fetchX.method']);
  });

  it('@stateName を各エントリへ伝搬すること', () => {
    const tag = uniqueTagName();
    defineElement(tag, {
      protocol: 'wc-bindable',
      version: 1,
      properties: [{ name: 'value', event: `${tag}:value-changed` }],
    });
    const el = createElement(tag);
    const results = parseBindTextsForElement('...: fetchX@store');
    const out = expandSpread(el, results);
    expect(out[0].stateName).toBe('store');
    expect(out[0].statePathName).toBe('fetchX.value');
  });

  it('途中の wildcard を含むパスも展開すること', () => {
    const tag = uniqueTagName();
    defineElement(tag, {
      protocol: 'wc-bindable',
      version: 1,
      properties: [{ name: 'value', event: `${tag}:value-changed` }],
    });
    const el = createElement(tag);
    const results = parseBindTextsForElement('...: stores.*.fetch');
    const out = expandSpread(el, results);
    expect(out[0].statePathName).toBe('stores.*.fetch.value');
  });

  it('後勝ち: spread の後に同名 prop が来たら explicit を残すこと', () => {
    const tag = uniqueTagName();
    defineElement(tag, {
      protocol: 'wc-bindable',
      version: 1,
      properties: [
        { name: 'value', event: `${tag}:value-changed` },
        { name: 'loading', event: `${tag}:loading-changed` },
      ],
    });
    const el = createElement(tag);
    const results = parseBindTextsForElement('...: fetchX; value: customValue');
    const out = expandSpread(el, results);
    expect(out).toHaveLength(2);
    const valueEntry = out.find(r => r.propName === 'value');
    expect(valueEntry?.statePathName).toBe('customValue');
  });

  it('debug モード時、オーバーライドを console.debug に記録すること', () => {
    setConfig({ debug: true });
    const tag = uniqueTagName();
    defineElement(tag, {
      protocol: 'wc-bindable',
      version: 1,
      properties: [{ name: 'value', event: `${tag}:value-changed` }],
    });
    const el = createElement(tag);
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const results = parseBindTextsForElement('...: fetchX; value: customValue');
    expandSpread(el, results);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/spread:\s*prop\s+"value"/);
    spy.mockRestore();
  });

  it('debug=false のとき console.debug は呼ばれないこと', () => {
    const tag = uniqueTagName();
    defineElement(tag, {
      protocol: 'wc-bindable',
      version: 1,
      properties: [{ name: 'value', event: `${tag}:value-changed` }],
    });
    const el = createElement(tag);
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const results = parseBindTextsForElement('...: fetchX; value: customValue');
    expandSpread(el, results);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('explicit が spread より前にある場合、spread のほうが後勝ち', () => {
    const tag = uniqueTagName();
    defineElement(tag, {
      protocol: 'wc-bindable',
      version: 1,
      properties: [{ name: 'value', event: `${tag}:value-changed` }],
    });
    const el = createElement(tag);
    const results = parseBindTextsForElement('value: explicitOne; ...: fetchX');
    const out = expandSpread(el, results);
    expect(out).toHaveLength(1);
    expect(out[0].statePathName).toBe('fetchX.value');
  });

  it('カスタム要素未定義時、allowDeferred=true (既定) なら entry を残すこと', () => {
    const tag = `wcs-not-defined-${++tagCounter}`;
    const el = createElement(tag);
    const results = parseBindTextsForElement('...: fetchX');
    const out = expandSpread(el, results);
    expect(out).toHaveLength(1);
    expect(out[0].bindingType).toBe('spread');
    expect(hasUnresolvedSpread(out)).toBe(true);
  });

  it('カスタム要素未定義時、allowDeferred=false ならエラーになること', () => {
    const tag = `wcs-not-defined-${++tagCounter}`;
    const el = createElement(tag);
    const results = parseBindTextsForElement('...: fetchX');
    expect(() => expandSpread(el, results, { allowDeferred: false }))
      .toThrow(/to be registered/);
  });

  it('wcBindable が未宣言の custom element では即エラー', () => {
    const tag = uniqueTagName();
    class NoBindable extends HTMLElement {}
    customElements.define(tag, NoBindable);
    const el = createElement(tag);
    const results = parseBindTextsForElement('...: fetchX');
    expect(() => expandSpread(el, results)).toThrow(/wcBindable/);
  });

  it('wcBindable.version が不一致なら即エラー', () => {
    const tag = uniqueTagName();
    defineElement(tag, {
      protocol: 'wc-bindable',
      version: 2,
      properties: [{ name: 'value', event: `${tag}:value-changed` }],
    });
    const el = createElement(tag);
    const results = parseBindTextsForElement('...: fetchX');
    expect(() => expandSpread(el, results)).toThrow(/wcBindable/);
  });

  it('カスタム要素ではない普通の要素では即エラー', () => {
    const el = document.createElement('div');
    const results = parseBindTextsForElement('...: fetchX');
    expect(() => expandSpread(el, results)).toThrow(/custom element/);
  });

  it('properties と inputs に同名がある場合は最初に出会った定義を採用', () => {
    const tag = uniqueTagName();
    defineElement(tag, {
      protocol: 'wc-bindable',
      version: 1,
      properties: [{ name: 'value', event: `${tag}:value-changed` }],
      inputs: [{ name: 'value' }],
    });
    const el = createElement(tag);
    const results = parseBindTextsForElement('...: fetchX');
    const out = expandSpread(el, results);
    expect(out).toHaveLength(1);
    expect(out[0].propName).toBe('value');
  });

  it('hasUnresolvedSpread は spread エントリの有無を判定すること', () => {
    expect(hasUnresolvedSpread(parseBindTextsForElement('value: a'))).toBe(false);
    expect(hasUnresolvedSpread(parseBindTextsForElement('...: fetchX'))).toBe(true);
  });
});
