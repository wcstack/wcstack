import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyChangeToFor, __test_setContentByListIndex, __test_deleteLastNodeByNode, __test_deleteContentByNode } from '../src/apply/applyChangeToFor';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import { createListDiff } from '../src/list/createListDiff';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import { setStateElementByName } from '../src/stateElementByName';
import { getPathInfo } from '../src/address/PathInfo';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
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
import { setLastListValueByAbsoluteStateAddress, clearLastListValueByAbsoluteStateAddress } from '../src/list/lastListValueByAbsoluteStateAddress';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';

const uuid = 'test-uuid';

const createListIndexes = (
  parentListIndex,
  oldList,
  newList,
) => createListDiff(parentListIndex, oldList, newList).newIndexes;

function createBindingInfo(node: Node, overrides: Partial<IBindingInfo> = {}): IBindingInfo {
  const pathInfo = getPathInfo('items');
  return {
    propName: 'for',
    propSegments: [],
    propModifiers: [],
    statePathName: 'items',
    statePathInfo: pathInfo,
    stateAbsolutePathInfo: getAbsolutePathInfo('default', pathInfo),
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
    uuid
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: getFragmentNodeInfos(fragment)
  };
}

// 同じノ�Eドに褁E��のバインチE��ングを持つフラグメントを作�E
function createFragmentInfoWithMultipleBindings() {
  const fragment = document.createDocumentFragment();
  const span = document.createElement('span');
  // 同じノ�Eドに褁E��のバインチE��ングを設宁E
  span.setAttribute('data-wcs', 'textContent: items.*; title: items.*');
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
    setStateElementByName(document, 'default', stateElement);
    context = { stateName: 'default', rootNode: document, stateElement: stateElement as any, state, appliedBindingSet: new Set(), newListValueByAbsAddress: new Map() };
    return stateElement;
  }

  const apply = (bindingInfo: IBindingInfo, value: any) => {
    applyChangeToFor(bindingInfo, context, value);
    for (const [absAddress, newListValue] of context.newListValueByAbsAddress.entries()) {
      setLastListValueByAbsoluteStateAddress(absAddress, newListValue);
    }
    context.newListValueByAbsAddress.clear();
  };

  afterEach(() => {
    setFragmentInfoByUUID(uuid, document, null);
    setStateElementByName(document, 'default', null);
    // Clear cached lastListValue to prevent cross-test contamination
    const pathInfo = getPathInfo('items');
    const absPathInfo = getAbsolutePathInfo('default', pathInfo);
    const absAddress = createAbsoluteStateAddress(absPathInfo, null);
    clearLastListValueByAbsoluteStateAddress(absAddress);
  });

  it('fragmentInfoが存在しなぁE��合�Eエラーになること', () => {
    setupContext();

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);

    expect(() => apply(bindingInfo, list)).toThrow(/Fragment with UUID/);

    setListIndexesByList(list, null);
  });

  it('list diffが事前に存在しなくても�E琁E��きること', () => {
    setupContext();

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);
    setFragmentInfoByUUID(uuid, document, createFragmentInfo());

    const list = [1];
    expect(() => apply(bindingInfo, list)).not.toThrow();
  });

  it('配�E以外�E値は空配�Eとして扱われること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfoWithBinding());

    const bindingInfo = createBindingInfo(placeholder);

    const notList = { not: 'array' };
    createListIndexes(null, [], notList);
    apply(bindingInfo, notList);

    expect(container.childNodes.length).toBe(1);
  });

  it('空のフラグメントでもエラーにならなぁE��と', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createEmptyFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);

    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(1);

    setListIndexesByList(list, null);
  });

  it('リストに応じてコンチE��チE��生�Eすること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);

    apply(bindingInfo, list);

    // コメントノーチE+ 2つのspan
    expect(container.childNodes.length).toBe(3);
    expect(container.childNodes[1].nodeName).toBe('SPAN');
    expect(container.childNodes[2].nodeName).toBe('SPAN');

    // 後片付け
    setListIndexesByList(list, null);
  });

  it('再適用時に以前�EコンチE��チE��アンマウントすること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);

    apply(bindingInfo, list);
    expect(container.childNodes.length).toBe(3);

    // 次の更新は空配�E
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList);
    apply(bindingInfo, emptyList);
    expect(container.childNodes.length).toBe(1);

    // 後片付け
    setListIndexesByList(list, null);
  });

  it('再適用時にプ�EルされたコンチE��チE��再利用すること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    setFragmentInfoByUUID(uuid, document, createFragmentInfoWithBinding());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);

    apply(bindingInfo, list);
    const firstSpan = container.childNodes[1];
    const secondSpan = container.childNodes[2];

    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList);
    apply(bindingInfo, emptyList);
    expect(container.childNodes.length).toBe(1);

    const list2 = [3];
    const list2Indexes = createListIndexes(null, emptyList, list2);
    setListIndexesByList(list2, list2Indexes);
    apply(bindingInfo, list2);

    expect(container.childNodes.length).toBe(2);
    const reusedSpan = container.childNodes[1];
    expect(reusedSpan === firstSpan || reusedSpan === secondSpan).toBe(true);

    // 後片付け
    setListIndexesByList(list, null);
    setListIndexesByList(list2, null);
  });

  it('頁E��変更時に変更バインチE��ングを�E適用すること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    const firstSpan = container.childNodes[1];
    const secondSpan = container.childNodes[2];

    const reordered = [2, 1];
    const reorderedIndexes = createListIndexes(null, list, reordered);
    setListIndexesByList(reordered, reorderedIndexes);
    apply(bindingInfo, reordered);

    expect(container.childNodes[1]).toBe(secondSpan);
    expect(container.childNodes[2]).toBe(firstSpan);

    setListIndexesByList(list, null);
    setListIndexesByList(reordered, null);
  });

  it('変更時にbindingsが存在する場合�EapplyChangeが実行されること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    setFragmentInfoByUUID(uuid, document, createEmptyFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);

    // 初回適用でcontentByListIndexをセチE��
    apply(bindingInfo, list);

    // 変更時�Ebindingsを設定するため�Eダミ�Econtentを登録
    const textNode = document.createTextNode('');
    container.appendChild(textNode);
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

    __test_setContentByListIndex(placeholder, listIndexes[0], content1);
    __test_setContentByListIndex(placeholder, listIndexes[1], content1);
    setBindingsByContent(content1, [dummyBindingInfo]);
    setIndexBindingsByContent(content1, [dummyBindingInfo]);

    // 頁E��変更でchangeIndexSetを発生させる
    const prevGetByAddress = state.$$getByAddress;
    state.$$getByAddress = () => 'x';
    const reordered = [2, 1];
    createListIndexes(null, list, reordered);
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

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(3);
    const firstSpan = container.childNodes[1];
    const secondSpan = container.childNodes[2];

    // 同じリストを再適用 (isSameList = trueのケース)
    const sameList = [1, 2];
    createListIndexes(null, list, sameList);
    apply(bindingInfo, sameList);

    // 要素が同じ位置に保持されてぁE��こと
    expect(container.childNodes.length).toBe(3);
    expect(container.childNodes[1]).toBe(firstSpan);
    expect(container.childNodes[2]).toBe(secondSpan);

    setListIndexesByList(list, null);
  });

  it('要素追加時に既存�E要素を維持すること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(2);
    const firstSpan = container.childNodes[1];

    // 末尾に新要素を追加
    const extendedList = [1, 2];
    const extendedIndexes = createListIndexes(null, list, extendedList);
    setListIndexesByList(extendedList, extendedIndexes);
    apply(bindingInfo, extendedList);

    expect(container.childNodes.length).toBe(3);
    // 既存要素が同じ位置に保持
    expect(container.childNodes[1]).toBe(firstSpan);

    setListIndexesByList(list, null);
    setListIndexesByList(extendedList, null);
  });

  it('同じノ�Eドに褁E��のバインチE��ングがある場合でもloopContextが正しく設定されること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    setFragmentInfoByUUID(uuid, document, createFragmentInfoWithMultipleBindings());
    const bindingInfo = createBindingInfo(placeholder);

    // 最初�EリスチE
    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(3);

    // 空にしてプ�Eルに追加
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList);
    apply(bindingInfo, emptyList);

    expect(container.childNodes.length).toBe(1);

    // 再度リストを設定（�Eールから再利用、褁E��バインチE��ングのあるノ�EドでnodeSet.has()がtrueになる！E
    const list2 = [3];
    const list2Indexes = createListIndexes(null, emptyList, list2);
    setListIndexesByList(list2, list2Indexes);
    apply(bindingInfo, list2);

    expect(container.childNodes.length).toBe(2);

    setListIndexesByList(list, null);
    setListIndexesByList(list2, null);
  });

  it('削除対象のコンチE��チE��contentByListIndexに存在しなぁE��合でもエラーにならなぁE��と', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    // 最初�Eリストを作�E・適用
    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(3);

    // contentByListIndexから手動でcontentを削除して、E
    // 削除処琁E��にcontentが見つからなぁE��態を作る
    __test_setContentByListIndex(placeholder, listIndexes[0], null);

    // 空リストに変更�E�削除処琁E��発生！E
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList);
    // contentが見つからなくてもエラーにならなぁE��と
    expect(() => apply(bindingInfo, emptyList)).not.toThrow();

    // 後片付け
    setListIndexesByList(list, null);
  });

  it('全件追加時にバッチ�E琁E��一括挿入されること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2, 3];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);

    // isConnected=true かつ全件追加 ↁEバッチパス
    apply(bindingInfo, list);

    // コメントノーチE+ 3つのspan
    expect(container.childNodes.length).toBe(4);
    expect(container.childNodes[1].nodeName).toBe('SPAN');
    expect(container.childNodes[2].nodeName).toBe('SPAN');
    expect(container.childNodes[3].nodeName).toBe('SPAN');

    // 後片付け
    document.body.removeChild(container);
    setListIndexesByList(list, null);
  });

  it('バッチ挿入された各コンチE��チE�EfirstNode/lastNodeが正しいこと', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);

    apply(bindingInfo, list);

    // バッチ挿入後もDOMの頁E��が正しいこと
    expect(container.childNodes.length).toBe(3);
    const span1 = container.childNodes[1];
    const span2 = container.childNodes[2];
    expect(span1.nodeName).toBe('SPAN');
    expect(span2.nodeName).toBe('SPAN');
    // 頁E��が placeholder -> span1 -> span2 であること
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

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);

    apply(bindingInfo, list);
    expect(container.childNodes.length).toBe(3);

    // 空配�Eで再適用 ↁEアンマウンチE
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList);
    apply(bindingInfo, emptyList);
    expect(container.childNodes.length).toBe(1);

    document.body.removeChild(container);
    setListIndexesByList(list, null);
  });

  it('isConnected=falseの場合�Eバッチ�E琁E��れなぁE��と', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    // document.bodyに追加しなぁEↁEisConnected=false

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);

    // 非バチE��パスでも正しく動作すること
    apply(bindingInfo, list);

    expect(container.childNodes.length).toBe(3);
    expect(container.childNodes[1].nodeName).toBe('SPAN');
    expect(container.childNodes[2].nodeName).toBe('SPAN');

    setListIndexesByList(list, null);
  });

  it('追加と既存が混在する場合�Eバッチ�E琁E��れなぁE��と', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    // 初回適用
    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);
    expect(container.childNodes.length).toBe(3);

    const firstSpan = container.childNodes[1];

    // 既存要素�E�新規追加�E�混在ケース ↁE非バチE��パス�E�E
    const extendedList = [1, 2, 3];
    const extendedIndexes = createListIndexes(null, list, extendedList);
    setListIndexesByList(extendedList, extendedIndexes);
    apply(bindingInfo, extendedList);

    expect(container.childNodes.length).toBe(4);
    // 既存要素が保持されてぁE��こと
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

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2, 3];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);
    expect(container.childNodes.length).toBe(4);

    // 全件削除 ↁEtextContent='' による一括クリア
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList);
    apply(bindingInfo, emptyList);

    // placeholderのみ残ること
    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild).toBe(placeholder);

    setListIndexesByList(list, null);
  });

  it('全件削除でisOnlyNode=trueの場合にキャチE��ュが使われること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    // 1回目: apply ↁE全削除�E�キャチE��ュ作�E�E�E
    const list1 = [1, 2];
    const list1Indexes = createListIndexes(null, [], list1);
    setListIndexesByList(list1, list1Indexes);
    apply(bindingInfo, list1);

    const empty1: any[] = [];
    createListIndexes(null, list1, empty1);
    apply(bindingInfo, empty1);
    expect(container.childNodes.length).toBe(1);

    // 2回目: apply ↁE全削除�E�キャチE��ュヒット！E
    const list2 = [3, 4];
    const list2Indexes = createListIndexes(null, empty1, list2);
    setListIndexesByList(list2, list2Indexes);
    apply(bindingInfo, list2);

    const empty2: any[] = [];
    createListIndexes(null, list2, empty2);
    apply(bindingInfo, empty2);
    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild).toBe(placeholder);

    setListIndexesByList(list1, null);
    setListIndexesByList(list2, null);
  });

  it('全件削除で前方に要素がある場合�EisOnlyNode=falseとなること', () => {
    setupContext();

    const container = document.createElement('div');
    const sibling = document.createElement('div');
    sibling.id = 'sibling';
    container.appendChild(sibling);
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);
    expect(container.childNodes.length).toBe(4);

    // 全件削除 ↁE前方にsibling要素あり ↁEtextContentクリアされなぁE
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList);
    apply(bindingInfo, emptyList);

    // sibling + placeholder が残ること
    expect(container.childNodes.length).toBe(2);
    expect(container.childNodes[0]).toBe(sibling);
    expect(container.childNodes[1]).toBe(placeholder);

    setListIndexesByList(list, null);
  });

  it('全件削除で後方に要素がある場合�EisOnlyNode=falseとなること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    const tail = document.createElement('div');
    tail.id = 'tail';
    container.appendChild(tail);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    // 全件削除 ↁE後方にtail要素あり ↁEtextContentクリアされなぁE
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList);
    apply(bindingInfo, emptyList);

    // placeholder + tail が残ること
    expect(container.childNodes.length).toBe(2);
    expect(container.childNodes[0]).toBe(placeholder);
    expect(container.childNodes[1]).toBe(tail);

    setListIndexesByList(list, null);
  });

  it('全件削除で前方に非空白チE��ストがある場合�EisOnlyNode=falseとなること', () => {
    setupContext();

    const container = document.createElement('div');
    container.appendChild(document.createTextNode('hello'));
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList);
    apply(bindingInfo, emptyList);

    // チE��ストノーチE+ placeholder が残ること
    expect(container.childNodes.length).toBe(2);
    expect(container.childNodes[0].textContent).toBe('hello');

    setListIndexesByList(list, null);
  });

  it('全件削除で後方に非空白チE��ストがある場合�EisOnlyNode=falseとなること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    container.appendChild(document.createTextNode('world'));

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList);
    apply(bindingInfo, emptyList);

    // placeholder + チE��ストノーチEが残ること
    expect(container.childNodes.length).toBe(2);
    expect(container.childNodes[1].textContent).toBe('world');

    setListIndexesByList(list, null);
  });

  it('全件削除でlastNodeByNodeが未設定�E場合�EbindingInfo.nodeがフォールバックされること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);
    expect(container.childNodes.length).toBe(2);

    // lastNodeByNodeを削除してフォールバックを発生させる
    __test_deleteLastNodeByNode(placeholder);

    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList);
    apply(bindingInfo, emptyList);

    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild).toBe(placeholder);

    setListIndexesByList(list, null);
  });

  it('全件削除で空白チE��スト�Eみの允E���EisOnlyNode=trueとなること', () => {
    setupContext();

    const container = document.createElement('div');
    container.appendChild(document.createTextNode('\n  '));
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);
    container.appendChild(document.createTextNode('  \t'));

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    // 全件削除 ↁE空白チE��スト�EみなのでisOnlyNode=true ↁEtextContentクリア
    const emptyList: any[] = [];
    createListIndexes(null, list, emptyList);
    apply(bindingInfo, emptyList);

    // textContent=''でクリア後、placeholderのみ
    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild).toBe(placeholder);

    setListIndexesByList(list, null);
  });

  it('既存インチE��クスのcontentが見つからなぁE��合�Eエラーになること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    // 初回適用
    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    // contentByListIndexから手動でcontentを削除
    __test_setContentByListIndex(placeholder, listIndexes[0], null);
    __test_setContentByListIndex(placeholder, listIndexes[1], null);

    // 同じリストを再適用�E�既存インチE��クスだがcontentが無ぁE��E
    const sameList = [1, 2];
    createListIndexes(null, list, sameList);
    expect(() => apply(bindingInfo, sameList)).toThrow(/Content not found for ListIndex/);

    setListIndexesByList(list, null);
  });

  it('__test_setContentByListIndexでcontentを設定できること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list);
    setListIndexesByList(list, listIndexes);
    apply(bindingInfo, list);

    // ダミ�Eのcontentを作�E
    const dummyContent = {
      firstNode: document.createElement('div'),
      lastNode: document.createElement('div'),
      mounted: false,
      mountAfter: () => {},
      unmount: () => {},
    };

    // チE��ト�Eルパ�Eでcontentを設定！Else刁E��をカバ�E�E�E
    __test_setContentByListIndex(placeholder, listIndexes[0], dummyContent);

    // 後片付け
    setListIndexesByList(list, null);
  });

  it('contentByListIndexが未登録のノードにnullをsetしても安全なこと', () => {
    // setContent(node, index, null) で contentByListIndex が存在しない場合の早期リターンをカバー
    const freshNode = document.createComment('fresh');
    const list = [1];
    const listIndexes = createListIndexes(null, [], list);
    // freshNode は contentByListIndexByNode に登録されていない
    __test_setContentByListIndex(freshNode, listIndexes[0], null);
    // エラーなく完了すること
    setListIndexesByList(list, null);
  });

  it('contentByListIndexが未登録のノードでdeleteが発生した場合にスキップされること', () => {
    setupContext();

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    // list1を適用
    const list1 = [1];
    apply(bindingInfo, list1);
    expect(container.childNodes.length).toBe(2); // comment + 1 span

    // contentByListIndexByNode から placeholder のエントリを完全削除
    // getContent が contentByListIndex === undefined の分岐（line 73）を通るようにする
    __test_deleteContentByNode(placeholder);
    // lastNodeByNode もクリアしておく
    __test_deleteLastNodeByNode(placeholder);

    // 空リストに変更（list1の要素を削除）→ getContent(node, deleteIndex)がnullを返す
    apply(bindingInfo, []);
    // deleteされるはずの要素のcontentがnullでもエラーにならない
    expect(container.childNodes.length).toBe(2); // comment + 残った span (unmountされない)
  });

  it('add時にcreateLoopContextがコールバックを実行しなかった場合�Eエラーになること', () => {
    const stateElement = createMockStateElement();
    // コールバックを実行しなぁEoopContextStackをモチE��
    stateElement.loopContextStack = {
      createLoopContext: (_stateAddress: any, _callback: any) => {
        // コールバックを呼ばなぁEↁEcontent ぁEundefined のまま
      }
    } as any;
    setStateElementByName(document, 'default', stateElement);
    context = { stateName: 'default', rootNode: document, stateElement: stateElement as any, state, appliedBindingSet: new Set(), newListValueByAbsAddress: new Map() };

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, document, createFragmentInfo());
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    createListDiff(null, [], list);

    expect(() => apply(bindingInfo, list)).toThrow(/Content not found for ListIndex/);

    setListIndexesByList(list, null);
  });
});
