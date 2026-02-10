import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/address/ResolvedAddress', () => ({
  getResolvedAddress: vi.fn()
}));
vi.mock('../src/address/AbsolutePathInfo', () => ({
  getAbsolutePathInfo: vi.fn()
}));
vi.mock('../src/address/AbsoluteStateAddress', () => ({
  createAbsoluteStateAddress: vi.fn()
}));
vi.mock('../src/address/StateAddress', () => ({
  createStateAddress: vi.fn()
}));
vi.mock('../src/cache/cacheEntryByAbsoluteStateAddress', () => ({
  setCacheEntryByAbsoluteStateAddress: vi.fn()
}));
vi.mock('../src/dependency/walkDependency', () => ({
  walkDependency: vi.fn()
}));
vi.mock('../src/updater/updater', () => ({
  getUpdater: vi.fn()
}));
vi.mock('../src/proxy/methods/getListIndex', () => ({
  getListIndex: vi.fn()
}));

import { postUpdate } from '../src/proxy/apis/postUpdate';
import { getResolvedAddress } from '../src/address/ResolvedAddress';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { createStateAddress } from '../src/address/StateAddress';
import { setCacheEntryByAbsoluteStateAddress } from '../src/cache/cacheEntryByAbsoluteStateAddress';
import { walkDependency } from '../src/dependency/walkDependency';
import { getUpdater } from '../src/updater/updater';
import { getListIndex } from '../src/proxy/methods/getListIndex';

const getResolvedAddressMock = vi.mocked(getResolvedAddress);
const getAbsolutePathInfoMock = vi.mocked(getAbsolutePathInfo);
const createAbsoluteStateAddressMock = vi.mocked(createAbsoluteStateAddress);
const createStateAddressMock = vi.mocked(createStateAddress);
const setCacheMock = vi.mocked(setCacheEntryByAbsoluteStateAddress);
const walkDependencyMock = vi.mocked(walkDependency);
const getUpdaterMock = vi.mocked(getUpdater);
const getListIndexMock = vi.mocked(getListIndex);

describe('postUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PostFunctionを返すこと', () => {
    const handler = {
      stateElement: { name: 'default', staticDependency: new Map(), dynamicDependency: new Map(), listPaths: new Set() },
      stateName: 'default'
    } as any;

    const fn = postUpdate({}, '$postUpdate', {}, handler);
    expect(typeof fn).toBe('function');
  });

  it('PostFunctionがアドレス解決・キュー登録・依存関係�E琁E��実行すること', () => {
    const resolvedAddress = { pathInfo: { path: 'count' } };
    const listIndex = null;
    const stateAddress = { pathInfo: { path: 'count' }, listIndex: null };
    const absPathInfo = { path: 'default.count' };
    const absAddress = { absPathInfo, listIndex: null };
    const updater = { enqueueAbsoluteAddress: vi.fn() };

    getResolvedAddressMock.mockReturnValue(resolvedAddress as any);
    getListIndexMock.mockReturnValue(listIndex as any);
    createStateAddressMock.mockReturnValue(stateAddress as any);
    getAbsolutePathInfoMock.mockReturnValue(absPathInfo as any);
    createAbsoluteStateAddressMock.mockReturnValue(absAddress as any);
    getUpdaterMock.mockReturnValue(updater as any);
    walkDependencyMock.mockImplementation(() => []);

    const staticDep = new Map();
    const dynamicDep = new Map();
    const listPaths = new Set<string>();
    const handler = {
      stateElement: { name: 'default', staticDependency: staticDep, dynamicDependency: dynamicDep, listPaths },
      stateName: 'default'
    } as any;
    const target = {};
    const receiver = {};

    const fn = postUpdate(target, '$postUpdate', receiver, handler);
    fn('count');

    expect(getResolvedAddressMock).toHaveBeenCalledWith('count');
    expect(getListIndexMock).toHaveBeenCalledWith(target, resolvedAddress, receiver, handler);
    expect(createStateAddressMock).toHaveBeenCalledWith(resolvedAddress.pathInfo, listIndex);
    expect(getAbsolutePathInfoMock).toHaveBeenCalledWith('default', stateAddress.pathInfo);
    expect(createAbsoluteStateAddressMock).toHaveBeenCalledWith(absPathInfo, stateAddress.listIndex);
    expect(updater.enqueueAbsoluteAddress).toHaveBeenCalledWith(absAddress);
    expect(walkDependencyMock).toHaveBeenCalledWith(
      stateAddress, staticDep, dynamicDep, listPaths, receiver, 'new', expect.any(Function)
    );
  });

  it('walkDependencyコールバックがキャチE��ュ無効化とキュー登録を行うこと', () => {
    const resolvedAddress = { pathInfo: { path: 'count' } };
    const stateAddress = { pathInfo: { path: 'count' }, listIndex: null };
    const absPathInfo = { path: 'default.count' };
    const absAddress = { absPathInfo, listIndex: null };
    const updater = { enqueueAbsoluteAddress: vi.fn() };

    getResolvedAddressMock.mockReturnValue(resolvedAddress as any);
    getListIndexMock.mockReturnValue(null as any);
    createStateAddressMock.mockReturnValue(stateAddress as any);
    getAbsolutePathInfoMock.mockReturnValue(absPathInfo as any);
    createAbsoluteStateAddressMock.mockReturnValue(absAddress as any);
    getUpdaterMock.mockReturnValue(updater as any);

    // walkDependencyのコールバックを直接実行すめE
    walkDependencyMock.mockImplementation((_addr, _sd, _dd, _lp, _recv, _mode, callback) => {
      const depAddress = { pathInfo: { path: 'derived' }, listIndex: null };
      const depAbsPathInfo = { path: 'default.derived' };
      const depAbsAddress = { absPathInfo: depAbsPathInfo, listIndex: null };

      getAbsolutePathInfoMock.mockReturnValue(depAbsPathInfo as any);
      createAbsoluteStateAddressMock.mockReturnValue(depAbsAddress as any);

      callback(depAddress as any);
      return [];
    });

    const handler = {
      stateElement: { name: 'default', staticDependency: new Map(), dynamicDependency: new Map(), listPaths: new Set() },
      stateName: 'default'
    } as any;

    const fn = postUpdate({}, '$postUpdate', {}, handler);
    fn('count');

    // コールバック冁E キャチE��ュ無効匁E
    expect(setCacheMock).toHaveBeenCalled();
    // コールバック冁E 更新対象登録 (本佁E囁E+ コールバック1囁E= 訁E囁E
    expect(updater.enqueueAbsoluteAddress).toHaveBeenCalledTimes(2);
  });
});
