import { describe, it, expect, afterEach } from 'vitest';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { createListDiff } from '../src/list/createListDiff';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import { setStateElementByName } from '../src/stateElementByName';
import { getPathInfo } from '../src/address/PathInfo';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { createLoopContextStack } from '../src/list/loopContext';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';
import type { IStateAddress } from '../src/address/types';
import type { ICacheEntry } from '../src/cache/types';
import type { IVersionInfo } from '../src/version/types';
import type { IApplyContext } from '../src/apply/types';

const outerUUID = 'nested-outer-uuid';
const innerUUID = 'nested-inner-uuid';

function createMockStateElement(): IStateElement {
  let version = 0;
  const stateProxy: any = {
    $$setLoopContext: (_loopContext: any, callback: () => any) => callback(),
    $$getByAddress: () => undefined,
  };
  return {
    name: 'default',
    initializePromise: Promise.resolve(),
    listPaths: new Set<string>(),
    elementPaths: new Set<string>(),
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    loopContextStack: createLoopContextStack(),
    cache: new Map<IStateAddress, ICacheEntry>(),
    mightChangeByPath: new Map<string, IVersionInfo>(),
    dynamicDependency: new Map<string, string[]>(),
    staticDependency: new Map<string, string[]>(),
    get version() { return version; },
    setPathInfo() {},
    addStaticDependency() {},
    addDynamicDependency() {},
    createState(_mutability, callback) { return callback(stateProxy); },
    async createStateAsync(_mutability, callback) { return callback(stateProxy); },
    nextVersion() { version += 1; return version; },
  };
}

function createOuterBindingInfo(node: Node): IBindingInfo {
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
    uuid: outerUUID,
    node,
    replaceNode: node,
  } as IBindingInfo;
}

// 内側フラグメント: <span>child</span>（バインディングなし）
function createInnerFragmentInfo() {
  const fragment = document.createDocumentFragment();
  const span = document.createElement('span');
  span.textContent = 'child';
  fragment.appendChild(span);

  const pathInfo = getPathInfo('items.*.children');
  const parseBindTextResult: ParseBindTextResult = {
    propName: 'for',
    propSegments: [],
    propModifiers: [],
    statePathName: 'items.*.children',
    statePathInfo: pathInfo,
    stateAbsolutePathInfo: getAbsolutePathInfo('default', pathInfo),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'for',
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: [],
  };
}

// 外側フラグメント: 内側forコメントがフラグメント直下（ラップ要素なし）
function createOuterFragmentInfoUnwrapped() {
  const fragment = document.createDocumentFragment();
  const innerComment = document.createComment(`@@wcs-for:${innerUUID}`);
  fragment.appendChild(innerComment);

  const pathInfo = getPathInfo('items');
  const parseBindTextResult: ParseBindTextResult = {
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
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: getFragmentNodeInfos(fragment),
  };
}

// 外側フラグメント: 内側forコメントがdiv要素内
function createOuterFragmentInfoWrapped() {
  const fragment = document.createDocumentFragment();
  const div = document.createElement('div');
  div.className = 'outer-item';
  const innerComment = document.createComment(`@@wcs-for:${innerUUID}`);
  div.appendChild(innerComment);
  fragment.appendChild(div);

  const pathInfo = getPathInfo('items');
  const parseBindTextResult: ParseBindTextResult = {
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
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: getFragmentNodeInfos(fragment),
  };
}

