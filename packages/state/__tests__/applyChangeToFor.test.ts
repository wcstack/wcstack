import { describe, it, expect, afterEach } from 'vitest';
import { applyChangeToFor, __test_setContentByListIndex } from '../src/apply/applyChangeToFor';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import { createListIndexes } from '../src/list/createListDiff';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import { setStateElementByName } from '../src/stateElementByName';
import { getPathInfo } from '../src/address/PathInfo';
import { createLoopContextStack } from '../src/list/loopContext';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';
import type { IStateAddress } from '../src/address/types';
import type { ICacheEntry } from '../src/cache/types';
import type { IVersionInfo } from '../src/version/types';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';
import { setBindingsByContent } from '../src/bindings/bindingsByContent';

const uuid = 'test-uuid';

function createBindingInfo(node: Node, overrides: Partial<IBindingInfo> = {}): IBindingInfo {
  return {
    propName: 'for',
    propSegments: [],
    propModifiers: [],
    statePathName: 'items',
    statePathInfo: getPathInfo('items'),
    stateName: 'default',
    filters: [],
    bindingType: 'for',
    uuid,
    node,
    replaceNode: node,
    ...overrides,
  } as IBindingInfo;
}

function createMockStateElement(): IStateElement {
  const bindingInfosByAddress = new Map<IStateAddress, IBindingInfo[]>();
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
    bindingInfosByAddress,
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
    addBindingInfo() {},
    deleteBindingInfo() {},
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

function createFragmentInfo() {
  const fragment = document.createDocumentFragment();
  const span = document.createElement('span');
  span.textContent = 'item';
  fragment.appendChild(span);

  const parseBindTextResult: ParseBindTextResult = {
    propName: 'for',
    propSegments: [],
    propModifiers: [],
    statePathName: 'items',
    statePathInfo: getPathInfo('items'),
    stateName: 'default',
    filters: [],
    bindingType: 'for',
    uuid
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: []
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
    filters: [],
    bindingType: 'for',
    uuid
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: getFragmentNodeInfos(fragment)
  };
}

// 同じノードに複数のバインディングを持つフラグメントを作成
function createFragmentInfoWithMultipleBindings() {
  const fragment = document.createDocumentFragment();
  const span = document.createElement('span');
  // 同じノードに複数のバインディングを設定
  span.setAttribute('data-bind-state', 'textContent: items.*; title: items.*');
  fragment.appendChild(span);

  const parseBindTextResult: ParseBindTextResult = {
    propName: 'for',
    propSegments: [],
    propModifiers: [],
    statePathName: 'items',
    statePathInfo: getPathInfo('items'),
    stateName: 'default',
    filters: [],
    bindingType: 'for',
    uuid
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: getFragmentNodeInfos(fragment)
  };
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
    filters: [],
    bindingType: 'for',
    uuid
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: []
  };
}

afterEach(() => {
  setFragmentInfoByUUID(uuid, null);
  setStateElementByName('default', null);
});

