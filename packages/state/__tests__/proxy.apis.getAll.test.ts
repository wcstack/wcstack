import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAll } from '../src/proxy/apis/getAll';
import { createListIndex } from '../src/list/createListIndex';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import { setStateElement } from '../src/stateElementByName';

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
    addressStackLength: 0,
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
    setStateElement(document, null);
  });

  it('単一ワイルドカードで全要素を取得できること', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};
    const list = ['a', 'b', 'c'];

    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    const listIndex2 = createListIndex(null, 2);
    setListIndexesByList(list, [listIndex0, listIndex1, listIndex2]);

    // getByAddress: 1回目はリスト取征EgetAll冁E、E-4回目はresolve冁E�E個別値取征E
    getByAddressMock
      .mockReturnValueOnce(list)       // walkWildcardPattern: items のリスト取征E
      .mockReturnValueOnce(list)       // resolve: items のリスト取征E
      .mockReturnValueOnce('a')        // resolve: items.* index=0
      .mockReturnValueOnce(list)       // resolve: items のリスト取征E
      .mockReturnValueOnce('b')        // resolve: items.* index=1
      .mockReturnValueOnce(list)       // resolve: items のリスト取征E
      .mockReturnValueOnce('c');       // resolve: items.* index=2

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('items.*', []);

    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('indexes を指定して特定�E要素のみ取得できること', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};
    const list = ['a', 'b', 'c'];

    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    const listIndex2 = createListIndex(null, 2);
    setListIndexesByList(list, [listIndex0, listIndex1, listIndex2]);

    getByAddressMock
      .mockReturnValueOnce(list)       // walkWildcardPattern: items のリスト取征E
      .mockReturnValueOnce(list)       // resolve: items のリスト取征E
      .mockReturnValueOnce('b');       // resolve: items.* index=1

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('items.*', [1]);

    expect(result).toEqual(['b']);
  });

  it('indexes 未持E��時にコンチE��ストから�E動解決すること', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);

    const list = ['x', 'y'];
    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    setListIndexesByList(list, [listIndex0, listIndex1]);

    // lastAddressStack にワイルドカードパスのコンチE��ストを設宁E
    // indexByWildcardPath のキーはワイルドカードパス自身（'items.*'）。
    // 以前は 'items'（親パス）でモックしており、実 PathInfo が生成しない形で
    // 文脈解決を「成功」させて本番の取り違えを隠していた。
    const contextListIndex = createListIndex(null, 0);
    const lastAddress = {
      pathInfo: {
        path: 'items.*.name',
        indexByWildcardPath: { 'items.*': 0 },
        wildcardCount: 1,
      },
      listIndex: contextListIndex,
    };
    const handler = createHandler(mockStateElement, { addressStackLength: 1, lastAddressStack: lastAddress });
    const target = {};

    getByAddressMock
      .mockReturnValueOnce(list)       // walkWildcardPattern
      .mockReturnValueOnce(list)       // resolve
      .mockReturnValueOnce('x');       // resolve: value

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('items.*');

    expect(result).toEqual(['x']);
  });

  it('indexes 未持E��でコンチE��ストにめElistIndex がなぁE��合�E空配�Eになること', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);
    // lastAddressStack なぁEↁEgetContextListIndex ぁEnull を返す
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

    // indexes が空配�Eとして扱われ、�E要素が返る
    expect(result).toEqual(['a', 'b']);
  });

  it('getterパスの場合�E動的依存関係を登録すること', () => {
    mockStateElement = createStateElement();
    mockStateElement.getterPaths.add('computed');
    setStateElement(document, mockStateElement);

    const lastAddress = {
      pathInfo: { path: 'computed' },
      listIndex: null,
    };
    const handler = createHandler(mockStateElement, { addressStackLength: 1, lastAddressStack: lastAddress });
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

  it('addressStackLength>0でlastAddressStackがnullなら依存関係を登録しなぁE��と', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);
    const handler = createHandler(mockStateElement, { addressStackLength: 1, lastAddressStack: null });
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

    expect(mockStateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('addressStackLength>0で同一パスの場合�E依存関係を登録しなぁE��と', () => {
    mockStateElement = createStateElement();
    mockStateElement.getterPaths.add('items.*');
    setStateElement(document, mockStateElement);

    const lastAddress = {
      pathInfo: { path: 'items.*' },
      listIndex: null,
    };
    const handler = createHandler(mockStateElement, { addressStackLength: 1, lastAddressStack: lastAddress });
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

    expect(mockStateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('2回目の呼び出しで lastValue との差刁E��計算されること', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    // 1回目: リスチE['a', 'b']
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

    // 2回目: リスチE['a', 'b', 'c'] (要素追加)
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

  it('多重ワイルドカードで indexes 持E��あり�E場合に再帰皁E��解決できること', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    // 外�EリスチE
    const outerList = [['a', 'b'], ['c', 'd']];
    const outerIndex0 = createListIndex(null, 0);
    const outerIndex1 = createListIndex(null, 1);
    setListIndexesByList(outerList, [outerIndex0, outerIndex1]);

    // 冁E�EリスチE
    const innerList = ['c', 'd'];
    const innerIndex0 = createListIndex(outerIndex1, 0);
    const innerIndex1 = createListIndex(outerIndex1, 1);
    setListIndexesByList(innerList, [innerIndex0, innerIndex1]);

    getByAddressMock
      .mockReturnValueOnce(outerList)    // walkWildcardPattern: 外�Eリスト取征E
      .mockReturnValueOnce(innerList)    // walkWildcardPattern: 冁E�Eリスト取征E(index=1)
      .mockReturnValueOnce(outerList)    // resolve: 外�Eリスト取征E
      .mockReturnValueOnce(innerList)    // resolve: 冁E�Eリスト取征E
      .mockReturnValueOnce('d');         // resolve: categories.*.items.* index=[1,1]

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('categories.*.items.*', [1, 1]);

    expect(result).toEqual(['d']);
  });

  it('listDiff.newIndexes ぁEnull の場合�Eエラーになること', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    getByAddressMock.mockReturnValueOnce([]);

    // createListDiff ぁEnewIndexes: null を返すようモチE��
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

  it('indexes 持E��で篁E��外�EインチE��クスを指定した場合�Eエラーになること', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};
    const list = ['a', 'b'];

    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    setListIndexesByList(list, [listIndex0, listIndex1]);

    getByAddressMock.mockReturnValueOnce(list);

    const getAllFn = getAll(target, '$getAll', target, handler as any);

    // §8.4: 範囲外はどの index が無いかまで示す
    expect(() => getAllFn('items.*', [99])).toThrow(/ListIndex not found at index 99 of items/);
  });

  it('oldValue に listIndexes がなぁE��合�E空配�EがoldIndexesとして使われること', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);
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
    // getListIndexesByList(oldValue) ぁEnull ↁE|| [] 刁E��を通る
    setListIndexesByList(list1, null);

    const list2 = ['b'];
    const li2_0 = createListIndex(null, 0);
    setListIndexesByList(list2, [li2_0]);

    // createListDiff をモチE��して oldIndexes=[] でも正常動作させる
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

  it('ワイルドカードなし�Eパスでも値を取得できること', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    getByAddressMock.mockReturnValueOnce('hello');

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('name');

    expect(result).toEqual(['hello']);
  });

  it('indexes 省略時、path と共有の無いループ文脈が添字を持つ場合はエラーになること', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);

    // 文脈は others.* のループ（添字あり）だが、path 'items.*' とは共有ゼロ。
    // 既定の [...$n] は異なる文脈の添字の流用になるため throw する
    const contextListIndex = createListIndex(null, 2);
    const lastAddress = {
      pathInfo: {
        path: 'others.*.x',
        indexByWildcardPath: { 'others.*': 0 },
        wildcardCount: 1,
      },
      listIndex: contextListIndex,
    };
    const handler = createHandler(mockStateElement, { addressStackLength: 1, lastAddressStack: lastAddress });
    const target = {};

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    expect(() => getAllFn('items.*')).toThrow(/shares no wildcard level/);
  });

  it('indexes 省略時、文脈が path より深い場合は共有分に切り詰められること', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);

    const list = ['a', 'b'];
    const li0 = createListIndex(null, 0);
    const li1 = createListIndex(null, 1);
    setListIndexesByList(list, [li0, li1]);

    // 2 段ループの文脈 [1, 0]。path 'items.*' と共有するのは外側 'items.*' の 1 段だけ
    const innerListIndex = createListIndex(li1, 0);
    const lastAddress = {
      pathInfo: {
        path: 'items.*.sub.*.y',
        indexByWildcardPath: { 'items.*': 0, 'items.*.sub.*': 1 },
        wildcardCount: 2,
      },
      listIndex: innerListIndex,
    };
    const handler = createHandler(mockStateElement, { addressStackLength: 1, lastAddressStack: lastAddress });
    const target = {};

    getByAddressMock
      .mockReturnValueOnce(list)       // walkWildcardPattern
      .mockReturnValueOnce(list)       // resolve
      .mockReturnValueOnce('b');       // resolve: items.* index=1

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    expect(getAllFn('items.*')).toEqual(['b']);
  });

  it('ワイルドカード無しのパスはループ文脈があってもエラーにならないこと', () => {
    mockStateElement = createStateElement();
    setStateElement(document, mockStateElement);

    const contextListIndex = createListIndex(null, 0);
    const lastAddress = {
      pathInfo: {
        path: 'others.*.x',
        indexByWildcardPath: { 'others.*': 0 },
        wildcardCount: 1,
      },
      listIndex: contextListIndex,
    };
    const handler = createHandler(mockStateElement, { addressStackLength: 1, lastAddressStack: lastAddress });
    const target = {};

    getByAddressMock.mockReturnValueOnce('hello');

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    expect(getAllFn('name')).toEqual(['hello']);
  });
});
