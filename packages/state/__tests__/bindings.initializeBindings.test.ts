import { describe, it, expect, afterEach, vi } from 'vitest';
import { initializeBindings, initializeBindingsByFragment } from '../src/bindings/initializeBindings';
import { setStateElementByName } from '../src/stateElementByName';
import { attachEventHandler } from '../src/event/handler';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';
import { createLoopContextStack } from '../src/list/loopContext';
import type { IStateAddress } from '../src/address/types';
import type { ICacheEntry } from '../src/cache/types';
import type { IVersionInfo } from '../src/version/types';
import { setLoopContextSymbol, getByAddressSymbol } from '../src/proxy/symbols';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';
import { getLoopContextByNode } from '../src/list/loopContextByNode';
import { getPathInfo } from '../src/address/PathInfo';
import { applyChangeFromBindings } from '../src/apply/applyChangeFromBindings';
import { getAbsoluteStateAddressByBindingInfo } from '../src/binding/getAbsoluteStateAddressByBindingInfo';
import { getBindingSetByAbsoluteStateAddress, addBindingByAbsoluteStateAddress } from '../src/binding/getBindingSetByAbsoluteStateAddress';

vi.mock('../src/binding/getBindingSetByAbsoluteStateAddress', async () => {
  const actual = await vi.importActual('../src/binding/getBindingSetByAbsoluteStateAddress') as any;
  return {
    ...actual,
    addBindingByAbsoluteStateAddress: vi.fn((...args) => actual.addBindingByAbsoluteStateAddress(...args)),
  };
});

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
    [setLoopContextSymbol]: (_loopContext: any, callback: () => any) => callback(),
    [getByAddressSymbol]: () => 'hello',
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
    setPathInfo(path: string, bindingType: string) {
      if (bindingType === 'for') {
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
    setStateElementByName(document, 'default', null);
    vi.clearAllMocks();
  });

  it('コメントノードのtextバインディングを初期化できること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName(document, 'default', stateElement);

    const container = document.createElement('div');
    const comment = document.createComment('@@wcs-text: message');
    container.appendChild(comment);
    document.body.appendChild(container);

    const setBindingSpy = vi.spyOn(stateElement, 'setPathInfo');

    initializeBindings(container, null);

    expect(container.childNodes.length).toBe(1);
    expect(container.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(container.childNodes[0].nodeValue).toBe('');

    expect(setBindingSpy).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    const [bindings] = applyChangeFromBindingsMock.mock.calls[0];
    expect(bindings).toHaveLength(1);
    const absoluteAddress = getAbsoluteStateAddressByBindingInfo(bindings[0]);
    expect(getBindingSetByAbsoluteStateAddress(absoluteAddress)).toContain(bindings[0]);
  });

  it('stateElementが存在しない場合はエラーになること', () => {
    const container = document.createElement('div');
    const el = document.createElement('span');
    el.setAttribute('data-wcs', 'textContent: message@missing');
    container.appendChild(el);

    expect(() => initializeBindings(container, null)).toThrow(/State element with name "missing" not found/);
  });

  it('eventバインディングは登録処理をスキップすること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName(document, 'default', stateElement);

    const setBindingSpy = vi.spyOn(stateElement, 'setPathInfo');

    const container = document.createElement('div');
    const el = document.createElement('button');
    el.setAttribute('data-wcs', 'onclick: handleClick');
    container.appendChild(el);
    document.body.appendChild(container);

    initializeBindings(container, null);

    expect(setBindingSpy).not.toHaveBeenCalled();
  });

  it('同じstateElementに複数バインディングがある場合も処理されること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName(document, 'default', stateElement);

    const container = document.createElement('div');
    const el1 = document.createElement('span');
    el1.setAttribute('data-wcs', 'textContent: message');
    const el2 = document.createElement('span');
    el2.setAttribute('data-wcs', 'textContent: message');
    container.appendChild(el1);
    container.appendChild(el2);
    document.body.appendChild(container);

    initializeBindings(container, null);

    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    const [bindings] = applyChangeFromBindingsMock.mock.calls[0];
    expect(bindings).toHaveLength(2);
  });

  it('fragment初期化ではループコンテキストが設定されないこと', () => {
    const stateElement = createMockStateElement();
    setStateElementByName(document, 'default', stateElement);

    const fragment = document.createDocumentFragment();
    const el = document.createElement('span');
    el.setAttribute('data-wcs', 'textContent: message');
    fragment.appendChild(el);

    const nodeInfos = getFragmentNodeInfos(fragment);
    initializeBindingsByFragment(fragment, nodeInfos);

    const [node] = Array.from(fragment.childNodes);
    expect(getLoopContextByNode(node)).toBeNull();
  });

  it('初期化途中でStateElementが削除された場合はエラーになること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName(document, 'default', stateElement);

    const container = document.createElement('div');
    const comment = document.createComment('@@wcs-text: message');
    container.appendChild(comment);
    document.body.appendChild(container);

    // addBindingInfoByAbsoluteStateAddress の呼び出しタイミングで StateElement を削除し、
    // 直後の getStateElementByName チェックでエラーを発生させる
    vi.mocked(addBindingByAbsoluteStateAddress).mockImplementationOnce(() => {
      setStateElementByName(document, 'default', null);
    });

    expect(() => initializeBindings(container, null)).toThrow(/State element with name "default" not found for binding/);
  });
});
