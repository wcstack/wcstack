import { describe, it, expect, afterEach, vi } from 'vitest';
import { createContent } from '../src/structural/createContent';
import * as bindingsByContent from '../src/bindings/bindingsByContent.js';
import * as contentByNode from '../src/structural/contentByNode.js';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { getPathInfo } from '../src/address/PathInfo';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import type { IBindingInfo } from '../src/types';

const uuid = 'content-test-uuid';

function createBindingInfo(node: Node, overrides: Partial<IBindingInfo> = {}): IBindingInfo {
  return {
    propName: 'if',
    propSegments: [],
    propModifiers: [],
    statePathName: 'flag',
    statePathInfo: getPathInfo('flag'),
    stateName: 'default',
    filters: [],
    bindingType: 'if',
    uuid,
    node,
    replaceNode: node,
    ...overrides,
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
    filters: [],
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

describe('createContent', () => {
  it('uuidがnullの場合はエラーになること', () => {
    const placeholder = document.createComment('placeholder');
    const bindingInfo = createBindingInfo(placeholder, { uuid: null });

    expect(() => createContent(bindingInfo)).toThrow(/BindingInfo\.uuid is null/);
  });

  it('mountAfterでノードを挿入できること', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const fragment = document.createDocumentFragment();
    const span1 = document.createElement('span');
    span1.id = 'span1';
    const span2 = document.createElement('span');
    span2.id = 'span2';
    fragment.appendChild(span1);
    fragment.appendChild(span2);

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    content.mountAfter(placeholder);

    expect(container.childNodes.length).toBe(3);
    expect((container.childNodes[1] as HTMLElement).id).toBe('span1');
    expect((container.childNodes[2] as HTMLElement).id).toBe('span2');
  });

  it('unmountでノードを削除できること', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    fragment.appendChild(span);

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    content.mountAfter(placeholder);
    expect(container.childNodes.length).toBe(2);

    content.unmount();
    expect(container.childNodes.length).toBe(1);
    expect(container.childNodes[0]).toBe(placeholder);

    content.unmount();
    expect(container.childNodes.length).toBe(1);
  });

  it('firstNode/lastNode が取得できること', () => {
    const fragment = document.createDocumentFragment();
    const span1 = document.createElement('span');
    span1.id = 'first';
    const span2 = document.createElement('span');
    span2.id = 'last';
    fragment.appendChild(span1);
    fragment.appendChild(span2);

    const placeholder = document.createComment('placeholder');
    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    expect((content.firstNode as HTMLElement).id).toBe('first');
    expect((content.lastNode as HTMLElement).id).toBe('last');
  });

  it('空のfragmentではfirstNode/lastNodeがnullになること', () => {
    const fragment = document.createDocumentFragment();
    const placeholder = document.createComment('placeholder');
    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    expect(content.firstNode).toBeNull();
    expect(content.lastNode).toBeNull();
  });

  it('mountAfterで親が無い場合は何もしないこと', () => {
    const placeholder = document.createComment('placeholder');
    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    fragment.appendChild(span);

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);
    content.mountAfter(placeholder);

    expect(span.parentNode).toBe(fragment);
  });

  it('mountedの状態が切り替わること', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('span'));

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    expect(content.mounted).toBe(false);

    content.mountAfter(placeholder);
    expect(content.mounted).toBe(true);

    content.unmount();
    expect(content.mounted).toBe(false);
  });

  it('unmountで子のif/elseif/else contentもアンマウントされること', () => {
    const placeholder = document.createComment('placeholder');
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('span'));

    setFragment(fragment);
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    const childNode = document.createComment('child-if');
    const childContent = {
      firstNode: null,
      lastNode: null,
      mounted: true,
      mountAfter: () => {},
      unmount: vi.fn()
    } as any;

    const childBinding = createBindingInfo(childNode, { bindingType: 'if', propName: 'if' });

    contentByNode.setContentByNode(childNode, childContent);
    bindingsByContent.setBindingsByContent(content, [childBinding]);

    expect(bindingsByContent.getBindingsByContent(content)).toHaveLength(1);

    content.unmount();

    expect(childContent.unmount).toHaveBeenCalled();
  });
});
