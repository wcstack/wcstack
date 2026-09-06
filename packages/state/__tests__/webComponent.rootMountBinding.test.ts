import { describe, it, expect } from 'vitest';
import { hasRootMountBinding } from '../src/webComponent/rootMountBinding';
import { addBindingByNode } from '../src/bindings/getBindingsByNode';
import { config } from '../src/config';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';

function binding(node: Element, propSegments: string[]): IBindingInfo {
  return {
    propName: propSegments.join('.'),
    propSegments,
    propModifiers: [],
    statePathName: 'user',
    statePathInfo: getPathInfo('user'),
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node,
    replaceNode: node,
  } as IBindingInfo;
}

describe('rootMountBinding（ホストが state: path を書いているか）', () => {
  it('バインド属性が無ければ偽', () => {
    expect(hasRootMountBinding(document.createElement('my-c'), 'state')).toBe(false);
  });

  it('属性はあるがバインディングが未登録なら偽', () => {
    const el = document.createElement('my-c');
    el.setAttribute(config.bindAttributeName, 'state: user');
    expect(hasRootMountBinding(el, 'state')).toBe(false);
  });

  it('1 セグメントの stateProp バインディングがあれば真、部分だけなら偽', () => {
    const root = document.createElement('my-c');
    root.setAttribute(config.bindAttributeName, 'state: user');
    addBindingByNode(root, binding(root, ['state']));
    expect(hasRootMountBinding(root, 'state')).toBe(true);
    expect(hasRootMountBinding(root, 'model')).toBe(false);

    const partial = document.createElement('my-c');
    partial.setAttribute(config.bindAttributeName, 'state.name: user.name');
    addBindingByNode(partial, binding(partial, ['state', 'name']));
    expect(hasRootMountBinding(partial, 'state')).toBe(false);
  });
});
