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

  it('bindAttributeNameがない場合はエラーになること', async () => {
    const component = createComponentWithShadow(false);
    const stateEl = createMockStateElement();
    await expect(bindWebComponent(stateEl, component, 'outer')).rejects.toThrow(/no "data-wcs" attribute/);
  });

  it('bindingsがnullの場合はエラーになること', async () => {
    const component = createComponentWithShadow();
    const stateEl = createMockStateElement();
    getBindingsByNodeMock.mockReturnValue(null);

    await expect(bindWebComponent(stateEl, component, 'outer')).rejects.toThrow(/Bindings not found/);
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

    // waitForStateInitialize, convertMustache, collectStructural が呼ばれること
    expect(waitForStateInitialize).toHaveBeenCalledWith(component.shadowRoot);
    expect(convertMustacheToComments).toHaveBeenCalledWith(component.shadowRoot);
    expect(collectStructuralFragments).toHaveBeenCalledWith(component.shadowRoot, component.shadowRoot);

    // waitInitializeBinding が呼ばれること
    expect(waitInitializeBinding).toHaveBeenCalledWith(component);

    // buildPrimaryMappingRule が呼ばれること
    expect(buildPrimaryMappingRule).toHaveBeenCalledWith(component);

    // createOuterState, createInnerState が component を受け取ること
    expect(createOuterState).toHaveBeenCalledWith(component);
    expect(createInnerState).toHaveBeenCalledWith(component);

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
});
