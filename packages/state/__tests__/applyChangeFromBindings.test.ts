import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/list/loopContextByNode', () => ({
  getLoopContextByNode: vi.fn()
}));
vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn()
}));
vi.mock('../src/apply/applyChange', () => ({
  applyChange: vi.fn()
}));

import { applyChangeFromBindings } from '../src/apply/applyChangeFromBindings';
import { getLoopContextByNode } from '../src/list/loopContextByNode';
import { getStateElementByName } from '../src/stateElementByName';
import { applyChange } from '../src/apply/applyChange';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';

const getLoopContextByNodeMock = vi.mocked(getLoopContextByNode);
const getStateElementByNameMock = vi.mocked(getStateElementByName);
const applyChangeMock = vi.mocked(applyChange);

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
    $$setLoopContext: vi.fn((loopContext: any, callback: () => any) => callback())
  } as any;
}

describe('applyChangeFromBindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('同じstateNameはcreateStateが1回で処理されること', () => {
    const state = createStateProxy({ a: 1, b: 2 });
    const createStateMock = vi.fn((_mutability: string, callback: (state: any) => void) => callback(state));
    getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);
    getLoopContextByNodeMock.mockReturnValue(null);

    const node1 = document.createElement('div');
    const node2 = document.createElement('span');
    const bindingInfos = [
      createBindingInfo('app', 'a', node1),
      createBindingInfo('app', 'b', node2)
    ];

    applyChangeFromBindings(bindingInfos);

    expect(createStateMock).toHaveBeenCalledTimes(1);
    expect(applyChangeMock).toHaveBeenCalledTimes(2);
  });

  it('同じstateName内でloopContextごとに$$setLoopContextが呼ばれること', () => {
    const state = createStateProxy({ a: 'x', b: 'y', c: 'z' });
    const createStateMock = vi.fn((_mutability: string, callback: (state: any) => void) => callback(state));
    getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);

    const node1 = document.createElement('div');
    const node2 = document.createElement('span');
    const node3 = document.createElement('p');
    const loopContext1 = { id: 1 } as any;
    const loopContext2 = { id: 2 } as any;

    getLoopContextByNodeMock.mockImplementation((node) => {
      if (node === node3) return loopContext2;
      return loopContext1;
    });

    const bindingInfos = [
      createBindingInfo('app', 'a', node1),
      createBindingInfo('app', 'b', node2),
      createBindingInfo('app', 'c', node3)
    ];

    applyChangeFromBindings(bindingInfos);

    expect(state.$$setLoopContext).toHaveBeenCalledTimes(2);
    expect(state.$$setLoopContext).toHaveBeenNthCalledWith(1, loopContext1, expect.any(Function));
    expect(state.$$setLoopContext).toHaveBeenNthCalledWith(2, loopContext2, expect.any(Function));
    expect(applyChangeMock).toHaveBeenCalledTimes(3);
  });

  it('stateNameが変わる場合はcreateStateが分割されること', () => {
    const stateA = createStateProxy({ a: 1 });
    const stateB = createStateProxy({ b: 2 });
    const createStateMockA = vi.fn((_mutability: string, callback: (state: any) => void) => callback(stateA));
    const createStateMockB = vi.fn((_mutability: string, callback: (state: any) => void) => callback(stateB));

    getStateElementByNameMock.mockImplementation((name: string) => {
      if (name === 'app') return { createState: createStateMockA } as any;
      if (name === 'app2') return { createState: createStateMockB } as any;
      return null as any;
    });
    getLoopContextByNodeMock.mockReturnValue(null);

    const node1 = document.createElement('div');
    const node2 = document.createElement('span');
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
    getLoopContextByNodeMock.mockReturnValue(null);

    const node = document.createElement('div');
    const bindingInfos = [createBindingInfo('missing', 'a', node)];

    expect(() => applyChangeFromBindings(bindingInfos)).toThrow(/State element with name "missing" not found for binding/);
    expect(applyChangeMock).not.toHaveBeenCalled();
  });
});
