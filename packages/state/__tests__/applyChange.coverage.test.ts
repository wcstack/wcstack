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
vi.mock('../src/apply/getValue', () => ({
  getValue: vi.fn()
}));
vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn()
}));
vi.mock('../src/apply/rootNodeByFragment', () => ({
  getRootNodeByFragment: vi.fn()
}));

import { applyChange } from '../src/apply/applyChange';
import { applyChangeToText } from '../src/apply/applyChangeToText';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';
import { applyChangeToIf } from '../src/apply/applyChangeToIf';
import { applyChangeToAttribute } from '../src/apply/applyChangeToAttribute';
import { applyChangeToClass } from '../src/apply/applyChangeToClass';
import { applyChangeToStyle } from '../src/apply/applyChangeToStyle';
import { applyChangeToProperty } from '../src/apply/applyChangeToProperty';
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
const getValueMock = vi.mocked(getValue);
const getStateElementByNameMock = vi.mocked(getStateElementByName);

function createBaseBindingInfo(): Omit<IBindingInfo, 'bindingType' | 'node' | 'replaceNode' | 'propSegments' | 'propName'> {
  return {
    statePathName: 'value',
    statePathInfo: getPathInfo('value'),
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
});
