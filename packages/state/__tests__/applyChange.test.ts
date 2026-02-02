import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyChange } from '../src/apply/applyChange';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';
import { applyChangeToIf } from '../src/apply/applyChangeToIf';
import { getValue } from '../src/apply/getValue';
import type { IBindingInfo } from '../src/types';

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
    statePathInfo: null,
    stateName: 'default',
    filters: [],
    propModifiers: [],
    uuid: null,
    node: document.createTextNode(''),
    replaceNode: document.createTextNode('')
  } as any;
}

describe('applyChange', () => {
  const state = {} as any;
  const stateName = 'default';
  const getValueMock = vi.mocked(getValue);
  const applyChangeToForMock = vi.mocked(applyChangeToFor);
  const applyChangeToIfMock = vi.mocked(applyChangeToIf);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('textバインディングでテキストを更新できること', () => {
    const textNode = document.createTextNode('a');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: textNode,
      replaceNode: textNode,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue('b');
    applyChange(bindingInfo, state, stateName);
    expect(textNode.nodeValue).toBe('b');
  });

  it('propバインディングでプロパティを更新できること', () => {
    const input = document.createElement('input');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: input,
      replaceNode: input,
      propName: 'value',
      propSegments: ['value']
    } as IBindingInfo;

    getValueMock.mockReturnValue('hello');
    applyChange(bindingInfo, state, stateName);
    expect(input.value).toBe('hello');
  });

  it('forバインディングはapplyChangeToForが呼ばれること', () => {
    const placeholder = document.createComment('for');
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
    applyChange(bindingInfo, state, stateName);
    expect(applyChangeToForMock).toHaveBeenCalledWith(bindingInfo, list, state, stateName);
  });

  it('ifバインディングはapplyChangeToIfが呼ばれること', () => {
    const placeholder = document.createComment('if');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'if',
      node: placeholder,
      replaceNode: placeholder,
      propName: 'if',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue(true);
    applyChange(bindingInfo, state, stateName);
    expect(applyChangeToIfMock).toHaveBeenCalledWith(bindingInfo, true, state, stateName);
  });

  it('elseバインディングはapplyChangeToIfが呼ばれること', () => {
    const placeholder = document.createComment('else');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'else',
      node: placeholder,
      replaceNode: placeholder,
      propName: 'else',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue(false);
    applyChange(bindingInfo, state, stateName);
    expect(applyChangeToIfMock).toHaveBeenCalledWith(bindingInfo, false, state, stateName);
  });

  it('elseifバインディングはapplyChangeToIfが呼ばれること', () => {
    const placeholder = document.createComment('elseif');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'elseif',
      node: placeholder,
      replaceNode: placeholder,
      propName: 'elseif',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue(true);
    applyChange(bindingInfo, state, stateName);
    expect(applyChangeToIfMock).toHaveBeenCalledWith(bindingInfo, true, state, stateName);
  });
});
