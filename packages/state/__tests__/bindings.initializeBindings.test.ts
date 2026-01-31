import { describe, it, expect, afterEach, vi } from 'vitest';
import { initializeBindings, initializeBindingsByFragment } from '../src/bindings/initializeBindings';
import { setStateElementByName } from '../src/stateElementByName';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';
import { createLoopContextStack } from '../src/list/loopContext';
import type { IStateAddress } from '../src/address/types';
import type { ICacheEntry } from '../src/cache/types';
import type { IVersionInfo } from '../src/version/types';
import { createStateAddress } from '../src/address/StateAddress';
import { getListIndexByBindingInfo } from '../src/list/getListIndexByBindingInfo';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';
import { getLoopContextByNode } from '../src/list/loopContextByNode';
import { getPathInfo } from '../src/address/PathInfo';
import { createListIndex } from '../src/list/createListIndex';

vi.mock('../src/event/handler', () => ({
  attachEventHandler: vi.fn((bindingInfo: IBindingInfo) => bindingInfo.bindingType === 'event')
}));

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
    message: 'hello',
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
    addBindingInfo(bindingInfo: IBindingInfo) {
      const listIndex = getListIndexByBindingInfo(bindingInfo);
      const address = createStateAddress(bindingInfo.statePathInfo!, listIndex);
      const list = bindingInfosByAddress.get(address) || [];
      list.push(bindingInfo);
      bindingInfosByAddress.set(address, list);
    },
    deleteBindingInfo(bindingInfo: IBindingInfo) {
      const listIndex = getListIndexByBindingInfo(bindingInfo);
      const address = createStateAddress(bindingInfo.statePathInfo!, listIndex);
      const list = bindingInfosByAddress.get(address) || [];
      const index = list.indexOf(bindingInfo);
      if (index !== -1) {
        list.splice(index, 1);
      }
      if (list.length === 0) {
        bindingInfosByAddress.delete(address);
      }
    },
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

describe('initializeBindings', () => {
  afterEach(() => {
    setStateElementByName('default', null);
  });

  it('コメントノードのtextバインディングを初期化できること', async () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const comment = document.createComment('@@wcs-text: message');
    container.appendChild(comment);

    await initializeBindings(container, null);

    expect(container.childNodes.length).toBe(1);
    expect(container.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(container.childNodes[0].nodeValue).toBe('hello');

    const bindingInfos = Array.from(stateElement.bindingInfosByAddress.values()).flat();
    expect(bindingInfos.length).toBe(1);
    const address = createStateAddress(bindingInfos[0].statePathInfo!, null);
    expect(stateElement.bindingInfosByAddress.get(address)).toBeDefined();
  });

  it('stateElementが存在しない場合はエラーになること', async () => {
    const container = document.createElement('div');
    const el = document.createElement('span');
    el.setAttribute('data-bind-state', 'textContent: message@missing');
    container.appendChild(el);

    await expect(initializeBindings(container, null)).rejects.toThrow(/State element with name "missing" not found/);
  });

  it('eventバインディングは登録処理をスキップすること', async () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const addBindingSpy = vi.spyOn(stateElement, 'addBindingInfo');

    const container = document.createElement('div');
    const el = document.createElement('button');
    el.setAttribute('data-bind-state', 'onclick: handleClick');
    container.appendChild(el);

    await initializeBindings(container, null);

    expect(addBindingSpy).not.toHaveBeenCalled();
  });

  it('同じstateElementに複数バインディングがある場合も処理されること', async () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const el1 = document.createElement('span');
    el1.setAttribute('data-bind-state', 'textContent: message');
    const el2 = document.createElement('span');
    el2.setAttribute('data-bind-state', 'textContent: message');
    container.appendChild(el1);
    container.appendChild(el2);

    await initializeBindings(container, null);

    const bindingInfos = Array.from(stateElement.bindingInfosByAddress.values()).flat();
    expect(bindingInfos).toHaveLength(2);
  });

  it('fragment初期化でループコンテキストが設定されること', async () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const fragment = document.createDocumentFragment();
    const el = document.createElement('span');
    el.setAttribute('data-bind-state', 'textContent: message');
    fragment.appendChild(el);

    const nodeInfos = getFragmentNodeInfos(fragment);
    const loopContext = {
      elementPathInfo: getPathInfo('items.*'),
      listIndex: createListIndex(null, 0)
    };

    await initializeBindingsByFragment(fragment, nodeInfos, loopContext);

    const [node] = Array.from(fragment.childNodes);
    expect(getLoopContextByNode(node)).toBe(loopContext);
  });
});
