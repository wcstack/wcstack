import { describe, it, expect, afterEach } from 'vitest';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { createListDiff } from '../src/list/createListDiff';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import { setStateElementByName } from '../src/stateElementByName';
import { getPathInfo } from '../src/address/PathInfo';
import { createLoopContextStack } from '../src/list/loopContext';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';
import type { IStateAddress } from '../src/address/types';
import type { ICacheEntry } from '../src/cache/types';
import type { IVersionInfo } from '../src/version/types';
import type { IApplyContext } from '../src/apply/types';

const uuid = 'index-opt-test-uuid';

const createListIndexes = (
  parentListIndex: any,
  oldList: any,
  newList: any,
  oldIndexes: any
) => createListDiff(parentListIndex, oldList, newList, oldIndexes).newIndexes;

function createBindingInfo(node: Node, overrides: Partial<IBindingInfo> = {}): IBindingInfo {
  return {
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
    node,
    replaceNode: node,
    ...overrides,
  } as IBindingInfo;
}

function createMockStateElement(): IStateElement {
  const listPaths = new Set<string>();
  const elementPaths = new Set<string>();
  const getterPaths = new Set<string>();
  const cache = new Map<IStateAddress, ICacheEntry>();
  const mightChangeByPath = new Map<string, IVersionInfo>();
  const dynamicDependency = new Map<string, string[]>();
  const staticDependency = new Map<string, string[]>();
  let version = 0;
  const stateProxy: any = {
    items: [],
    $$setLoopContext: (_loopContext: any, callback: () => any) => callback(),
    $$getByAddress: () => undefined,
  };

  return {
    name: 'default',
    initializePromise: Promise.resolve(),
    listPaths,
    elementPaths,
    getterPaths,
    setterPaths: new Set<string>(),
    loopContextStack: createLoopContextStack(),
    cache,
    mightChangeByPath,
    dynamicDependency,
    staticDependency,
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
  };
}

function createFragmentInfoWithBinding() {
  const fragment = document.createDocumentFragment();
  const span = document.createElement('span');
  span.setAttribute('data-bind-state', 'textContent: items.*');
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
    uuid
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: getFragmentNodeInfos(fragment)
  };
}

function createFragmentInfoWithIndexBinding() {
  const fragment = document.createDocumentFragment();
  const span = document.createElement('span');
  span.setAttribute('data-bind-state', 'textContent: items.*; title: $1');
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
    uuid
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: getFragmentNodeInfos(fragment)
  };
}

afterEach(() => {
  setFragmentInfoByUUID(uuid, null);
  setStateElementByName('default', null);
});

describe('applyChangeToFor - changeIndexSet最適化', () => {
  const state = { $$getByAddress: () => undefined } as any;
  let context: IApplyContext;

  function setupContext() {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);
    context = { stateName: 'default', stateElement: stateElement as any, state, appliedBindingSet: new Set() };
    return stateElement;
  }

  const apply = (bindingInfo: IBindingInfo, value: any) =>
    applyChangeToFor(bindingInfo, context, value);

  it('changeIndexSet時にインデックスバインディングのみ再適用されること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfoWithIndexBinding());
    const bindingInfo = createBindingInfo(placeholder);

    // 初回適用: [1, 2]
    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(3);

    // 先頭に追加: [0, 1, 2] → 既存要素はchangeIndexSetに入る
    const newList = [0, 1, 2];
    const newListIndexes = createListIndexes(null, list, newList, listIndexes);
    setListIndexesByList(newList, newListIndexes);

    // applyChangeの実行を追跡
    state.$$getByAddress = () => 'updated';
    apply(bindingInfo, newList);

    expect(container.childNodes.length).toBe(4); // comment + 3 spans

    setListIndexesByList(list, null);
    setListIndexesByList(newList, null);
  });

  it('$1を使わないリストではchangeIndexSet時にバインディングが再適用されないこと', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    // $1を含まないフラグメント
    setFragmentInfoByUUID(uuid, createFragmentInfoWithBinding());
    const bindingInfo = createBindingInfo(placeholder);

    // 初回適用: [1, 2]
    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    state.$$getByAddress = () => 'initial';
    apply(bindingInfo, list);

    const span1 = container.childNodes[1] as HTMLElement;
    const span2 = container.childNodes[2] as HTMLElement;
    expect(span1.textContent).toBe('initial');
    expect(span2.textContent).toBe('initial');

    // 先頭に追加: [0, 1, 2] → 既存要素はchangeIndexSetに入る
    const newList = [0, 1, 2];
    const newListIndexes = createListIndexes(null, list, newList, listIndexes);
    setListIndexesByList(newList, newListIndexes);

    state.$$getByAddress = () => 'should-not-change';
    apply(bindingInfo, newList);

    // indexBindingsが空なので、changeIndexSetの既存要素のtextContentは変更されない
    expect(span1.textContent).toBe('initial');
    expect(span2.textContent).toBe('initial');

    setListIndexesByList(list, null);
    setListIndexesByList(newList, null);
  });

  it('changeIndexSet時にindexBindingsのみが再適用され通常バインディングはスキップされること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    // items.* と $1 の両方を持つフラグメント
    setFragmentInfoByUUID(uuid, createFragmentInfoWithIndexBinding());
    const bindingInfo = createBindingInfo(placeholder);

    // 初回適用
    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    let callCount = 0;
    const origGetByAddress = state.$$getByAddress;
    state.$$getByAddress = () => {
      callCount++;
      return 'value';
    };
    apply(bindingInfo, list);

    // 初回適用時の呼び出し回数を記録（addIndexSetで全バインディング適用）
    const initialCallCount = callCount;
    callCount = 0;

    // 順序変更: [2, 1] → changeIndexSetが発生
    const reordered = [2, 1];
    const reorderedIndexes = createListIndexes(null, list, reordered, listIndexes);
    setListIndexesByList(reordered, reorderedIndexes);
    apply(bindingInfo, reordered);

    // changeIndexSet時はindexBindings（$1）のみが再適用される
    // 通常バインディング（items.*）は再適用されないため、
    // 呼び出し回数は初回より少ないはず
    expect(callCount).toBeLessThan(initialCallCount);

    state.$$getByAddress = origGetByAddress;
    setListIndexesByList(list, null);
    setListIndexesByList(reordered, null);
  });

});
