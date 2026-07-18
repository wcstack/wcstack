import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../src/binding/getAbsoluteStateAddressByBinding', () => {
  const cache = new WeakMap();
  return {
    getAbsoluteStateAddressByBinding: vi.fn((binding) => {
      if (cache.has(binding)) return cache.get(binding);
      const addr = { absolutePathInfo: { stateName: binding.stateName, pathInfo: binding.statePathInfo }, listIndex: null };
      cache.set(binding, addr);
      return addr;
    }),
    clearAbsoluteStateAddressByBinding: vi.fn(),
    resolveBindingRootNode: vi.fn(() => document),
  };
});
import { longestIncreasingSubsequence, computeStableIndexSet } from '../src/list/stableListOrder';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import { createListDiff } from '../src/list/createListDiff';
import { createListIndex } from '../src/list/createListIndex';
import type { IListDiff, IListIndex } from '../src/list/types';
import { setListIndexesByList, getListIndexesByList } from '../src/list/listIndexesByList';
import { setStateElementByName } from '../src/stateElementByName';
import { getPathInfo } from '../src/address/PathInfo';
import { createLoopContextStack } from '../src/list/loopContext';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';
import type { IStateAddress } from '../src/address/types';
import type { ICacheEntry } from '../src/cache/types';
import type { IVersionInfo } from '../src/version/types';
import type { IApplyContext } from '../src/apply/types';
import { setLoopContextSymbol, getByAddressSymbol } from '../src/proxy/symbols';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';
import { setLastListValueByAbsoluteStateAddress } from '../src/list/lastListValueByAbsoluteStateAddress';

const uuid = 'stable-order-uuid';

describe('longestIncreasingSubsequence', () => {
  it('空列では空を返すこと', () => {
    expect(longestIncreasingSubsequence([])).toEqual([]);
  });

  it('昇順列では全インデックスを返すこと', () => {
    expect(longestIncreasingSubsequence([10, 20, 30, 40])).toEqual([0, 1, 2, 3]);
  });

  it('降順列では長さ1になること', () => {
    expect(longestIncreasingSubsequence([4, 3, 2, 1, 0])).toHaveLength(1);
  });

  it('混在列で最長増加部分列（インデックス昇順・値増加）を返すこと', () => {
    const seq = [3, 1, 4, 1.5, 5, 9, 2.5, 6];
    const lis = longestIncreasingSubsequence(seq);
    // 選ばれたインデックスは昇順かつ値も厳密増加であること
    for (let i = 1; i < lis.length; i++) {
      expect(lis[i]).toBeGreaterThan(lis[i - 1]);
      expect(seq[lis[i]]).toBeGreaterThan(seq[lis[i - 1]]);
    }
    // この列の LIS 長は 4（例: 1, 1.5, 2.5, 6）
    expect(lis.length).toBe(4);
  });

  it('スワップ列（先頭側と末尾側の交換）では交換された2要素のみ除外されること', () => {
    // 位置1と8を交換した10要素の位置列
    const seq = [0, 8, 2, 3, 4, 5, 6, 7, 1, 9];
    const lis = longestIncreasingSubsequence(seq);
    expect(lis).toEqual([0, 2, 3, 4, 5, 6, 7, 9]);
  });
});

