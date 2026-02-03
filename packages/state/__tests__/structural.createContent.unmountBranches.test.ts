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

  it('unmountでcontentByNodeがnullにクリアされること', async () => {
    const { content, setFragmentInfoByUUID, bindingsByContent, contentByNode } = await setup();

    const childNode = document.createComment('child-text');
    const childBinding = createBindingInfo(childNode, { bindingType: 'text', propName: 'text' });
    
    // contentByNodeを設定
    const dummyContent = {
      firstNode: null,
      lastNode: null,
      mounted: true,
      mountAfter: vi.fn(),
      unmount: vi.fn(),
    } as any;
    contentByNode.setContentByNode(childNode, dummyContent);
    bindingsByContent.setBindingsByContent(content, [childBinding]);

    content.unmount();

    // unmount後はcontentByNodeがnullになっていること
    expect(contentByNode.getContentByNode(childNode)).toBeNull();

    setFragmentInfoByUUID(uuid, null);
  });

  it('unmountでloopContextByNodeがnullにクリアされること', async () => {
    vi.resetModules();
    const { createContent } = await import('../src/structural/createContent');
    const { setFragmentInfoByUUID } = await import('../src/structural/fragmentInfoByUUID');
    const bindingsByContent = await import('../src/bindings/bindingsByContent.js');
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
      filters: [],
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
    const content = createContent(bindingInfo, null);

    const childNode = document.createComment('child-for');
    const childBinding = createBindingInfo(childNode, { bindingType: 'for', propName: 'for' });
    
    // loopContextByNodeを設定
    const listIndex = createListIndex(null, 0);
    loopContextByNode.setLoopContextByNode(childNode, { 
      listIndex, 
      elementPathInfo: getPathInfo('items.*') 
    } as any);
    bindingsByContent.setBindingsByContent(content, [childBinding]);

    // unmount前はloopContextが存在する
    expect(loopContextByNode.getLoopContextByNode(childNode)).not.toBeNull();

    content.unmount();

    // unmount後はloopContextByNodeがnullになっていること
    expect(loopContextByNode.getLoopContextByNode(childNode)).toBeNull();

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
      filters: [],
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
    const content = createContent(bindingInfo, null);

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

    // unmount後はloopContextがクリアされているので、新しいloopContextを設定
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

  it('同じノードに複数のバインディングがある場合でもcontentByNodeとloopContextByNodeは1回だけクリアされること', async () => {
    vi.resetModules();
    const { createContent } = await import('../src/structural/createContent');
    const { setFragmentInfoByUUID } = await import('../src/structural/fragmentInfoByUUID');
    const bindingsByContent = await import('../src/bindings/bindingsByContent.js');
    const contentByNode = await import('../src/structural/contentByNode.js');

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
      filters: [],
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
    const content = createContent(bindingInfo, null);

    // 同じノードに複数のバインディング
    const sharedNode = document.createElement('span');
    const childBinding1 = createBindingInfo(sharedNode, { 
      bindingType: 'text', 
      propName: 'textContent',
      statePathName: 'value1',
      statePathInfo: getPathInfo('value1')
    });
    const childBinding2 = createBindingInfo(sharedNode, { 
      bindingType: 'text', 
      propName: 'title',
      statePathName: 'value2',
      statePathInfo: getPathInfo('value2')
    });
    
    // ダミーのcontentを設定
    const dummyContent = {
      firstNode: null,
      lastNode: null,
      mounted: true,
      mountAfter: vi.fn(),
      unmount: vi.fn(),
    } as any;
    contentByNode.setContentByNode(sharedNode, dummyContent);
    bindingsByContent.setBindingsByContent(content, [childBinding1, childBinding2]);

    content.unmount();

    // contentByNodeがnullになっていること（nodeSetによる重複排除が機能）
    expect(contentByNode.getContentByNode(sharedNode)).toBeNull();

    setFragmentInfoByUUID(uuid, null);
  });
});
