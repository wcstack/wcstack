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
  };
});
import {
  applyChangeToFor,
  __test_setMaxPooledContents,
  __test_getPooledContentsCount,
} from '../src/apply/applyChangeToFor';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { getContentSetByNode } from '../src/structural/contentsByNode';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import { createListDiff } from '../src/list/createListDiff';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import { setStateElementByName } from '../src/stateElementByName';
import { getPathInfo } from '../src/address/PathInfo';
import { createLoopContextStack } from '../src/list/loopContext';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';
import { setLoopContextSymbol, getByAddressSymbol } from '../src/proxy/symbols';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';
import { setLastListValueByAbsoluteStateAddress } from '../src/list/lastListValueByAbsoluteStateAddress';

const uuid = 'pool-cap-uuid';

function createBindingInfo(node: Node): IBindingInfo {
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
  } as IBindingInfo;
}

function createMockStateElement(): IStateElement {
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
    cache: new Map(),
    mightChangeByPath: new Map(),
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
  return { fragment, parseBindTextResult, nodeInfos: getFragmentNodeInfos(fragment) };
}

describe('applyChangeToFor のプール上限', () => {
  const state = { [getByAddressSymbol]: () => undefined } as any;
  let context: IApplyContext;
  let restoreCap: number | null = null;

  function setupContext() {
    const stateElement = createMockStateElement();
    setStateElementByName(document, 'default', stateElement);
    context = { stateName: 'default', rootNode: document, stateElement: stateElement as any, state, appliedBindingSet: new Set(), newListValueByAbsAddress: new Map(), updatedAbsAddressSetByStateElement: new Map(), deferredSelectBindings: [] };
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
    return { container, placeholder, bindingInfo };
  }

  const spans = (container: HTMLElement) => Array.from(container.childNodes).slice(1) as Element[];

  afterEach(() => {
    if (restoreCap !== null) {
      __test_setMaxPooledContents(restoreCap);
      restoreCap = null;
    }
    setFragmentInfoByUUID(uuid, document, null);
    setStateElementByName(document, 'default', null);
    document.body.innerHTML = '';
  });

  it('全削除時、上限までプールし超過分は contentSetByNode からも解放されること', () => {
    restoreCap = __test_setMaxPooledContents(2);
    const list = ['a', 'b', 'c', 'd', 'e'];
    const { container, placeholder, bindingInfo } = mount(list);
    expect(spans(container)).toHaveLength(5);
    expect(getContentSetByNode(placeholder).size).toBe(5);

    apply(bindingInfo, []);
    expect(spans(container)).toHaveLength(0);
    // プールは上限 2 で打ち止め
    expect(__test_getPooledContentsCount(placeholder)).toBe(2);
    // 超過 3 件は contentSetByNode の台帳からも外れて GC 可能になる
    expect(getContentSetByNode(placeholder).size).toBe(2);
  });

  it('再追加時はプール分のみ DOM ノードを再利用し、残りは新規生成されること', () => {
    restoreCap = __test_setMaxPooledContents(2);
    const list = ['a', 'b', 'c', 'd', 'e'];
    const { container, bindingInfo, placeholder } = mount(list);
    const originalSpans = new Set(spans(container));

    apply(bindingInfo, []);
    expect(__test_getPooledContentsCount(placeholder)).toBe(2);

    const nextList = ['f', 'g', 'h', 'i', 'j'];
    apply(bindingInfo, nextList);
    const after = spans(container);
    expect(after).toHaveLength(5);
    const reused = after.filter(span => originalSpans.has(span));
    expect(reused).toHaveLength(2);
    // プールは消費済み
    expect(__test_getPooledContentsCount(placeholder)).toBe(0);
  });

  it('上限 0 ではプールされないこと', () => {
    restoreCap = __test_setMaxPooledContents(0);
    const list = ['a', 'b'];
    const { container, bindingInfo, placeholder } = mount(list);
    const originalSpans = new Set(spans(container));

    apply(bindingInfo, []);
    expect(__test_getPooledContentsCount(placeholder)).toBe(0);
    expect(getContentSetByNode(placeholder).size).toBe(0);

    apply(bindingInfo, ['x', 'y']);
    const after = spans(container);
    expect(after).toHaveLength(2);
    // 全て新規生成（旧ノードは再利用されない）
    expect(after.some(span => originalSpans.has(span))).toBe(false);
  });

  it('既定の上限内では従来通り全件プール・再利用されること', () => {
    const list = ['a', 'b', 'c'];
    const { container, bindingInfo, placeholder } = mount(list);
    const originalSpans = new Set(spans(container));

    apply(bindingInfo, []);
    expect(__test_getPooledContentsCount(placeholder)).toBe(3);

    apply(bindingInfo, ['x', 'y', 'z']);
    const after = spans(container);
    expect(after).toHaveLength(3);
    expect(after.every(span => originalSpans.has(span))).toBe(true);
  });
});
