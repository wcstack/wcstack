import { describe, it, expect } from 'vitest';
import { applyChangeToStyle } from '../src/apply/applyChangeToStyle';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateName: 'default',
  stateElement: {} as any,
  state: {} as any,
};

function createBinding(element: Element, styleName: string): IBindingInfo {
  return {
    propName: 'style',
    propSegments: ['style', styleName],
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

describe('applyChangeToStyle', () => {
  it('同じ値の場合は変更しないこと', () => {
    const el = document.createElement('div');
    el.style.color = 'red';
    const binding = createBinding(el, 'color');
    applyChangeToStyle(binding, dummyContext, 'red');
    expect(el.style.color).toBe('red');
  });

  it('値が異なる場合は更新すること', () => {
    const el = document.createElement('div');
    el.style.color = 'red';
    const binding = createBinding(el, 'color');
    applyChangeToStyle(binding, dummyContext, 'blue');
    expect(el.style.color).toBe('blue');
  });
});
