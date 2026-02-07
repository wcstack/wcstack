import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setByAddress } from '../src/proxy/methods/setByAddress';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { createListIndex } from '../src/list/createListIndex';
import { createListDiff } from '../src/list/createListDiff';
import { getListIndexesByList, setListIndexesByList } from '../src/list/listIndexesByList';
import { getSwapInfoByAddress, setSwapInfoByAddress } from '../src/proxy/methods/swapInfo';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';

const absAddressByState = new Map<string, WeakMap<object, object>>();

const createListIndexes = (
  parentListIndex,
  oldList,
  newList,
  oldIndexes
) => createListDiff(parentListIndex, oldList, newList, oldIndexes).newIndexes;

vi.mock('../src/proxy/methods/getByAddress', () => ({
  getByAddress: vi.fn(),
}));

const mockEnqueueAbsoluteAddress = vi.fn();

vi.mock('../src/updater/updater', () => ({
  getUpdater: vi.fn(() => ({
    enqueueAbsoluteAddress: mockEnqueueAbsoluteAddress,
  })),
}));

vi.mock('../src/address/AbsoluteStateAddress', () => ({
  createAbsoluteStateAddress: vi.fn((stateName, address) => {
    let byAddress = absAddressByState.get(stateName);
    if (!byAddress) {
      byAddress = new WeakMap();
      absAddressByState.set(stateName, byAddress);
    }
    let absAddress = byAddress.get(address);
    if (!absAddress) {
      absAddress = { stateName, address };
      byAddress.set(address, absAddress);
    }
    return absAddress;
  }),
}));

import { getByAddress } from '../src/proxy/methods/getByAddress';
import { getCacheEntryByAbsoluteStateAddress, setCacheEntryByAbsoluteStateAddress } from '../src/cache/cacheEntryByAbsoluteStateAddress';

function createStateElement(overrides?: Partial<any>) {
  return {
    name: 'default',
    elementPaths: new Set<string>(),
    listPaths: new Set<string>(),
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    cache: new Map(),
    staticDependency: new Map(),
    dynamicDependency: new Map(),
    ...overrides,
  };
}

function createHandler(stateElement: any, overrides?: Partial<any>) {
  return {
    stateElement,
    stateName: 'default',
    pushAddress: vi.fn(),
    popAddress: vi.fn(),
    ...overrides,
  };
}

