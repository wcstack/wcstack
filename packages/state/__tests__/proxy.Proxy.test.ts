import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createStateProxy } from '../src/proxy/StateHandler';
import { createListIndex } from '../src/list/createListIndex';
import { getListIndexesByList } from '../src/list/listIndexesByList';
import type { IBindingInfo } from '../src/types';
import type { IStateElement } from '../src/components/types';
import type { IStateAddress } from '../src/address/types';
import type { ICacheEntry } from '../src/cache/types';
import type { IVersionInfo } from '../src/version/types';
import { setStateElementByName } from '../src/stateElementByName';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { addBindingInfoByAbsoluteStateAddress } from '../src/binding/getBindingInfosByAbsoluteStateAddress';

vi.mock('../src/apply/applyChangeFromBindings', () => ({
  applyChangeFromBindings: vi.fn()
}));

import { applyChangeFromBindings } from '../src/apply/applyChangeFromBindings';

const applyChangeFromBindingsMock = vi.mocked(applyChangeFromBindings);

function createMockStateElement(options?: {
  listPaths?: Set<string>;
  elementPaths?: Set<string>;
  getterPaths?: Set<string>;
  setterPaths?: Set<string>;
}): IStateElement {
  const listPaths = options?.listPaths ?? new Set<string>();
  const elementPaths = options?.elementPaths ?? new Set<string>();
  const getterPaths = options?.getterPaths ?? new Set<string>();
  const setterPaths = options?.setterPaths ?? new Set<string>();
  const cache = new Map<IStateAddress, ICacheEntry>();
  const mightChangeByPath = new Map<string, IVersionInfo>();
  const dynamicDependency = new Map<string, string[]>();
  const staticDependency = new Map<string, string[]>();
  let version = 0;
  return {
    name: 'default',
    initializePromise: Promise.resolve(),
    listPaths,
    elementPaths,
    getterPaths,
    setterPaths,
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
    setBindingInfo() {},
    addStaticDependency() {},
    addDynamicDependency() {},
    createState(mutability, callback) {
      return callback({ $$setLoopContext: (_loopContext: any, cb: () => any) => cb() } as any);
    },
    async createStateAsync(mutability, callback) {
      return callback({ $$setLoopContext: (_loopContext: any, cb: () => any) => cb() } as any);
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
    const proxy = createStateProxy({}, 'default', 'readonly');
    expect(() => (proxy as any).unknown).toThrow();
  });

  it('ネストしたパスを取得できること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);
    const proxy = createStateProxy({ user: { name: 'Alice' } }, 'default', 'readonly');
    expect((proxy as any)['user.name']).toBe('Alice');
  });

  it('$$setLoopContextでワイルドカードパスを解決できること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);
    const state = { users: [{ name: 'Bob' }, { name: 'Carol' }] };
    const proxy = createStateProxy(state, 'default', 'readonly');
    const listIndex = createListIndex(null, 1);
    const loopContext = {
      elementPathInfo: getPathInfo('users.*'),
      listIndex
    };

    const result = (proxy as any).$$setLoopContext(loopContext, () => (proxy as any)['users.*.name']);
    expect(result).toBe('Carol');
  });

  it('listPathsに含まれる配列でもget時にlistIndexesは設定されないこと', () => {
    const list = [1, 2, 3];
    const listPaths = new Set<string>(['items']);
    const stateElement = createMockStateElement({ listPaths });
    setStateElementByName('default', stateElement);
    const proxy = createStateProxy({ items: list }, 'default', 'readonly');

    expect(getListIndexesByList(list)).toBeNull();
    const value = (proxy as any).items;
    expect(value).toBe(list);
    expect(getListIndexesByList(list)).toBeNull();
  });

  it('listPathsに含まれる配列でもset時にlistIndexesは設定されないこと', () => {
    const listPaths = new Set<string>(['items']);
    const stateElement = createMockStateElement({ listPaths });
    setStateElementByName('default', stateElement);
    const proxy = createStateProxy({ items: [] }, 'default', 'writable');

    const list = [10, 20];
    (proxy as any).items = list;

    expect(getListIndexesByList(list)).toBeNull();
  });

  it('setでバインディングがあればapplyChangeが呼ばれること', async () => {
    const bindingInfo = {
      propName: 'value',
      propSegments: ['value'],
      propModifiers: [],
      statePathName: 'count',
      statePathInfo: getPathInfo('count'),
      stateName: 'default',
      filters: [],
      bindingType: 'prop',
      uuid: null,
      node: document.createElement('input'),
      replaceNode: document.createElement('input')
    } as IBindingInfo;

    const address = createStateAddress(bindingInfo.statePathInfo!, null);
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);
    const absoluteAddress = createAbsoluteStateAddress('default', address);
    addBindingInfoByAbsoluteStateAddress(absoluteAddress, bindingInfo);
    const proxy = createStateProxy({ count: 0 }, 'default', 'writable');

    (proxy as any).count = 2;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([bindingInfo]);
  });
});