describe('applyChangeToFor', () => {
  const state = { $$getByAddress: () => undefined } as any;
  const stateName = 'default';
  const apply = (bindingInfo: IBindingInfo, value: any) =>
    applyChangeToFor(bindingInfo, value, state, stateName);

  it('fragmentInfoが存在しない場合はエラーになること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    expect(() => apply(bindingInfo, list)).toThrow(/Fragment with UUID/);

    setListIndexesByList(list, null);
  });

  it('stateElementが存在しない場合はエラーになること', () => {
    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    createListIndexes(null, [], list, []);
    expect(() => apply(bindingInfo, list)).toThrow(/State element with name/);
  });

  it('listPathInfoがない場合はエラーになること', () => {
    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder, { statePathInfo: null as any });

    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const list: any[] = [];
    createListIndexes(null, [], list, []);
    expect(() => apply(bindingInfo, list)).toThrow(/List path info not found/);
  });

  it('list diffが存在しない場合はエラーになること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    // createListIndexes を呼ばず、diff が生成されない状態を作る
    expect(() => apply(bindingInfo, list)).toThrow(/Failed to get list diff/);
  });

  it('配列以外の値は空配列として扱われること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfoWithBinding());

    const bindingInfo = createBindingInfo(placeholder);

    const notList = { not: 'array' };
    createListIndexes(null, [], notList, []);
    apply(bindingInfo, notList);

    expect(container.childNodes.length).toBe(1);
  });

  it('空のフラグメントでもエラーにならないこと', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createEmptyFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(1);

    setListIndexesByList(list, null);
  });

  it('リストに応じてコンテンツを生成すること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    apply(bindingInfo, list);

    // コメントノード + 2つのspan
    expect(container.childNodes.length).toBe(3);
    expect(container.childNodes[1].nodeName).toBe('SPAN');
    expect(container.childNodes[2].nodeName).toBe('SPAN');

    // 後片付け
    setListIndexesByList(list, null);
  });

  it('再適用時に以前のコンテンツをアンマウントすること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    apply(bindingInfo, list);
    expect(container.childNodes.length).toBe(3);

    // 次の更新は空配列
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList, listIndexes);
    apply(bindingInfo, emptyList);
    expect(container.childNodes.length).toBe(1);

    // 後片付け
    setListIndexesByList(list, null);
  });

  it('再適用時にプールされたコンテンツを再利用すること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfoWithBinding());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    apply(bindingInfo, list);
    const firstSpan = container.childNodes[1];
    const secondSpan = container.childNodes[2];

    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList, listIndexes);
    apply(bindingInfo, emptyList);
    expect(container.childNodes.length).toBe(1);

    const list2 = [3];
    const list2Indexes = createListIndexes(null, emptyList, list2, []);
    setListIndexesByList(list2, list2Indexes);
    apply(bindingInfo, list2);

    expect(container.childNodes.length).toBe(2);
    const reusedSpan = container.childNodes[1];
    expect(reusedSpan === firstSpan || reusedSpan === secondSpan).toBe(true);

    // 後片付け
    setListIndexesByList(list, null);
    setListIndexesByList(list2, null);
  });

  it('順序変更時に変更バインディングを再適用すること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    const firstSpan = container.childNodes[1];
    const secondSpan = container.childNodes[2];

    const reordered = [2, 1];
    const reorderedIndexes = createListIndexes(null, list, reordered, listIndexes);
    setListIndexesByList(reordered, reorderedIndexes);
    apply(bindingInfo, reordered);

    expect(container.childNodes[1]).toBe(secondSpan);
    expect(container.childNodes[2]).toBe(firstSpan);

    setListIndexesByList(list, null);
    setListIndexesByList(reordered, null);
  });

  it('変更時にbindingsが存在する場合はapplyChangeが実行されること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createEmptyFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    // 初回適用でcontentByListIndexをセット
    apply(bindingInfo, list);

    // 変更時のbindingsを設定するためのダミーcontentを登録
    const textNode = document.createTextNode('');
    const dummyBindingInfo: IBindingInfo = {
      ...createBindingInfo(textNode, { bindingType: 'text', propName: 'text', propSegments: [] }),
      node: textNode,
      replaceNode: textNode,
    } as IBindingInfo;

    const content1 = {
      firstNode: textNode,
      lastNode: textNode,
      mounted: true,
      mountAfter: () => {},
      unmount: () => {},
    } as any;

    __test_setContentByListIndex(listIndexes[0], content1);
    __test_setContentByListIndex(listIndexes[1], content1);
    setBindingsByContent(content1, [dummyBindingInfo]);

    // 順序変更でchangeIndexSetを発生させる
    const prevGetByAddress = state.$$getByAddress;
    state.$$getByAddress = () => 'x';
    const reordered = [2, 1];
    createListIndexes(null, list, reordered, listIndexes);
    apply(bindingInfo, reordered);

    // applyChangeが実行されてtextが更新されること
    expect(textNode.nodeValue).toBe('x');
    state.$$getByAddress = prevGetByAddress;

    setListIndexesByList(list, null);
  });

  it('同じリストを再適用しても要素が正しく保持されること', () => {
    // 同じリストを再適用するケース（changeIndexSet, addIndexSet, deleteIndexSet が全て空）
    // lastNode.nextSibling === content.firstNode となり、mountAfterがスキップされる
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(3);
    const firstSpan = container.childNodes[1];
    const secondSpan = container.childNodes[2];

    // 同じリストを再適用 (isSameList = trueのケース)
    const sameList = [1, 2];
    createListIndexes(null, list, sameList, listIndexes);
    apply(bindingInfo, sameList);

    // 要素が同じ位置に保持されていること
    expect(container.childNodes.length).toBe(3);
    expect(container.childNodes[1]).toBe(firstSpan);
    expect(container.childNodes[2]).toBe(secondSpan);

    setListIndexesByList(list, null);
  });

  it('要素追加時に既存の要素を維持すること', () => {
    // 既存要素が変更なしで保持されるケース
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(2);
    const firstSpan = container.childNodes[1];

    // 末尾に新要素を追加
    const extendedList = [1, 2];
    const extendedIndexes = createListIndexes(null, list, extendedList, listIndexes);
    setListIndexesByList(extendedList, extendedIndexes);
    apply(bindingInfo, extendedList);

    expect(container.childNodes.length).toBe(3);
    // 既存要素が同じ位置に保持
    expect(container.childNodes[1]).toBe(firstSpan);

    setListIndexesByList(list, null);
    setListIndexesByList(extendedList, null);
  });

  it('同じノードに複数のバインディングがある場合でもloopContextが正しく設定されること', () => {
    // 行72の else ブランチをカバー: nodeSet.has(bindingInfo.node) が true の場合
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfoWithMultipleBindings());
    const bindingInfo = createBindingInfo(placeholder);

    // 最初のリスト
    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(3);

    // 空にしてプールに追加
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList, listIndexes);
    apply(bindingInfo, emptyList);

    expect(container.childNodes.length).toBe(1);

    // 再度リストを設定（プールから再利用、複数バインディングのあるノードでnodeSet.has()がtrueになる）
    const list2 = [3];
    const list2Indexes = createListIndexes(null, emptyList, list2, []);
    setListIndexesByList(list2, list2Indexes);
    apply(bindingInfo, list2);

    expect(container.childNodes.length).toBe(2);

    setListIndexesByList(list, null);
    setListIndexesByList(list2, null);
  });

  it('削除対象のコンテンツがcontentByListIndexに存在しない場合でもエラーにならないこと', () => {
    // 行45のelseブランチをカバー: contentByListIndexにcontentが登録されていない場合
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    // 最初のリストを作成・適用
    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(3);

    // contentByListIndexから手動でcontentを削除して、
    // 削除処理時にcontentが見つからない状態を作る
    __test_setContentByListIndex(listIndexes[0], null);

    // 空リストに変更（削除処理が発生）
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList, listIndexes);
    // contentが見つからなくてもエラーにならないこと
    expect(() => apply(bindingInfo, emptyList)).not.toThrow();

    // 後片付け
    setListIndexesByList(list, null);
  });

  it('__test_setContentByListIndexでcontentを設定できること', () => {
    // テストヘルパーの content !== null ブランチをカバー
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    // ダミーのcontentを作成
    const dummyContent = {
      firstNode: document.createElement('div'),
      lastNode: document.createElement('div'),
      mounted: false,
      mountAfter: () => {},
      unmount: () => {},
    };

    // テストヘルパーでcontentを設定（else分岐をカバー）
    __test_setContentByListIndex(listIndexes[0], dummyContent);

    // 後片付け
    setListIndexesByList(list, null);
  });
});
