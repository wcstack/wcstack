import { describe, it, expect } from 'vitest';
import { applyChangeToCheckbox } from '../src/apply/applyChangeToCheckbox';
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

function createCheckboxBinding(element: HTMLInputElement): IBindingInfo {
  return {
    propName: 'checkbox',
    propSegments: ['checkbox'],
    propModifiers: [],
    statePathName: 'selected',
    statePathInfo: getPathInfo('selected'),
    stateAbsolutePathInfo: getPathInfo('selected') as any,
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'checkbox',
    uuid: null,
    node: element,
    replaceNode: element,
  } as IBindingInfo;
}

describe('applyChangeToCheckbox', () => {
  it('配列にチェックボックスの値が含まれている場合はcheckedがtrueになること', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.value = 'apple';
    const binding = createCheckboxBinding(el);

    applyChangeToCheckbox(binding, dummyContext, ['apple', 'banana']);

    expect(el.checked).toBe(true);
  });

  it('配列にチェックボックスの値が含まれていない場合はcheckedがfalseになること', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.value = 'orange';
    const binding = createCheckboxBinding(el);

    applyChangeToCheckbox(binding, dummyContext, ['apple', 'banana']);

    expect(el.checked).toBe(false);
  });

  it('配列でない値の場合はcheckedがfalseになること', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.value = 'apple';
    const binding = createCheckboxBinding(el);

    applyChangeToCheckbox(binding, dummyContext, 'apple');

    expect(el.checked).toBe(false);
  });

  it('nullの場合はcheckedがfalseになること', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.value = 'apple';
    const binding = createCheckboxBinding(el);

    applyChangeToCheckbox(binding, dummyContext, null);

    expect(el.checked).toBe(false);
  });

  it('inFiltersがある場合はフィルター後の値で比較すること', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.value = '3';
    const binding = createCheckboxBinding(el);
    (binding as any).inFilters = [
      { filterName: 'num', args: [], filterFn: (v: any) => Number(v) },
    ];

    applyChangeToCheckbox(binding, dummyContext, [1, 2, 3]);

    expect(el.checked).toBe(true);
  });

  it('空配列の場合はcheckedがfalseになること', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.value = 'apple';
    const binding = createCheckboxBinding(el);

    applyChangeToCheckbox(binding, dummyContext, []);

    expect(el.checked).toBe(false);
  });
});
