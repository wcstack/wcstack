import { describe, it, expect, afterEach } from 'vitest';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import { createListIndexes } from '../src/list/createListIndexes';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import { setStateElementByName } from '../src/stateElementByName';
import { getPathInfo } from '../src/address/PathInfo';
import { createLoopContextStack } from '../src/list/loopContext';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';
import type { IStateAddress } from '../src/address/types';
import type { ICacheEntry } from '../src/cache/types';
import type { IVersionInfo } from '../src/version/types';

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
    createState(callback) {
      return callback(stateProxy);
    },
    async createStateAsync(callback) {
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
    filterTexts: [],
    bindingType: 'for',
    uuid
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: []
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
    filterTexts: [],
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
  it('fragmentInfoが存在しない場合はエラーになること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);

    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    expect(() => applyChangeToFor(bindingInfo, list)).toThrow(/Fragment with UUID/);

    setListIndexesByList(list, null);
  });

  it('stateElementが存在しない場合はエラーになること', () => {
    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);

    expect(() => applyChangeToFor(bindingInfo, [1])).toThrow(/State element with name/);
  });

  it('listPathInfoがない場合はエラーになること', () => {
    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder, { statePathInfo: null as any });

    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    expect(() => applyChangeToFor(bindingInfo, [])).toThrow(/List path info not found/);
  });

  it('配列以外の値は空配列として扱われること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());

    const bindingInfo = createBindingInfo(placeholder);

    applyChangeToFor(bindingInfo, { not: 'array' });

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

    applyChangeToFor(bindingInfo, list);

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

    applyChangeToFor(bindingInfo, list);

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

    applyChangeToFor(bindingInfo, list);
    expect(container.childNodes.length).toBe(3);

    // 次の更新は空配列
    applyChangeToFor(bindingInfo, []);
    expect(container.childNodes.length).toBe(1);

    // 後片付け
    setListIndexesByList(list, null);
  });
});
