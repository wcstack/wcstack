import { describe, it, expect, afterEach } from 'vitest';
import { setContentByNode, getContentByNode } from '../src/structural/contentByNode';
import { createContent } from '../src/structural/createContent';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { getPathInfo } from '../src/address/PathInfo';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import type { IBindingInfo } from '../src/types';

const uuid = 'content-by-node-test-uuid';

function createBindingInfo(node: Node): IBindingInfo {
  return {
    propName: 'if',
    propSegments: [],
    propModifiers: [],
    statePathName: 'flag',
    statePathInfo: getPathInfo('flag'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'if',
    uuid,
    node,
    replaceNode: node,
  } as IBindingInfo;
}

function setFragment(fragment: DocumentFragment) {
  const parseBindTextResult: ParseBindTextResult = {
    propName: 'if',
    propSegments: [],
    propModifiers: [],
    statePathName: 'flag',
    statePathInfo: getPathInfo('flag'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    filterTexts: [],
    bindingType: 'if',
    uuid,
  } as ParseBindTextResult;

  setFragmentInfoByUUID(uuid, {
    fragment,
    parseBindTextResult,
    nodeInfos: [],
  });
}

afterEach(() => {
  setFragmentInfoByUUID(uuid, null);
});

describe('contentByNode', () => {
  it('set/getできること', () => {
    const node = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    fragment.appendChild(span);

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    setContentByNode(node, content);

    expect(getContentByNode(node)).toBe(content);
  });

  it('nullで削除できること', () => {
    const node = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('span'));
    
    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    setContentByNode(node, content);
    setContentByNode(node, null);

    expect(getContentByNode(node)).toBeNull();
  });
});
