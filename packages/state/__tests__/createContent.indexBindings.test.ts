import { describe, it, expect, afterEach } from 'vitest';
import { createContent } from '../src/structural/createContent';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { getPathInfo } from '../src/address/PathInfo';
import { getIndexBindingsByContent } from '../src/bindings/indexBindingsByContent';
import { getBindingsByContent } from '../src/bindings/bindingsByContent';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';
import { setStateElementByName } from '../src/stateElementByName';
import { createLoopContextStack } from '../src/list/loopContext';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import type { IBindingInfo } from '../src/types';
import type { IStateElement } from '../src/components/types';
import type { IStateAddress } from '../src/address/types';
import type { ICacheEntry } from '../src/cache/types';
import type { IVersionInfo } from '../src/version/types';

const uuid = 'index-binding-test-uuid';

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
  const cache = new Map<IStateAddress, ICacheEntry>();
  const mightChangeByPath = new Map<string, IVersionInfo>();
  let version = 0;

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
      return callback({
        $$setLoopContext: (_loopContext: any, callback: () => any) => callback(),
        $$getByAddress: () => undefined,
      } as any);
    },
    async createStateAsync(_mutability, callback) {
      return callback({
        $$setLoopContext: (_loopContext: any, callback: () => any) => callback(),
        $$getByAddress: () => undefined,
      } as any);
    },
    nextVersion() {
      version += 1;
      return version;
    },
  };
}

function setFragment(fragment: DocumentFragment, nodeInfos: any[] = []) {
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
  } as ParseBindTextResult;

  setFragmentInfoByUUID(uuid, document, {
    fragment,
    parseBindTextResult,
    nodeInfos,
  });
}

afterEach(() => {
  setFragmentInfoByUUID(uuid, document, null);
  setStateElementByName(document, 'default', null);
});

describe('createContent - indexBindingsの分類', () => {
  it('$1バインディングがindexBindingsに分類されること', () => {
    setStateElementByName(document, 'default', createMockStateElement());

    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    span.setAttribute('data-bind-state', 'textContent: $1');
    fragment.appendChild(span);

    setFragment(fragment, getFragmentNodeInfos(fragment));

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    const indexBindings = getIndexBindingsByContent(content);
    expect(indexBindings.length).toBe(1);
    expect(indexBindings[0].statePathName).toBe('$1');
  });

  it('$2バインディングがindexBindingsに分類されること', () => {
    setStateElementByName(document, 'default', createMockStateElement());

    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    span.setAttribute('data-bind-state', 'textContent: $2');
    fragment.appendChild(span);

    setFragment(fragment, getFragmentNodeInfos(fragment));

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    const indexBindings = getIndexBindingsByContent(content);
    expect(indexBindings.length).toBe(1);
    expect(indexBindings[0].statePathName).toBe('$2');
  });

  it('通常のバインディング（items.*）はindexBindingsに含まれないこと', () => {
    setStateElementByName(document, 'default', createMockStateElement());

    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    span.setAttribute('data-bind-state', 'textContent: items.*');
    fragment.appendChild(span);

    setFragment(fragment, getFragmentNodeInfos(fragment));

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    const indexBindings = getIndexBindingsByContent(content);
    expect(indexBindings.length).toBe(0);

    // bindingsByContentには含まれていること
    const allBindings = getBindingsByContent(content);
    expect(allBindings.length).toBe(1);
  });

  it('$1と通常バインディングが混在する場合、$1のみがindexBindingsに含まれること', () => {
    setStateElementByName(document, 'default', createMockStateElement());

    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    span.setAttribute('data-bind-state', 'textContent: items.*; title: $1');
    fragment.appendChild(span);

    setFragment(fragment, getFragmentNodeInfos(fragment));

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    const indexBindings = getIndexBindingsByContent(content);
    expect(indexBindings.length).toBe(1);
    expect(indexBindings[0].statePathName).toBe('$1');

    // allBindingsには両方含まれること
    const allBindings = getBindingsByContent(content);
    expect(allBindings.length).toBe(2);
  });

  it('インデックスバインディングがない場合はindexBindingsが空配列になること', () => {
    setStateElementByName(document, 'default', createMockStateElement());

    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    span.textContent = 'static text';
    fragment.appendChild(span);

    setFragment(fragment);

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    const indexBindings = getIndexBindingsByContent(content);
    expect(indexBindings.length).toBe(0);
  });

  it('複数の$NバインディングがすべてindexBindingsに分類されること', () => {
    setStateElementByName(document, 'default', createMockStateElement());

    const fragment = document.createDocumentFragment();
    const span1 = document.createElement('span');
    span1.setAttribute('data-bind-state', 'textContent: $1');
    const span2 = document.createElement('span');
    span2.setAttribute('data-bind-state', 'textContent: $2');
    fragment.appendChild(span1);
    fragment.appendChild(span2);

    setFragment(fragment, getFragmentNodeInfos(fragment));

    const placeholder = document.createComment('for');
    const bindingInfo = createBindingInfo(placeholder);
    const content = createContent(bindingInfo);

    const indexBindings = getIndexBindingsByContent(content);
    expect(indexBindings.length).toBe(2);
    const pathNames = indexBindings.map(b => b.statePathName).sort();
    expect(pathNames).toEqual(['$1', '$2']);
  });
});
