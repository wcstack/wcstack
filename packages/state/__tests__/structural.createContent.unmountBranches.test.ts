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
    outFilters: [],
    inFilters: [],
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

    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

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

  it('unmountでstateAddressキャッシュがクリアされること', async () => {
    vi.resetModules();
    const { createContent } = await import('../src/structural/createContent');
    const { setFragmentInfoByUUID } = await import('../src/structural/fragmentInfoByUUID');
    const bindingsByContent = await import('../src/bindings/bindingsByContent.js');
    const { getStateAddressByBindingInfo } = await import('../src/binding/getStateAddressByBindingInfo');
    const loopContextByNode = await import('../src/list/loopContextByNode.js');
    const { createListIndex } = await import('../src/list/createListIndex');

    const placeholder = document.createComment('placeholder');
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('span'));

    const parseBindTextResult = {
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
    } as any;

    setFragmentInfoByUUID(uuid, {
      fragment,
      parseBindTextResult,
      nodeInfos: [],
    });

    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    const childNode = document.createComment('child-text');
    // ワイルドカード付きのパスでテスト（loopContextが使用される）
    const childBinding = createBindingInfo(childNode, { 
      bindingType: 'text', 
      propName: 'text',
      statePathName: 'items.*',
      statePathInfo: getPathInfo('items.*')
    });
    bindingsByContent.setBindingsByContent(content, [childBinding]);

    // loopContextを設定
    const listIndex1 = createListIndex(null, 0);
    loopContextByNode.setLoopContextByNode(childNode, { 
      listIndex: listIndex1, 
      elementPathInfo: getPathInfo('items.*') 
    } as any);

    // アドレスを取得してキャッシュされることを確認
    const address1 = getStateAddressByBindingInfo(childBinding);
    const address1Cached = getStateAddressByBindingInfo(childBinding);
    expect(address1).toBe(address1Cached);
    expect(address1.listIndex).toBe(listIndex1);

    content.unmount();

    // unmount後、新しいloopContextを設定
    const listIndex2 = createListIndex(null, 5);
    loopContextByNode.setLoopContextByNode(childNode, { 
      listIndex: listIndex2, 
      elementPathInfo: getPathInfo('items.*') 
    } as any);

    // unmount後は新しいlistIndexに基づいたアドレスが生成される（キャッシュがクリアされた証拠）
    const address2 = getStateAddressByBindingInfo(childBinding);
    expect(address2.listIndex).toBe(listIndex2);

    setFragmentInfoByUUID(uuid, null);
  });

  it('同じノードに複数のバインディングがある場合でも各バインディングのstateAddressキャッシュがクリアされること', async () => {
    vi.resetModules();
    const { createContent } = await import('../src/structural/createContent');
    const { setFragmentInfoByUUID } = await import('../src/structural/fragmentInfoByUUID');
    const bindingsByContent = await import('../src/bindings/bindingsByContent.js');
    const { getStateAddressByBindingInfo } = await import('../src/binding/getStateAddressByBindingInfo');
    const loopContextByNode = await import('../src/list/loopContextByNode.js');
    const { createListIndex } = await import('../src/list/createListIndex');

    const placeholder = document.createComment('placeholder');
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('span'));

    const parseBindTextResult = {
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
    } as any;

    setFragmentInfoByUUID(uuid, {
      fragment,
      parseBindTextResult,
      nodeInfos: [],
    });

    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    // 同じノードに複数のバインディング（ワイルドカード付き）
    const sharedNode = document.createElement('span');
    const childBinding1 = createBindingInfo(sharedNode, { 
      bindingType: 'text', 
      propName: 'textContent',
      statePathName: 'items.*.name',
      statePathInfo: getPathInfo('items.*.name')
    });
    const childBinding2 = createBindingInfo(sharedNode, { 
      bindingType: 'text', 
      propName: 'title',
      statePathName: 'items.*.title',
      statePathInfo: getPathInfo('items.*.title')
    });
    
    bindingsByContent.setBindingsByContent(content, [childBinding1, childBinding2]);

    // loopContextを設定
    const listIndex1 = createListIndex(null, 0);
    loopContextByNode.setLoopContextByNode(sharedNode, { 
      listIndex: listIndex1, 
      elementPathInfo: getPathInfo('items.*') 
    } as any);

    // 両方のバインディングのアドレスを取得してキャッシュ
    const address1_1 = getStateAddressByBindingInfo(childBinding1);
    const address1_2 = getStateAddressByBindingInfo(childBinding2);
    expect(address1_1.listIndex).toBe(listIndex1);
    expect(address1_2.listIndex).toBe(listIndex1);

    content.unmount();

    // unmount後、新しいloopContextを設定
    const listIndex2 = createListIndex(null, 5);
    loopContextByNode.setLoopContextByNode(sharedNode, { 
      listIndex: listIndex2, 
      elementPathInfo: getPathInfo('items.*') 
    } as any);

    // 両方のバインディングで新しいアドレスが生成される
    const address2_1 = getStateAddressByBindingInfo(childBinding1);
    const address2_2 = getStateAddressByBindingInfo(childBinding2);
    expect(address2_1.listIndex).toBe(listIndex2);
    expect(address2_2.listIndex).toBe(listIndex2);

    setFragmentInfoByUUID(uuid, null);
  });
});
