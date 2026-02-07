import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAll } from '../src/proxy/apis/getAll';
import { createListIndex } from '../src/list/createListIndex';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import { setStateElementByName } from '../src/stateElementByName';

vi.mock('../src/proxy/methods/getByAddress', () => ({
  getByAddress: vi.fn()
}));

vi.mock('../src/proxy/methods/setByAddress', () => ({
  setByAddress: vi.fn()
}));

vi.mock('../src/list/createListDiff', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/list/createListDiff')>();
  return {
    ...original,
    createListDiff: vi.fn(original.createListDiff),
  };
});

import { getByAddress } from '../src/proxy/methods/getByAddress';
import { createListDiff } from '../src/list/createListDiff';

const getByAddressMock = vi.mocked(getByAddress);
const createListDiffMock = vi.mocked(createListDiff);

function createStateElement(overrides?: Partial<any>) {
  return {
    name: 'default',
    listPaths: new Set<string>(),
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    addDynamicDependency: vi.fn(),
    ...overrides,
  };
}

function createHandler(stateElement: any, overrides?: Partial<any>) {
  return {
    addressStackIndex: -1,
    lastAddressStack: null,
    stateElement,
    pushAddress: vi.fn(),
    popAddress: vi.fn(),
    ...overrides,
  };
}

describe('getAll', () => {
  let mockStateElement: any;

  afterEach(() => {
    vi.clearAllMocks();
    setStateElementByName('default', null);
  });

  it('単一ワイルドカードで全要素を取得できること', () => {
    mockStateElement = createStateElement();
    setStateElementByName('default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};
    const list = ['a', 'b', 'c'];

    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    const listIndex2 = createListIndex(null, 2);
    setListIndexesByList(list, [listIndex0, listIndex1, listIndex2]);

    // getByAddress: 1回目はリスト取得(getAll内)、2-4回目はresolve内の個別値取得
    getByAddressMock
      .mockReturnValueOnce(list)       // walkWildcardPattern: items のリスト取得
      .mockReturnValueOnce(list)       // resolve: items のリスト取得
      .mockReturnValueOnce('a')        // resolve: items.* index=0
      .mockReturnValueOnce(list)       // resolve: items のリスト取得
      .mockReturnValueOnce('b')        // resolve: items.* index=1
      .mockReturnValueOnce(list)       // resolve: items のリスト取得
      .mockReturnValueOnce('c');       // resolve: items.* index=2

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('items.*', []);

    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('indexes を指定して特定の要素のみ取得できること', () => {
    mockStateElement = createStateElement();
    setStateElementByName('default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};
    const list = ['a', 'b', 'c'];

    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    const listIndex2 = createListIndex(null, 2);
    setListIndexesByList(list, [listIndex0, listIndex1, listIndex2]);

    getByAddressMock
      .mockReturnValueOnce(list)       // walkWildcardPattern: items のリスト取得
      .mockReturnValueOnce(list)       // resolve: items のリスト取得
      .mockReturnValueOnce('b');       // resolve: items.* index=1

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('items.*', [1]);

    expect(result).toEqual(['b']);
  });

  it('indexes 未指定時にコンテキストから自動解決すること', () => {
    mockStateElement = createStateElement();
    setStateElementByName('default', mockStateElement);

    const list = ['x', 'y'];
    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    setListIndexesByList(list, [listIndex0, listIndex1]);

    // lastAddressStack にワイルドカードパスのコンテキストを設定
    const contextListIndex = createListIndex(null, 0);
    const lastAddress = {
      pathInfo: {
        path: 'items.*.name',
        indexByWildcardPath: { 'items': 0 },
      },
      listIndex: contextListIndex,
    };
    const handler = createHandler(mockStateElement, { lastAddressStack: lastAddress });
    const target = {};

    getByAddressMock
      .mockReturnValueOnce(list)       // walkWildcardPattern
      .mockReturnValueOnce(list)       // resolve
      .mockReturnValueOnce('x');       // resolve: value

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('items.*');

    expect(result).toEqual(['x']);
  });

  it('indexes 未指定でコンテキストにも listIndex がない場合は空配列になること', () => {
    mockStateElement = createStateElement();
    setStateElementByName('default', mockStateElement);
    // lastAddressStack なし → getContextListIndex が null を返す
    const handler = createHandler(mockStateElement);
    const target = {};
    const list = ['a', 'b'];

    const li0 = createListIndex(null, 0);
    const li1 = createListIndex(null, 1);
    setListIndexesByList(list, [li0, li1]);

    getByAddressMock
      .mockReturnValueOnce(list)
      .mockReturnValueOnce(list)
      .mockReturnValueOnce('a')
      .mockReturnValueOnce(list)
      .mockReturnValueOnce('b');

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('items.*');

    // indexes が空配列として扱われ、全要素が返る
    expect(result).toEqual(['a', 'b']);
  });

  it('getterパスの場合は動的依存関係を登録すること', () => {
    mockStateElement = createStateElement();
    mockStateElement.getterPaths.add('computed');
    setStateElementByName('default', mockStateElement);

    const lastAddress = {
      pathInfo: { path: 'computed' },
      listIndex: null,
    };
    const handler = createHandler(mockStateElement, { lastAddressStack: lastAddress });
    const target = {};
    const list = ['a'];

    const listIndex0 = createListIndex(null, 0);
    setListIndexesByList(list, [listIndex0]);

    getByAddressMock
      .mockReturnValueOnce(list)
      .mockReturnValueOnce(list)
      .mockReturnValueOnce('a');

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    getAllFn('items.*', []);

    expect(mockStateElement.addDynamicDependency).toHaveBeenCalledWith('items.*', 'computed');
  });

  it('2回目の呼び出しで lastValue との差分が計算されること', () => {
    mockStateElement = createStateElement();
    setStateElementByName('default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    // 1回目: リスト ['a', 'b']
    const list1 = ['a', 'b'];
    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    setListIndexesByList(list1, [listIndex0, listIndex1]);

    getByAddressMock
      .mockReturnValueOnce(list1)
      .mockReturnValueOnce(list1)
      .mockReturnValueOnce('a')
      .mockReturnValueOnce(list1)
      .mockReturnValueOnce('b');

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result1 = getAllFn('items.*', []);
    expect(result1).toEqual(['a', 'b']);

    // 2回目: リスト ['a', 'b', 'c'] (要素追加)
    const list2 = ['a', 'b', 'c'];
    const listIndex2 = createListIndex(null, 2);
    setListIndexesByList(list2, [listIndex0, listIndex1, listIndex2]);

    getByAddressMock
      .mockReturnValueOnce(list2)
      .mockReturnValueOnce(list2)
      .mockReturnValueOnce('a')
      .mockReturnValueOnce(list2)
      .mockReturnValueOnce('b')
      .mockReturnValueOnce(list2)
      .mockReturnValueOnce('c');

    const result2 = getAllFn('items.*', []);
    expect(result2).toEqual(['a', 'b', 'c']);
  });

  it('多重ワイルドカードで indexes 指定ありの場合に再帰的に解決できること', () => {
    mockStateElement = createStateElement();
    setStateElementByName('default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    // 外側リスト
    const outerList = [['a', 'b'], ['c', 'd']];
    const outerIndex0 = createListIndex(null, 0);
    const outerIndex1 = createListIndex(null, 1);
    setListIndexesByList(outerList, [outerIndex0, outerIndex1]);

    // 内側リスト
    const innerList = ['c', 'd'];
    const innerIndex0 = createListIndex(outerIndex1, 0);
    const innerIndex1 = createListIndex(outerIndex1, 1);
    setListIndexesByList(innerList, [innerIndex0, innerIndex1]);

    getByAddressMock
      .mockReturnValueOnce(outerList)    // walkWildcardPattern: 外側リスト取得
      .mockReturnValueOnce(innerList)    // walkWildcardPattern: 内側リスト取得 (index=1)
      .mockReturnValueOnce(outerList)    // resolve: 外側リスト取得
      .mockReturnValueOnce(innerList)    // resolve: 内側リスト取得
      .mockReturnValueOnce('d');         // resolve: categories.*.items.* index=[1,1]

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('categories.*.items.*', [1, 1]);

    expect(result).toEqual(['d']);
  });

  it('listDiff.newIndexes が null の場合はエラーになること', () => {
    mockStateElement = createStateElement();
    setStateElementByName('default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    getByAddressMock.mockReturnValueOnce([]);

    // createListDiff が newIndexes: null を返すようモック
    createListDiffMock.mockReturnValueOnce({
      oldIndexes: [],
      newIndexes: [],
      changeIndexSet: new Set(),
      deleteIndexSet: new Set(),
      addIndexSet: new Set(),
    });

    const getAllFn = getAll(target, '$getAll', target, handler as any);

    expect(() => getAllFn('items.*', [0])).toThrow(/ListIndex not found/);
  });

  it('indexes 指定で範囲外のインデックスを指定した場合はエラーになること', () => {
    mockStateElement = createStateElement();
    setStateElementByName('default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};
    const list = ['a', 'b'];

    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    setListIndexesByList(list, [listIndex0, listIndex1]);

    getByAddressMock.mockReturnValueOnce(list);

    const getAllFn = getAll(target, '$getAll', target, handler as any);

    expect(() => getAllFn('items.*', [99])).toThrow(/ListIndex not found/);
  });

  it('oldValue に listIndexes がない場合は空配列がoldIndexesとして使われること', () => {
    mockStateElement = createStateElement();
    setStateElementByName('default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    // 1回目: lastValue にリストを保存させる
    const list1 = ['a'];
    const li0 = createListIndex(null, 0);
    setListIndexesByList(list1, [li0]);

    getByAddressMock
      .mockReturnValueOnce(list1)
      .mockReturnValueOnce(list1)
      .mockReturnValueOnce('a');

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result1 = getAllFn('items.*', []);
    expect(result1).toEqual(['a']);

    // 2回目の呼び出し前に list1 の listIndexes をクリア
    // getListIndexesByList(oldValue) が null → || [] 分岐を通る
    setListIndexesByList(list1, null);

    const list2 = ['b'];
    const li2_0 = createListIndex(null, 0);
    setListIndexesByList(list2, [li2_0]);

    // createListDiff をモックして oldIndexes=[] でも正常動作させる
    createListDiffMock.mockReturnValueOnce({
      oldIndexes: [],
      newIndexes: [li2_0],
      changeIndexSet: new Set(),
      deleteIndexSet: new Set(),
      addIndexSet: new Set([li2_0]),
    });

    getByAddressMock
      .mockReturnValueOnce(list2)
      .mockReturnValueOnce(list2)
      .mockReturnValueOnce('b');

    const result2 = getAllFn('items.*', []);
    expect(result2).toEqual(['b']);
  });

  it('ワイルドカードなしのパスでも値を取得できること', () => {
    mockStateElement = createStateElement();
    setStateElementByName('default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    getByAddressMock.mockReturnValueOnce('hello');

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('name');

    expect(result).toEqual(['hello']);
  });
});
