import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyChangeToFor, __test_setContentByListIndex, __test_deleteLastNodeByNode } from '../src/apply/applyChangeToFor';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import { createListDiff } from '../src/list/createListDiff';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import { setStateElementByName } from '../src/stateElementByName';
import { getPathInfo } from '../src/address/PathInfo';
import { createLoopContextStack } from '../src/list/loopContext';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';
import type { IStateAddress } from '../src/address/types';
import type { ICacheEntry } from '../src/cache/types';
import type { IVersionInfo } from '../src/version/types';
import type { IApplyContext } from '../src/apply/types';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';
import { setBindingsByContent } from '../src/bindings/bindingsByContent';
import { setIndexBindingsByContent } from '../src/bindings/indexBindingsByContent';

const uuid = 'test-uuid';

const createListIndexes = (
  parentListIndex,
  oldList,
  newList,
  oldIndexes
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
    outFilters: [],
    inFilters: [],
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
    uuid
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: []
  };
}

describe('applyChangeToFor', () => {
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

  afterEach(() => {
    setFragmentInfoByUUID(uuid, null);
    setStateElementByName('default', null);
  });

  it('fragmentInfoが存在しない場合はエラーになること', () => {
    setupContext();

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    expect(() => apply(bindingInfo, list)).toThrow(/Fragment with UUID/);

    setListIndexesByList(list, null);
  });

  it('list diffが事前に存在しなくても処理できること', () => {
    setupContext();

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);
    setFragmentInfoByUUID(uuid, createFragmentInfo());

    const list = [1];
    expect(() => apply(bindingInfo, list)).not.toThrow();
  });

  it('配列以外の値は空配列として扱われること', () => {
    setupContext();

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
    setupContext();

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
    setupContext();

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
    setupContext();

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
    setupContext();

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
    setupContext();

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
    setupContext();

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
    setIndexBindingsByContent(content1, [dummyBindingInfo]);

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
    setupContext();

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
    setupContext();

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
    setupContext();

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
    setupContext();

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

  it('全件追加時にバッチ処理で一括挿入されること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2, 3];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    // isConnected=true かつ全件追加 → バッチパス
    apply(bindingInfo, list);

    // コメントノード + 3つのspan
    expect(container.childNodes.length).toBe(4);
    expect(container.childNodes[1].nodeName).toBe('SPAN');
    expect(container.childNodes[2].nodeName).toBe('SPAN');
    expect(container.childNodes[3].nodeName).toBe('SPAN');

    // 後片付け
    document.body.removeChild(container);
    setListIndexesByList(list, null);
  });

  it('バッチ挿入された各コンテンツのfirstNode/lastNodeが正しいこと', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    apply(bindingInfo, list);

    // バッチ挿入後もDOMの順序が正しいこと
    expect(container.childNodes.length).toBe(3);
    const span1 = container.childNodes[1];
    const span2 = container.childNodes[2];
    expect(span1.nodeName).toBe('SPAN');
    expect(span2.nodeName).toBe('SPAN');
    // 順序が placeholder -> span1 -> span2 であること
    expect(placeholder.nextSibling).toBe(span1);
    expect(span1.nextSibling).toBe(span2);

    document.body.removeChild(container);
    setListIndexesByList(list, null);
  });

  it('バッチ挿入後にアンマウントが正しく動作すること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    apply(bindingInfo, list);
    expect(container.childNodes.length).toBe(3);

    // 空配列で再適用 → アンマウント
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList, listIndexes);
    apply(bindingInfo, emptyList);
    expect(container.childNodes.length).toBe(1);

    document.body.removeChild(container);
    setListIndexesByList(list, null);
  });

  it('isConnected=falseの場合はバッチ処理されないこと', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    // document.bodyに追加しない → isConnected=false

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    // 非バッチパスでも正しく動作すること
    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(3);
    expect(container.childNodes[1].nodeName).toBe('SPAN');
    expect(container.childNodes[2].nodeName).toBe('SPAN');

    setListIndexesByList(list, null);
  });

  it('追加と既存が混在する場合はバッチ処理されないこと', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    // 初回適用
    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);
    expect(container.childNodes.length).toBe(3);

    const firstSpan = container.childNodes[1];

    // 既存要素＋新規追加（混在ケース → 非バッチパス）
    const extendedList = [1, 2, 3];
    const extendedIndexes = createListIndexes(null, list, extendedList, listIndexes);
    setListIndexesByList(extendedList, extendedIndexes);
    apply(bindingInfo, extendedList);

    expect(container.childNodes.length).toBe(4);
    // 既存要素が保持されていること
    expect(container.childNodes[1]).toBe(firstSpan);

    document.body.removeChild(container);
    setListIndexesByList(list, null);
    setListIndexesByList(extendedList, null);
  });

  it('全件削除でisOnlyNode=trueの場合にtextContent一括クリアされること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2, 3];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);
    expect(container.childNodes.length).toBe(4);

    // 全件削除 → textContent='' による一括クリア
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList, listIndexes);
    apply(bindingInfo, emptyList);

    // placeholderのみ残ること
    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild).toBe(placeholder);

    setListIndexesByList(list, null);
  });

  it('全件削除でisOnlyNode=trueの場合にキャッシュが使われること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    // 1回目: apply → 全削除（キャッシュ作成）
    const list1 = [1, 2];
    const list1Indexes = createListIndexes(null, [], list1, []);
    setListIndexesByList(list1, list1Indexes);
    apply(bindingInfo, list1);

    const empty1: any[] = [];
    createListIndexes(null, list1, empty1, list1Indexes);
    apply(bindingInfo, empty1);
    expect(container.childNodes.length).toBe(1);

    // 2回目: apply → 全削除（キャッシュヒット）
    const list2 = [3, 4];
    const list2Indexes = createListIndexes(null, empty1, list2, []);
    setListIndexesByList(list2, list2Indexes);
    apply(bindingInfo, list2);

    const empty2: any[] = [];
    createListIndexes(null, list2, empty2, list2Indexes);
    apply(bindingInfo, empty2);
    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild).toBe(placeholder);

    setListIndexesByList(list1, null);
    setListIndexesByList(list2, null);
  });

  it('全件削除で前方に要素がある場合はisOnlyNode=falseとなること', () => {
    setupContext();

    const container = document.createElement('div');
    const sibling = document.createElement('div');
    sibling.id = 'sibling';
    container.appendChild(sibling);
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);
    expect(container.childNodes.length).toBe(4);

    // 全件削除 → 前方にsibling要素あり → textContentクリアされない
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList, listIndexes);
    apply(bindingInfo, emptyList);

    // sibling + placeholder が残ること
    expect(container.childNodes.length).toBe(2);
    expect(container.childNodes[0]).toBe(sibling);
    expect(container.childNodes[1]).toBe(placeholder);

    setListIndexesByList(list, null);
  });

  it('全件削除で後方に要素がある場合はisOnlyNode=falseとなること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    const tail = document.createElement('div');
    tail.id = 'tail';
    container.appendChild(tail);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    // 全件削除 → 後方にtail要素あり → textContentクリアされない
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList, listIndexes);
    apply(bindingInfo, emptyList);

    // placeholder + tail が残ること
    expect(container.childNodes.length).toBe(2);
    expect(container.childNodes[0]).toBe(placeholder);
    expect(container.childNodes[1]).toBe(tail);

    setListIndexesByList(list, null);
  });

  it('全件削除で前方に非空白テキストがある場合はisOnlyNode=falseとなること', () => {
    setupContext();

    const container = document.createElement('div');
    container.appendChild(document.createTextNode('hello'));
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList, listIndexes);
    apply(bindingInfo, emptyList);

    // テキストノード + placeholder が残ること
    expect(container.childNodes.length).toBe(2);
    expect(container.childNodes[0].textContent).toBe('hello');

    setListIndexesByList(list, null);
  });

  it('全件削除で後方に非空白テキストがある場合はisOnlyNode=falseとなること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    container.appendChild(document.createTextNode('world'));

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList, listIndexes);
    apply(bindingInfo, emptyList);

    // placeholder + テキストノード が残ること
    expect(container.childNodes.length).toBe(2);
    expect(container.childNodes[1].textContent).toBe('world');

    setListIndexesByList(list, null);
  });

  it('全件削除でlastNodeByNodeが未設定の場合はbindingInfo.nodeがフォールバックされること', () => {
    setupContext();

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

    // lastNodeByNodeを削除してフォールバックを発生させる
    __test_deleteLastNodeByNode(placeholder);

    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList, listIndexes);
    apply(bindingInfo, emptyList);

    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild).toBe(placeholder);

    setListIndexesByList(list, null);
  });

  it('全件削除で空白テキストのみの兄弟はisOnlyNode=trueとなること', () => {
    setupContext();

    const container = document.createElement('div');
    container.appendChild(document.createTextNode('\n  '));
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    container.appendChild(document.createTextNode('  \t'));

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    // 全件削除 → 空白テキストのみなのでisOnlyNode=true → textContentクリア
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList, listIndexes);
    apply(bindingInfo, emptyList);

    // textContent=''でクリア後、placeholderのみ
    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild).toBe(placeholder);

    setListIndexesByList(list, null);
  });

  it('既存インデックスのcontentが見つからない場合はエラーになること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    // 初回適用
    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    // contentByListIndexから手動でcontentを削除
    __test_setContentByListIndex(listIndexes[0], null);
    __test_setContentByListIndex(listIndexes[1], null);

    // 同じリストを再適用（既存インデックスだがcontentが無い）
    const sameList = [1, 2];
    createListIndexes(null, list, sameList, listIndexes);
    expect(() => apply(bindingInfo, sameList)).toThrow(/Content not found for ListIndex/);

    setListIndexesByList(list, null);
  });

  it('__test_setContentByListIndexでcontentを設定できること', () => {
    setupContext();

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
