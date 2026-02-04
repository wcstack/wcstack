import { describe, it, expect, vi } from 'vitest';
import { getListIndex } from '../src/proxy/methods/getListIndex';
import { getPathInfo } from '../src/address/PathInfo';
import { createListIndex } from '../src/list/createListIndex';
import { createListIndexes } from '../src/list/createListDiff';
import { setListIndexesByList } from '../src/list/listIndexesByList';

vi.mock('../src/proxy/methods/getByAddress', () => ({
  getByAddress: vi.fn(),
}));

vi.mock('../src/proxy/methods/getContextListIndex', () => ({
  getContextListIndex: vi.fn(),
}));

import { getByAddress } from '../src/proxy/methods/getByAddress';
import { getContextListIndex } from '../src/proxy/methods/getContextListIndex';

function createHandler() {
  return { lastAddressStack: null } as any;
}

describe('getListIndex', () => {
  it('wildcardTypeがnoneならnullを返すこと', () => {
    const resolvedAddress = {
      pathInfo: getPathInfo('users'),
      wildcardType: 'none',
      wildcardIndexes: [],
    } as any;
    const result = getListIndex({}, resolvedAddress, {}, createHandler());
    expect(result).toBeNull();
  });

  it('contextでlastWildcardPathが無い場合はエラーになること', () => {
    const resolvedAddress = {
      pathInfo: getPathInfo('users'),
      wildcardType: 'context',
      wildcardIndexes: [],
    } as any;
    expect(() => getListIndex({}, resolvedAddress, {}, createHandler())).toThrow(/lastWildcardPath is null/);
  });

  it('contextでlistIndexが見つからない場合はエラーになること', () => {
    vi.mocked(getContextListIndex).mockReturnValue(null);
    const resolvedAddress = {
      pathInfo: getPathInfo('users.*.name'),
      wildcardType: 'context',
      wildcardIndexes: [0],
    } as any;
    expect(() => getListIndex({}, resolvedAddress, {}, createHandler())).toThrow(/ListIndex not found/);
  });

  it('contextでlistIndexを取得できること', () => {
    const listIndex = createListIndex(null, 0);
    vi.mocked(getContextListIndex).mockReturnValue(listIndex);
    const resolvedAddress = {
      pathInfo: getPathInfo('users.*.name'),
      wildcardType: 'context',
      wildcardIndexes: [0],
    } as any;
    const result = getListIndex({}, resolvedAddress, {}, createHandler());
    expect(result).toBe(listIndex);
  });

  it('allでリストインデックスを辿れること', () => {
    const users = [{ orders: ['a', 'b'] }];
    const orders = users[0].orders;

    const usersIndexes = createListIndexes(null, [], users, []);
    const ordersIndexes = createListIndexes(usersIndexes[0], [], orders, []);
    setListIndexesByList(users, usersIndexes);
    setListIndexesByList(orders, ordersIndexes);

    vi.mocked(getByAddress).mockImplementation((_target, address) => {
      if (address.pathInfo.path === 'users') {
        return users;
      }
      if (address.pathInfo.path === 'users.*.orders') {
        return orders;
      }
      return null;
    });

    const resolvedAddress = {
      pathInfo: getPathInfo('users.*.orders.*.id'),
      wildcardType: 'all',
      wildcardIndexes: [0, 1],
    } as any;

    const result = getListIndex({}, resolvedAddress, {}, createHandler());
    expect(result).toBe(ordersIndexes[1]);

    setListIndexesByList(users, null);
    setListIndexesByList(orders, null);
  });

  it('allでListIndexが見つからない場合はエラーになること', () => {
    const users = [{ orders: ['a'] }];

    vi.mocked(getByAddress).mockImplementation((_target, address) => {
      if (address.pathInfo.path === 'users') {
        return users;
      }
      return null;
    });

    const resolvedAddress = {
      pathInfo: getPathInfo('users.*.orders.*.id'),
      wildcardType: 'all',
      wildcardIndexes: [0, 0],
    } as any;

    expect(() => getListIndex({}, resolvedAddress, {}, createHandler())).toThrow(/ListIndex not found/);
  });

  it('allでwildcardIndexがnullならエラーになること', () => {
    const users = [{ orders: ['a'] }];
    const usersIndexes = createListIndexes(null, [], users, []);
    setListIndexesByList(users, usersIndexes);

    vi.mocked(getByAddress).mockImplementation((_target, address) => {
      if (address.pathInfo.path === 'users') {
        return users;
      }
      return null;
    });

    const resolvedAddress = {
      pathInfo: getPathInfo('users.*.orders.*.id'),
      wildcardType: 'all',
      wildcardIndexes: [null, 0],
    } as any;

    expect(() => getListIndex({}, resolvedAddress, {}, createHandler())).toThrow(/wildcardIndex is null/);

    setListIndexesByList(users, null);
  });

  it('allでwildcardParentPathInfoがnullならエラーになること', () => {
    const resolvedAddress = {
      pathInfo: {
        wildcardCount: 1,
        wildcardParentPathInfos: [],
        path: 'users.*.name',
      },
      wildcardType: 'all',
      wildcardIndexes: [0],
    } as any;

    expect(() => getListIndex({}, resolvedAddress, {}, createHandler())).toThrow(/wildcardParentPathInfo is null/);
  });

  it('allでインデックスが範囲外ならエラーになること', () => {
    const users = [{ name: 'a' }];
    const usersIndexes = createListIndexes(null, [], users, []);
    setListIndexesByList(users, usersIndexes);

    vi.mocked(getByAddress).mockImplementation((_target, address) => {
      if (address.pathInfo.path === 'users') {
        return users;
      }
      return null;
    });

    const resolvedAddress = {
      pathInfo: getPathInfo('users.*.name'),
      wildcardType: 'all',
      wildcardIndexes: [1],
    } as any;

    expect(() => getListIndex({}, resolvedAddress, {}, createHandler())).toThrow(/ListIndex not found/);

    setListIndexesByList(users, null);
  });

  it('partialは未対応エラーになること', () => {
    const resolvedAddress = {
      pathInfo: getPathInfo('users.*.name'),
      wildcardType: 'partial',
      wildcardIndexes: [0],
    } as any;
    expect(() => getListIndex({}, resolvedAddress, {}, createHandler())).toThrow(/Partial wildcard type is not supported yet/);
  });
});
