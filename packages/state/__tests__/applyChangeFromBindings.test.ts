import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn()
}));
vi.mock('../src/apply/applyChange', () => ({
  applyChange: vi.fn()
}));
vi.mock('../src/apply/rootNodeByFragment', () => ({
  getRootNodeByFragment: vi.fn()
}));

import { applyChangeFromBindings } from '../src/apply/applyChangeFromBindings';
import { getStateElementByName } from '../src/stateElementByName';
import { applyChange } from '../src/apply/applyChange';
import { getRootNodeByFragment } from '../src/apply/rootNodeByFragment';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';

const getStateElementByNameMock = vi.mocked(getStateElementByName);
const applyChangeMock = vi.mocked(applyChange);
const getRootNodeByFragmentMock = vi.mocked(getRootNodeByFragment);

function createBindingInfo(stateName: string, statePathName: string, node: Node): IBindingInfo {
  return {
    propName: '',
    propSegments: [],
    propModifiers: [],
    statePathName,
    statePathInfo: getPathInfo(statePathName),
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
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
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

  it('DocumentFragmentのrootNodeが解決できない場合はエラーになること', () => {
    getRootNodeByFragmentMock.mockReturnValue(null);

    const fragment = document.createDocumentFragment();
    const bindingInfos = [createBindingInfo('app', 'a', fragment)];

    expect(() => applyChangeFromBindings(bindingInfos)).toThrow(/Root node for fragment not found for binding/);
    expect(getStateElementByNameMock).not.toHaveBeenCalled();
  });

  it('DocumentFragmentのrootNodeが解決できる場合は正常に処理されること', () => {
    const state = createStateProxy({ a: 1 });
    const createStateMock = vi.fn((_mutability: string, callback: (state: any) => void) => callback(state));
    getRootNodeByFragmentMock.mockReturnValue(document);
    getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);

    const fragment = document.createDocumentFragment();
    const bindingInfos = [createBindingInfo('app', 'a', fragment)];

    applyChangeFromBindings(bindingInfos);

    expect(getRootNodeByFragmentMock).toHaveBeenCalledWith(fragment);
    expect(getStateElementByNameMock).toHaveBeenCalledWith(document, 'app');
    expect(applyChangeMock).toHaveBeenCalledTimes(1);
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
});
