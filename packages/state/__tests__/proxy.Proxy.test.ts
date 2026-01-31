import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createStateProxy } from '../src/proxy/StateHandler';
import { createListIndex } from '../src/list/createListIndex';
import { getListIndexesByList, setListIndexesByList } from '../src/list/listIndexesByList';
import type { IBindingInfo } from '../src/types';
import type { IStateElement } from '../src/components/types';
import type { IStateAddress } from '../src/address/types';
import type { ICacheEntry } from '../src/cache/types';
import type { IVersionInfo } from '../src/version/types';
import { setStateElementByName } from '../src/stateElementByName';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';

vi.mock('../src/apply/applyChange', () => ({
  applyChange: vi.fn()
}));

import { applyChange } from '../src/apply/applyChange';

const applyChangeMock = vi.mocked(applyChange);

function createMockStateElement(options?: {
  listPaths?: Set<string>;
  elementPaths?: Set<string>;
  getterPaths?: Set<string>;
  bindingInfosByAddress?: Map<IStateAddress, IBindingInfo[]>;
}): IStateElement {
  const bindingInfosByAddress = options?.bindingInfosByAddress ?? new Map<IStateAddress, IBindingInfo[]>();
  const listPaths = options?.listPaths ?? new Set<string>();
  const elementPaths = options?.elementPaths ?? new Set<string>();
  const getterPaths = options?.getterPaths ?? new Set<string>();
  const cache = new Map<IStateAddress, ICacheEntry>();
  const mightChangeByPath = new Map<string, IVersionInfo>();
  const dynamicDependency = new Map<string, string[]>();
  const staticDependency = new Map<string, string[]>();
  let version = 0;
  return {
    name: 'default',
    bindingInfosByAddress,
    initializePromise: Promise.resolve(),
    listPaths,
    elementPaths,
    getterPaths,
    loopContextStack: {
      createLoopContext: (_elementPathInfo, _listIndex, callback) => {
        return callback({ elementPathInfo: _elementPathInfo, listIndex: _listIndex } as any);
      }
    },
    cache,
    mightChangeByPath,
    dynamicDependency,
    staticDependency,
    get version() {
      return version;
    },
    addBindingInfo() {},
    deleteBindingInfo() {},
    addStaticDependency() {},
    addDynamicDependency() {},
    async createState(callback) {
      return callback({} as any);
    },
    nextVersion() {
      version += 1;
      return version;
    },
  };
}

describe('proxy/StateHandler', () => {
  beforeEach(() => {
    setStateElementByName('default', null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setStateElementByName('default', null);
  });

  it('存在しないプロパティはエラーになること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);
    const proxy = createStateProxy({}, 'default');
    expect(() => (proxy as any).unknown).toThrow();
  });

  it('ネストしたパスを取得できること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);
    const proxy = createStateProxy({ user: { name: 'Alice' } }, 'default');
    expect((proxy as any)['user.name']).toBe('Alice');
  });

  it('$$setLoopContextでワイルドカードパスを解決できること', async () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);
    const state = { users: [{ name: 'Bob' }, { name: 'Carol' }] };
    const proxy = createStateProxy(state, 'default');
    const listIndex = createListIndex(null, 1);
    const loopContext = {
      elementPathInfo: getPathInfo('users.*'),
      listIndex
    };

    const result = await (proxy as any).$$setLoopContext(loopContext, async () => (proxy as any)['users.*.name']);
    expect(result).toBe('Carol');
  });

  it('listPathsに含まれる配列はget時にlistIndexesが設定されること', () => {
    const list = [1, 2, 3];
    const listPaths = new Set<string>(['items']);
    const stateElement = createMockStateElement({ listPaths });
    setStateElementByName('default', stateElement);
    const proxy = createStateProxy({ items: list }, 'default');

    expect(getListIndexesByList(list)).toBeNull();
    const value = (proxy as any).items;
    expect(value).toBe(list);
    expect(getListIndexesByList(list)).not.toBeNull();

    setListIndexesByList(list, null);
  });

  it('listPathsに含まれる配列はset時にlistIndexesが設定されること', () => {
    const listPaths = new Set<string>(['items']);
    const stateElement = createMockStateElement({ listPaths });
    setStateElementByName('default', stateElement);
    const proxy = createStateProxy({ items: [] }, 'default');

    const list = [10, 20];
    (proxy as any).items = list;

    expect(getListIndexesByList(list)).toBeNull();
    setListIndexesByList(list, null);
  });

  it('setでバインディングがあればapplyChangeが呼ばれること', async () => {
    const bindingInfo = {
      propName: 'value',
      propSegments: ['value'],
      propModifiers: [],
      statePathName: 'count',
      statePathInfo: getPathInfo('count'),
      stateName: 'default',
      filterTexts: [],
      bindingType: 'prop',
      uuid: null,
      node: document.createElement('input'),
      placeHolderNode: document.createElement('input')
    } as IBindingInfo;

    const address = createStateAddress(bindingInfo.statePathInfo!, null);
    const bindingInfosByAddress = new Map<IStateAddress, IBindingInfo[]>([[address, [bindingInfo]]]);
    const stateElement = createMockStateElement({ bindingInfosByAddress });
    setStateElementByName('default', stateElement);
    const proxy = createStateProxy({ count: 0 }, 'default');

    (proxy as any).count = 2;
    await new Promise((resolve) => queueMicrotask(resolve));
    expect(applyChangeMock).toHaveBeenCalledTimes(1);
    expect(applyChangeMock).toHaveBeenCalledWith(bindingInfo, 2);
  });
});
