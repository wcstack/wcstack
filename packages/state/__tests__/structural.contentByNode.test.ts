import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { setContentByNode, getContentsByNode, deleteContentByNode } from '../src/structural/contentsByNode';
import { createContent } from '../src/structural/createContent';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { getPathInfo } from '../src/address/PathInfo';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import type { IBindingInfo } from '../src/types';
import { setStateElementByName } from '../src/stateElementByName';

const uuid = 'content-by-node-test-uuid';

vi.mock('../src/stateElementByName', () => {
  const map = new Map();
  return {
    getStateElementByName: (_rootNode: Node, name: string) => map.get(name) || null,
    setStateElementByName: (_rootNode: Node, name: string, el: any) => {
      if (el === null) map.delete(name);
      else map.set(name, el);
    }
  };
});

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

  setFragmentInfoByUUID(uuid, document, {
    fragment,
    parseBindTextResult,
    nodeInfos: [],
  });
}

afterEach(() => {
  setFragmentInfoByUUID(uuid, document, null);
  vi.restoreAllMocks();
});

describe('contentsByNode', () => {
  beforeEach(() => {
    setStateElementByName(document, 'default', {
      setPathInfo: vi.fn(),
    } as any);
  });

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

    const contents = getContentsByNode(node);
    expect(contents).toHaveLength(1);
    expect(contents[0]).toBe(content);
  });

  it('複数のcontentを追加できること', () => {
    const node = document.createElement('div');
    const placeholder1 = document.createComment('placeholder1');
    const placeholder2 = document.createComment('placeholder2');

    const fragment1 = document.createDocumentFragment();
    fragment1.appendChild(document.createElement('span'));
    setFragment(fragment1);
    const content1 = createContent(createBindingInfo(placeholder1));

    const fragment2 = document.createDocumentFragment();
    fragment2.appendChild(document.createElement('div'));
    setFragment(fragment2);
    const content2 = createContent(createBindingInfo(placeholder2));

    setContentByNode(node, content1);
    setContentByNode(node, content2);

    const contents = getContentsByNode(node);
    expect(contents).toHaveLength(2);
    expect(contents[0]).toBe(content1);
    expect(contents[1]).toBe(content2);
  });

  it('登録されていないノードは空配列を返すこと', () => {
    const node = document.createElement('div');
    expect(getContentsByNode(node)).toEqual([]);
  });

  it('deleteContentByNodeで削除できること', () => {
    const node = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('span'));

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    setContentByNode(node, content);
    expect(getContentsByNode(node)).toHaveLength(1);

    deleteContentByNode(node, content);
    expect(getContentsByNode(node)).toEqual([]);
  });

  it('deleteContentByNodeで存在しないcontentを削除しても問題ないこと', () => {
    const node = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('span'));

    setFragment(fragment);
    const content = createContent(createBindingInfo(placeholder));

    // 登録せずに削除
    deleteContentByNode(node, content);
    expect(getContentsByNode(node)).toEqual([]);
  });

  it('deleteContentByNodeで登録済みノードから別のcontentを削除しようとしても変化しないこと', () => {
    const node = document.createElement('div');
    const placeholder1 = document.createComment('placeholder1');
    const placeholder2 = document.createComment('placeholder2');

    const fragment1 = document.createDocumentFragment();
    fragment1.appendChild(document.createElement('span'));
    setFragment(fragment1);
    const content1 = createContent(createBindingInfo(placeholder1));

    const fragment2 = document.createDocumentFragment();
    fragment2.appendChild(document.createElement('div'));
    setFragment(fragment2);
    const content2 = createContent(createBindingInfo(placeholder2));

    setContentByNode(node, content1);
    // content2は登録していないので削除しても変化なし
    deleteContentByNode(node, content2);
    expect(getContentsByNode(node)).toHaveLength(1);
    expect(getContentsByNode(node)[0]).toBe(content1);
  });

  it('deleteContentByNodeで複数登録のうち1つだけ削除した場合残りが保持されること', () => {
    const node = document.createElement('div');
    const placeholder1 = document.createComment('placeholder1');
    const placeholder2 = document.createComment('placeholder2');

    const fragment1 = document.createDocumentFragment();
    fragment1.appendChild(document.createElement('span'));
    setFragment(fragment1);
    const content1 = createContent(createBindingInfo(placeholder1));

    const fragment2 = document.createDocumentFragment();
    fragment2.appendChild(document.createElement('div'));
    setFragment(fragment2);
    const content2 = createContent(createBindingInfo(placeholder2));

    setContentByNode(node, content1);
    setContentByNode(node, content2);
    expect(getContentsByNode(node)).toHaveLength(2);

    deleteContentByNode(node, content1);
    const remaining = getContentsByNode(node);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(content2);
  });
});
