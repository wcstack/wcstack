import { describe, it, expect } from 'vitest';
import { applyChangeToClass } from '../src/apply/applyChangeToClass';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateElement: {} as any,
  state: {} as any,
  appliedBindingSet: new Set(),
};

function createBinding(element: Element, className: string): IBindingInfo {
  return {
    propName: 'class',
    propSegments: ['class', className],
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

/**
 * 値が無い（undefined / null）ときはクラスを外す（要件 B8 の `attr.` と同じ語彙）。
 * throw にしていると、使い回した行に値の無い行オブジェクトが来たときに行ごと描かれなかった。
 */
describe('applyChangeToClass — 値が無いとき', () => {
  it.each([undefined, null])('%s はクラスを外すこと（throw しない）', (value) => {
    const el = document.createElement('div');
    el.classList.add('active');
    const binding = createBinding(el, 'active');
    expect(() => applyChangeToClass(binding, dummyContext, value)).not.toThrow();
    expect(el.classList.contains('active')).toBe(false);
  });
});