describe('computeStableIndexSet', () => {
  function diffOf(oldList: unknown[], newList: unknown[]) {
    createListDiff(null, [], oldList);
    return createListDiff(null, oldList, newList);
  }

  afterEach(() => {
    // WeakMap ベースの台帳はリスト参照ごとなので明示クリーンアップ不要
  });

  it('同一リストでは null を返すこと（changeIndexSet が空）', () => {
    const list = ['a', 'b', 'c'];
    const diff = diffOf(list, list);
    expect(computeStableIndexSet(diff)).toBeNull();
  });

  it('初回適用（全追加）では null を返すこと', () => {
    const diff = diffOf([], ['a', 'b', 'c']);
    expect(computeStableIndexSet(diff)).toBeNull();
  });

  it('末尾追加では null を返すこと（転置なし）', () => {
    const diff = diffOf(['a', 'b'], ['a', 'b', 'c', 'd']);
    expect(computeStableIndexSet(diff)).toBeNull();
  });

  it('削除のみでは null を返すこと（残存要素の相対順は保たれる）', () => {
    const diff = diffOf(['a', 'b', 'c', 'd', 'e'], ['a', 'c', 'e']);
    expect(computeStableIndexSet(diff)).toBeNull();
  });

  it('先頭挿入では null を返すこと（既存要素の相対順は保たれる）', () => {
    const diff = diffOf(['a', 'b', 'c'], ['x', 'a', 'b', 'c']);
    expect(computeStableIndexSet(diff)).toBeNull();
  });

  it('スワップでは交換された2要素だけが安定集合から除外されること', () => {
    const oldList = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'];
    const newList = [...oldList];
    [newList[1], newList[8]] = [newList[8], newList[1]];
    const diff = diffOf(oldList, newList);
    const stable = computeStableIndexSet(diff);
    expect(stable).not.toBeNull();
    expect(stable!.size).toBe(8);
    // 交換された 2 要素（新位置 1 と 8）は移動対象
    expect(stable!.has(diff.newIndexes[1])).toBe(false);
    expect(stable!.has(diff.newIndexes[8])).toBe(false);
  });

  it('完全逆順では安定集合が1要素になること', () => {
    const oldList = ['a', 'b', 'c', 'd', 'e'];
    const newList = [...oldList].reverse();
    const diff = diffOf(oldList, newList);
    const stable = computeStableIndexSet(diff);
    expect(stable).not.toBeNull();
    expect(stable!.size).toBe(1);
  });

  it('再利用インデックスが oldIndexes に無い不正な diff では null を返すこと（防御分岐）', () => {
    const iA = createListIndex(null, 0);
    const iB = createListIndex(null, 1);
    const diff = {
      oldIndexes: [iA],
      newIndexes: [iB, iA],
      changeIndexSet: new Set<IListIndex>([iA]),
      deleteIndexSet: new Set<IListIndex>(),
      addIndexSet: new Set<IListIndex>(),
    } as IListDiff;
    expect(computeStableIndexSet(diff)).toBeNull();
  });

  it('並べ替え＋追加の混在では追加要素は安定集合に含まれないこと', () => {
    const oldList = ['a', 'b', 'c', 'd'];
    const newList = ['a', 'c', 'x', 'b', 'd'];
    const diff = diffOf(oldList, newList);
    const stable = computeStableIndexSet(diff);
    expect(stable).not.toBeNull();
    // 追加要素 x（新位置2）は含まれない
    expect(stable!.has(diff.newIndexes[2])).toBe(false);
    // 安定集合の各要素は再利用インデックスのみ
    for (const idx of stable!) {
      expect(diff.addIndexSet.has(idx)).toBe(false);
    }
  });
});

// --- applyChangeToFor 統合: 移動回数の削減と任意順列の正しさ -------------------

function createBindingInfo(node: Node, overrides: Partial<IBindingInfo> = {}): IBindingInfo {
  const pathInfo = getPathInfo('items');
  return {
    propName: 'for',
    propSegments: [],
    propModifiers: [],
    statePathName: 'items',
    statePathInfo: pathInfo,
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'for',
    uuid,
    node,
    replaceNode: node,
    ...overrides,
  } as IBindingInfo;
}

function createMockStateElement(): IStateElement {
  const cache = new Map<IStateAddress, ICacheEntry>();
  const mightChangeByPath = new Map<string, IVersionInfo>();
  let version = 0;
  const stateProxy: any = {
    items: [],
    [setLoopContextSymbol]: (_loopContext: any, callback: () => any) => callback(),
    [getByAddressSymbol]: () => undefined,
  };
  return {
    name: 'default',
    initializePromise: Promise.resolve(),
    listPaths: new Set<string>(),
    elementPaths: new Set<string>(),
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    loopContextStack: createLoopContextStack(),
    cache,
    mightChangeByPath,
    dynamicDependency: new Map<string, string[]>(),
    staticDependency: new Map<string, string[]>(),
    get version() {
      return version;
    },
    setPathInfo() {},
    addStaticDependency() {},
    addDynamicDependency() {},
    createState(_mutability, callback) {
      return callback(stateProxy);
    },
    async createStateAsync(_mutability, callback) {
      return callback(stateProxy);
    },
    nextVersion() {
      version += 1;
      return version;
    },
  } as IStateElement;
}

