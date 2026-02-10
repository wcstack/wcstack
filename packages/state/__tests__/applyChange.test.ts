import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyChange } from '../src/apply/applyChange';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';
import { applyChangeToIf } from '../src/apply/applyChangeToIf';
import { getValue } from '../src/apply/getValue';
import { getPathInfo } from '../src/address/PathInfo';
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
  const context: IApplyContext = {
    stateName: 'default',
    rootNode: document as any,
    stateElement: {} as any,
    state,
    appliedBindingSet: new Set(),
  };
  const getValueMock = vi.mocked(getValue);
  const applyChangeToForMock = vi.mocked(applyChangeToFor);
  const applyChangeToIfMock = vi.mocked(applyChangeToIf);

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    context.appliedBindingSet.clear();
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
});
