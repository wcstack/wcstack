import { describe, it, expect, vi } from 'vitest';
import { isPossibleTwoWay } from '../src/event/isPossibleTwoWay';

vi.mock('../src/raiseError', () => ({
  raiseError: vi.fn((msg: string) => { throw new Error(msg); }),
}));

import { raiseError } from '../src/raiseError';

describe('isPossibleTwoWay', () => {
  it('input:text の value はtrue', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    expect(isPossibleTwoWay(input, 'value')).toBe(true);
  });

  it('input:checkbox の checked はtrue', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'checkbox');
    expect(isPossibleTwoWay(input, 'checked')).toBe(true);
  });

  it('input:radio の checked はtrue', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'radio');
    expect(isPossibleTwoWay(input, 'checked')).toBe(true);
  });

  it('input:button はfalse', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'button');
    expect(isPossibleTwoWay(input, 'value')).toBe(false);
  });

  it('inputでtype指定がない場合はtext扱いになること', () => {
    const input = document.createElement('input');
    expect(isPossibleTwoWay(input, 'value')).toBe(true);
  });

  it('inputのvalueAsNumber/valueAsDateはtrue', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    expect(isPossibleTwoWay(input, 'valueAsNumber')).toBe(true);
    expect(isPossibleTwoWay(input, 'valueAsDate')).toBe(true);
  });

  it('inputでも対象外のpropはfalse', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    expect(isPossibleTwoWay(input, 'checked')).toBe(false);
  });

  it('select の value はtrue', () => {
    const select = document.createElement('select');
    expect(isPossibleTwoWay(select, 'value')).toBe(true);
  });

  it('textarea の value はtrue', () => {
    const textarea = document.createElement('textarea');
    expect(isPossibleTwoWay(textarea, 'value')).toBe(true);
  });

  it('非Elementノードはfalse', () => {
    const text = document.createTextNode('x');
    expect(isPossibleTwoWay(text, 'value')).toBe(false);
  });

  describe('wcBindable プロトコル', () => {
    it('properties.nameに一致するpropNameはtrue', () => {
      class MyInputA extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 1,
          properties: [
            { name: 'value', event: 'my-input-a:value-changed' },
            { name: 'selectedDate', event: 'my-input-a:selected-date-changed' },
          ],
        };
      }
      customElements.define('my-input-a', MyInputA);
      const el = document.createElement('my-input-a');
      expect(isPossibleTwoWay(el, 'value')).toBe(true);
      expect(isPossibleTwoWay(el, 'selectedDate')).toBe(true);
    });

    it('wcBindableがないカスタム要素はfalse', () => {
      class PlainElementA extends HTMLElement {}
      customElements.define('plain-element-a', PlainElementA);
      const el = document.createElement('plain-element-a');
      expect(isPossibleTwoWay(el, 'value')).toBe(false);
    });

    it('propertiesに含まれないpropNameはfalse', () => {
      class MyWidgetA extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 1,
          properties: [
            { name: 'value', event: 'my-widget-a:value-changed' },
          ],
        };
      }
      customElements.define('my-widget-a', MyWidgetA);
      const el = document.createElement('my-widget-a');
      expect(isPossibleTwoWay(el, 'notInProperties')).toBe(false);
    });

    it('未定義のカスタム要素はraiseErrorを呼ぶこと', () => {
      const el = document.createElement('undefined-element-a');
      expect(() => isPossibleTwoWay(el, 'value')).toThrow();
      expect(raiseError).toHaveBeenCalledWith(
        'Custom element <undefined-element-a> is not defined. Cannot determine if property "value" is suitable for two-way binding.'
      );
    });

    it('複数のpropertiesで判定できること', () => {
      class MyComboA extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 1,
          properties: [
            { name: 'value', event: 'my-combo-a:value-changed' },
            { name: 'isOpen', event: 'my-combo-a:toggle' },
          ],
        };
      }
      customElements.define('my-combo-a', MyComboA);
      const el = document.createElement('my-combo-a');
      expect(isPossibleTwoWay(el, 'value')).toBe(true);
      expect(isPossibleTwoWay(el, 'isOpen')).toBe(true);
      expect(isPossibleTwoWay(el, 'other')).toBe(false);
    });

    it('protocolが"wc-bindable"でない場合はfalse', () => {
      class BadProtocolA extends HTMLElement {
        static wcBindable = {
          protocol: "something-else",
          version: 1,
          properties: [{ name: 'value', event: 'change' }],
        };
      }
      customElements.define('bad-protocol-a', BadProtocolA);
      const el = document.createElement('bad-protocol-a');
      expect(isPossibleTwoWay(el, 'value')).toBe(false);
    });

    it('versionが1でない場合はfalse', () => {
      class BadVersionA extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 2,
          properties: [{ name: 'value', event: 'change' }],
        };
      }
      customElements.define('bad-version-a', BadVersionA);
      const el = document.createElement('bad-version-a');
      expect(isPossibleTwoWay(el, 'value')).toBe(false);
    });
  });
});
