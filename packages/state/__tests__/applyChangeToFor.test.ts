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
    $$setLoopContext: async (_loopContext: any, callback: () => any) => callback(),
  };

  return {
    name: 'default',
    bindingInfosByAddress,
    initializePromise: Promise.resolve(),
    listPaths,
    elementPaths,
    getterPaths,
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
    async createState(callback) {
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
    expect(() => applyChangeToFor(placeholder, uuid, [])).toThrow(/Fragment with UUID/);
  });

  it('stateElementが存在しない場合はエラーになること', () => {
    const placeholder = document.createComment('for');
    setFragmentInfoByUUID(uuid, createFragmentInfo());

    expect(() => applyChangeToFor(placeholder, uuid, [])).toThrow(/State element with name/);
  });

  it('listPathInfoがない場合はエラーになること', () => {
    const placeholder = document.createComment('for');
    const fragmentInfo = createFragmentInfo();
    fragmentInfo.parseBindTextResult.statePathInfo = null as any;
    setFragmentInfoByUUID(uuid, fragmentInfo);

    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    expect(() => applyChangeToFor(placeholder, uuid, [])).toThrow(/List path info not found/);
  });

  it('配列以外の値は空配列として扱われること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());

    applyChangeToFor(placeholder, uuid, { not: 'array' });

    expect(container.childNodes.length).toBe(1);
  });

  it('空のフラグメントでもエラーにならないこと', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createEmptyFragmentInfo());

    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    applyChangeToFor(placeholder, uuid, list);

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

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    applyChangeToFor(placeholder, uuid, list);

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

    const list = [1, 2];
    const listIndexes = createListIndexes(null, [], list, []);
    setListIndexesByList(list, listIndexes);

    applyChangeToFor(placeholder, uuid, list);
    expect(container.childNodes.length).toBe(3);

    // 次の更新は空配列
    applyChangeToFor(placeholder, uuid, []);
    expect(container.childNodes.length).toBe(1);

    // 後片付け
    setListIndexesByList(list, null);
  });
});
