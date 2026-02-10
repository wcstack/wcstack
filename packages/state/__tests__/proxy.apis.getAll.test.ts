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
    setStateElementByName(document, 'default', null);
  });

  it('蜊倅ｸ繝ｯ繧､繝ｫ繝峨き繝ｼ繝峨〒蜈ｨ隕∫ｴ繧貞叙蠕励〒縺阪ｋ縺薙→', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};
    const list = ['a', 'b', 'c'];

    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    const listIndex2 = createListIndex(null, 2);
    setListIndexesByList(list, [listIndex0, listIndex1, listIndex2]);

    // getByAddress: 1蝗樒岼縺ｯ繝ｪ繧ｹ繝亥叙蠕・getAll蜀・縲・-4蝗樒岼縺ｯresolve蜀・・蛟句挨蛟､蜿門ｾ・
    getByAddressMock
      .mockReturnValueOnce(list)       // walkWildcardPattern: items 縺ｮ繝ｪ繧ｹ繝亥叙蠕・
      .mockReturnValueOnce(list)       // resolve: items 縺ｮ繝ｪ繧ｹ繝亥叙蠕・
      .mockReturnValueOnce('a')        // resolve: items.* index=0
      .mockReturnValueOnce(list)       // resolve: items 縺ｮ繝ｪ繧ｹ繝亥叙蠕・
      .mockReturnValueOnce('b')        // resolve: items.* index=1
      .mockReturnValueOnce(list)       // resolve: items 縺ｮ繝ｪ繧ｹ繝亥叙蠕・
      .mockReturnValueOnce('c');       // resolve: items.* index=2

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('items.*', []);

    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('indexes 繧呈欠螳壹＠縺ｦ迚ｹ螳壹・隕∫ｴ縺ｮ縺ｿ蜿門ｾ励〒縺阪ｋ縺薙→', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};
    const list = ['a', 'b', 'c'];

    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    const listIndex2 = createListIndex(null, 2);
    setListIndexesByList(list, [listIndex0, listIndex1, listIndex2]);

    getByAddressMock
      .mockReturnValueOnce(list)       // walkWildcardPattern: items 縺ｮ繝ｪ繧ｹ繝亥叙蠕・
      .mockReturnValueOnce(list)       // resolve: items 縺ｮ繝ｪ繧ｹ繝亥叙蠕・
      .mockReturnValueOnce('b');       // resolve: items.* index=1

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('items.*', [1]);

    expect(result).toEqual(['b']);
  });

  it('indexes 譛ｪ謖・ｮ壽凾縺ｫ繧ｳ繝ｳ繝・く繧ｹ繝医°繧芽・蜍戊ｧ｣豎ｺ縺吶ｋ縺薙→', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);

    const list = ['x', 'y'];
    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    setListIndexesByList(list, [listIndex0, listIndex1]);

    // lastAddressStack 縺ｫ繝ｯ繧､繝ｫ繝峨き繝ｼ繝峨ヱ繧ｹ縺ｮ繧ｳ繝ｳ繝・く繧ｹ繝医ｒ險ｭ螳・
    const contextListIndex = createListIndex(null, 0);
    const lastAddress = {
      pathInfo: {
        path: 'items.*.name',
        indexByWildcardPath: { 'items': 0 },
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

  it('indexes 譛ｪ謖・ｮ壹〒繧ｳ繝ｳ繝・く繧ｹ繝医↓繧・listIndex 縺後↑縺・ｴ蜷医・遨ｺ驟榊・縺ｫ縺ｪ繧九％縺ｨ', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    // lastAddressStack 縺ｪ縺・竊・getContextListIndex 縺・null 繧定ｿ斐☆
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

    // indexes 縺檎ｩｺ驟榊・縺ｨ縺励※謇ｱ繧上ｌ縲∝・隕∫ｴ縺瑚ｿ斐ｋ
    expect(result).toEqual(['a', 'b']);
  });

  it('getter繝代せ縺ｮ蝣ｴ蜷医・蜍慕噪萓晏ｭ倬未菫ゅｒ逋ｻ骭ｲ縺吶ｋ縺薙→', () => {
    mockStateElement = createStateElement();
    mockStateElement.getterPaths.add('computed');
    setStateElementByName(document, 'default', mockStateElement);

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

  it('addressStackLength>0縺ｧlastAddressStack縺系ull縺ｪ繧我ｾ晏ｭ倬未菫ゅｒ逋ｻ骭ｲ縺励↑縺・％縺ｨ', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
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

  it('addressStackLength>0縺ｧ蜷御ｸ繝代せ縺ｮ蝣ｴ蜷医・萓晏ｭ倬未菫ゅｒ逋ｻ骭ｲ縺励↑縺・％縺ｨ', () => {
    mockStateElement = createStateElement();
    mockStateElement.getterPaths.add('items.*');
    setStateElementByName(document, 'default', mockStateElement);

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

  it('2蝗樒岼縺ｮ蜻ｼ縺ｳ蜃ｺ縺励〒 lastValue 縺ｨ縺ｮ蟾ｮ蛻・′險育ｮ励＆繧後ｋ縺薙→', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    // 1蝗樒岼: 繝ｪ繧ｹ繝・['a', 'b']
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

    // 2蝗樒岼: 繝ｪ繧ｹ繝・['a', 'b', 'c'] (隕∫ｴ霑ｽ蜉)
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

  it('螟夐㍾繝ｯ繧､繝ｫ繝峨き繝ｼ繝峨〒 indexes 謖・ｮ壹≠繧翫・蝣ｴ蜷医↓蜀榊ｸｰ逧・↓隗｣豎ｺ縺ｧ縺阪ｋ縺薙→', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    // 螟門・繝ｪ繧ｹ繝・
    const outerList = [['a', 'b'], ['c', 'd']];
    const outerIndex0 = createListIndex(null, 0);
    const outerIndex1 = createListIndex(null, 1);
    setListIndexesByList(outerList, [outerIndex0, outerIndex1]);

    // 蜀・・繝ｪ繧ｹ繝・
    const innerList = ['c', 'd'];
    const innerIndex0 = createListIndex(outerIndex1, 0);
    const innerIndex1 = createListIndex(outerIndex1, 1);
    setListIndexesByList(innerList, [innerIndex0, innerIndex1]);

    getByAddressMock
      .mockReturnValueOnce(outerList)    // walkWildcardPattern: 螟門・繝ｪ繧ｹ繝亥叙蠕・
      .mockReturnValueOnce(innerList)    // walkWildcardPattern: 蜀・・繝ｪ繧ｹ繝亥叙蠕・(index=1)
      .mockReturnValueOnce(outerList)    // resolve: 螟門・繝ｪ繧ｹ繝亥叙蠕・
      .mockReturnValueOnce(innerList)    // resolve: 蜀・・繝ｪ繧ｹ繝亥叙蠕・
      .mockReturnValueOnce('d');         // resolve: categories.*.items.* index=[1,1]

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('categories.*.items.*', [1, 1]);

    expect(result).toEqual(['d']);
  });

  it('listDiff.newIndexes 縺・null 縺ｮ蝣ｴ蜷医・繧ｨ繝ｩ繝ｼ縺ｫ縺ｪ繧九％縺ｨ', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    getByAddressMock.mockReturnValueOnce([]);

    // createListDiff 縺・newIndexes: null 繧定ｿ斐☆繧医≧繝｢繝・け
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

  it('indexes 謖・ｮ壹〒遽・峇螟悶・繧､繝ｳ繝・ャ繧ｯ繧ｹ繧呈欠螳壹＠縺溷ｴ蜷医・繧ｨ繝ｩ繝ｼ縺ｫ縺ｪ繧九％縺ｨ', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
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

  it('oldValue 縺ｫ listIndexes 縺後↑縺・ｴ蜷医・遨ｺ驟榊・縺経ldIndexes縺ｨ縺励※菴ｿ繧上ｌ繧九％縺ｨ', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    // 1蝗樒岼: lastValue 縺ｫ繝ｪ繧ｹ繝医ｒ菫晏ｭ倥＆縺帙ｋ
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

    // 2蝗樒岼縺ｮ蜻ｼ縺ｳ蜃ｺ縺怜燕縺ｫ list1 縺ｮ listIndexes 繧偵け繝ｪ繧｢
    // getListIndexesByList(oldValue) 縺・null 竊・|| [] 蛻・ｲ舌ｒ騾壹ｋ
    setListIndexesByList(list1, null);

    const list2 = ['b'];
    const li2_0 = createListIndex(null, 0);
    setListIndexesByList(list2, [li2_0]);

    // createListDiff 繧偵Δ繝・け縺励※ oldIndexes=[] 縺ｧ繧よｭ｣蟶ｸ蜍穂ｽ懊＆縺帙ｋ
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

  it('繝ｯ繧､繝ｫ繝峨き繝ｼ繝峨↑縺励・繝代せ縺ｧ繧ょ､繧貞叙蠕励〒縺阪ｋ縺薙→', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    getByAddressMock.mockReturnValueOnce('hello');

    const getAllFn = getAll(target, '$getAll', target, handler as any);
    const result = getAllFn('name');

    expect(result).toEqual(['hello']);
  });
});
