import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/bindings/getBindingsByNode', () => ({
  getBindingsByNode: vi.fn()
}));
vi.mock('../src/bindings/initializeBindingPromiseByNode', () => ({
  waitInitializeBinding: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../src/bindings/initializeBindings', () => ({
  initializeBindings: vi.fn()
}));
vi.mock('../src/mustache/convertMustacheToComments', () => ({
  convertMustacheToComments: vi.fn()
}));
vi.mock('../src/structural/collectStructuralFragments', () => ({
  collectStructuralFragments: vi.fn()
}));
vi.mock('../src/waitForStateInitialize', () => ({
  waitForStateInitialize: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../src/webComponent/outerState', () => {
  const outerState = { $$bind: vi.fn() };
  return { createOuterState: vi.fn(() => outerState) };
});
vi.mock('../src/webComponent/innerState', () => {
  const innerState = { $$bind: vi.fn() };
  return { createInnerState: vi.fn(() => innerState) };
});

import { bindWebComponent } from '../src/webComponent/bindWebComponent';
import { getBindingsByNode } from '../src/bindings/getBindingsByNode';
import { waitInitializeBinding } from '../src/bindings/initializeBindingPromiseByNode';
import { initializeBindings } from '../src/bindings/initializeBindings';
import { convertMustacheToComments } from '../src/mustache/convertMustacheToComments';
import { collectStructuralFragments } from '../src/structural/collectStructuralFragments';
import { waitForStateInitialize } from '../src/waitForStateInitialize';
import { createOuterState } from '../src/webComponent/outerState';
import { createInnerState } from '../src/webComponent/innerState';
import { IBindingInfo } from '../src/types';
import { getPathInfo } from '../src/address/PathInfo';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';

const getBindingsByNodeMock = vi.mocked(getBindingsByNode);

const createMockBinding = (propSegments: string[], statePathName: string, stateName = 'default'): IBindingInfo => {
  const statePathInfo = getPathInfo(statePathName);
  return {
    propName: propSegments.join('.'),
    propSegments,
    propModifiers: [],
    statePathName,
    statePathInfo,
    stateName,
    stateAbsolutePathInfo: getAbsolutePathInfo(stateName, statePathInfo),
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node: document.createElement('div'),
    replaceNode: document.createElement('div'),
  } as IBindingInfo;
};

const createMockStateElement = () => ({
  bindProperty: vi.fn(),
  createState: vi.fn(),
  setInitialState: vi.fn(),
} as any);

const createComponentWithShadow = (bindAttr = true): Element => {
  const component = document.createElement('div');
  const shadow = component.attachShadow({ mode: 'open' });
  if (bindAttr) {
    component.setAttribute('data-wcs', 'state:prop1; state:prop2');
  }
  return component;
};

describe('bindWebComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shadowRootがない場合はエラーになること', async () => {
    const component = document.createElement('div');
    const stateEl = createMockStateElement();
    await expect(bindWebComponent(stateEl, component, 'outer', {})).rejects.toThrow(/no shadow root/);
  });

  it('bindAttributeNameがない場合はエラーになること', async () => {
    const component = createComponentWithShadow(false);
    const stateEl = createMockStateElement();
    await expect(bindWebComponent(stateEl, component, 'outer', {})).rejects.toThrow(/no "data-wcs" attribute/);
  });

  it('bindingsがnullの場合はエラーになること', async () => {
    const component = createComponentWithShadow();
    const stateEl = createMockStateElement();
    getBindingsByNodeMock.mockReturnValue(null);

    await expect(bindWebComponent(stateEl, component, 'outer', {})).rejects.toThrow(/Bindings not found/);
  });

  it('statePropとバインディングの先頭プロパティが一致しない場合はエラーになること', async () => {
    const component = createComponentWithShadow();
    const stateEl = createMockStateElement();
    const binding = createMockBinding(['other', 'value'], 'data');
    getBindingsByNodeMock.mockReturnValue([binding]);

    await expect(bindWebComponent(stateEl, component, 'outer', {})).rejects.toThrow(
      /does not match stateProp/,
    );
  });

  it('正常系: バインディングを処理してouterプロパティを設定すること', async () => {
    const component = createComponentWithShadow();
    const stateEl = createMockStateElement();
    const binding1 = createMockBinding(['outer', 'title'], 'name');
    const binding2 = createMockBinding(['outer', 'count'], 'total');
    getBindingsByNodeMock.mockReturnValue([binding1, binding2]);

    const initialState = { seed: 'value' };

    const outerState = (createOuterState as any)();
    const innerState = (createInnerState as any)();
    vi.mocked(createOuterState).mockReturnValue(outerState);
    vi.mocked(createInnerState).mockReturnValue(innerState);

    await bindWebComponent(stateEl, component, 'outer', initialState);

    expect(stateEl.setInitialState).toHaveBeenCalledWith(initialState);

    // waitForStateInitialize, convertMustache, collectStructural が呼ばれること
    expect(waitForStateInitialize).toHaveBeenCalledWith(component.shadowRoot);
    expect(convertMustacheToComments).toHaveBeenCalledWith(component.shadowRoot);
    expect(collectStructuralFragments).toHaveBeenCalledWith(component.shadowRoot, component.shadowRoot);

    // waitInitializeBinding が呼ばれること
    expect(waitInitializeBinding).toHaveBeenCalledWith(component);

    // outerState.$$bind, innerState.$$bind がバインディングごとに呼ばれること
    expect(outerState.$$bind).toHaveBeenCalledTimes(2);
    expect(outerState.$$bind).toHaveBeenCalledWith(stateEl, binding1);
    expect(outerState.$$bind).toHaveBeenCalledWith(stateEl, binding2);
    expect(innerState.$$bind).toHaveBeenCalledTimes(2);
    expect(innerState.$$bind).toHaveBeenCalledWith(binding1);
    expect(innerState.$$bind).toHaveBeenCalledWith(binding2);

    // bindProperty が各バインディングに対して呼ばれること
    expect(stateEl.bindProperty).toHaveBeenCalledTimes(2);
    expect(stateEl.bindProperty).toHaveBeenCalledWith('title', expect.objectContaining({
      enumerable: true,
      configurable: true,
    }));
    expect(stateEl.bindProperty).toHaveBeenCalledWith('count', expect.objectContaining({
      enumerable: true,
      configurable: true,
    }));

    // component.outer が設定されていること
    expect((component as any).outer).toBe(outerState);

    // initializeBindings が呼ばれること
    expect(initializeBindings).toHaveBeenCalledWith(component.shadowRoot, null);
  });

  it('bindPropertyで定義されたgetter/setterが内部状態を操作できること', async () => {
    const component = createComponentWithShadow();
    const stateEl = createMockStateElement();
    const binding = createMockBinding(['outer', 'value'], 'data');
    getBindingsByNodeMock.mockReturnValue([binding]);

    const outerState = (createOuterState as any)();
    const innerState = (createInnerState as any)();
    vi.mocked(createOuterState).mockReturnValue(outerState);
    vi.mocked(createInnerState).mockReturnValue(innerState);

    await bindWebComponent(stateEl, component, 'outer', {});

    // bindPropertyに渡されたdescriptorを取得
    const call = stateEl.bindProperty.mock.calls[0];
    expect(call[0]).toBe('value');
    const descriptor = call[1];

    // innerStateのgetterを設定してテスト
    innerState.value = 'test-data';
    expect(descriptor.get()).toBe('test-data');

    // setterテスト
    descriptor.set('new-data');
    expect(innerState.value).toBe('new-data');
  });
});
