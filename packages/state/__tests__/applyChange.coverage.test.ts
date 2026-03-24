import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo, IFilterInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

vi.mock('../src/apply/applyChangeToText', () => ({
  applyChangeToText: vi.fn()
}));
vi.mock('../src/apply/applyChangeToFor', () => ({
  applyChangeToFor: vi.fn()
}));
vi.mock('../src/apply/applyChangeToIf', () => ({
  applyChangeToIf: vi.fn()
}));
vi.mock('../src/apply/applyChangeToAttribute', () => ({
  applyChangeToAttribute: vi.fn()
}));
vi.mock('../src/apply/applyChangeToClass', () => ({
  applyChangeToClass: vi.fn()
}));
vi.mock('../src/apply/applyChangeToStyle', () => ({
  applyChangeToStyle: vi.fn()
}));
vi.mock('../src/apply/applyChangeToProperty', () => ({
  applyChangeToProperty: vi.fn()
}));
vi.mock('../src/apply/applyChangeToWebComponent', () => ({
  applyChangeToWebComponent: vi.fn()
}));
vi.mock('../src/webComponent/completeWebComponent', () => ({
  isWebComponentComplete: vi.fn().mockReturnValue(false)
}));
vi.mock('../src/apply/getValue', () => ({
  getValue: vi.fn()
}));
vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn()
}));
vi.mock('../src/apply/rootNodeByFragment', () => ({
  getRootNodeByFragment: vi.fn()
}));
vi.mock('../src/binding/getAbsoluteStateAddressByBinding', () => ({
  getAbsoluteStateAddressByBinding: vi.fn(() => ({ absolutePathInfo: {}, listIndex: null }))
}));

import { applyChange } from '../src/apply/applyChange';
import { applyChangeToText } from '../src/apply/applyChangeToText';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';
import { applyChangeToIf } from '../src/apply/applyChangeToIf';
import { applyChangeToAttribute } from '../src/apply/applyChangeToAttribute';
import { applyChangeToClass } from '../src/apply/applyChangeToClass';
import { applyChangeToStyle } from '../src/apply/applyChangeToStyle';
import { applyChangeToProperty } from '../src/apply/applyChangeToProperty';
import { applyChangeToWebComponent } from '../src/apply/applyChangeToWebComponent';
import { isWebComponentComplete } from '../src/webComponent/completeWebComponent';
import { getValue } from '../src/apply/getValue';
import { getStateElementByName } from '../src/stateElementByName';
import { getRootNodeByFragment } from '../src/apply/rootNodeByFragment';

const applyChangeToTextMock = vi.mocked(applyChangeToText);
const getRootNodeByFragmentMock = vi.mocked(getRootNodeByFragment);
const applyChangeToForMock = vi.mocked(applyChangeToFor);
const applyChangeToIfMock = vi.mocked(applyChangeToIf);
const applyChangeToAttributeMock = vi.mocked(applyChangeToAttribute);
const applyChangeToClassMock = vi.mocked(applyChangeToClass);
const applyChangeToStyleMock = vi.mocked(applyChangeToStyle);
const applyChangeToPropertyMock = vi.mocked(applyChangeToProperty);
const applyChangeToWebComponentMock = vi.mocked(applyChangeToWebComponent);
const isWebComponentCompleteMock = vi.mocked(isWebComponentComplete);
const getValueMock = vi.mocked(getValue);
const getStateElementByNameMock = vi.mocked(getStateElementByName);

function createBaseBindingInfo(): Omit<IBindingInfo, 'bindingType' | 'node' | 'replaceNode' | 'propSegments' | 'propName'> {
  const pathInfo = getPathInfo('value');
  return {
    statePathName: 'value',
    statePathInfo: pathInfo,
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    propModifiers: [],
    uuid: null,
    node: document.createTextNode(''),
    replaceNode: document.createTextNode('')
  } as unknown as IBindingInfo;
}

