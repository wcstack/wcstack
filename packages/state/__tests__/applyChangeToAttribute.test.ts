import { describe, it, expect } from 'vitest';
import { applyChangeToAttribute } from '../src/apply/applyChangeToAttribute';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateElement: {} as any,
  state: {} as any,
  appliedBindingSet: new Set(),
};

function createBinding(element: Element, attrName: string): IBindingInfo {
  return {
    propName: 'attr',
    propSegments: ['attr', attrName],
    propModifiers: [],
    statePathName: 'value',
    statePathInfo: getPathInfo('value'),
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node: element,
    replaceNode: element,
  } as IBindingInfo;
}

describe('applyChangeToAttribute', () => {
  it('同じ値の場合は変更しないこと', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', 'a');
    const binding = createBinding(el, 'data-test');
    applyChangeToAttribute(binding, dummyContext, 'a');
    expect(el.getAttribute('data-test')).toBe('a');
  });

  it('値が異なる場合は更新すること', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', 'a');
    const binding = createBinding(el, 'data-test');
    applyChangeToAttribute(binding, dummyContext, 'b');
    expect(el.getAttribute('data-test')).toBe('b');
  });
});

/**
 * 属性の値は常に文字列なので、同値判定は文字列化してから行う（`applyChangeToText` と同じ）。
 * 生値のまま比べると数値・真偽値は同値でも毎回 setAttribute が走っていた。
 */
describe('applyChangeToAttribute — 非文字列の同値判定', () => {
  it.each([[1, '1'], [true, 'true'], [0, '0']])('%s は既存の "%s" と同値とみなすこと', (value, text) => {
    const el = document.createElement('div');
    el.setAttribute('data-test', text);
    let writes = 0;
    const original = el.setAttribute.bind(el);
    (el as any).setAttribute = (...args: [string, string]) => { writes++; return original(...args); };
    const binding = createBinding(el, 'data-test');
    applyChangeToAttribute(binding, dummyContext, value);
    expect(writes).toBe(0);
    expect(el.getAttribute('data-test')).toBe(text);
  });

  it('値が変われば文字列化して書くこと', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', '1');
    const binding = createBinding(el, 'data-test');
    applyChangeToAttribute(binding, dummyContext, 2);
    expect(el.getAttribute('data-test')).toBe('2');
  });
});
