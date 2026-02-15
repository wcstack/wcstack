import { describe, it, expect, vi } from 'vitest';
import { walkDependency } from '../src/dependency/walkDependency';
import { config } from '../src/config';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { createListIndex } from '../src/list/createListIndex';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import * as listIndexesByList from '../src/list/listIndexesByList';
import { getByAddressSymbol } from '../src/proxy/symbols';
import type { IStateElement } from '../src/components/types';

const defaultStateElement = { name: 'default' } as IStateElement;

function createStateProxy(values: Record<string, any>) {
  return {
    [getByAddressSymbol]: (address: { pathInfo: { path: string } }) => values[address.pathInfo.path],
  } as any;
}

function collectResult(result: ReturnType<typeof walkDependency>) {
  return result.map((address) => ({
    path: address.pathInfo.path,
    index: address.listIndex?.index ?? null,
  }));
}

describe('walkDependency', () => {
  it('static dependency expands list indexes when list path', () => {
    const stateProxy = createStateProxy({
      users: [{ id: 1 }, { id: 2 }],
    });
    const startAddress = createStateAddress(getPathInfo('users'), null);
    const staticDependency = new Map<string, string[]>([['users', ['users.*']]]);
    const dynamicDependency = new Map<string, string[]>();
    const listPathSet = new Set<string>(['users']);
    const visited: string[] = [];

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      dynamicDependency,
      listPathSet,
      stateProxy,
      'new',
      (address) => visited.push(address.pathInfo.path)
    );

    const mapped = collectResult(result);
    expect(mapped).toEqual([
      { path: 'users.*', index: 0 },
      { path: 'users.*', index: 1 },
    ]);
    expect(visited).toContain('users');
  });

  it('static dependency reuses last list value when present', () => {
    const stateProxy = createStateProxy({
      users: [{ id: 1 }, { id: 2 }],
    });
    const startAddress = createStateAddress(getPathInfo('users'), null);
    const staticDependency = new Map<string, string[]>([['users', ['users.*']]]);
    const dynamicDependency = new Map<string, string[]>();
    const listPathSet = new Set<string>(['users']);

    walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      dynamicDependency,
      listPathSet,
      stateProxy,
      'new',
      () => {}
    );

    setListIndexesByList(stateProxy[getByAddressSymbol](startAddress), [
      createListIndex(null, 0),
      createListIndex(null, 1),
    ]);

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      dynamicDependency,
      listPathSet,
      stateProxy,
      'new',
      () => {}
    );

    expect(collectResult(result)).toEqual([
      { path: 'users.*', index: 0 },
      { path: 'users.*', index: 1 },
    ]);
  });

  it('static dependency uses cached lastValue branch', () => {
    const stateProxy = createStateProxy({
      users: [{ id: 1 }, { id: 2 }],
    });
    const startAddress = createStateAddress(getPathInfo('users'), null);
    const staticDependency = new Map<string, string[]>([['users', ['users.*']]]);
    const listPathSet = new Set<string>(['users']);

    // First call to seed lastValueByListAddress
    walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      new Map(),
      listPathSet,
      stateProxy,
      'new',
      () => {}
    );

    // Ensure list indexes are available for cached path
    setListIndexesByList(stateProxy[getByAddressSymbol](startAddress), [
      createListIndex(null, 0),
      createListIndex(null, 1),
    ]);

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      new Map(),
      listPathSet,
      stateProxy,
      'new',
      () => {}
    );

    expect(collectResult(result)).toEqual([
      { path: 'users.*', index: 0 },
      { path: 'users.*', index: 1 },
    ]);
  });

  it('static dependency hits lastValue branch of getListIndexesByList', () => {
    const stateProxy = createStateProxy({
      users: [{ id: 1 }, { id: 2 }],
    });
    const startAddress = createStateAddress(getPathInfo('users'), null);
    const staticDependency = new Map<string, string[]>([['users', ['users.*']]]);
    const listPathSet = new Set<string>(['users']);
    const spy = vi.spyOn(listIndexesByList, 'getListIndexesByList');

    const beforeFirst = spy.mock.calls.length;
    walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      new Map(),
      listPathSet,
      stateProxy,
      'new',
      () => {}
    );
    const afterFirst = spy.mock.calls.length;

    setListIndexesByList(stateProxy[getByAddressSymbol](startAddress), [
      createListIndex(null, 0),
      createListIndex(null, 1),
    ]);

    walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      new Map(),
      listPathSet,
      stateProxy,
      'new',
      () => {}
    );

    // createListDiff now caches results, so the spy count stays the same
    expect(spy.mock.calls.length).toBe(afterFirst);
    spy.mockRestore();
  });

  it('static dependency follows non-list path', () => {
    const stateProxy = createStateProxy({});
    const startAddress = createStateAddress(getPathInfo('user'), null);
    const staticDependency = new Map<string, string[]>([['user', ['user.name']]]);
    const dynamicDependency = new Map<string, string[]>();
    const listPathSet = new Set<string>();

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      dynamicDependency,
      listPathSet,
      stateProxy,
      'new',
      () => {}
    );

    expect(collectResult(result)).toEqual([
      { path: 'user.name', index: null },
    ]);
  });

  it('static dependency with list path but non-wildcard target uses else branch', () => {
    const stateProxy = createStateProxy({});
    const startAddress = createStateAddress(getPathInfo('user'), null);
    const staticDependency = new Map<string, string[]>([['user', ['user.name']]]);
    const dynamicDependency = new Map<string, string[]>();
    const listPathSet = new Set<string>(['user']);

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      dynamicDependency,
      listPathSet,
      stateProxy,
      'new',
      () => {}
    );

    expect(collectResult(result)).toEqual([
      { path: 'user.name', index: null },
    ]);
  });

  it('dynamic dependency carries over list index', () => {
    const stateProxy = createStateProxy({});
    const listIndex = createListIndex(null, 1);
    const startAddress = createStateAddress(getPathInfo('products.*.price'), listIndex);
    const staticDependency = new Map<string, string[]>();
    const dynamicDependency = new Map<string, string[]>([
      ['products.*.price', ['products.*.tax']],
    ]);
    const listPathSet = new Set<string>();

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      dynamicDependency,
      listPathSet,
      stateProxy,
      'new',
      () => {}
    );

    expect(collectResult(result)).toEqual([
      { path: 'products.*.tax', index: 1 },
    ]);
  });

  it('dynamic dependency expands nested wildcards for add', () => {
    const stateProxy = createStateProxy({
      'users.*.orders': [1, 2],
    });
    const listIndex = createListIndex(null, 0);
    const startAddress = createStateAddress(getPathInfo('users.*.name'), listIndex);
    const staticDependency = new Map<string, string[]>();
    const dynamicDependency = new Map<string, string[]>([
      ['users.*.name', ['users.*.orders.*.id']],
    ]);
    const listPathSet = new Set<string>();

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      dynamicDependency,
      listPathSet,
      stateProxy,
      'add',
      () => {}
    );

    expect(collectResult(result)).toEqual([
      { path: 'users.*.orders.*.id', index: 0 },
      { path: 'users.*.orders.*.id', index: 1 },
    ]);
  });

  it('dynamic dependency expansion uses cached lastValue branch', () => {
    const stateProxy = createStateProxy({
      'users.*.orders': [1, 2],
    });
    const listIndex = createListIndex(null, 0);
    const startAddress = createStateAddress(getPathInfo('users.*.name'), listIndex);
    const dynamicDependency = new Map<string, string[]>([
      ['users.*.name', ['users.*.orders.*.id']],
    ]);

    // First call to seed lastValueByListAddress for expansion
    walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'new',
      () => {}
    );

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'new',
      () => {}
    );

    expect(collectResult(result)).toEqual([
      { path: 'users.*.orders.*.id', index: 0 },
      { path: 'users.*.orders.*.id', index: 1 },
    ]);
  });

  it('dynamic dependency hits lastValue branch of getListIndexesByList', () => {
    const stateProxy = createStateProxy({
      'users.*.orders': [1, 2],
    });
    const listIndex = createListIndex(null, 0);
    const startAddress = createStateAddress(getPathInfo('users.*.name'), listIndex);
    const dynamicDependency = new Map<string, string[]>([
      ['users.*.name', ['users.*.orders.*.id']],
    ]);
    const spy = vi.spyOn(listIndexesByList, 'getListIndexesByList');

    const beforeFirst = spy.mock.calls.length;
    walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'new',
      () => {}
    );
    const afterFirst = spy.mock.calls.length;

    walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'new',
      () => {}
    );

    // createListDiff now caches results, so the spy count stays the same
    expect(spy.mock.calls.length).toBe(afterFirst);
    spy.mockRestore();
  });

  it('dynamic dependency recurses when multiple wildcards remain', () => {
    const stateProxy = createStateProxy({
      'groups.*.teams': [1, 2],
      'groups.*.teams.*.members': [10, 11],
    });
    const listIndex = createListIndex(null, 0);
    const startAddress = createStateAddress(getPathInfo('groups.*.name'), listIndex);
    const dynamicDependency = new Map<string, string[]>([
      ['groups.*.name', ['groups.*.teams.*.members.*.id']],
    ]);

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'new',
      () => {}
    );

    expect(collectResult(result)).toEqual([
      { path: 'groups.*.teams.*.members.*.id', index: 0 },
      { path: 'groups.*.teams.*.members.*.id', index: 1 },
    ]);
  });

  it('dynamic dependency handles search types without throwing', () => {
    const stateProxy = createStateProxy({
      'users.*.orders': [1, 2],
    });
    const listIndex = createListIndex(null, 0);
    const startAddress = createStateAddress(getPathInfo('users.*.name'), listIndex);
    const staticDependency = new Map<string, string[]>();
    const dynamicDependency = new Map<string, string[]>([
      ['users.*.name', ['users.*.orders.*.id']],
    ]);
    const listPathSet = new Set<string>();

    const types = ['old', 'new', 'add', 'change', 'delete'] as const;
    for (const type of types) {
      expect(() => walkDependency(
        'default',
        defaultStateElement,
        startAddress,
        staticDependency,
        dynamicDependency,
        listPathSet,
        stateProxy,
        type,
        () => {}
      )).not.toThrow();
    }
  });

  it('logs and returns empty for invalid search type', () => {
    const originalDebug = config.debug;
    config.debug = true;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stateProxy = createStateProxy({
      'users.*.orders': [1],
      'users.*.orders.*.items': [10],
    });
    const listIndex = createListIndex(null, 0);
    const startAddress = createStateAddress(getPathInfo('users.*.name'), listIndex);
    const dynamicDependency = new Map<string, string[]>([
      ['users.*.name', ['users.*.orders.*.items.*.id']],
    ]);

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'invalid' as any,
      () => {}
    );

    expect(result).toEqual([]);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
    config.debug = originalDebug;
  });

  it('does not log when debug is false for invalid search type', () => {
    const originalDebug = config.debug;
    config.debug = false;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stateProxy = createStateProxy({
      'users.*.orders': [1],
      'users.*.orders.*.items': [10],
    });
    const listIndex = createListIndex(null, 0);
    const startAddress = createStateAddress(getPathInfo('users.*.name'), listIndex);
    const dynamicDependency = new Map<string, string[]>([
      ['users.*.name', ['users.*.orders.*.items.*.id']],
    ]);

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'invalid' as any,
      () => {}
    );

    expect(result).toEqual([]);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    config.debug = originalDebug;
  });

  it('throws when expandable wildcard has no list index', () => {
    const stateProxy = createStateProxy({
      'users.*.orders': [1],
    });
    const startAddress = createStateAddress(getPathInfo('users.*.name'), null);
    const dynamicDependency = new Map<string, string[]>([
      ['users.*.name', ['users.*.orders.*.id']],
    ]);

    expect(() => walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'new',
      () => {}
    )).toThrow(/Cannot expand dynamic dependency with wildcard/);
  });

  it('throws when carryover wildcard has no list index', () => {
    const stateProxy = createStateProxy({});
    const startAddress = createStateAddress(getPathInfo('users.*.name'), null);
    const dynamicDependency = new Map<string, string[]>([
      ['users.*.name', ['users.*.dispName']],
    ]);

    expect(() => walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'new',
      () => {}
    )).toThrow(/Cannot expand dynamic dependency with wildcard/);
  });

  it('dynamic dependency with no wildcards uses null listIndex', () => {
    const stateProxy = createStateProxy({});
    const startAddress = createStateAddress(getPathInfo('users.*.name'), createListIndex(null, 0));
    const dynamicDependency = new Map<string, string[]>([
      ['users.*.name', ['users.summary']],
    ]);

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'new',
      () => {}
    );

    expect(collectResult(result)).toEqual([
      { path: 'users.summary', index: null },
    ]);
  });

  it('skips revisiting the same address', () => {
    const stateProxy = createStateProxy({});
    const listIndex = createListIndex(null, 0);
    const startAddress = createStateAddress(getPathInfo('users.*.name'), listIndex);
    const dynamicDependency = new Map<string, string[]>([
      ['users.*.name', ['users.*.name']],
    ]);

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'new',
      () => {}
    );

    expect(collectResult(result)).toEqual([
      { path: 'users.*.name', index: 0 },
    ]);
  });

  it('throws when dependency depth exceeds max', () => {
    const staticDependency = new Map<string, string[]>();
    const chainLength = 1002;
    for (let i = 0; i < chainLength; i++) {
      staticDependency.set(`p${i}`, [`p${i + 1}`]);
    }

    const startAddress = createStateAddress(getPathInfo('p0'), null);
    const stateProxy = createStateProxy({});

    expect(() => walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      new Map(),
      new Set(),
      stateProxy,
      'new',
      () => {}
    )).toThrow(/Maximum dependency depth/);
  });

  it('static dependency with empty list skips loop body', () => {
    const stateProxy = createStateProxy({
      users: [],
    });
    const startAddress = createStateAddress(getPathInfo('users'), null);
    const staticDependency = new Map<string, string[]>([['users', ['users.*']]]);
    const dynamicDependency = new Map<string, string[]>();
    const listPathSet = new Set<string>(['users']);

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      staticDependency,
      dynamicDependency,
      listPathSet,
      stateProxy,
      'new',
      () => {}
    );

    expect(collectResult(result)).toEqual([]);
  });

  it('dynamic dependency expansion with empty list skips loop body', () => {
    const stateProxy = createStateProxy({
      'users.*.orders': [],
    });
    const listIndex = createListIndex(null, 0);
    const startAddress = createStateAddress(getPathInfo('users.*.name'), listIndex);
    const dynamicDependency = new Map<string, string[]>([
      ['users.*.name', ['users.*.orders.*.id']],
    ]);

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'new',
      () => {}
    );

    expect(collectResult(result)).toEqual([]);
  });

  it('dynamic dependency with different wildcard paths uses null listIndex', () => {
    // users.*.name -> groups.*.id (no common wildcard paths)
    const stateProxy = createStateProxy({
      'groups': [{ id: 1 }, { id: 2 }],
    });
    const listIndex = createListIndex(null, 0);
    const startAddress = createStateAddress(getPathInfo('users.*.name'), listIndex);
    const dynamicDependency = new Map<string, string[]>([
      ['users.*.name', ['groups.*.id']],
    ]);

    const result = walkDependency(
      'default',
      defaultStateElement,
      startAddress,
      new Map(),
      dynamicDependency,
      new Set(),
      stateProxy,
      'new',
      () => {}
    );

    // Different wildcard paths means expand groups.* from root
    expect(collectResult(result)).toEqual([
      { path: 'groups.*.id', index: 0 },
      { path: 'groups.*.id', index: 1 },
    ]);
  });
});
