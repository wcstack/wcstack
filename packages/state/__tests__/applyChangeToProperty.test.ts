import { describe, it, expect } from 'vitest';
import { applyChangeToProperty } from '../src/apply/applyChangeToProperty';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateName: 'default',
  stateElement: {} as any,
  state: {} as any,
};

function createBinding(element: Element, propSegments: string[]): IBindingInfo {
  return {
    propName: propSegments[0],
    propSegments,
    propModifiers: [],
    statePathName: 'value',
    statePathInfo: getPathInfo('value'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node: element,
    replaceNode: element,
  } as IBindingInfo;
}

describe('applyChangeToProperty', () => {
  it('同じ値の場合は変更しないこと', () => {
    const input = document.createElement('input');
    input.value = 'a';
    const binding = createBinding(input, ['value']);
    applyChangeToProperty(binding, dummyContext, 'a');
    expect(input.value).toBe('a');
  });

  it('値が異なる場合は更新すること', () => {
    const input = document.createElement('input');
    input.value = 'a';
    const binding = createBinding(input, ['value']);
    applyChangeToProperty(binding, dummyContext, 'b');
    expect(input.value).toBe('b');
  });

  it('ネストしたプロパティを更新できること', () => {
    const el = document.createElement('div') as any;
    el.foo = { bar: { baz: 1 } };
    const binding = createBinding(el, ['foo', 'bar', 'baz']);
    applyChangeToProperty(binding, dummyContext, 2);
    expect(el.foo.bar.baz).toBe(2);
  });

  it('ネストプロパティの同じ値の場合は変更しないこと', () => {
    const el = document.createElement('div') as any;
    el.foo = { bar: { baz: 1 } };
    const binding = createBinding(el, ['foo', 'bar', 'baz']);
    applyChangeToProperty(binding, dummyContext, 1);
    expect(el.foo.bar.baz).toBe(1);
  });

  it('途中のオブジェクトがnullの場合は何もしないこと', () => {
    const el = document.createElement('div') as any;
    el.foo = null;
    const binding = createBinding(el, ['foo', 'bar', 'baz']);
    applyChangeToProperty(binding, dummyContext, 2);
    expect(el.foo).toBeNull();
  });
});