describe('setByAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('既存プロパティはsetterがあればpush/popしつつ更新すること', () => {
    const target = { count: 1 };
    const address = createStateAddress(getPathInfo('count'), null);
    const stateElement = createStateElement({ setterPaths: new Set(['count']), getterPaths: new Set(['count']) });
    const handler = createHandler(stateElement);

    const result = setByAddress(target, address, 5, target, handler as any);
    expect(result).toBe(true);
    expect(target.count).toBe(5);
    expect(handler.pushAddress).toHaveBeenCalledWith(address);
    expect(handler.popAddress).toHaveBeenCalled();

    expect(mockEnqueueAbsoluteAddress).toHaveBeenCalled();
  });

  it('既存キャッシュがある場合は更新されること', () => {
    const target = { count: 1 };
    const address = createStateAddress(getPathInfo('count'), null);
    const stateElement = createStateElement({ getterPaths: new Set(['count']) });
    const handler = createHandler(stateElement);
    const absAddress = createAbsoluteStateAddress(stateElement.name, address);

    setCacheEntryByAbsoluteStateAddress(absAddress, { value: 1 });

    setByAddress(target, address, 9, target, handler as any);

    const cacheEntry = getCacheEntryByAbsoluteStateAddress(absAddress);
    expect(cacheEntry).not.toBeNull();
    expect(cacheEntry!.value).toBe(9);

    setCacheEntryByAbsoluteStateAddress(absAddress, null);
  });

  it('依存先がある場合はキャッシュ削除と更新通知が行われること', () => {
    const target = { count: 1, total: 2 };
    const address = createStateAddress(getPathInfo('count'), null);
    const stateElement = createStateElement({
      staticDependency: new Map<string, string[]>([['count', ['total']]]),
    });
    const handler = createHandler(stateElement);

    setByAddress(target, address, 5, target, handler as any);

    const hasDependentEnqueue = mockEnqueueAbsoluteAddress.mock.calls.some(
      ([arg]) => arg.address?.pathInfo?.path === 'total'
    );
    expect(hasDependentEnqueue).toBe(true);
  });

  it('親経由で非ワイルドカードの値を設定できること', () => {
    const target = { user: { name: 'A' } };
    const address = createStateAddress(getPathInfo('user.name'), null);
    const stateElement = createStateElement();
    const handler = createHandler(stateElement);

    vi.mocked(getByAddress).mockImplementation((_target, addr) => {
      if (addr.pathInfo.path === 'user') {
        return target.user;
      }
      return null;
    });

    setByAddress(target, address, 'B', target, handler as any);
    expect(target.user.name).toBe('B');
  });

  it('ワイルドカードでlistIndexが無い場合はエラーになること', () => {
    const target = { items: ['a'] };
    const address = createStateAddress(getPathInfo('items.*'), null);
    const stateElement = createStateElement();
    const handler = createHandler(stateElement);

    vi.mocked(getByAddress).mockImplementation((_target, addr) => {
      if (addr.pathInfo.path === 'items') {
        return target.items;
      }
      return null;
    });

    expect(() => setByAddress(target, address, 'b', target, handler as any)).toThrow(/listIndex/);
    expect(mockEnqueueAbsoluteAddress).toHaveBeenCalled();
  });

  it('elementsのswapで重複が無ければswapInfoが削除されること', () => {
    const target = { items: ['a', 'b'] };
    const parentListIndex = createListIndex(null, 0);
    const listIndex = createListIndex(parentListIndex, 0);
    const address = createStateAddress(getPathInfo('items.*'), listIndex);
    const parentAddress = address.parentAddress!;

    const indexes = createListIndexes(parentListIndex, [], target.items, []);
    setListIndexesByList(target.items, indexes);

    const stateElement = createStateElement({ elementPaths: new Set(['items.*']) });
    const handler = createHandler(stateElement);

    vi.mocked(getByAddress).mockImplementation((_target, addr) => {
      if (addr.pathInfo.path === 'items') {
        return target.items;
      }
      return null;
    });

    setByAddress(target, address, 'a', target, handler as any);

    expect(getSwapInfoByAddress(parentAddress)).toBeNull();
    const currentIndexes = getListIndexesByList(target.items)!;
    expect(currentIndexes[0].index).toBe(0);

    setListIndexesByList(target.items, null);
  });

  it('elementsのswapで重複がある場合はswapInfoが残ること', () => {
    const target = { items: ['a', 'a'] };
    const parentListIndex = createListIndex(null, 0);
    const listIndex = createListIndex(parentListIndex, 0);
    const address = createStateAddress(getPathInfo('items.*'), listIndex);
    const parentAddress = address.parentAddress!;

    const indexes = createListIndexes(parentListIndex, [], target.items, []);
    setListIndexesByList(target.items, indexes);

    const stateElement = createStateElement({ elementPaths: new Set(['items.*']) });
    const handler = createHandler(stateElement);

    vi.mocked(getByAddress).mockImplementation((_target, addr) => {
      if (addr.pathInfo.path === 'items') {
        return target.items;
      }
      return null;
    });

    setByAddress(target, address, 'a', target, handler as any);

    expect(getSwapInfoByAddress(parentAddress)).not.toBeNull();

    setListIndexesByList(target.items, null);
  });

  it('swap対象が存在しない場合は新規ListIndexを作ること', () => {
    const target = { items: ['a', 'b'] };
    const parentListIndex = createListIndex(null, 0);
    const listIndex = createListIndex(parentListIndex, 0);
    const address = createStateAddress(getPathInfo('items.*'), listIndex);
    const parentAddress = address.parentAddress!;

    const indexes = createListIndexes(parentListIndex, [], target.items, []);
    setListIndexesByList(target.items, indexes);

    const stateElement = createStateElement({ elementPaths: new Set(['items.*']) });
    const handler = createHandler(stateElement);

    vi.mocked(getByAddress).mockImplementation((_target, addr) => {
      if (addr.pathInfo.path === 'items') {
        return target.items;
      }
      return null;
    });

    setByAddress(target, address, 'c', target, handler as any);

    const currentIndexes = getListIndexesByList(target.items)!;
    expect(currentIndexes[0]).toBeDefined();

    // swapInfo should be cleared after successful swap
    expect(getSwapInfoByAddress(parentAddress)).toBeNull();

    setListIndexesByList(target.items, null);
  });

  it('parentAddressがnullの場合はエラーになること（_setByAddress）', () => {
    // 単一セグメントで target にプロパティがない場合、parentAddress は null
    const target = {};
    const address = createStateAddress(getPathInfo('foo'), null);
    // getPathInfo('foo') の parentPathInfo は null なので parentAddress も null
    const stateElement = createStateElement();
    const handler = createHandler(stateElement);

    expect(() => setByAddress(target, address, 'bar', target, handler as any)).toThrow(/parentAddress/);
  });

  it('parentAddressがnullの場合はエラーになること（_setByAddressWithSwap）', () => {
    // トップレベルの * パスでテスト（parentPathInfo が null になるケース）
    const target = {};
    const listIndex = createListIndex(null, 0);
    const address = createStateAddress(getPathInfo('*'), listIndex);
    // getPathInfo('*') の parentPathInfo は null なので parentAddress も null
    const stateElement = createStateElement({ elementPaths: new Set(['*']) });
    const handler = createHandler(stateElement);

    expect(() => setByAddress(target, address, 'value', target, handler as any)).toThrow(/parentAddress/);
  });

  it('swapInfoが既に存在する場合は再利用されること', () => {
    const target = { items: ['a', 'b'] };
    const parentListIndex = createListIndex(null, 0);
    const listIndex = createListIndex(parentListIndex, 0);
    const address = createStateAddress(getPathInfo('items.*'), listIndex);
    const parentAddress = address.parentAddress!;

    const indexes = createListIndexes(parentListIndex, [], target.items, []);
    setListIndexesByList(target.items, indexes);

    // 事前にswapInfoをセットしておく
    const existingSwapInfo = {
      value: ['a', 'b'],
      listIndexes: [...indexes]
    };
    setSwapInfoByAddress(parentAddress, existingSwapInfo);

    const stateElement = createStateElement({ elementPaths: new Set(['items.*']) });
    const handler = createHandler(stateElement);

    vi.mocked(getByAddress).mockImplementation((_target, addr) => {
      if (addr.pathInfo.path === 'items') {
        return target.items;
      }
      return null;
    });

    setByAddress(target, address, 'a', target, handler as any);

    // swapが完了したのでnullになる
    expect(getSwapInfoByAddress(parentAddress)).toBeNull();

    setListIndexesByList(target.items, null);
  });

  it('getByAddressがnullを返す場合でもswapInfoの ?? [] フォールバックが動作すること', () => {
    // このテストでは swapInfo 作成時の getByAddress が null を返すケースを確認
    const parentListIndex = createListIndex(null, 0);
    const listIndex = createListIndex(parentListIndex, 0);
    const address = createStateAddress(getPathInfo('items.*'), listIndex);
    const parentAddress = address.parentAddress!;

    // swapInfoがまだ存在しない状態でテスト
    setSwapInfoByAddress(parentAddress, null);

    const stateElement = createStateElement({ elementPaths: new Set(['items.*']) });
    const handler = createHandler(stateElement);

    const target = { items: ['a'] };
    
    // getByAddressの初回呼び出し（swapInfo作成時）でnullを返す
    // その後は items を返す
    let callCount = 0;
    vi.mocked(getByAddress).mockImplementation((_target, addr) => {
      callCount++;
      if (callCount === 1) {
        // swapInfo作成時はnullを返す（?? [] がトリガーされる）
        return null;
      }
      if (addr.pathInfo.path === 'items') {
        return target.items;
      }
      return target.items;
    });

    setByAddress(target, address, 'b', target, handler as any);

    // クリーンアップ
    setSwapInfoByAddress(parentAddress, null);
  });

  it('finallyブロック内でgetByAddressがnullを返す場合も空配列にフォールバックすること', () => {
    // 88行目の ?? [] をカバーするテスト
    const parentListIndex = createListIndex(null, 0);
    const listIndex = createListIndex(parentListIndex, 0);
    const address = createStateAddress(getPathInfo('items.*'), listIndex);
    const parentAddress = address.parentAddress!;

    // swapInfoがまだ存在しない状態でテスト
    setSwapInfoByAddress(parentAddress, null);

    const stateElement = createStateElement({ elementPaths: new Set(['items.*']) });
    const handler = createHandler(stateElement);

    const target = { items: ['a'] };
    
    // 1回目: swapInfo作成時 → items を返す
    // 2回目: _setByAddress内 → items を返す
    // 3回目: finallyブロック内 → null を返す (88行目の ?? [] がトリガーされる)
    let callCount = 0;
    vi.mocked(getByAddress).mockImplementation((_target, addr) => {
      callCount++;
      if (callCount === 3) {
        // finallyブロック内でnullを返す
        return null;
      }
      if (addr.pathInfo.path === 'items') {
        return target.items;
      }
      return target.items;
    });

    setByAddress(target, address, 'b', target, handler as any);

    // クリーンアップ
    setSwapInfoByAddress(parentAddress, null);
  });

  it('finallyブロック内でgetByAddressが配列ではない値を返す場合は空配列にフォールバックすること', () => {
    // 94行目の Array.isArray チェックをカバーするテスト
    const parentListIndex = createListIndex(null, 0);
    const listIndex = createListIndex(parentListIndex, 0);
    const address = createStateAddress(getPathInfo('items.*'), listIndex);
    const parentAddress = address.parentAddress!;

    setSwapInfoByAddress(parentAddress, null);

    const stateElement = createStateElement({ elementPaths: new Set(['items.*']) });
    const handler = createHandler(stateElement);

    const target = { items: ['a'] };
    
    // 1回目: swapInfo作成時 → items を返す
    // 2回目: _setByAddress内 → items を返す
    // 3回目: finallyブロック内 → 配列ではないがイテラブルな値を返す (94行目がトリガーされる)
    let callCount = 0;
    vi.mocked(getByAddress).mockImplementation((_target, addr) => {
      callCount++;
      if (callCount === 3) {
        // finallyブロック内で配列ではないがイテラブルな文字列を返す
        // Array.isArray('ab') は false なので、94行目の else ブランチが実行される
        return 'ab';
      }
      if (addr.pathInfo.path === 'items') {
        return target.items;
      }
      return target.items;
    });

    setByAddress(target, address, 'b', target, handler as any);

    // クリーンアップ
    setSwapInfoByAddress(parentAddress, null);
  });
});
