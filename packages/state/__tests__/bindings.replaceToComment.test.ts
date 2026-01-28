import { describe, it, expect } from 'vitest';
import { replaceToComment } from '../src/bindings/replaceToComment';
import type { IBindingInfo } from '../src/types';

function createBindingInfo(node: Node, placeHolderNode: Node): IBindingInfo {
  return {
    propName: 'textContent',
    propSegments: ['textContent'],
    propModifiers: [],
    statePathName: 'message',
    statePathInfo: null,
    stateName: 'default',
    filterTexts: [],
    bindingType: 'text',
    uuid: null,
    node,
    placeHolderNode
  } as IBindingInfo;
}

describe('replaceToComment', () => {
  it('ノードをプレースホルダーに置き換えること', () => {
    const container = document.createElement('div');
    const comment = document.createComment('@@wcs-text: message');
    const textNode = document.createTextNode('');
    container.appendChild(comment);

    const bindingInfo = createBindingInfo(comment, textNode);
    replaceToComment(bindingInfo);

    expect(container.childNodes[0]).toBe(textNode);
  });

  it('nodeとplaceHolderNodeが同じ場合は何もしないこと', () => {
    const node = document.createElement('span');
    const bindingInfo = createBindingInfo(node, node);
    replaceToComment(bindingInfo);
    expect(bindingInfo.node).toBe(node);
  });

  it('nodeに親がない場合は何もしないこと', () => {
    const node = document.createComment('@@wcs-text: message');
    const placeHolder = document.createTextNode('');
    const bindingInfo = createBindingInfo(node, placeHolder);
    replaceToComment(bindingInfo);
    expect(node.parentNode).toBeNull();
  });
});
