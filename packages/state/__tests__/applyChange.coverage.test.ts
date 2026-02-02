import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IBindingInfo, IFilterInfo } from '../src/types';

vi.mock('../src/apply/applyChangeToElement', () => ({
  applyChangeToElement: vi.fn()
}));
vi.mock('../src/apply/applyChangeToText', () => ({
  applyChangeToText: vi.fn()
}));
vi.mock('../src/apply/applyChangeToFor', () => ({
  applyChangeToFor: vi.fn()
}));
vi.mock('../src/apply/applyChangeToIf', () => ({
  applyChangeToIf: vi.fn()
}));
vi.mock('../src/apply/getValue', () => ({
  getValue: vi.fn()
}));
vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn()
}));

import { applyChange } from '../src/apply/applyChange';
import { applyChangeToElement } from '../src/apply/applyChangeToElement';
import { applyChangeToText } from '../src/apply/applyChangeToText';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';
import { applyChangeToIf } from '../src/apply/applyChangeToIf';
import { getValue } from '../src/apply/getValue';
import { getStateElementByName } from '../src/stateElementByName';

const applyChangeToElementMock = vi.mocked(applyChangeToElement);
const applyChangeToTextMock = vi.mocked(applyChangeToText);
const applyChangeToForMock = vi.mocked(applyChangeToFor);
const applyChangeToIfMock = vi.mocked(applyChangeToIf);
const getValueMock = vi.mocked(getValue);
const getStateElementByNameMock = vi.mocked(getStateElementByName);

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
  } as unknown as IBindingInfo;
}

describe('applyChange (coverage)', () => {
  const state = {} as any;
  const stateName = 'default';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filtersが順に適用されること', () => {
    const filters: IFilterInfo[] = [
      { filterName: 'add1', args: [], filterFn: (v: any) => v + 1 },
      { filterName: 'mul2', args: [], filterFn: (v: any) => v * 2 }
    ];
    const input = document.createElement('input');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: input,
      replaceNode: input,
      propName: 'value',
      propSegments: ['value'],
      filters
    } as IBindingInfo;

    getValueMock.mockReturnValue(3);
    applyChange(bindingInfo, state, stateName);

    expect(applyChangeToElementMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToElementMock).toHaveBeenCalledWith(input, ['value'], 8);
  });

  it('textバインディングはapplyChangeToTextが呼ばれること', () => {
    const textNode = document.createTextNode('x');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: textNode,
      replaceNode: textNode,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    getValueMock.mockReturnValue('y');
    applyChange(bindingInfo, state, stateName);

    expect(applyChangeToTextMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToTextMock).toHaveBeenCalledWith(textNode, 'y');
  });

  it('forバインディングはuuidがあればapplyChangeToForが呼ばれること', () => {
    const placeholder = document.createComment('for');
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
    applyChange(bindingInfo, state, stateName);

    expect(applyChangeToForMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToForMock).toHaveBeenCalledWith(bindingInfo, list, state, stateName);
  });

  it('ifバインディングはuuidがあればapplyChangeToIfが呼ばれること', () => {
    const placeholder = document.createComment('if');
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
    applyChange(bindingInfo, state, stateName);

    expect(applyChangeToIfMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToIfMock).toHaveBeenCalledWith(bindingInfo, true, state, stateName);
  });

  it('elseバインディングはuuidがあればapplyChangeToIfが呼ばれること', () => {
    const placeholder = document.createComment('else');
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
    applyChange(bindingInfo, state, stateName);

    expect(applyChangeToIfMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToIfMock).toHaveBeenCalledWith(bindingInfo, false, state, stateName);
  });

  it('elseifバインディングはuuidがあればapplyChangeToIfが呼ばれること', () => {
    const placeholder = document.createComment('elseif');
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
    applyChange(bindingInfo, state, stateName);

    expect(applyChangeToIfMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToIfMock).toHaveBeenCalledWith(bindingInfo, true, state, stateName);
  });

  it('対象外のbindingTypeは何も呼ばれないこと', () => {
    const node = document.createElement('button');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'event',
      node,
      replaceNode: node,
      propName: 'onclick',
      propSegments: ['onclick']
    } as IBindingInfo;

    getValueMock.mockReturnValue(() => {});
    applyChange(bindingInfo, state, stateName);

    expect(applyChangeToTextMock).not.toHaveBeenCalled();
    expect(applyChangeToElementMock).not.toHaveBeenCalled();
    expect(applyChangeToForMock).not.toHaveBeenCalled();
    expect(applyChangeToIfMock).not.toHaveBeenCalled();
  });

  it('stateNameが異なる場合は別stateで適用されること', () => {
    const textNode = document.createTextNode('x');
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
    getStateElementByNameMock.mockReturnValue({
      createState: (_mutability: any, callback: (state: any) => any) => callback(otherState)
    } as any);

    getValueMock.mockReturnValue('z');
    applyChange(bindingInfo, state, stateName);

    expect(getStateElementByNameMock).toHaveBeenCalledWith('other');
    expect(applyChangeToTextMock).toHaveBeenCalledWith(textNode, 'z');
  });

  it('stateNameが異なる場合にstateElementが見つからなければエラーになること', () => {
    const textNode = document.createTextNode('x');
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

    expect(() => applyChange(bindingInfo, state, stateName))
      .toThrow(/State element with name "missing" not found for binding/);
  });
});
