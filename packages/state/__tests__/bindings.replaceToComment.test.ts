import { describe, it, expect } from 'vitest';
import { replaceToReplaceNode } from '../src/bindings/replaceToReplaceNode';
import type { IBindingInfo } from '../src/types';

function createBindingInfo(node: Node, replaceNode: Node): IBindingInfo {
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
    replaceNode
  } as IBindingInfo;
}

describe('replaceToReplaceNode', () => {
  it('ノードをreplaceNodeに置き換えること', () => {
    const container = document.createElement('div');
    const comment = document.createComment('@@wcs-text: message');
    const textNode = document.createTextNode('');
    container.appendChild(comment);

    const bindingInfo = createBindingInfo(comment, textNode);
    replaceToReplaceNode(bindingInfo);

    expect(container.childNodes[0]).toBe(textNode);
  });

  it('nodeとreplaceNodeが同じ場合は何もしないこと', () => {
    const node = document.createElement('span');
    const bindingInfo = createBindingInfo(node, node);
    replaceToReplaceNode(bindingInfo);
    expect(bindingInfo.node).toBe(node);
  });

  it('nodeに親がない場合は何もしないこと', () => {
    const node = document.createComment('@@wcs-text: message');
    const replaceNode = document.createTextNode('');
    const bindingInfo = createBindingInfo(node, replaceNode);
    replaceToReplaceNode(bindingInfo);
    expect(node.parentNode).toBeNull();
  });
});
