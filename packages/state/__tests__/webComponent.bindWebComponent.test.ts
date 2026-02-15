import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../src/webComponent/MappingRule', () => ({
  buildPrimaryMappingRule: vi.fn()
}));
vi.mock('../src/webComponent/outerState', () => {
  const outerState = {};
  return { createOuterState: vi.fn(() => outerState) };
});
vi.mock('../src/webComponent/innerState', () => {
  const innerState = {};
  return { createInnerState: vi.fn(() => innerState) };
});
vi.mock('../src/webComponent/stateElementByWebComponent', () => ({
  setStateElementByWebComponent: vi.fn()
}));
vi.mock('../src/webComponent/registerWebComponent', () => ({
  isWebComponentRegistered: vi.fn(() => false),
  registerWebComponent: vi.fn().mockResolvedValue(undefined)
}));

import { bindWebComponent } from '../src/webComponent/bindWebComponent';
import { getBindingsByNode } from '../src/bindings/getBindingsByNode';
import { waitInitializeBinding } from '../src/bindings/initializeBindingPromiseByNode';
import { initializeBindings } from '../src/bindings/initializeBindings';
import { convertMustacheToComments } from '../src/mustache/convertMustacheToComments';
import { collectStructuralFragments } from '../src/structural/collectStructuralFragments';
import { waitForStateInitialize } from '../src/waitForStateInitialize';
import { buildPrimaryMappingRule } from '../src/webComponent/MappingRule';
import { createOuterState } from '../src/webComponent/outerState';
import { createInnerState } from '../src/webComponent/innerState';
import { setStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { isWebComponentRegistered, registerWebComponent } from '../src/webComponent/registerWebComponent';
import { IBindingInfo } from '../src/types';
import { getPathInfo } from '../src/address/PathInfo';

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
  component.attachShadow({ mode: 'open' });
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
    await expect(bindWebComponent(stateEl, component, 'outer')).rejects.toThrow(/no shadow root/);
  });

  it('bindAttributeNameがない場合でも正常に動作すること（単独WebComponent）', async () => {
    const component = createComponentWithShadow(false);
    const stateEl = createMockStateElement();

    await expect(bindWebComponent(stateEl, component, 'state')).resolves.not.toThrow();

    // setStateElementByWebComponentが呼ばれること
    expect(setStateElementByWebComponent).toHaveBeenCalledWith(component, 'state', stateEl);

    // registerWebComponentが呼ばれること
    expect(registerWebComponent).toHaveBeenCalledWith(component);

    // initializeBindingsが呼ばれること（data-wcs属性がなくても）
    expect(initializeBindings).toHaveBeenCalledWith(component.shadowRoot, null);
  });

  it('bindingsが空配列でも正常に動作すること', async () => {
    const component = createComponentWithShadow();
    const stateEl = createMockStateElement();
    getBindingsByNodeMock.mockReturnValue([]);

    await expect(bindWebComponent(stateEl, component, 'outer')).resolves.not.toThrow();
  });

  // Note: stateProp チェックは現在コメントアウトされているため、このテストは削除またはスキップ
  it.skip('statePropとバインディングの先頭プロパティが一致しない場合はエラーになること', async () => {
    const component = createComponentWithShadow();
    const stateEl = createMockStateElement();
    const binding = createMockBinding(['other', 'value'], 'data');
    getBindingsByNodeMock.mockReturnValue([binding]);

    await expect(bindWebComponent(stateEl, component, 'outer')).rejects.toThrow(
      /does not match stateProp/,
    );
  });

  it('正常系: バインディングを処理してouterプロパティを設定すること', async () => {
    const component = createComponentWithShadow();
    const stateEl = createMockStateElement();
    const binding1 = createMockBinding(['outer', 'title'], 'name');
    const binding2 = createMockBinding(['outer', 'count'], 'total');
    getBindingsByNodeMock.mockReturnValue([binding1, binding2]);

    const outerState = (createOuterState as any)();
    const innerState = (createInnerState as any)();
    vi.mocked(createOuterState).mockReturnValue(outerState);
    vi.mocked(createInnerState).mockReturnValue(innerState);

    await bindWebComponent(stateEl, component, 'outer');

    // setStateElementByWebComponentが呼ばれること
    expect(setStateElementByWebComponent).toHaveBeenCalledWith(component, 'outer', stateEl);

    // registerWebComponentが呼ばれること
    expect(registerWebComponent).toHaveBeenCalledWith(component);

    // buildPrimaryMappingRule が呼ばれること（stateName, bindingsパラメータ付き）
    expect(buildPrimaryMappingRule).toHaveBeenCalledWith(component, 'outer', [binding1, binding2]);

    // createOuterState, createInnerState が component, stateName を受け取ること
    expect(createOuterState).toHaveBeenCalledWith(component, 'outer');
    expect(createInnerState).toHaveBeenCalledWith(component, 'outer');

    // setInitialState が innerState で呼ばれること
    expect(stateEl.setInitialState).toHaveBeenCalledWith(innerState);

    // component.outer が設定されていること
    expect((component as any).outer).toBe(outerState);

    // initializeBindings が呼ばれること
    expect(initializeBindings).toHaveBeenCalledWith(component.shadowRoot, null);
  });

  it('setInitialStateでinnerStateが設定されること', async () => {
    const component = createComponentWithShadow();
    const stateEl = createMockStateElement();
    const binding = createMockBinding(['outer', 'value'], 'data');
    getBindingsByNodeMock.mockReturnValue([binding]);

    const outerState = (createOuterState as any)();
    const innerState = (createInnerState as any)();
    vi.mocked(createOuterState).mockReturnValue(outerState);
    vi.mocked(createInnerState).mockReturnValue(innerState);

    await bindWebComponent(stateEl, component, 'outer');

    // setInitialStateが呼ばれたことを確認
    expect(stateEl.setInitialState).toHaveBeenCalledTimes(1);
    expect(stateEl.setInitialState).toHaveBeenCalledWith(innerState);
  });

  it('異なるstatePropのバインディングはフィルタリングされること', async () => {
    const component = createComponentWithShadow();
    const stateEl = createMockStateElement();
    const binding1 = createMockBinding(['outer', 'title'], 'name');
    const binding2 = createMockBinding(['props', 'config'], 'settings'); // 別のstateProp
    getBindingsByNodeMock.mockReturnValue([binding1, binding2]);

    await bindWebComponent(stateEl, component, 'outer');

    // buildPrimaryMappingRuleには'outer'で始まるバインディングのみ渡される
    expect(buildPrimaryMappingRule).toHaveBeenCalledWith(component, 'outer', [binding1]);
  });
});