describe('applyChange (coverage)', () => {
  const state = {} as any;
  const context: IApplyContext = {
    stateName: 'default',
    rootNode: document as any,
    stateElement: {} as any,
    state,
    appliedBindingSet: new Set(),
    newListValueByAbsAddress: new Map(),
    updatedAbsAddressSetByStateElement: new Map(),
    deferredSelectBindings: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    isWebComponentCompleteMock.mockReturnValue(false);
    document.body.innerHTML = '';
  });

  it('filtersが順に適用されること', () => {
    const filters: IFilterInfo[] = [
      { filterName: 'add1', args: [], filterFn: (v: any) => v + 1 },
      { filterName: 'mul2', args: [], filterFn: (v: any) => v * 2 }
    ];
    const input = document.createElement('input');
    document.body.appendChild(input);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: input,
      replaceNode: input,
      propName: 'value',
      propSegments: ['value'],
      outFilters: filters,
      inFilters: []
    } as IBindingInfo;

    getValueMock.mockReturnValue(3);
    applyChange(bindingInfo, context);

    expect(applyChangeToPropertyMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToPropertyMock).toHaveBeenCalledWith(bindingInfo, context, 8);
  });

  it('textバインディングはapplyChangeToTextが呼ばれること', () => {
    const textNode = document.createTextNode('x');
    document.body.appendChild(textNode);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: textNode,
      replaceNode: textNode,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue('y');
    applyChange(bindingInfo, context);

    expect(applyChangeToTextMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToTextMock).toHaveBeenCalledWith(bindingInfo, context, 'y');
  });

  it('classバインディングはapplyChangeToClassが呼ばれること', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: el,
      replaceNode: el,
      propName: 'class',
      propSegments: ['class', 'active']
    } as IBindingInfo;

    getValueMock.mockReturnValue(true);
    applyChange(bindingInfo, context);

    expect(applyChangeToClassMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToClassMock).toHaveBeenCalledWith(bindingInfo, context, true);
  });

  it('attrバインディングはapplyChangeToAttributeが呼ばれること', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: el,
      replaceNode: el,
      propName: 'attr',
      propSegments: ['attr', 'data-id']
    } as IBindingInfo;

    getValueMock.mockReturnValue('123');
    applyChange(bindingInfo, context);

    expect(applyChangeToAttributeMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToAttributeMock).toHaveBeenCalledWith(bindingInfo, context, '123');
  });

  it('styleバインディングはapplyChangeToStyleが呼ばれること', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: el,
      replaceNode: el,
      propName: 'style',
      propSegments: ['style', 'color']
    } as IBindingInfo;

    getValueMock.mockReturnValue('red');
    applyChange(bindingInfo, context);

    expect(applyChangeToStyleMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToStyleMock).toHaveBeenCalledWith(bindingInfo, context, 'red');
  });

  it('forバインディングはapplyChangeToForが呼ばれること', () => {
    const placeholder = document.createComment('for');
    document.body.appendChild(placeholder);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'for',
      node: placeholder,
      replaceNode: placeholder,
      propName: 'for',
      propSegments: [],
      uuid: 'test-uuid'
    } as IBindingInfo;

    const list = [1, 2];
    getValueMock.mockReturnValue(list);
    applyChange(bindingInfo, context);

    expect(applyChangeToForMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToForMock).toHaveBeenCalledWith(bindingInfo, context, list);
  });

  it('ifバインディングはapplyChangeToIfが呼ばれること', () => {
    const placeholder = document.createComment('if');
    document.body.appendChild(placeholder);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'if',
      node: placeholder,
      replaceNode: placeholder,
      propName: 'if',
      propSegments: [],
      uuid: 'test-if-uuid'
    } as IBindingInfo;

    getValueMock.mockReturnValue(true);
    applyChange(bindingInfo, context);

    expect(applyChangeToIfMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToIfMock).toHaveBeenCalledWith(bindingInfo, context, true);
  });

  it('elseバインディングはapplyChangeToIfが呼ばれること', () => {
    const placeholder = document.createComment('else');
    document.body.appendChild(placeholder);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'else',
      node: placeholder,
      replaceNode: placeholder,
      propName: 'else',
      propSegments: [],
      uuid: 'test-else-uuid'
    } as IBindingInfo;

    getValueMock.mockReturnValue(false);
    applyChange(bindingInfo, context);

    expect(applyChangeToIfMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToIfMock).toHaveBeenCalledWith(bindingInfo, context, false);
  });

  it('elseifバインディングはapplyChangeToIfが呼ばれること', () => {
    const placeholder = document.createComment('elseif');
    document.body.appendChild(placeholder);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'elseif',
      node: placeholder,
      replaceNode: placeholder,
      propName: 'elseif',
      propSegments: [],
      uuid: 'test-elseif-uuid'
    } as IBindingInfo;

    getValueMock.mockReturnValue(true);
    applyChange(bindingInfo, context);

    expect(applyChangeToIfMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToIfMock).toHaveBeenCalledWith(bindingInfo, context, true);
  });

  it('eventバインディングはapplyChangeをスキップすること', () => {
    const node = document.createElement('button');
    document.body.appendChild(node);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'event',
      node,
      replaceNode: node,
      propName: 'onclick',
      propSegments: ['onclick']
    } as IBindingInfo;

    getValueMock.mockReturnValue(() => {});
    applyChange(bindingInfo, context);

    expect(applyChangeToTextMock).not.toHaveBeenCalled();
    expect(applyChangeToForMock).not.toHaveBeenCalled();
    expect(applyChangeToIfMock).not.toHaveBeenCalled();
    expect(applyChangeToPropertyMock).not.toHaveBeenCalled();
  });

  it('stateNameが異なる場合は別stateで適用されること', () => {
    const textNode = document.createTextNode('x');
    document.body.appendChild(textNode);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: textNode,
      replaceNode: textNode,
      propName: 'text',
      propSegments: [],
      stateName: 'other'
    } as IBindingInfo;

    const otherState = {} as any;
    const otherStateElement = {} as any;
    getStateElementByNameMock.mockReturnValue({
      createState: (_mutability: any, callback: (state: any) => any) => callback(otherState)
    } as any);

    getValueMock.mockReturnValue('z');
    applyChange(bindingInfo, context);

    expect(getStateElementByNameMock).toHaveBeenCalledWith(document, 'other');
    expect(applyChangeToTextMock).toHaveBeenCalledWith(
      bindingInfo,
      expect.objectContaining({ stateName: 'other', state: otherState }),
      'z'
    );
  });

  it('同じbindingが2回適用された場合はスキップされること', () => {
    const textNode = document.createTextNode('x');
    document.body.appendChild(textNode);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: textNode,
      replaceNode: textNode,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue('y');
    const ctx: IApplyContext = {
      stateName: 'default',
      rootNode: document as any,
      stateElement: {} as any,
      state,
      appliedBindingSet: new Set(),
      newListValueByAbsAddress: new Map(),
      updatedAbsAddressSetByStateElement: new Map(),
      deferredSelectBindings: [],
    };
    applyChange(bindingInfo, ctx);
    applyChange(bindingInfo, ctx);

    expect(applyChangeToTextMock).toHaveBeenCalledTimes(1);
  });

  it('DocumentFragmentのrootNodeが解決できない場合はエラーになること', () => {
    getRootNodeByFragmentMock.mockReturnValue(null);

    const fragment = document.createDocumentFragment();
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: fragment,
      replaceNode: fragment as any,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    expect(() => applyChange(bindingInfo, context)).toThrow(/Root node for fragment not found for binding/);
  });

  it('DocumentFragmentのrootNodeが解決できる場合は正常に処理されること', () => {
    getRootNodeByFragmentMock.mockReturnValue(document);
    getValueMock.mockReturnValue('z');

    const fragment = document.createDocumentFragment();
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: fragment,
      replaceNode: fragment as any,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    applyChange(bindingInfo, context);

    expect(getRootNodeByFragmentMock).toHaveBeenCalledWith(fragment);
    expect(applyChangeToTextMock).toHaveBeenCalledTimes(1);
  });

  it('stateNameが異なる場合にstateElementが見つからなければエラーになること', () => {
    const textNode = document.createTextNode('x');
    document.body.appendChild(textNode);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: textNode,
      replaceNode: textNode,
      propName: 'text',
      propSegments: [],
      stateName: 'missing'
    } as IBindingInfo;

    getStateElementByNameMock.mockReturnValue(null as any);

    expect(() => applyChange(bindingInfo, context))
      .toThrow(/State element with name "missing" not found for binding/);
  });

  it('未定義のカスタム要素の場合はスキップされること', () => {
    const el = document.createElement('my-undefined-element');
    document.body.appendChild(el);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: el,
      replaceNode: el,
      propName: 'value',
      propSegments: ['value']
    } as IBindingInfo;

    getValueMock.mockReturnValue('test');
    applyChange(bindingInfo, context);

    // customElements.get returns undefined, so apply is skipped
    expect(applyChangeToPropertyMock).not.toHaveBeenCalled();
  });

  it('定義済みのカスタム要素の場合は通常どおり適用されること', () => {
    class MyDefinedElement extends HTMLElement {}
    customElements.define('my-defined-element', MyDefinedElement);

    const el = document.createElement('my-defined-element');
    document.body.appendChild(el);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: el,
      replaceNode: el,
      propName: 'value',
      propSegments: ['value']
    } as IBindingInfo;

    getValueMock.mockReturnValue('hello');
    applyChange(bindingInfo, context);

    expect(applyChangeToPropertyMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToPropertyMock).toHaveBeenCalledWith(bindingInfo, context, 'hello');
  });

  it('isWebComponentCompleteがtrueの場合はapplyChangeToWebComponentが呼ばれること', () => {
    isWebComponentCompleteMock.mockReturnValue(true);

    const el = document.createElement('my-defined-element');
    document.body.appendChild(el);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: el,
      replaceNode: el,
      propName: 'state.title',
      propSegments: ['state', 'title']
    } as IBindingInfo;

    getValueMock.mockReturnValue('test-value');
    applyChange(bindingInfo, context);

    expect(applyChangeToWebComponentMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToWebComponentMock).toHaveBeenCalledWith(bindingInfo, context, 'test-value');
    expect(applyChangeToPropertyMock).not.toHaveBeenCalled();
  });

  describe('fnByBindingキャッシュ', () => {
    it('2回目の呼び出しではキャッシュされた関数が使われること（textバインディング）', () => {
      const textNode = document.createTextNode('x');
      document.body.appendChild(textNode);
      const bindingInfo: IBindingInfo = {
        ...createBaseBindingInfo(),
        bindingType: 'text',
        node: textNode,
        replaceNode: textNode,
        propName: 'text',
        propSegments: []
      } as IBindingInfo;

      getValueMock.mockReturnValue('y');
      const ctx: IApplyContext = {
        stateName: 'default',
        rootNode: document as any,
        stateElement: {} as any,
        state,
        appliedBindingSet: new Set(),
        newListValueByAbsAddress: new Map(),
        updatedAbsAddressSetByStateElement: new Map(),
        deferredSelectBindings: [],
      };
      applyChange(bindingInfo, ctx);
      expect(applyChangeToTextMock).toHaveBeenCalledTimes(1);

      // 2回目: appliedBindingSetをリセットして再呼び出し
      ctx.appliedBindingSet = new Set();
      getValueMock.mockReturnValue('z');
      applyChange(bindingInfo, ctx);
      expect(applyChangeToTextMock).toHaveBeenCalledTimes(2);
      expect(applyChangeToTextMock).toHaveBeenLastCalledWith(bindingInfo, ctx, 'z');
    });

    it('2回目の呼び出しではキャッシュされた関数が使われること（classバインディング）', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const bindingInfo: IBindingInfo = {
        ...createBaseBindingInfo(),
        bindingType: 'prop',
        node: el,
        replaceNode: el,
        propName: 'class.active',
        propSegments: ['class', 'active']
      } as IBindingInfo;

      getValueMock.mockReturnValue(true);
      const ctx: IApplyContext = {
        stateName: 'default',
        rootNode: document as any,
        stateElement: {} as any,
        state,
        appliedBindingSet: new Set(),
        newListValueByAbsAddress: new Map(),
        updatedAbsAddressSetByStateElement: new Map(),
        deferredSelectBindings: [],
      };
      applyChange(bindingInfo, ctx);
      expect(applyChangeToClassMock).toHaveBeenCalledTimes(1);

      ctx.appliedBindingSet = new Set();
      getValueMock.mockReturnValue(false);
      applyChange(bindingInfo, ctx);
      expect(applyChangeToClassMock).toHaveBeenCalledTimes(2);
      expect(applyChangeToClassMock).toHaveBeenLastCalledWith(bindingInfo, ctx, false);
    });

    it('通常要素のpropertyバインディングがキャッシュされること', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const bindingInfo: IBindingInfo = {
        ...createBaseBindingInfo(),
        bindingType: 'prop',
        node: el,
        replaceNode: el,
        propName: 'title',
        propSegments: ['title']
      } as IBindingInfo;

      getValueMock.mockReturnValue('first');
      const ctx: IApplyContext = {
        stateName: 'default',
        rootNode: document as any,
        stateElement: {} as any,
        state,
        appliedBindingSet: new Set(),
        newListValueByAbsAddress: new Map(),
        updatedAbsAddressSetByStateElement: new Map(),
        deferredSelectBindings: [],
      };
      applyChange(bindingInfo, ctx);
      expect(applyChangeToPropertyMock).toHaveBeenCalledTimes(1);

      ctx.appliedBindingSet = new Set();
      getValueMock.mockReturnValue('second');
      applyChange(bindingInfo, ctx);
      expect(applyChangeToPropertyMock).toHaveBeenCalledTimes(2);
      // isWebComponentCompleteは通常要素では再評価されない
      expect(isWebComponentCompleteMock).not.toHaveBeenCalled();
    });
  });

  describe('deferredSelectBindingByBindingキャッシュ', () => {
    it('select要素のvalueバインディングは2回目以降もdeferredされること', () => {
      const select = document.createElement('select');
      document.body.appendChild(select);
      const bindingInfo: IBindingInfo = {
        ...createBaseBindingInfo(),
        bindingType: 'prop',
        node: select,
        replaceNode: select,
        propName: 'value',
        propSegments: ['value']
      } as IBindingInfo;

      getValueMock.mockReturnValue('opt1');
      const ctx: IApplyContext = {
        stateName: 'default',
        rootNode: document as any,
        stateElement: {} as any,
        state,
        appliedBindingSet: new Set(),
        newListValueByAbsAddress: new Map(),
        updatedAbsAddressSetByStateElement: new Map(),
        deferredSelectBindings: [],
      };
      applyChange(bindingInfo, ctx);
      expect(ctx.deferredSelectBindings).toHaveLength(1);
      expect(ctx.deferredSelectBindings[0].value).toBe('opt1');

      // 2回目: キャッシュによりfn解決ロジックをスキップしてdeferredされる
      ctx.appliedBindingSet = new Set();
      ctx.deferredSelectBindings = [];
      getValueMock.mockReturnValue('opt2');
      applyChange(bindingInfo, ctx);
      expect(ctx.deferredSelectBindings).toHaveLength(1);
      expect(ctx.deferredSelectBindings[0].value).toBe('opt2');
      expect(applyChangeToPropertyMock).not.toHaveBeenCalled();
    });
  });

  describe('WebComponent動的判定キャッシュ', () => {
    it('isWebComponentCompleteがfalseからtrueに変わるとキャッシュが昇格すること', () => {
      isWebComponentCompleteMock.mockReturnValue(false);

      const el = document.createElement('my-defined-element');
      document.body.appendChild(el);
      const bindingInfo: IBindingInfo = {
        ...createBaseBindingInfo(),
        bindingType: 'prop',
        node: el,
        replaceNode: el,
        propName: 'state.value',
        propSegments: ['state', 'value']
      } as IBindingInfo;

      getValueMock.mockReturnValue('v1');
      const ctx: IApplyContext = {
        stateName: 'default',
        rootNode: document as any,
        stateElement: {} as any,
        state,
        appliedBindingSet: new Set(),
        newListValueByAbsAddress: new Map(),
        updatedAbsAddressSetByStateElement: new Map(),
        deferredSelectBindings: [],
      };

      // 1回目: isWebComponentComplete=false → applyChangeToProperty
      applyChange(bindingInfo, ctx);
      expect(applyChangeToPropertyMock).toHaveBeenCalledTimes(1);
      expect(applyChangeToWebComponentMock).not.toHaveBeenCalled();
      expect(isWebComponentCompleteMock).toHaveBeenCalledTimes(1);

      // 2回目: まだfalse → fnByBinding.has=true, get=undefined → 再評価
      ctx.appliedBindingSet = new Set();
      getValueMock.mockReturnValue('v2');
      applyChange(bindingInfo, ctx);
      expect(applyChangeToPropertyMock).toHaveBeenCalledTimes(2);
      expect(isWebComponentCompleteMock).toHaveBeenCalledTimes(2);

      // 3回目: trueに変化 → applyChangeToWebComponent + キャッシュ昇格
      ctx.appliedBindingSet = new Set();
      isWebComponentCompleteMock.mockReturnValue(true);
      getValueMock.mockReturnValue('v3');
      applyChange(bindingInfo, ctx);
      expect(applyChangeToWebComponentMock).toHaveBeenCalledTimes(1);
      expect(applyChangeToWebComponentMock).toHaveBeenCalledWith(bindingInfo, ctx, 'v3');
      expect(isWebComponentCompleteMock).toHaveBeenCalledTimes(3);

      // 4回目: キャッシュ昇格済み → isWebComponentCompleteは呼ばれない
      ctx.appliedBindingSet = new Set();
      getValueMock.mockReturnValue('v4');
      applyChange(bindingInfo, ctx);
      expect(applyChangeToWebComponentMock).toHaveBeenCalledTimes(2);
      expect(isWebComponentCompleteMock).toHaveBeenCalledTimes(3); // 増えない
    });

    it('カスタム要素でない場合はapplyChangeToPropertyで確定キャッシュされること', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const bindingInfo: IBindingInfo = {
        ...createBaseBindingInfo(),
        bindingType: 'prop',
        node: el,
        replaceNode: el,
        propName: 'data',
        propSegments: ['data']
      } as IBindingInfo;

      getValueMock.mockReturnValue('a');
      const ctx: IApplyContext = {
        stateName: 'default',
        rootNode: document as any,
        stateElement: {} as any,
        state,
        appliedBindingSet: new Set(),
        newListValueByAbsAddress: new Map(),
        updatedAbsAddressSetByStateElement: new Map(),
        deferredSelectBindings: [],
      };

      applyChange(bindingInfo, ctx);
      expect(applyChangeToPropertyMock).toHaveBeenCalledTimes(1);
      expect(isWebComponentCompleteMock).not.toHaveBeenCalled();

      // 2回目: キャッシュ済みなのでisWebComponentCompleteは呼ばれない
      ctx.appliedBindingSet = new Set();
      getValueMock.mockReturnValue('b');
      applyChange(bindingInfo, ctx);
      expect(applyChangeToPropertyMock).toHaveBeenCalledTimes(2);
      expect(isWebComponentCompleteMock).not.toHaveBeenCalled();
    });
  });
});