describe('applyChangeToFor ネストされたforループの回帰テスト', () => {
  const children1 = ['a', 'b'];
  const children2 = ['c'];

  function setup(createOuterFn: () => ReturnType<typeof createOuterFragmentInfoUnwrapped>) {
    const stateElement = createMockStateElement();
    setStateElementByName(document, 'default', stateElement);
    // 内側フラグメントを先に登録（外側のnodeInfos生成時にUUID解決が必要）
    setFragmentInfoByUUID(innerUUID, document, createInnerFragmentInfo());
    setFragmentInfoByUUID(outerUUID, document, createOuterFn());

    const state = {
      $$getByAddress: (stateAddress: any) => {
        if (stateAddress.pathInfo.path === 'items.*.children') {
          const idx = stateAddress.listIndex?.index;
          if (idx === 0) return children1;
          if (idx === 1) return children2;
        }
        return undefined;
      }
    } as any;

    const context: IApplyContext = {
      stateName: 'default',
      rootNode: document,
      stateElement: stateElement as any,
      state,
      appliedBindingSet: new Set(),
    };

    return { stateElement, state, context };
  }

  afterEach(() => {
    setFragmentInfoByUUID(outerUUID, document, null);
    setFragmentInfoByUUID(innerUUID, document, null);
    setStateElementByName(document, 'default', null);
  });

  it('ネストされたforループ（ラップなし）で子コンテンツがDOMツリーに正しく配置されること', () => {
    const { context } = setup(createOuterFragmentInfoUnwrapped);

    const container = document.createElement('div');
    const outerPlaceholder = document.createComment('for');
    container.appendChild(outerPlaceholder);
    document.body.appendChild(container);

    const outerData = [{}, {}];
    createListDiff(null, [], outerData);

    const bindingInfo = createOuterBindingInfo(outerPlaceholder);
    applyChangeToFor(bindingInfo, context, outerData);

    // 期待するDOM構造:
    // container
    //   <!--for-->                    (外側プレースホルダー)
    //   <!--@@wcs-for:innerUUID-->    (外側アイテム0の内側プレースホルダー)
    //   <span>child</span>           (子 'a')
    //   <span>child</span>           (子 'b')
    //   <!--@@wcs-for:innerUUID-->    (外側アイテム1の内側プレースホルダー)
    //   <span>child</span>           (子 'c')

    // 内側コンテンツがDOMに存在すること
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(3);

    // 外側placeholder + 2つの内側コメント + 3つのspan = 6ノード
    expect(container.childNodes.length).toBe(6);

    setListIndexesByList(outerData, null);
    setListIndexesByList(children1, null);
    setListIndexesByList(children2, null);
  });

  it('ネストされたforループ（div要素でラップ）で子コンテンツがDOMツリーに正しく配置されること', () => {
    const { context } = setup(createOuterFragmentInfoWrapped);

    const container = document.createElement('div');
    const outerPlaceholder = document.createComment('for');
    container.appendChild(outerPlaceholder);
    document.body.appendChild(container);

    const outerData = [{}, {}];
    createListDiff(null, [], outerData);

    const bindingInfo = createOuterBindingInfo(outerPlaceholder);
    applyChangeToFor(bindingInfo, context, outerData);

    // 期待するDOM構造:
    // container
    //   <!--for-->              (外側プレースホルダー)
    //   <div class="outer-item">
    //     <!--@@wcs-for:...-->  (内側プレースホルダー)
    //     <span>child</span>   (子 'a')
    //     <span>child</span>   (子 'b')
    //   </div>
    //   <div class="outer-item">
    //     <!--@@wcs-for:...-->  (内側プレースホルダー)
    //     <span>child</span>   (子 'c')
    //   </div>

    // 外側placeholder + 2つのdiv = コンテナに3ノード
    expect(container.childNodes.length).toBe(3);

    const divs = container.querySelectorAll('.outer-item');
    expect(divs.length).toBe(2);

    // 1つ目のdiv: 内側コメント + 2つのspan
    expect(divs[0].childNodes.length).toBe(3);
    expect(divs[0].querySelectorAll('span').length).toBe(2);

    // 2つ目のdiv: 内側コメント + 1つのspan
    expect(divs[1].childNodes.length).toBe(2);
    expect(divs[1].querySelectorAll('span').length).toBe(1);

    setListIndexesByList(outerData, null);
    setListIndexesByList(children1, null);
    setListIndexesByList(children2, null);
  });

  it('ネストされたforループでバッチ処理（isConnected=true）でも正しく配置されること', () => {
    const { context } = setup(createOuterFragmentInfoUnwrapped);

    const container = document.createElement('div');
    const outerPlaceholder = document.createComment('for');
    container.appendChild(outerPlaceholder);
    document.body.appendChild(container);
    document.body.appendChild(container);

    const outerData = [{}, {}];
    createListDiff(null, [], outerData);

    const bindingInfo = createOuterBindingInfo(outerPlaceholder);
    applyChangeToFor(bindingInfo, context, outerData);

    // バッチ挿入パスでも内側コンテンツがDOMに存在すること
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(3);
    expect(container.childNodes.length).toBe(6);

    document.body.removeChild(container);
    setListIndexesByList(outerData, null);
    setListIndexesByList(children1, null);
    setListIndexesByList(children2, null);
  });

  it('ネストされたforループ（ラップあり）で外側アイテム追加時に内側コンテンツも正しく追加されること', () => {
    const { context } = setup(createOuterFragmentInfoWrapped);

    const container = document.createElement('div');
    const outerPlaceholder = document.createComment('for');
    container.appendChild(outerPlaceholder);
    document.body.appendChild(container);

    // 初回: 1アイテム（children1 = ['a', 'b']）
    const singleItemChildren = ['a', 'b'];
    context.state.$$getByAddress = (stateAddress: any) => {
      if (stateAddress.pathInfo.path === 'items.*.children') {
        const idx = stateAddress.listIndex?.index;
        if (idx === 0) return singleItemChildren;
        if (idx === 1) return ['c', 'd'];
      }
      return undefined;
    };

    const outerData1 = [{}];
    createListDiff(null, [], outerData1);
    const bindingInfo = createOuterBindingInfo(outerPlaceholder);
    applyChangeToFor(bindingInfo, context, outerData1);

    expect(container.querySelectorAll('.outer-item').length).toBe(1);
    expect(container.querySelectorAll('span').length).toBe(2);

    // 追加: 2アイテム目を追加（既存 + 新規の混在ケース）
    context.appliedBindingSet = new Set();
    const outerData2 = [{}, {}];
    createListDiff(null, outerData1, outerData2);
    applyChangeToFor(bindingInfo, context, outerData2);

    // 外側placeholder + 2つのdiv
    expect(container.childNodes.length).toBe(3);
    expect(container.querySelectorAll('.outer-item').length).toBe(2);

    // 1つ目のdiv: 内側コメント + 2 span ('a', 'b')
    const divs = container.querySelectorAll('.outer-item');
    expect(divs[0].querySelectorAll('span').length).toBe(2);

    // 2つ目のdiv: 内側コメント + 2 span ('c', 'd')
    expect(divs[1].querySelectorAll('span').length).toBe(2);

    // 全体で4つのspan
    expect(container.querySelectorAll('span').length).toBe(4);

    setListIndexesByList(outerData1, null);
    setListIndexesByList(outerData2, null);
    setListIndexesByList(singleItemChildren, null);
  });

  it('外側アイテムが1つの場合でもネストされた子コンテンツが正しく配置されること', () => {
    const { context } = setup(createOuterFragmentInfoUnwrapped);

    const container = document.createElement('div');
    const outerPlaceholder = document.createComment('for');
    container.appendChild(outerPlaceholder);
    document.body.appendChild(container);

    const singleChildren = ['x'];
    context.state.$$getByAddress = (stateAddress: any) => {
      if (stateAddress.pathInfo.path === 'items.*.children') {
        return singleChildren;
      }
      return undefined;
    };

    const outerData = [{}];
    createListDiff(null, [], outerData);

    const bindingInfo = createOuterBindingInfo(outerPlaceholder);
    applyChangeToFor(bindingInfo, context, outerData);

    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(1);
    // 外側placeholder + 内側コメント + 1 span = 3ノード
    expect(container.childNodes.length).toBe(3);

    setListIndexesByList(outerData, null);
    setListIndexesByList(singleChildren, null);
  });
});
