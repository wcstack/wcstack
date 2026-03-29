import { describe, it, expect, afterEach } from 'vitest';
import { applyChangeToText } from '../src/apply/applyChangeToText';
import { getPathInfo } from '../src/address/PathInfo';
import { resetSsrCache } from '../src/config';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateName: 'default',
  stateElement: {} as any,
  state: {} as any,
  appliedBindingSet: new Set(),
};

function createBinding(replaceNode: Node): IBindingInfo {
  return {
    propName: 'text',
    propSegments: [],
    propModifiers: [],
    statePathName: 'value',
    statePathInfo: getPathInfo('value'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'text',
    uuid: null,
    node: replaceNode,
    replaceNode,
  } as IBindingInfo;
}

describe('applyChangeToText', () => {
  it('同じ値の場合は変更しないこと', () => {
    const textNode = document.createTextNode('hello');
    const binding = createBinding(textNode);
    applyChangeToText(binding, dummyContext, 'hello');
    expect(textNode.nodeValue).toBe('hello');
  });

  it('値が異なる場合は更新すること', () => {
    const textNode = document.createTextNode('hello');
    const binding = createBinding(textNode);
    applyChangeToText(binding, dummyContext, 'world');
    expect(textNode.nodeValue).toBe('world');
  });

  it('SSRモードでparentNodeが���いテキストノードはコメントを挿入しないこと', () => {
    resetSsrCache();
    document.documentElement.setAttribute('data-wcs-server', '');

    // DOMに追加されていないテキストノード（parentNode === null）
    const textNode = document.createTextNode('');
    const binding = createBinding(textNode);
    applyChangeToText(binding, dummyContext, 'test');
    expect(textNode.nodeValue).toBe('test');

    document.documentElement.removeAttribute('data-wcs-server');
    resetSsrCache();
  });
});
