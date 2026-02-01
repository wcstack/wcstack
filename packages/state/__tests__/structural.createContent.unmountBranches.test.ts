import { describe, it, expect, afterEach, vi } from 'vitest';
import { getPathInfo } from '../src/address/PathInfo';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import type { IBindingInfo } from '../src/types';

const uuid = 'content-unmount-branch-uuid';

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

afterEach(() => {
  vi.clearAllMocks();
});

describe('createContent (unmount branches)', () => {
  async function setup() {
    vi.resetModules();
    const { createContent } = await import('../src/structural/createContent');
    const { setFragmentInfoByUUID } = await import('../src/structural/fragmentInfoByUUID');
    const bindingsByContent = await import('../src/bindings/bindingsByContent.js');
    const contentByNode = await import('../src/structural/contentByNode.js');

    const placeholder = document.createComment('placeholder');
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('span'));

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

    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo, null);

    return { content, setFragmentInfoByUUID, bindingsByContent, contentByNode };
  }

  it('unmountでif/elseif/elseのcontentがアンマウントされること', async () => {
    const { content, setFragmentInfoByUUID, bindingsByContent, contentByNode } = await setup();

    const childNode = document.createComment('child-if');
    const childContent = {
      firstNode: null,
      lastNode: null,
      mounted: true,
      mountAfter: vi.fn(),
      unmount: vi.fn(),
    } as any;

    const childBinding = createBindingInfo(childNode, { bindingType: 'if', propName: 'if' });
    contentByNode.setContentByNode(childNode, childContent);
    bindingsByContent.setBindingsByContent(content, [childBinding]);

    content.unmount();

    expect(childContent.unmount).toHaveBeenCalled();

    setFragmentInfoByUUID(uuid, null);
  });

  it('bindingTypeがif/elseif/else以外の場合は子contentが呼ばれないこと', async () => {
    const { content, setFragmentInfoByUUID, bindingsByContent, contentByNode } = await setup();

    const childNode = document.createComment('child-text');
    const childContent = {
      firstNode: null,
      lastNode: null,
      mounted: true,
      mountAfter: vi.fn(),
      unmount: vi.fn(),
    } as any;

    const childBinding = createBindingInfo(childNode, { bindingType: 'text', propName: 'text' });
    contentByNode.setContentByNode(childNode, childContent);
    bindingsByContent.setBindingsByContent(content, [childBinding]);

    content.unmount();

    expect(childContent.unmount).not.toHaveBeenCalled();

    setFragmentInfoByUUID(uuid, null);
  });

  it('contentがnullの場合は子contentが呼ばれないこと', async () => {
    const { content, setFragmentInfoByUUID, bindingsByContent } = await setup();

    const childNode = document.createComment('child-null');
    const childBinding = createBindingInfo(childNode, { bindingType: 'if', propName: 'if' });
    bindingsByContent.setBindingsByContent(content, [childBinding]);

    content.unmount();

    setFragmentInfoByUUID(uuid, null);
  });
});
