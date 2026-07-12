import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../src/binding/getAbsoluteStateAddressByBinding', () => {
  const cache = new WeakMap();
  return {
    getAbsoluteStateAddressByBinding: vi.fn((binding) => {
      if (cache.has(binding)) return cache.get(binding);
      const addr = { absolutePathInfo: { stateName: binding.stateName, pathInfo: binding.statePathInfo }, listIndex: null };
      cache.set(binding, addr);
      return addr;
    }),
    clearAbsoluteStateAddressByBinding: vi.fn(),
  };
});
import { applyChange } from '../src/apply/applyChange';
import { setStateElementByName } from '../src/stateElementByName';
import { getPathInfo } from '../src/address/PathInfo';
import { getByAddressSymbol, setLoopContextSymbol } from '../src/proxy/symbols';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

function createMockStateElement(name: string, overrides: Record<string, unknown> = {}): IStateElement & { createStateCalls: number } {
  const stateProxy: any = {
    [setLoopContextSymbol]: (_lc: any, cb: () => any) => cb(),
    [getByAddressSymbol]: () => undefined,
  };
  const element: any = {
    name,
    createStateCalls: 0,
    createState(_mutability: string, callback: (state: any) => void) {
      element.createStateCalls += 1;
      callback(stateProxy);
    },
    ...overrides,
  };
  return element;
}

function createTextBinding(stateName: string): IBindingInfo {
  const textNode = document.createTextNode('');
  document.body.appendChild(textNode);
  return {
    propName: 'text',
    propSegments: [],
    propModifiers: [],
    statePathName: 'value',
    statePathInfo: getPathInfo('value'),
    stateName,
    outFilters: [],
    inFilters: [],
    bindingType: 'text',
    uuid: null,
    node: textNode,
    replaceNode: textNode,
  } as IBindingInfo;
}

function createContext(stateElement: IStateElement, extras: Partial<IApplyContext> = {}): IApplyContext {
  const stateProxy: any = {
    [setLoopContextSymbol]: (_lc: any, cb: () => any) => cb(),
    [getByAddressSymbol]: () => undefined,
  };
  return {
    rootNode: document,
    stateName: 'default',
    stateElement,
    state: stateProxy,
    appliedBindingSet: new Set(),
    newListValueByAbsAddress: new Map(),
    updatedAbsAddressSetByStateElement: new Map(),
    deferredSelectBindings: [],
    ...extras,
  } as IApplyContext;
}

describe('applyChange のゲートと fast path', () => {
  afterEach(() => {
    setStateElementByName(document, 'default', null);
    setStateElementByName(document, 'other', null);
    document.body.innerHTML = '';
  });

  it('hasUpdatedCallback === false のとき更新アドレスを集計しないこと', () => {
    const stateElement = createMockStateElement('default', { hasUpdatedCallback: false });
    const context = createContext(stateElement);
    const binding = createTextBinding('default');

    applyChange(binding, context);

    expect(context.updatedAbsAddressSetByStateElement.size).toBe(0);
  });

  it('hasUpdatedCallback 未定義（モック互換）のときは従来通り集計すること', () => {
    const stateElement = createMockStateElement('default');
    const context = createContext(stateElement);
    const binding = createTextBinding('default');

    applyChange(binding, context);

    expect(context.updatedAbsAddressSetByStateElement.size).toBe(1);
    expect(context.updatedAbsAddressSetByStateElement.get(stateElement)!.size).toBe(1);
  });

  it('hasUpdatedCallback === true のときも集計すること', () => {
    const stateElement = createMockStateElement('default', { hasUpdatedCallback: true });
    const context = createContext(stateElement);
    const binding = createTextBinding('default');

    applyChange(binding, context);

    expect(context.updatedAbsAddressSetByStateElement.size).toBe(1);
  });

  it('sameRootVerified かつ stateName 一致なら getRootNode を再解決しないこと（fast path）', () => {
    const stateElement = createMockStateElement('default');
    const context = createContext(stateElement, { sameRootVerified: true });
    const binding = createTextBinding('default');
    const getRootNodeSpy = vi.fn(() => document);
    Object.defineProperty(binding.replaceNode, 'getRootNode', { value: getRootNodeSpy, configurable: true });

    applyChange(binding, context);

    expect(getRootNodeSpy).not.toHaveBeenCalled();
    // fast path でも適用自体は行われる（同値 "" のため書き込みは無いが nodeValue は空）
    expect(binding.replaceNode.nodeValue).toBe('');
  });

  it('sameRootVerified が無ければ従来通り getRootNode を解決すること', () => {
    const stateElement = createMockStateElement('default');
    setStateElementByName(document, 'default', stateElement);
    const context = createContext(stateElement);
    const binding = createTextBinding('default');
    const getRootNodeSpy = vi.fn(() => document);
    Object.defineProperty(binding.replaceNode, 'getRootNode', { value: getRootNodeSpy, configurable: true });

    applyChange(binding, context);

    expect(getRootNodeSpy).toHaveBeenCalled();
  });

  it('sameRootVerified でも stateName 不一致なら従来の解決経路にフォールバックすること（テンプレート内 @state バインド相当）', () => {
    const defaultElement = createMockStateElement('default');
    const otherElement = createMockStateElement('other');
    setStateElementByName(document, 'other', otherElement);
    const context = createContext(defaultElement, { sameRootVerified: true });
    const binding = createTextBinding('other');

    applyChange(binding, context);

    // フォールバック: 対象 state の createState が呼ばれ、その state で適用される
    expect(otherElement.createStateCalls).toBe(1);
    expect(defaultElement.createStateCalls).toBe(0);
  });
});
