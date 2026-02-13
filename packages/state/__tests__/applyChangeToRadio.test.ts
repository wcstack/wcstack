import { describe, it, expect } from 'vitest';
import { applyChangeToRadio } from '../src/apply/applyChangeToRadio';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/binding/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateName: 'default',
  stateElement: {} as any,
  state: {} as any,
  appliedBindingSet: new Set(),
  newListValueByAbsAddress: new Map(),
  updatedAbsAddressSetByStateElement: new Map(),
  rootNode: document.body,
};

function createRadioBinding(element: HTMLInputElement): IBindingInfo {
  return {
    propName: 'radio',
    propSegments: ['radio'],
    propModifiers: [],
    statePathName: 'selected',
    statePathInfo: getPathInfo('selected'),
    stateAbsolutePathInfo: getPathInfo('selected') as any,
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'radio',
    uuid: null,
    node: element,
    replaceNode: element,
  } as IBindingInfo;
}

describe('applyChangeToRadio', () => {
  it('値が一致する場合はcheckedがtrueになること', () => {
    const el = document.createElement('input');
    el.type = 'radio';
    el.value = 'apple';
    const binding = createRadioBinding(el);

    applyChangeToRadio(binding, dummyContext, 'apple');

    expect(el.checked).toBe(true);
  });

  it('値が一致しない場合はcheckedがfalseになること', () => {
    const el = document.createElement('input');
    el.type = 'radio';
    el.value = 'apple';
    const binding = createRadioBinding(el);

    applyChangeToRadio(binding, dummyContext, 'banana');

    expect(el.checked).toBe(false);
  });

  it('inFiltersがある場合はフィルター後の値で比較すること', () => {
    const el = document.createElement('input');
    el.type = 'radio';
    el.value = '42';
    const binding = createRadioBinding(el);
    (binding as any).inFilters = [
      { filterName: 'num', args: [], filterFn: (v: any) => Number(v) },
    ];

    applyChangeToRadio(binding, dummyContext, 42);

    expect(el.checked).toBe(true);
  });

  it('nullの場合はcheckedがfalseになること', () => {
    const el = document.createElement('input');
    el.type = 'radio';
    el.value = 'apple';
    const binding = createRadioBinding(el);

    applyChangeToRadio(binding, dummyContext, null);

    expect(el.checked).toBe(false);
  });
});
