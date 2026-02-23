import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn()
}));
vi.mock('../src/apply/applyChange', () => ({
  applyChange: vi.fn()
}));
vi.mock('../src/apply/rootNodeByFragment', () => ({
  getRootNodeByFragment: vi.fn()
}));
vi.mock('../src/list/lastListValueByAbsoluteStateAddress', () => ({
  setLastListValueByAbsoluteStateAddress: vi.fn()
}));

import { applyChangeFromBindings } from '../src/apply/applyChangeFromBindings';
import { getStateElementByName } from '../src/stateElementByName';
import { applyChange } from '../src/apply/applyChange';
import { getRootNodeByFragment } from '../src/apply/rootNodeByFragment';
import { setLastListValueByAbsoluteStateAddress } from '../src/list/lastListValueByAbsoluteStateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { config } from '../src/config';
import { updatedCallbackSymbol } from '../src/proxy/symbols';
import type { IBindingInfo } from '../src/types';

const getStateElementByNameMock = vi.mocked(getStateElementByName);
const applyChangeMock = vi.mocked(applyChange);
const getRootNodeByFragmentMock = vi.mocked(getRootNodeByFragment);
const setLastListValueMock = vi.mocked(setLastListValueByAbsoluteStateAddress);

function createBindingInfo(stateName: string, statePathName: string, node: Node): IBindingInfo {
  const pathInfo = getPathInfo(statePathName);
  return {
    propName: '',
    propSegments: [],
    propModifiers: [],
    statePathName,
    statePathInfo: pathInfo,
    stateName,
    outFilters: [],
    inFilters: [],
    node,
    replaceNode: node,
    bindingType: 'text',
    uuid: null
  };
}

function createStateProxy(values: Record<string, any>) {
  return {
    ...values,
  } as any;
}

