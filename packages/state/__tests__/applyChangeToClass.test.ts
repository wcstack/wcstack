import { describe, it, expect } from 'vitest';
import { applyChangeToClass } from '../src/apply/applyChangeToClass';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateName: 'default',
  stateElement: {} as any,
  state: {} as any,
};

function createBinding(element: Element, className: string): IBindingInfo {
  return {
    propName: 'class',
    propSegments: ['class', className],
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

describe('applyChangeToClass', () => {
  it('trueでクラスを付与できること', () => {
    const el = document.createElement('div');
    const binding = createBinding(el, 'active');
    applyChangeToClass(binding, dummyContext, true);
    expect(el.classList.contains('active')).toBe(true);
  });

  it('falseでクラスを削除できること', () => {
    const el = document.createElement('div');
    el.classList.add('active');
    const binding = createBinding(el, 'active');
    applyChangeToClass(binding, dummyContext, false);
    expect(el.classList.contains('active')).toBe(false);
  });

  it('boolean以外はエラーになること', () => {
    const el = document.createElement('div');
    const binding = createBinding(el, 'active');
    expect(() => applyChangeToClass(binding, dummyContext, 'yes')).toThrow(/Invalid value for class application/);
  });
});
