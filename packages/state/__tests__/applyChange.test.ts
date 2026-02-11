import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyChange } from '../src/apply/applyChange';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';
import { applyChangeToIf } from '../src/apply/applyChangeToIf';
import { getValue } from '../src/apply/getValue';
import { getPathInfo } from '../src/address/PathInfo';
import { config } from '../src/config';
import { getRootNodeByFragment } from '../src/apply/rootNodeByFragment';
import { getStateElementByName } from '../src/stateElementByName';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

vi.mock('../src/apply/applyChangeToFor', () => ({
  applyChangeToFor: vi.fn()
}));
vi.mock('../src/apply/applyChangeToIf', () => ({
  applyChangeToIf: vi.fn()
}));
vi.mock('../src/apply/getValue', () => ({
  getValue: vi.fn()
}));
vi.mock('../src/apply/rootNodeByFragment', () => ({
  getRootNodeByFragment: vi.fn()
}));
vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn()
}));

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
  } as any;
}

describe('applyChange', () => {
  const state = {} as any;
  let context: IApplyContext;
  const getValueMock = vi.mocked(getValue);
  const applyChangeToForMock = vi.mocked(applyChangeToFor);
  const applyChangeToIfMock = vi.mocked(applyChangeToIf);
  const getRootNodeByFragmentMock = vi.mocked(getRootNodeByFragment);
  const getStateElementByNameMock = vi.mocked(getStateElementByName);

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    config.debug = false;
    context = {
      stateName: 'default',
      rootNode: document as any,
      stateElement: {} as any,
      state,
      appliedBindingSet: new Set(),
      newListValueByAbsAddress: new Map(),
    };
  });

  it('textバインディングでテキストを更新できること', () => {
    const textNode = document.createTextNode('a');
    document.body.appendChild(textNode);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: textNode,
      replaceNode: textNode,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue('b');
    applyChange(bindingInfo, context);
    expect(textNode.nodeValue).toBe('b');
  });

  it('propバインディングでプロパティを更新できること', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: input,
      replaceNode: input,
      propName: 'value',
      propSegments: ['value']
    } as IBindingInfo;

    getValueMock.mockReturnValue('hello');
    applyChange(bindingInfo, context);
    expect(input.value).toBe('hello');
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
      propSegments: []
    } as IBindingInfo;

    const list = [1, 2];
    getValueMock.mockReturnValue(list);
    applyChange(bindingInfo, context);
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
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue(true);
    applyChange(bindingInfo, context);
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
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue(false);
    applyChange(bindingInfo, context);
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
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue(true);
    applyChange(bindingInfo, context);
    expect(applyChangeToIfMock).toHaveBeenCalledWith(bindingInfo, context, true);
  });

  it('既に適用済みのバインディングはスキップされること', () => {
    const textNode = document.createTextNode('a');
    document.body.appendChild(textNode);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: textNode,
      replaceNode: textNode,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    context.appliedBindingSet.add(bindingInfo);
    applyChange(bindingInfo, context);
    expect(getValueMock).not.toHaveBeenCalled();
  });

  it('config.debug=trueの場合はconsole.logが呼ばれること', () => {
    config.debug = true;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const textNode = document.createTextNode('a');
    document.body.appendChild(textNode);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: textNode,
      replaceNode: textNode,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue('b');
    applyChange(bindingInfo, context);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('eventバインディングは早期リターンすること', () => {
    const node = document.createElement('button');
    document.body.appendChild(node);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'event',
      node,
      replaceNode: node,
      propName: 'click',
      propSegments: []
    } as IBindingInfo;

    applyChange(bindingInfo, context);
    expect(getValueMock).not.toHaveBeenCalled();
  });

  it('classセグメントでapplyChangeToClassが呼ばれること', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: div,
      replaceNode: div,
      propName: 'class.active',
      propSegments: ['class', 'active']
    } as IBindingInfo;

    getValueMock.mockReturnValue(true);
    applyChange(bindingInfo, context);
    expect(div.classList.contains('active')).toBe(true);
  });

  it('attrセグメントでapplyChangeToAttributeが呼ばれること', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: div,
      replaceNode: div,
      propName: 'attr.data-id',
      propSegments: ['attr', 'data-id']
    } as IBindingInfo;

    getValueMock.mockReturnValue('123');
    applyChange(bindingInfo, context);
    expect(div.getAttribute('data-id')).toBe('123');
  });

  it('styleセグメントでapplyChangeToStyleが呼ばれること', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: div,
      replaceNode: div,
      propName: 'style.color',
      propSegments: ['style', 'color']
    } as IBindingInfo;

    getValueMock.mockReturnValue('red');
    applyChange(bindingInfo, context);
    expect(div.style.color).toBe('red');
  });

  it('DocumentFragmentのrootNodeが解決できない場合はエラーになること', () => {
    getRootNodeByFragmentMock.mockReturnValue(null);

    const fragment = document.createDocumentFragment();
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: fragment,
      replaceNode: fragment,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue('test');
    expect(() => applyChange(bindingInfo, context)).toThrow(/Root node for fragment not found/);
  });

  it('stateNameが異なる場合はcreateStateが呼ばれて別コンテキストで適用されること', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    const targetState = { value: 'cross' } as any;
    const mockCreateState = vi.fn((_mutability: string, callback: (state: any) => void) => callback(targetState));
    const mockStateElement = { createState: mockCreateState } as any;
    getStateElementByNameMock.mockReturnValue(mockStateElement);

    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      stateName: 'other',
      bindingType: 'text',
      node: div,
      replaceNode: div,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue('cross-state');
    applyChange(bindingInfo, context);
    expect(getStateElementByNameMock).toHaveBeenCalledWith(document, 'other');
    expect(mockCreateState).toHaveBeenCalledWith('readonly', expect.any(Function));
    expect(getValueMock).toHaveBeenCalled();
  });

  it('stateNameが異なりstateElementが見つからない場合はエラーになること', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    getStateElementByNameMock.mockReturnValue(null);

    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      stateName: 'missing',
      bindingType: 'text',
      node: div,
      replaceNode: div,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue('test');
    expect(() => applyChange(bindingInfo, context)).toThrow(/State element with name "missing" not found/);
  });

  it('DocumentFragment内のノードでrootNodeが解決された場合に正常に処理されること', () => {
    getRootNodeByFragmentMock.mockReturnValue(document);
    getStateElementByNameMock.mockReturnValue(null);

    const fragment = document.createDocumentFragment();
    const textNode = document.createTextNode('');
    fragment.appendChild(textNode);

    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      stateName: 'other',
      bindingType: 'text',
      node: textNode,
      replaceNode: textNode,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue('resolved');
    // rootNode resolves to document via getRootNodeByFragment, 
    // but stateName differs so it tries getStateElementByName → null → error
    expect(() => applyChange(bindingInfo, context)).toThrow(/State element with name "other" not found/);
    expect(getRootNodeByFragmentMock).toHaveBeenCalled();
  });
});