describe('applyChangeFromBindings', () => {
  let originalDebug: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    originalDebug = config.debug;
  });

  afterEach(() => {
    config.debug = originalDebug;
  });

  it('同じstateNameはcreateStateが1回で処理されること', () => {
    const state = createStateProxy({ a: 1, b: 2 });
    const createStateMock = vi.fn((_mutability: string, callback: (state: any) => void) => callback(state));
    getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);

    const node1 = document.createElement('div');
    const node2 = document.createElement('span');
    document.body.appendChild(node1);
    document.body.appendChild(node2);
    const bindingInfos = [
      createBindingInfo('app', 'a', node1),
      createBindingInfo('app', 'b', node2)
    ];

    applyChangeFromBindings(bindingInfos);

    expect(createStateMock).toHaveBeenCalledTimes(1);
    expect(applyChangeMock).toHaveBeenCalledTimes(2);
  });

  it('stateNameが変わる場合はcreateStateが分割されること', () => {
    const stateA = createStateProxy({ a: 1 });
    const stateB = createStateProxy({ b: 2 });
    const createStateMockA = vi.fn((_mutability: string, callback: (state: any) => void) => callback(stateA));
    const createStateMockB = vi.fn((_mutability: string, callback: (state: any) => void) => callback(stateB));

    getStateElementByNameMock.mockImplementation((_rootNode: Node, name: string) => {
      if (name === 'app') return { createState: createStateMockA } as any;
      if (name === 'app2') return { createState: createStateMockB } as any;
      return null as any;
    });
    const node1 = document.createElement('div');
    const node2 = document.createElement('span');
    document.body.appendChild(node1);
    document.body.appendChild(node2);
    const bindingInfos = [
      createBindingInfo('app', 'a', node1),
      createBindingInfo('app2', 'b', node2)
    ];

    applyChangeFromBindings(bindingInfos);

    expect(createStateMockA).toHaveBeenCalledTimes(1);
    expect(createStateMockB).toHaveBeenCalledTimes(1);
    expect(applyChangeMock).toHaveBeenCalledTimes(2);
  });

  it('state要素が見つからない場合はエラーになること', () => {
    getStateElementByNameMock.mockReturnValue(null);

    const node = document.createElement('div');
    document.body.appendChild(node);
    const bindingInfos = [createBindingInfo('missing', 'a', node)];

    expect(() => applyChangeFromBindings(bindingInfos)).toThrow(/State element with name "missing" not found for binding/);
    expect(applyChangeMock).not.toHaveBeenCalled();
  });

  it('DocumentFragmentのreplaceNodeはisConnected=falseのためスキップされること', () => {
    getRootNodeByFragmentMock.mockReturnValue(null);

    const fragment = document.createDocumentFragment();
    const bindingInfos = [createBindingInfo('app', 'a', fragment)];

    // DocumentFragmentはisConnected=falseなのでスキップされる
    applyChangeFromBindings(bindingInfos);
    expect(applyChangeMock).not.toHaveBeenCalled();
    expect(getStateElementByNameMock).not.toHaveBeenCalled();
  });

  it('DocumentFragmentのrootNodeが解決できる場合でもisConnected=falseならスキップされること', () => {
    const state = createStateProxy({ a: 1 });
    const createStateMock = vi.fn((_mutability: string, callback: (state: any) => void) => callback(state));
    getRootNodeByFragmentMock.mockReturnValue(document);
    getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);

    const fragment = document.createDocumentFragment();
    const bindingInfos = [createBindingInfo('app', 'a', fragment)];

    // DocumentFragmentはisConnected=falseなのでスキップされる
    applyChangeFromBindings(bindingInfos);
    expect(getRootNodeByFragmentMock).not.toHaveBeenCalled();
    expect(applyChangeMock).not.toHaveBeenCalled();
  });

  it('同じstateNameでもrootNodeが変わる場合はcreateStateが分割されること', () => {
    const state = createStateProxy({ a: 1, b: 2 });
    const createStateMock = vi.fn((_mutability: string, callback: (state: any) => void) => callback(state));
    getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);

    const lightDomNode = document.createElement('div');
    document.body.appendChild(lightDomNode);

    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const shadowNode = document.createElement('span');
    shadowRoot.appendChild(shadowNode);
    document.body.appendChild(host);

    const bindingInfos = [
      createBindingInfo('app', 'a', lightDomNode),
      createBindingInfo('app', 'b', shadowNode)
    ];

    applyChangeFromBindings(bindingInfos);

    expect(createStateMock).toHaveBeenCalledTimes(2);
    expect(applyChangeMock).toHaveBeenCalledTimes(2);
  });

  it('applyChange中にnewListValueByAbsAddressに追加された値がsetLastListValueに反映されること', () => {
    const state = createStateProxy({ items: [1, 2] });
    const createStateMock = vi.fn((_mutability: string, callback: (state: any) => void) => callback(state));
    getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);

    const node = document.createElement('div');
    document.body.appendChild(node);
    const bindingInfos = [createBindingInfo('app', 'items', node)];

    // applyChange mock populates newListValueByAbsAddress on the context
    const fakeAbsAddress = { id: 'test-abs-address' } as any;
    const fakeListValue = [1, 2, 3];
    applyChangeMock.mockImplementation((_binding: any, context: any) => {
      context.newListValueByAbsAddress.set(fakeAbsAddress, fakeListValue);
    });

    applyChangeFromBindings(bindingInfos);

    expect(setLastListValueMock).toHaveBeenCalledWith(fakeAbsAddress, fakeListValue);
  });

  it('config.debug=trueで切断されたバインディングはconsole.logが呼ばれスキップされること', () => {
    config.debug = true;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const node = document.createElement('div');
    // DOMに追加しない → isConnected=false
    const bindingInfos = [createBindingInfo('app', 'a', node)];

    applyChangeFromBindings(bindingInfos);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain('skip disconnected binding');
    expect(applyChangeMock).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('DocumentFragmentのrootNodeがgetRootNodeByFragmentで解決されること', () => {
    const state = createStateProxy({ a: 1 });
    const createStateMock = vi.fn((_mutability: string, callback: (state: any) => void) => callback(state));
    getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);

    // connectedなノードのrootNodeがDocumentFragment(非ShadowRoot)を返すようモック
    const node = document.createElement('div');
    document.body.appendChild(node);
    const fakeFragment = document.createDocumentFragment();
    const originalGetRootNode = node.getRootNode.bind(node);
    let callCount = 0;
    vi.spyOn(node, 'getRootNode').mockImplementation(() => {
      callCount++;
      // 最初の呼び出し（外側ループ）ではDocumentFragmentを返す
      if (callCount === 1) return fakeFragment;
      return originalGetRootNode();
    });
    getRootNodeByFragmentMock.mockReturnValue(document);

    const bindingInfos = [createBindingInfo('app', 'a', node)];

    applyChangeFromBindings(bindingInfos);

    expect(getRootNodeByFragmentMock).toHaveBeenCalledWith(fakeFragment);
    expect(applyChangeMock).toHaveBeenCalledTimes(1);
  });

  it('DocumentFragmentのrootNodeが解決できない場合はエラーになること', () => {
    const node = document.createElement('div');
    document.body.appendChild(node);
    const fakeFragment = document.createDocumentFragment();
    vi.spyOn(node, 'getRootNode').mockReturnValue(fakeFragment);
    getRootNodeByFragmentMock.mockReturnValue(null);

    const bindingInfos = [createBindingInfo('app', 'a', node)];

    expect(() => applyChangeFromBindings(bindingInfos)).toThrow(/Root node for fragment not found/);
  });

  it('applyChange中にupdatedAbsAddressSetByStateElementに追加された値がupdatedCallbackに反映されること', () => {
    const updatedCallbackMock = vi.fn();
    const stateWritable = { [updatedCallbackSymbol]: updatedCallbackMock } as any;
    const stateReadonly = createStateProxy({ a: 1 });
    const createStateMock = vi.fn((mutability: string, callback: (state: any) => void) => {
      if (mutability === 'readonly') callback(stateReadonly);
      else if (mutability === 'writable') callback(stateWritable);
    });
    const fakeStateElement = { createState: createStateMock } as any;
    getStateElementByNameMock.mockReturnValue(fakeStateElement);

    const node = document.createElement('div');
    document.body.appendChild(node);
    const bindingInfos = [createBindingInfo('app', 'a', node)];

    const fakeAbsAddress = { id: 'updated-abs' } as any;
    applyChangeMock.mockImplementation((_binding: any, context: any) => {
      let addrSet = context.updatedAbsAddressSetByStateElement.get(fakeStateElement);
      if (!addrSet) {
        addrSet = new Set();
        context.updatedAbsAddressSetByStateElement.set(fakeStateElement, addrSet);
      }
      addrSet.add(fakeAbsAddress);
    });

    applyChangeFromBindings(bindingInfos);

    expect(createStateMock).toHaveBeenCalledWith('writable', expect.any(Function));
    expect(updatedCallbackMock).toHaveBeenCalledWith([fakeAbsAddress]);
  });

  it('applyChange中にdeferredSelectBindingsに追加されたselect.valueがPhase2で適用されること', () => {
    const state = createStateProxy({ selectedId: '2' });
    const createStateMock = vi.fn((_mutability: string, callback: (state: any) => void) => callback(state));
    getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);

    const select = document.createElement('select');
    const option1 = document.createElement('option');
    option1.value = '1';
    option1.textContent = 'Option 1';
    const option2 = document.createElement('option');
    option2.value = '2';
    option2.textContent = 'Option 2';
    select.appendChild(option1);
    select.appendChild(option2);
    document.body.appendChild(select);

    const bindingInfos = [createBindingInfo('app', 'selectedId', select)];

    // applyChange mock が deferredSelectBindings に select.value を追加するシミュレーション
    applyChangeMock.mockImplementation((_binding: any, context: any) => {
      context.deferredSelectBindings.push({
        binding: { ..._binding, propSegments: ['value'] },
        value: '2'
      });
    });

    applyChangeFromBindings(bindingInfos);

    expect(select.value).toBe('2');
  });

  it('Phase2で値が変わらない場合はスキップされること', () => {
    const state = createStateProxy({ selectedId: '1' });
    const createStateMock = vi.fn((_mutability: string, callback: (state: any) => void) => callback(state));
    getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);

    const select = document.createElement('select');
    const option1 = document.createElement('option');
    option1.value = '1';
    select.appendChild(option1);
    document.body.appendChild(select);
    select.value = '1'; // 既に正しい値

    const bindingInfos = [createBindingInfo('app', 'selectedId', select)];

    applyChangeMock.mockImplementation((_binding: any, context: any) => {
      context.deferredSelectBindings.push({
        binding: { ..._binding, propSegments: ['value'] },
        value: '1'
      });
    });

    applyChangeFromBindings(bindingInfos);

    expect(select.value).toBe('1');
  });
});