function createEmptyFragmentInfo() {
  const fragment = document.createDocumentFragment();
  const parseBindTextResult: ParseBindTextResult = {
    propName: 'for',
    propSegments: [],
    propModifiers: [],
    statePathName: 'items',
    statePathInfo: getPathInfo('items'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'for',
    uuid,
  };
  return { fragment, parseBindTextResult, nodeInfos: [] };
}

function createFragmentInfoWithBinding() {
  const fragment = document.createDocumentFragment();
  const span = document.createElement('span');
  span.setAttribute('data-wcs', 'textContent: items.*');
  fragment.appendChild(span);

  const parseBindTextResult: ParseBindTextResult = {
    propName: 'for',
    propSegments: [],
    propModifiers: [],
    statePathName: 'items',
    statePathInfo: getPathInfo('items'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'for',
    uuid,
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: getFragmentNodeInfos(fragment),
  };
}

// 再現可能な乱数（mulberry32）
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('applyChangeToFor の並べ替え（LIS リオーダー）', () => {
  const state = { [getByAddressSymbol]: () => undefined } as any;
  let context: IApplyContext;

  function setupContext() {
    const stateElement = createMockStateElement();
    setStateElementByName(document, 'default', stateElement);
    context = { stateName: 'default', rootNode: document, stateElement: stateElement as any, state, appliedBindingSet: new Set(), newListValueByAbsAddress: new Map(), updatedAbsAddressSetByStateElement: new Map(), deferredSelectBindings: [] };
    return stateElement;
  }

  const apply = (bindingInfo: IBindingInfo, value: any) => {
    applyChangeToFor(bindingInfo, context, value);
    for (const [absAddress, newListValue] of context.newListValueByAbsAddress.entries()) {
      setLastListValueByAbsoluteStateAddress(absAddress, newListValue);
    }
    context.newListValueByAbsAddress.clear();
  };

  function mount(initialList: unknown[]) {
    setupContext();
    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    document.body.appendChild(container);
    setFragmentInfoByUUID(uuid, document, createFragmentInfoWithBinding());
    const bindingInfo = createBindingInfo(placeholder);
    const listIndexes = createListDiff(null, [], initialList).newIndexes;
    setListIndexesByList(initialList, listIndexes);
    apply(bindingInfo, initialList);
    return { container, bindingInfo };
  }

  // container.childNodes[0] は placeholder コメント。i 番目のコンテントの span は childNodes[1+i]
  function spans(container: HTMLElement): Element[] {
    return Array.from(container.childNodes).slice(1) as Element[];
  }

  afterEach(() => {
    setFragmentInfoByUUID(uuid, document, null);
    setStateElementByName(document, 'default', null);
    // lastListValue の台帳はモック化した getAbsoluteStateAddressByBinding が
    // binding ごとに固有の住所を返すため、テスト間の隔離は mount() が毎回
    // 新しい bindingInfo を作ることで担保される（明示クリア不要）。
    document.body.innerHTML = '';
  });

  it('離れた2要素のスワップで移動が最小限（insertBefore 2回以下）になること', () => {
    const list = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'];
    const { container, bindingInfo } = mount(list);
    const spanByItem = new Map<unknown, Node>();
    spans(container).forEach((span, i) => spanByItem.set(list[i], span));

    const swappedList = [...list];
    [swappedList[1], swappedList[8]] = [swappedList[8], swappedList[1]];

    const insertBeforeSpy = vi.spyOn(container, 'insertBefore');
    apply(bindingInfo, swappedList);

    // LIS リオーダー: 交換された 2 要素のみが移動する（旧実装は間の 7 要素も玉突き移動）
    expect(insertBeforeSpy.mock.calls.length).toBeLessThanOrEqual(2);
    insertBeforeSpy.mockRestore();

    // 最終順序と DOM ノード同一性
    const after = spans(container);
    expect(after).toHaveLength(swappedList.length);
    swappedList.forEach((item, i) => {
      expect(after[i]).toBe(spanByItem.get(item));
    });
  });

  it('任意の順列を適用しても順序とノード同一性が保たれること', () => {
    const list = Array.from({ length: 12 }, (_, i) => `item-${i}`);
    const { container, bindingInfo } = mount(list);
    const spanByItem = new Map<unknown, Node>();
    spans(container).forEach((span, i) => spanByItem.set(list[i], span));

    const rand = mulberry32(20260712);
    let current = list;
    for (let round = 0; round < 25; round++) {
      const next = shuffled(current, rand);
      apply(bindingInfo, next);
      const after = spans(container);
      expect(after).toHaveLength(next.length);
      next.forEach((item, i) => {
        expect(after[i]).toBe(spanByItem.get(item));
      });
      current = next;
    }
  });

  it('並べ替え・追加・削除の混在でも順序と生存ノードの同一性が保たれること', () => {
    const initial = Array.from({ length: 10 }, (_, i) => `row-${i}`);
    const { container, bindingInfo } = mount(initial);
    let spanByItem = new Map<unknown, Node>();
    spans(container).forEach((span, i) => spanByItem.set(initial[i], span));

    const rand = mulberry32(551);
    let current = initial;
    let nextId = initial.length;
    for (let round = 0; round < 15; round++) {
      // シャッフルして 2 件削除し 3 件追加
      let next = shuffled(current, rand).slice(0, Math.max(1, current.length - 2));
      const added: string[] = [];
      for (let k = 0; k < 3; k++) {
        const item = `row-${nextId++}`;
        added.push(item);
        next.splice(Math.floor(rand() * (next.length + 1)), 0, item);
      }
      apply(bindingInfo, next);

      const after = spans(container);
      expect(after).toHaveLength(next.length);
      next.forEach((item, i) => {
        if (spanByItem.has(item)) {
          // 生存要素: ノード同一性が保たれ、正しい位置にある
          expect(after[i]).toBe(spanByItem.get(item));
        }
      });
      // 台帳を更新（追加要素の span を記録。プール再利用で旧 span が再登場しうるため上書き）
      spanByItem = new Map();
      after.forEach((span, i) => spanByItem.set(next[i], span));
      current = next;
    }
  });

  it('完全逆順でも順序とノード同一性が保たれること', () => {
    const list = Array.from({ length: 8 }, (_, i) => `rev-${i}`);
    const { container, bindingInfo } = mount(list);
    const spanByItem = new Map<unknown, Node>();
    spans(container).forEach((span, i) => spanByItem.set(list[i], span));

    const reversedList = [...list].reverse();
    apply(bindingInfo, reversedList);

    const after = spans(container);
    reversedList.forEach((item, i) => {
      expect(after[i]).toBe(spanByItem.get(item));
    });
  });

  it('DOM から外れたコンテントは安定集合に選ばれても再マウントされること（if 非表示中の並べ替え回帰）', () => {
    // if 非表示中に unmount された行コンテントは台帳（contentByListIndex・lastListValue）に
    // 残ったまま DOM から外れる。再表示時の転置ありの適用で、安定集合メンバーの
    // mountAfter スキップが再マウントを妨げてはならない。
    const list = ['x', 'y', 'z'];
    const { container, bindingInfo } = mount(list);
    const spanByItem = new Map<unknown, Node>();
    spans(container).forEach((span, i) => spanByItem.set(list[i], span));

    // 全 span を DOM から外す（unmount 相当。台帳は登録されたまま）
    spans(container).forEach(span => (span as ChildNode).remove());
    expect(container.childNodes).toHaveLength(1);

    const reversedList = [...list].reverse(); // 転置あり → 安定集合経路に入る
    apply(bindingInfo, reversedList);

    const after = spans(container);
    expect(after).toHaveLength(3);
    reversedList.forEach((item, i) => {
      expect(after[i]).toBe(spanByItem.get(item));
    });
  });

  it('台帳（listIndexes）と物理 DOM 順がずれていても配列置換で正しい順序に自己修復すること（要素書き込みスワップ回帰）', () => {
    // _setByAddressWithSwap は状態配列と listIndexes を入れ替えるが DOM ノードは動かさない。
    // その直後の配列置換で、安定集合スキップが台帳順を盲信して誤った物理順を確定しないこと。
    const list = ['a', 'b', 'c'];
    const { container, bindingInfo } = mount(list);
    const spanByItem = new Map<unknown, Node>();
    spans(container).forEach((span, i) => spanByItem.set(list[i], span));

    // 要素書き込みスワップ相当: 状態配列と登録済み listIndexes を DOM を動かさず入れ替える
    const indexes = getListIndexesByList(list)!;
    [indexes[0], indexes[2]] = [indexes[2], indexes[0]];
    indexes[0].index = 0;
    indexes[2].index = 2;
    [list[0], list[2]] = [list[2], list[0]]; // lastValue 参照そのものを in-place 変異

    apply(bindingInfo, ['b', 'c', 'a']);

    const after = spans(container);
    expect(after).toHaveLength(3);
    // 値→ノードの対応は初期マウント時のまま（b=span1, c=span2, a=span0）
    expect(after[0]).toBe(spanByItem.get('b'));
    expect(after[1]).toBe(spanByItem.get('c'));
    expect(after[2]).toBe(spanByItem.get('a'));
  });

  it('空コンテントの転置でもエラーなく settle walk 経路で処理されること', () => {
    setupContext();
    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    document.body.appendChild(container);
    setFragmentInfoByUUID(uuid, document, createEmptyFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = ['p', 'q', 'r'];
    const listIndexes = createListDiff(null, [], list).newIndexes;
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);
    expect(container.childNodes).toHaveLength(1);

    const reversedList = [...list].reverse(); // 転置あり・firstNode は null
    expect(() => apply(bindingInfo, reversedList)).not.toThrow();
    expect(container.childNodes).toHaveLength(1);
  });
});
