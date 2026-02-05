import { describe, it, expect, afterEach, vi } from 'vitest';
import { initializeBindings, initializeBindingsByFragment } from '../src/bindings/initializeBindings';
import { setStateElementByName } from '../src/stateElementByName';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';
import { createLoopContextStack } from '../src/list/loopContext';
import type { IStateAddress } from '../src/address/types';
import type { ICacheEntry } from '../src/cache/types';
import type { IVersionInfo } from '../src/version/types';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';
import { getLoopContextByNode } from '../src/list/loopContextByNode';
import { getPathInfo } from '../src/address/PathInfo';
import { applyChangeFromBindings } from '../src/apply/applyChangeFromBindings';
import { getAbsoluteStateAddressByBindingInfo } from '../src/binding/getAbsoluteStateAddressByBindingInfo';
import { getBindingInfosByAbsoluteStateAddress } from '../src/binding/getBindingInfosByAbsoluteStateAddress';

vi.mock('../src/event/handler', () => ({
  attachEventHandler: vi.fn((bindingInfo: IBindingInfo) => bindingInfo.bindingType === 'event')
}));
vi.mock('../src/apply/applyChangeFromBindings', () => ({
  applyChangeFromBindings: vi.fn()
}));

const applyChangeFromBindingsMock = vi.mocked(applyChangeFromBindings);

function createMockStateElement(): IStateElement {
  const listPaths = new Set<string>();
  const elementPaths = new Set<string>();
  const getterPaths = new Set<string>();
  const cache = new Map<IStateAddress, ICacheEntry>();
  const mightChangeByPath = new Map<string, IVersionInfo>();
  const dynamicDependency = new Map<string, string[]>();
  const staticDependency = new Map<string, string[]>();
  const pathSet = new Set<string>();
  let version = 0;
  const stateProxy: any = {
    message: 'hello',
    $$setLoopContext: (_loopContext: any, callback: () => any) => callback(),
    $$getByAddress: () => 'hello',
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
    setBindingInfo(bindingInfo: IBindingInfo) {
      const path = bindingInfo.statePathName;
      if (bindingInfo.bindingType === 'for') {
        listPaths.add(path);
        elementPaths.add(path + '.*');
      }
      if (!pathSet.has(path)) {
        pathSet.add(path);
        const pathInfo = getPathInfo(path);
        if (pathInfo.parentPath !== null) {
          const deps = staticDependency.get(pathInfo.parentPath) ?? [];
          if (!deps.includes(path)) {
            deps.push(path);
            staticDependency.set(pathInfo.parentPath, deps);
          }
        }
      }
    },
    addStaticDependency() {},
    addDynamicDependency() {},
    createState(mutability, callback) {
      return callback(stateProxy);
    },
    async createStateAsync(mutability, callback) {
      return callback(stateProxy);
    },
    nextVersion() {
      version += 1;
      return version;
    },
  };
}

describe('initializeBindings', () => {
  afterEach(() => {
    setStateElementByName('default', null);
    vi.clearAllMocks();
  });

  it('コメントノードのtextバインディングを初期化できること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const comment = document.createComment('@@wcs-text: message');
    container.appendChild(comment);

    const setBindingSpy = vi.spyOn(stateElement, 'setBindingInfo');

    initializeBindings(container, null);

    expect(container.childNodes.length).toBe(1);
    expect(container.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(container.childNodes[0].nodeValue).toBe('');

    expect(setBindingSpy).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    const [bindings] = applyChangeFromBindingsMock.mock.calls[0];
    expect(bindings).toHaveLength(1);
    const absoluteAddress = getAbsoluteStateAddressByBindingInfo(bindings[0]);
    expect(getBindingInfosByAbsoluteStateAddress(absoluteAddress)).toContain(bindings[0]);
  });

  it('stateElementが存在しない場合はエラーになること', () => {
    const container = document.createElement('div');
    const el = document.createElement('span');
    el.setAttribute('data-bind-state', 'textContent: message@missing');
    container.appendChild(el);

    expect(() => initializeBindings(container, null)).toThrow(/State element with name "missing" not found/);
  });

  it('eventバインディングは登録処理をスキップすること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const setBindingSpy = vi.spyOn(stateElement, 'setBindingInfo');

    const container = document.createElement('div');
    const el = document.createElement('button');
    el.setAttribute('data-bind-state', 'onclick: handleClick');
    container.appendChild(el);

    initializeBindings(container, null);

    expect(setBindingSpy).not.toHaveBeenCalled();
  });

  it('同じstateElementに複数バインディングがある場合も処理されること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const el1 = document.createElement('span');
    el1.setAttribute('data-bind-state', 'textContent: message');
    const el2 = document.createElement('span');
    el2.setAttribute('data-bind-state', 'textContent: message');
    container.appendChild(el1);
    container.appendChild(el2);

    initializeBindings(container, null);

    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    const [bindings] = applyChangeFromBindingsMock.mock.calls[0];
    expect(bindings).toHaveLength(2);
  });

  it('fragment初期化ではループコンテキストが設定されないこと', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const fragment = document.createDocumentFragment();
    const el = document.createElement('span');
    el.setAttribute('data-bind-state', 'textContent: message');
    fragment.appendChild(el);

    const nodeInfos = getFragmentNodeInfos(fragment);
    initializeBindingsByFragment(fragment, nodeInfos);

    const [node] = Array.from(fragment.childNodes);
    expect(getLoopContextByNode(node)).toBeNull();
  });
});
