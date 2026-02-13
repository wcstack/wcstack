import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updatedCallback } from '../src/proxy/apis/updatedCallback';
import { STATE_UPDATED_CALLBACK_NAME } from '../src/define';
import { IAbsoluteStateAddress, IAbsolutePathInfo, IPathInfo } from '../src/address/types';
import { IStateHandler } from '../src/proxy/types';
import { IListIndex } from '../src/list/types';

function createPathInfo(path: string, wildcardCount = 0): IPathInfo {
  const segments = path.split('.');
  return {
    id: 0,
    path,
    segments,
    lastSegment: segments[segments.length - 1],
    cumulativePaths: [],
    cumulativePathSet: new Set(),
    cumulativePathInfos: [],
    cumulativePathInfoSet: new Set(),
    parentPath: null,
    parentPathInfo: null,
    wildcardPaths: [],
    wildcardPathSet: new Set(),
    indexByWildcardPath: {},
    wildcardPathInfos: [],
    wildcardPathInfoSet: new Set(),
    wildcardParentPaths: [],
    wildcardParentPathSet: new Set(),
    wildcardParentPathInfos: [],
    wildcardParentPathInfoSet: new Set(),
    wildcardPositions: [],
    lastWildcardPath: null,
    lastWildcardInfo: null,
    wildcardCount,
  } as IPathInfo;
}

function createAbsolutePathInfo(stateName: string, path: string, wildcardCount = 0): IAbsolutePathInfo {
  return {
    stateName,
    pathInfo: createPathInfo(path, wildcardCount),
    parentAbsolutePathInfo: null,
  };
}

function createAbsoluteStateAddress(
  stateName: string,
  path: string,
  wildcardCount = 0,
  listIndex: IListIndex | null = null
): IAbsoluteStateAddress {
  return {
    absolutePathInfo: createAbsolutePathInfo(stateName, path, wildcardCount),
    listIndex,
    parentAbsoluteAddress: null,
  };
}

function createListIndex(index: number, indexes?: number[]): IListIndex {
  return {
    index,
    indexes: indexes ?? [index],
    key: null,
    address: null as any,
  } as IListIndex;
}

