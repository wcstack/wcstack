import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setByAddress } from '../src/proxy/methods/setByAddress';
import { setConfig } from '../src/config';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { createListIndex } from '../src/list/createListIndex';
import { createListDiff } from '../src/list/createListDiff';
import { getListIndexesByList, setListIndexesByList } from '../src/list/listIndexesByList';
import { getSwapInfoByAddress, setSwapInfoByAddress } from '../src/proxy/methods/swapInfo';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';

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

vi.mock('../src/address/AbsolutePathInfo', () => ({
  getAbsolutePathInfo: vi.fn((stateElement, pathInfo) => {
    return { stateName: stateElement.name, pathInfo };
  }),
}));

vi.mock('../src/address/AbsoluteStateAddress', () => {
  const cache = new Map<string, object>();
  return {
    createAbsoluteStateAddress: vi.fn((absolutePathInfo, listIndex) => {
      const key = `${absolutePathInfo.pathInfo.path}@${absolutePathInfo.stateName}#${listIndex?.index ?? 'null'}`;
      let absAddress = cache.get(key);
      if (!absAddress) {
        absAddress = { absolutePathInfo, listIndex };
        cache.set(key, absAddress);
      }
      return absAddress;
    }),
  };
});

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
    bindableEventMap: {},
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
    // これらは swap/依存伝播の白箱単体テスト。同値ガードは直交する機能なので off に固定し、
    // ガード起因の getByAddress 追加呼び出しでモックの呼び出し列がずれないようにする
    // （ガード自体の挙動は bench.gate0 / audit.sameValueGuard で検証済み）。
    setConfig({ sameValueGuard: false });
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
    const absAddress = createAbsoluteStateAddress({ stateName: stateElement.name, pathInfo: address.pathInfo }, address.listIndex);

    setCacheEntryByAbsoluteStateAddress(absAddress, { value: 1, dirty: false });

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
      ([arg]) => arg.absolutePathInfo?.pathInfo?.path === 'total'
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

  it('parentAddressがnullの場合はtargetへ直接設定すること（_setByAddress）', () => {
    // 単一セグメントで target にプロパティがない場合、parentAddress は null。
    // 未初期化 slot への初回書き込み（initial sync の commitProducerValue 等）を
    // own property の作成として受理する
    const target: Record<string, unknown> = {};
    const address = createStateAddress(getPathInfo('foo'), null);
    // getPathInfo('foo') の parentPathInfo は null なので parentAddress も null
    const stateElement = createStateElement();
    const handler = createHandler(stateElement);

    expect(setByAddress(target, address, 'bar', target, handler as any)).toBe(true);
    expect(target.foo).toBe('bar');
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

  it('bindableEventMapにパスがある場合はCustomEventがディスパッチされること', () => {
    const target = { count: 1 };
    const address = createStateAddress(getPathInfo('count'), null);

    // ShadowRootをシミュレート
    const hostElement = document.createElement('div');
    const shadowRoot = hostElement.attachShadow({ mode: 'open' });

    const receivedEvents: CustomEvent[] = [];
    hostElement.addEventListener('x-el:count-changed', (e) => {
      receivedEvents.push(e as CustomEvent);
    });

    const stateElement = createStateElement({
      bindableEventMap: { count: 'x-el:count-changed' },
    });
    (stateElement as any).rootNode = shadowRoot;
    const handler = createHandler(stateElement);

    setByAddress(target, address, 42, target, handler as any);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].detail).toBe(42);
    expect(receivedEvents[0].bubbles).toBe(true);
  });

  it('bindableEventMapにパスがない場合はCustomEventがディスパッチされないこと', () => {
    const target = { count: 1 };
    const address = createStateAddress(getPathInfo('count'), null);

    const hostElement = document.createElement('div');
    const dispatchSpy = vi.spyOn(hostElement, 'dispatchEvent');

    const stateElement = createStateElement({
      bindableEventMap: {},
    });
    const handler = createHandler(stateElement);

    setByAddress(target, address, 42, target, handler as any);

    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('rootNodeがShadowRootでない場合はCustomEventがディスパッチされないこと', () => {
    const target = { count: 1 };
    const address = createStateAddress(getPathInfo('count'), null);

    const stateElement = createStateElement({
      bindableEventMap: { count: 'x-el:count-changed' },
    });
    // rootNodeはdocument（ShadowRootではない）
    (stateElement as any).rootNode = document;
    const handler = createHandler(stateElement);

    // エラーにならずに完了する
    setByAddress(target, address, 42, target, handler as any);
  });

  describe('fast path（親を持つ未宣言の葉パス）', () => {
    it('関数を親とする葉パスへの書き込みは従来経路で設定されること', () => {
      const fnParent: any = function () {};
      const target = {};
      const address = createStateAddress(getPathInfo('factory.mode'), null);
      const stateElement = createStateElement();
      const handler = createHandler(stateElement);
      vi.mocked(getByAddress).mockReturnValue(fnParent);

      const result = setByAddress(target, address, 'fast', target, handler as any);
      expect(result).toBe(true);
      expect(fnParent.mode).toBe('fast');
      expect(mockEnqueueAbsoluteAddress).toHaveBeenCalled();
    });

    it('同値ガード有効時、同値なら親解決 1 回で early return すること', () => {
      setConfig({ sameValueGuard: true });
      try {
        const parent = { label: 'same' };
        const target = {};
        const address = createStateAddress(getPathInfo('row.label'), null);
        const stateElement = createStateElement();
        const handler = createHandler(stateElement);
        vi.mocked(getByAddress).mockReturnValue(parent);

        expect(setByAddress(target, address, 'same', target, handler as any)).toBe(true);
        expect(mockEnqueueAbsoluteAddress).not.toHaveBeenCalled();
        // 値が異なれば書き込まれ enqueue される
        expect(setByAddress(target, address, 'next', target, handler as any)).toBe(true);
        expect(parent.label).toBe('next');
        expect(mockEnqueueAbsoluteAddress).toHaveBeenCalled();
      } finally {
        setConfig({ sameValueGuard: false });
      }
    });

    it('fast path でも devtools sink に write イベントが流れること', async () => {
      const { setDevtoolsSink } = await import('../src/devtools/sink');
      const sink = vi.fn();
      setConfig({ sameValueGuard: true });
      try {
        setDevtoolsSink(sink);
        const parent = { label: 'old' };
        const target = {};
        const address = createStateAddress(getPathInfo('row.label'), null);
        const stateElement = createStateElement();
        const handler = createHandler(stateElement);
        vi.mocked(getByAddress).mockReturnValue(parent);

        setByAddress(target, address, 'new', target, handler as any);
        expect(sink).toHaveBeenCalledWith(expect.objectContaining({
          type: 'state:write',
          value: 'new',
          oldValue: 'old',
          hasOldValue: true,
        }));
      } finally {
        setDevtoolsSink(null);
        setConfig({ sameValueGuard: false });
      }
    });

    it('fast path でも bindableEventMap の CustomEvent がディスパッチされること', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const received: CustomEvent[] = [];
      host.addEventListener('cfg-theme-changed', (e) => received.push(e as CustomEvent));

      const parent = { theme: 'light' };
      const target = {};
      const address = createStateAddress(getPathInfo('cfg.theme'), null);
      const stateElement = createStateElement({
        bindableEventMap: { 'cfg.theme': 'cfg-theme-changed' },
      });
      (stateElement as any).rootNode = shadow;
      const handler = createHandler(stateElement);
      vi.mocked(getByAddress).mockReturnValue(parent);

      setByAddress(target, address, 'dark', target, handler as any);
      expect(parent.theme).toBe('dark');
      expect(received).toHaveLength(1);
      expect(received[0].detail).toBe('dark');
    });

    it('fast path で rootNode が ShadowRoot でなければディスパッチされず完了すること', () => {
      const parent = { theme: 'light' };
      const target = {};
      const address = createStateAddress(getPathInfo('cfg.theme'), null);
      const stateElement = createStateElement({
        bindableEventMap: { 'cfg.theme': 'cfg-theme-changed' },
      });
      (stateElement as any).rootNode = document;
      const handler = createHandler(stateElement);
      vi.mocked(getByAddress).mockReturnValue(parent);

      expect(setByAddress(target, address, 'dark', target, handler as any)).toBe(true);
      expect(parent.theme).toBe('dark');
    });

    it('enablePropagationContext 無効時は context なしで enqueue されること', () => {
      setConfig({ enablePropagationContext: false });
      try {
        const parent = { label: 'x' };
        const target = {};
        const address = createStateAddress(getPathInfo('row.label'), null);
        const stateElement = createStateElement();
        const handler = createHandler(stateElement);
        vi.mocked(getByAddress).mockReturnValue(parent);

        setByAddress(target, address, 'y', target, handler as any);
        expect(mockEnqueueAbsoluteAddress).toHaveBeenCalledWith(expect.anything(), null);
      } finally {
        setConfig({ enablePropagationContext: true });
      }
    });

    it('関数親のワイルドカード書き込みで listIndex が無ければ従来経路で raiseError すること', () => {
      const fnParent: any = function () {};
      const target = {};
      const address = createStateAddress(getPathInfo('items.*'), null);
      const stateElement = createStateElement();
      const handler = createHandler(stateElement);
      vi.mocked(getByAddress).mockReturnValue(fnParent);

      expect(() => setByAddress(target, address, 'v', target, handler as any)).toThrow(/listIndex/);
      expect(mockEnqueueAbsoluteAddress).toHaveBeenCalled();
    });

    it('同値ガード有効時、listIndex の無いワイルドカードは has=false 扱いで raiseError まで進むこと', () => {
      setConfig({ sameValueGuard: true });
      try {
        const parent: any[] = ['a'];
        const target = {};
        const address = createStateAddress(getPathInfo('items.*'), null);
        const stateElement = createStateElement();
        const handler = createHandler(stateElement);
        vi.mocked(getByAddress).mockReturnValue(parent);

        expect(() => setByAddress(target, address, 'b', target, handler as any)).toThrow(/listIndex/);
        expect(mockEnqueueAbsoluteAddress).toHaveBeenCalled();
      } finally {
        setConfig({ sameValueGuard: false });
      }
    });
  });
});
