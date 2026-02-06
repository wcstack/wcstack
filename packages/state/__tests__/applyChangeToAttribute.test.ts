import { describe, it, expect } from 'vitest';
import { applyChangeToAttribute } from '../src/apply/applyChangeToAttribute';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateName: 'default',
  stateElement: {} as any,
  state: {} as any,
};

function createBinding(element: Element, attrName: string): IBindingInfo {
  return {
    propName: 'attr',
    propSegments: ['attr', attrName],
    propModifiers: [],
    statePathName: 'value',
    statePathInfo: getPathInfo('value'),
    stateName: 'default',
    filters: [],
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