describe('proxy/apis/updatedCallback', () => {
  let handler: IStateHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = {
      stateName: 'default',
    } as IStateHandler;
  });

  it('$updatedCallback が定義されている場合、receiver の this コンテキストで呼び出されること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = { name: 'proxy-receiver' };
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'user.name'),
    ];

    updatedCallback(target, refs, receiver, handler);

    expect(callbackFn).toHaveBeenCalledTimes(1);
    expect(callbackFn.mock.instances[0]).toBe(receiver);
  });

  it('$updatedCallback が定義されていない場合、何もしないこと', () => {
    const target = {};
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'user.name'),
    ];

    const result = updatedCallback(target, refs, receiver, handler);

    expect(result).toBeUndefined();
  });

  it('$updatedCallback が関数でない場合、呼び出さないこと', () => {
    const target = { [STATE_UPDATED_CALLBACK_NAME]: 'not-a-function' };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'user.name'),
    ];

    const result = updatedCallback(target, refs, receiver, handler);

    expect(result).toBeUndefined();
  });

  it('同じ stateName の場合、パスだけを paths に追加すること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'user.name'),
      createAbsoluteStateAddress('default', 'user.age'),
    ];

    updatedCallback(target, refs, receiver, handler);

    expect(callbackFn).toHaveBeenCalledWith(['user.name', 'user.age'], {});
  });

  it('異なる stateName の場合、"path@stateName" 形式で paths に追加すること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'user.name'),
      createAbsoluteStateAddress('other', 'user.age'),
    ];

    updatedCallback(target, refs, receiver, handler);

    expect(callbackFn).toHaveBeenCalledWith(['user.name', 'user.age@other'], {});
  });

  it('重複するパスは Set により一意になること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'user.name'),
      createAbsoluteStateAddress('default', 'user.name'),
      createAbsoluteStateAddress('default', 'user.age'),
    ];

    updatedCallback(target, refs, receiver, handler);

    const paths = callbackFn.mock.calls[0][0];
    expect(paths.sort()).toEqual(['user.age', 'user.name']);
  });

  it('ワイルドカードがある場合、indexesListByPath に indexes 配列を追加すること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'items.*.name', 1, createListIndex(0)),
    ];

    updatedCallback(target, refs, receiver, handler);

    expect(callbackFn).toHaveBeenCalledWith(['items.*.name'], { 'items.*.name': [[0]] });
  });

  it('同じワイルドカードパスに複数の indexes 配列を集約すること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'items.*.name', 1, createListIndex(0)),
      createAbsoluteStateAddress('default', 'items.*.name', 1, createListIndex(2)),
      createAbsoluteStateAddress('default', 'items.*.name', 1, createListIndex(1)),
    ];

    updatedCallback(target, refs, receiver, handler);

    expect(callbackFn).toHaveBeenCalledWith(['items.*.name'], { 'items.*.name': [[0], [2], [1]] });
  });

  it('ワイルドカードと非ワイルドカードのパスを混在できること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'user.name'),
      createAbsoluteStateAddress('default', 'items.*.name', 1, createListIndex(0)),
      createAbsoluteStateAddress('default', 'items.*.name', 1, createListIndex(1)),
    ];

    updatedCallback(target, refs, receiver, handler);

    const [paths, indexesListByPath] = callbackFn.mock.calls[0];
    expect(paths.sort()).toEqual(['items.*.name', 'user.name']);
    expect(indexesListByPath).toEqual({ 'items.*.name': [[0], [1]] });
  });

  it('異なる stateName のワイルドカードパスも正しく処理すること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'items.*.name', 1, createListIndex(0)),
      createAbsoluteStateAddress('other', 'items.*.age', 1, createListIndex(1)),
    ];

    updatedCallback(target, refs, receiver, handler);

    const [paths, indexesListByPath] = callbackFn.mock.calls[0];
    expect(paths.sort()).toEqual(['items.*.age@other', 'items.*.name']);
    expect(indexesListByPath).toEqual({
      'items.*.name': [[0]],
      'items.*.age@other': [[1]],
    });
  });

  it('空の refs 配列でも正常に動作すること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [];

    updatedCallback(target, refs, receiver, handler);

    expect(callbackFn).toHaveBeenCalledWith([], {});
  });

  it('コールバックの戻り値を返すこと', () => {
    const returnValue = { result: 'success' };
    const callbackFn = vi.fn().mockReturnValue(returnValue);
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'user.name'),
    ];

    const result = updatedCallback(target, refs, receiver, handler);

    expect(result).toBe(returnValue);
  });

  it('コールバックが Promise を返す場合もそのまま返すこと', async () => {
    const returnValue = Promise.resolve({ result: 'success' });
    const callbackFn = vi.fn().mockReturnValue(returnValue);
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'user.name'),
    ];

    const result = updatedCallback(target, refs, receiver, handler);

    expect(result).toBe(returnValue);
    await expect(result).resolves.toEqual({ result: 'success' });
  });

  it('多階層ワイルドカード（categories.*.products.*.name）のフルインデックス配列を保持すること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'categories.*.products.*.name', 2, createListIndex(1, [0, 1])),
    ];

    updatedCallback(target, refs, receiver, handler);

    expect(callbackFn).toHaveBeenCalledWith(['categories.*.products.*.name'], {
      'categories.*.products.*.name': [[0, 1]],
    });
  });

  it('多階層ワイルドカードで複数の更新を集約すること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'categories.*.products.*.name', 2, createListIndex(1, [0, 1])),
      createAbsoluteStateAddress('default', 'categories.*.products.*.name', 2, createListIndex(3, [2, 3])),
      createAbsoluteStateAddress('default', 'categories.*.products.*.name', 2, createListIndex(0, [1, 0])),
    ];

    updatedCallback(target, refs, receiver, handler);

    expect(callbackFn).toHaveBeenCalledWith(['categories.*.products.*.name'], {
      'categories.*.products.*.name': [[0, 1], [2, 3], [1, 0]],
    });
  });

  it('listIndex.indexes が空配列の場合も正しく処理すること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'items.*.name', 1, createListIndex(0, [])),
    ];

    updatedCallback(target, refs, receiver, handler);

    expect(callbackFn).toHaveBeenCalledWith(['items.*.name'], {
      'items.*.name': [[]],
    });
  });

  it('listIndex.indexes が undefined の場合は空配列にフォールバックすること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_UPDATED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const listIndexWithoutIndexes: IListIndex = {
      index: 0,
      indexes: undefined as any,
      key: null,
      address: null as any,
    } as IListIndex;
    const refs: IAbsoluteStateAddress[] = [
      createAbsoluteStateAddress('default', 'items.*.name', 1, listIndexWithoutIndexes),
    ];

    updatedCallback(target, refs, receiver, handler);

    expect(callbackFn).toHaveBeenCalledWith(['items.*.name'], {
      'items.*.name': [[]],
    });
  });
});
