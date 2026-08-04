import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/bindings/getBindingsByNode', () => ({
  getBindingsByNode: vi.fn()
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
vi.mock('../src/webComponent/completeWebComponent', () => ({
  markWebComponentAsComplete: vi.fn()
}));
vi.mock('../src/webComponent/meltFrozenObject', () => ({
  meltFrozenObject: vi.fn((obj: any) => ({ ...obj, melted: true }))
}));
vi.mock('../src/raiseError', () => ({
  raiseError: vi.fn((message: string): never => { throw new Error(`[@wcstack/state] ${message}`); })
}));

import { bindWebComponent } from '../src/webComponent/bindWebComponent';
import { getBindingsByNode } from '../src/bindings/getBindingsByNode';
import { buildPrimaryMappingRule } from '../src/webComponent/MappingRule';
import { createOuterState } from '../src/webComponent/outerState';
import { createInnerState } from '../src/webComponent/innerState';
import { setStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { markWebComponentAsComplete } from '../src/webComponent/completeWebComponent';
import { meltFrozenObject } from '../src/webComponent/meltFrozenObject';
import { IBindingInfo } from '../src/types';
import { getPathInfo } from '../src/address/PathInfo';
import { config } from '../src/config';
import { WEBCOMPONENT_STATE_READY_CALLBACK_NAME } from '../src/define';
import { raiseError } from '../src/raiseError';

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

const createComponentWithShadow = (hasBind = true): Element => {
  const component = document.createElement('div');
  component.attachShadow({ mode: 'open' });
  if (hasBind) {
    component.setAttribute(config.bindAttributeName, '');
  }
  return component;
};

describe('bindWebComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shadowRootがないLightDOMコンポーネントでも正常に動作すること', () => {
    const component = document.createElement('div');
    const stateEl = createMockStateElement();
    const state = { message: 'hello' };

    expect(() => bindWebComponent(stateEl, component, 'outer', state)).not.toThrow();
    expect(stateEl.setInitialState).toHaveBeenCalled();
    expect(markWebComponentAsComplete).toHaveBeenCalledWith(component, stateEl);
  });

  describe('data-wcs属性がある場合（バインディングあり）', () => {
    it('正常系: バインディングを処理してouterプロパティを設定すること', () => {
      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      const binding1 = createMockBinding(['outer', 'title'], 'name');
      const binding2 = createMockBinding(['outer', 'count'], 'total');
      getBindingsByNodeMock.mockReturnValue([binding1, binding2]);

      const outerState = (createOuterState as any)();
      const innerState = (createInnerState as any)();
      vi.mocked(createOuterState).mockReturnValue(outerState);
      vi.mocked(createInnerState).mockReturnValue(innerState);

      bindWebComponent(stateEl, component, 'outer', { title: 'test' });

      // setStateElementByWebComponentが呼ばれること
      expect(setStateElementByWebComponent).toHaveBeenCalledWith(component, 'outer', stateEl);

      // buildPrimaryMappingRule が呼ばれること（stateName, bindingsパラメータ付き）
      expect(buildPrimaryMappingRule).toHaveBeenCalledWith(component, 'outer', [binding1, binding2]);

      // createOuterState, createInnerState が component, stateName を受け取ること
      expect(createOuterState).toHaveBeenCalledWith(component, 'outer');
      expect(createInnerState).toHaveBeenCalledWith(component, 'outer');

      // setInitialState が innerState で呼ばれること
      expect(stateEl.setInitialState).toHaveBeenCalledWith(innerState);

      // component.outer が設定されていること
      expect((component as any).outer).toBe(outerState);
    });

    it('setInitialStateでinnerStateが設定されること', () => {
      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      const binding = createMockBinding(['outer', 'value'], 'data');
      getBindingsByNodeMock.mockReturnValue([binding]);

      const outerState = (createOuterState as any)();
      const innerState = (createInnerState as any)();
      vi.mocked(createOuterState).mockReturnValue(outerState);
      vi.mocked(createInnerState).mockReturnValue(innerState);

      bindWebComponent(stateEl, component, 'outer', {});

      // setInitialStateが呼ばれたことを確認
      expect(stateEl.setInitialState).toHaveBeenCalledTimes(1);
      expect(stateEl.setInitialState).toHaveBeenCalledWith(innerState);
    });

    it('異なるstatePropのバインディングはフィルタリングされること', () => {
      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      const binding1 = createMockBinding(['outer', 'title'], 'name');
      const binding2 = createMockBinding(['props', 'config'], 'settings'); // 別のstateProp
      getBindingsByNodeMock.mockReturnValue([binding1, binding2]);

      bindWebComponent(stateEl, component, 'outer', {});

      // buildPrimaryMappingRuleには'outer'で始まるバインディングのみ渡される
      expect(buildPrimaryMappingRule).toHaveBeenCalledWith(component, 'outer', [binding1]);
    });

    it('生stateのmeltは行わずinnerStateをsetInitialStateに渡すこと', () => {
      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      const binding = createMockBinding(['outer', 'title'], 'name');
      getBindingsByNodeMock.mockReturnValue([binding]);

      bindWebComponent(stateEl, component, 'outer', {});

      expect(createInnerState).toHaveBeenCalledWith(component, 'outer');
      expect(meltFrozenObject).not.toHaveBeenCalled();
    });
  });

  // 回帰: 分岐は data-wcs 属性の有無ではなく <stateProp>.* バインディングの件数で決まる。
  // 属性だけあってマッピング対象が 0 件のとき mapped 分岐に落ちると、
  // primaryMappingRule が 1 件も無い innerState proxy が state の実体になり、
  // 親にも子にも解決先が無い状態になる
  // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.2）。
  describe('data-wcs属性はあるが <stateProp>.* バインディングが0件の場合', () => {
    it('別 stateProp のバインディングしか無いときは plain 分岐になること', () => {
      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      const other = createMockBinding(['class', 'on'], 'flag');
      getBindingsByNodeMock.mockReturnValue([other]);

      bindWebComponent(stateEl, component, 'outer', { title: 'test' });

      expect(createInnerState).not.toHaveBeenCalled();
      expect(buildPrimaryMappingRule).not.toHaveBeenCalled();
      expect(meltFrozenObject).toHaveBeenCalledWith({ title: 'test' });
    });

    it('bindingsが空配列のときは plain 分岐になること', () => {
      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      getBindingsByNodeMock.mockReturnValue([]);

      expect(() => bindWebComponent(stateEl, component, 'outer', {})).not.toThrow();
      expect(createInnerState).not.toHaveBeenCalled();
      expect(meltFrozenObject).toHaveBeenCalled();
    });

    it('getBindingsByNodeがnullを返す場合も plain 分岐になること', () => {
      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      getBindingsByNodeMock.mockReturnValue(null as any);

      expect(() => bindWebComponent(stateEl, component, 'outer', {})).not.toThrow();
      expect(createInnerState).not.toHaveBeenCalled();
      expect(buildPrimaryMappingRule).not.toHaveBeenCalled();
    });
  });

  // G1: 外向き proxy は分岐に関わらず同一。mapped 専用の lastValue / $postUpdate 意味論は廃止した。
  it('どちらの分岐でも同じ createOuterState が使われること', () => {
    const mapped = createComponentWithShadow(true);
    getBindingsByNodeMock.mockReturnValue([createMockBinding(['outer', 'title'], 'name')]);
    bindWebComponent(createMockStateElement(), mapped, 'outer', {});

    const plain = createComponentWithShadow(false);
    bindWebComponent(createMockStateElement(), plain, 'outer', {});

    expect(createOuterState).toHaveBeenNthCalledWith(1, mapped, 'outer');
    expect(createOuterState).toHaveBeenNthCalledWith(2, plain, 'outer');
  });

  describe('data-wcs属性がない場合（バインディングなし）', () => {
    it('meltFrozenObjectでstateを溶かしてsetInitialStateに渡すこと', () => {
      const component = createComponentWithShadow(false);
      const stateEl = createMockStateElement();
      const state = { count: 0, name: 'test' };

      bindWebComponent(stateEl, component, 'outer', state);

      expect(meltFrozenObject).toHaveBeenCalledWith(state);
      expect(stateEl.setInitialState).toHaveBeenCalledWith({ count: 0, name: 'test', melted: true });
    });

    it('createOuterStateでouterプロパティを設定すること', () => {
      const component = createComponentWithShadow(false);
      const stateEl = createMockStateElement();
      const outerState = (createOuterState as any)();
      vi.mocked(createOuterState).mockReturnValue(outerState);

      bindWebComponent(stateEl, component, 'outer', {});

      expect(createOuterState).toHaveBeenCalledWith(component, 'outer');
      expect((component as any).outer).toBe(outerState);
    });

    it('マッピング関連の関数が呼ばれないこと', () => {
      const component = createComponentWithShadow(false);
      const stateEl = createMockStateElement();

      bindWebComponent(stateEl, component, 'outer', {});

      expect(getBindingsByNode).not.toHaveBeenCalled();
      expect(buildPrimaryMappingRule).not.toHaveBeenCalled();
      expect(createInnerState).not.toHaveBeenCalled();
    });
  });

  it('markWebComponentAsCompleteが呼ばれること', () => {
    const component = createComponentWithShadow(true);
    const stateEl = createMockStateElement();
    getBindingsByNodeMock.mockReturnValue([]);

    bindWebComponent(stateEl, component, 'outer', {});

    expect(markWebComponentAsComplete).toHaveBeenCalledWith(component, stateEl);
  });

  it('data-wcs属性がない場合もmarkWebComponentAsCompleteが呼ばれること', () => {
    const component = createComponentWithShadow(false);
    const stateEl = createMockStateElement();

    bindWebComponent(stateEl, component, 'outer', {});

    expect(markWebComponentAsComplete).toHaveBeenCalledWith(component, stateEl);
  });

  describe('$stateReadyCallback', () => {
    it('コンポーネントに$stateReadyCallbackが定義されていれば呼び出されること', () => {
      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      const callback = vi.fn().mockResolvedValue(undefined);
      (component as any)[WEBCOMPONENT_STATE_READY_CALLBACK_NAME] = callback;
      getBindingsByNodeMock.mockReturnValue([]);

      bindWebComponent(stateEl, component, 'outer', {});

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('statePropが引数として渡されること', () => {
      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      const callback = vi.fn().mockResolvedValue(undefined);
      (component as any)[WEBCOMPONENT_STATE_READY_CALLBACK_NAME] = callback;
      getBindingsByNodeMock.mockReturnValue([]);

      bindWebComponent(stateEl, component, 'myState', {});

      expect(callback).toHaveBeenCalledWith('myState');
    });

    it('コンポーネントのthisコンテキストで呼び出されること', () => {
      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      let calledThis: any;
      const callback = vi.fn().mockImplementation(function(this: any) {
        calledThis = this;
        return Promise.resolve();
      });
      (component as any)[WEBCOMPONENT_STATE_READY_CALLBACK_NAME] = callback;
      getBindingsByNodeMock.mockReturnValue([]);

      bindWebComponent(stateEl, component, 'outer', {});

      expect(calledThis).toBe(component);
    });

    it('$stateReadyCallbackが未定義の場合は何も起きないこと', () => {
      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      getBindingsByNodeMock.mockReturnValue([]);

      expect(() => bindWebComponent(stateEl, component, 'outer', {})).not.toThrow();
    });

    it('$stateReadyCallbackが関数でない場合はエラーになること', () => {
      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      (component as any)[WEBCOMPONENT_STATE_READY_CALLBACK_NAME] = 'not a function';
      getBindingsByNodeMock.mockReturnValue([]);

      expect(() => bindWebComponent(stateEl, component, 'outer', {})).toThrow(
        /\$stateReadyCallback is not a function/
      );
    });

    it('非同期コールバックが拒否された場合はraiseErrorが呼ばれること', async () => {
      const raiseErrorMock = vi.mocked(raiseError);
      // catchハンドラ内でthrowさせないようにする（unhandled rejection防止）
      raiseErrorMock.mockImplementation((() => {}) as any);

      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      const callback = vi.fn().mockRejectedValue(new Error('async error'));
      (component as any)[WEBCOMPONENT_STATE_READY_CALLBACK_NAME] = callback;
      getBindingsByNodeMock.mockReturnValue([]);

      bindWebComponent(stateEl, component, 'outer', {});

      // catchハンドラが実行されるのを待つ
      await vi.waitFor(() => {
        expect(raiseErrorMock).toHaveBeenCalledWith(
          expect.stringContaining('async error')
        );
      });
    });

    it('非同期コールバックがError以外で拒否された場合はString変換されること', async () => {
      const raiseErrorMock = vi.mocked(raiseError);
      raiseErrorMock.mockImplementation((() => {}) as any);

      const component = createComponentWithShadow(true);
      const stateEl = createMockStateElement();
      const callback = vi.fn().mockRejectedValue('string error');
      (component as any)[WEBCOMPONENT_STATE_READY_CALLBACK_NAME] = callback;
      getBindingsByNodeMock.mockReturnValue([]);

      bindWebComponent(stateEl, component, 'outer', {});

      await vi.waitFor(() => {
        expect(raiseErrorMock).toHaveBeenCalledWith(
          expect.stringContaining('string error')
        );
      });
    });

    it('data-wcs属性がない場合でも$stateReadyCallbackが呼ばれること', () => {
      const component = createComponentWithShadow(false);
      const stateEl = createMockStateElement();
      const callback = vi.fn().mockResolvedValue(undefined);
      (component as any)[WEBCOMPONENT_STATE_READY_CALLBACK_NAME] = callback;

      bindWebComponent(stateEl, component, 'outer', {});

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('outer');
    });
  });
});
