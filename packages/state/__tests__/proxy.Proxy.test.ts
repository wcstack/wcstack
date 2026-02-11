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
import { setLoopContextSymbol } from '../src/proxy/symbols';

import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
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
      createLoopContext: (_elementStateAddress, callback) => {
        return callback(_elementStateAddress as any);
      }
    },
    cache,
    mightChangeByPath,
    dynamicDependency,
    staticDependency,
    get version() {
      return version;
    },
    setPathInfo() {},
    addStaticDependency() {},
    addDynamicDependency() {},
    createState(mutability, callback) {
      return callback({ [setLoopContextSymbol]: (_loopContext: any, cb: () => any) => cb() } as any);
    },
    async createStateAsync(mutability, callback) {
      return callback({ [setLoopContextSymbol]: (_loopContext: any, cb: () => any) => cb() } as any);
    },
    nextVersion() {
      version += 1;
      return version;
    },
  };
}

describe('proxy/StateHandler', () => {
  beforeEach(() => {
    setStateElementByName(document, 'default', null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setStateElementByName(document, 'default', null);
  });

  it('存在しないプロパティはエラーになること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName(document, 'default', stateElement);
    const proxy = createStateProxy(document, {}, 'default', 'readonly');
    expect(() => (proxy as any).unknown).toThrow();
  });

  it('ネストしたパスを取得できること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName(document, 'default', stateElement);
    const proxy = createStateProxy(document, { user: { name: 'Alice' } }, 'default', 'readonly');
    expect((proxy as any)['user.name']).toBe('Alice');
  });

  it('$$setLoopContextでワイルドカードパスを解決できること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName(document, 'default', stateElement);
    const state = { users: [{ name: 'Bob' }, { name: 'Carol' }] };
    const proxy = createStateProxy(document, state, 'default', 'readonly');
    const listIndex = createListIndex(null, 1);
    const loopContext = createStateAddress(getPathInfo('users.*'), listIndex);

    const result = (proxy as any)[setLoopContextSymbol](loopContext, () => (proxy as any)['users.*.name']);
    expect(result).toBe('Carol');
  });

  it('listPathsに含まれる配列でもget時にlistIndexesは設定されないこと', () => {
    const list = [1, 2, 3];
    const listPaths = new Set<string>(['items']);
    const stateElement = createMockStateElement({ listPaths });
    setStateElementByName(document, 'default', stateElement);
    const proxy = createStateProxy(document, { items: list }, 'default', 'readonly');

    expect(getListIndexesByList(list)).toBeNull();
    const value = (proxy as any).items;
    expect(value).toBe(list);
    expect(getListIndexesByList(list)).toBeNull();
  });

  it('listPathsに含まれる配列でもset時にlistIndexesは設定されないこと', () => {
    const listPaths = new Set<string>(['items']);
    const stateElement = createMockStateElement({ listPaths });
    setStateElementByName(document, 'default', stateElement);
    const proxy = createStateProxy(document, { items: [] }, 'default', 'writable');

    const list = [10, 20];
    (proxy as any).items = list;

    expect(getListIndexesByList(list)).toBeNull();
  });

  it('setでバインディングがあればapplyChangeが呼ばれること', async () => {
    const countPathInfo = getPathInfo('count');
    const bindingInfo = {
      propName: 'value',
      propSegments: ['value'],
      propModifiers: [],
      statePathName: 'count',
      statePathInfo: countPathInfo,
      stateAbsolutePathInfo: getAbsolutePathInfo('default', countPathInfo),
      stateName: 'default',
      outFilters: [],
      inFilters: [],
      bindingType: 'prop',
      uuid: null,
      node: document.createElement('input'),
      replaceNode: document.createElement('input')
    } as IBindingInfo;

    const address = createStateAddress(bindingInfo.statePathInfo!, null);
    const stateElement = createMockStateElement();
    setStateElementByName(document, 'default', stateElement);
    const absoluteAddress = createAbsoluteStateAddress(getAbsolutePathInfo('default', address.pathInfo), address.listIndex);
    addBindingInfoByAbsoluteStateAddress(absoluteAddress, bindingInfo);
    const proxy = createStateProxy(document, { count: 0 }, 'default', 'writable');

    (proxy as any).count = 2;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([bindingInfo]);
  });
});
