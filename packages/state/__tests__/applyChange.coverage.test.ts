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

import { applyChange } from '../src/apply/applyChange';
import { applyChangeToElement } from '../src/apply/applyChangeToElement';
import { applyChangeToText } from '../src/apply/applyChangeToText';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';

const applyChangeToElementMock = vi.mocked(applyChangeToElement);
const applyChangeToTextMock = vi.mocked(applyChangeToText);
const applyChangeToForMock = vi.mocked(applyChangeToFor);

function createBaseBindingInfo(): Omit<IBindingInfo, 'bindingType' | 'node' | 'placeHolderNode' | 'propSegments' | 'propName'> {
  return {
    statePathName: 'value',
    statePathInfo: null,
    stateName: 'default',
    filters: [],
    propModifiers: [],
    uuid: null,
    node: document.createTextNode(''),
    placeHolderNode: document.createTextNode('')
  } as IBindingInfo;
}

describe('applyChange (coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filtersが順に適用されること', () => {
    const filters: IFilterInfo[] = [
      { filterName: 'add1', args: [], filterFn: (v: number) => v + 1 },
      { filterName: 'mul2', args: [], filterFn: (v: number) => v * 2 }
    ];
    const input = document.createElement('input');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: input,
      placeHolderNode: input,
      propName: 'value',
      propSegments: ['value'],
      filters
    } as IBindingInfo;

    applyChange(bindingInfo, 3);

    expect(applyChangeToElementMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToElementMock).toHaveBeenCalledWith(input, ['value'], 8);
  });

  it('textバインディングはapplyChangeToTextが呼ばれること', () => {
    const textNode = document.createTextNode('x');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: textNode,
      placeHolderNode: textNode,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    applyChange(bindingInfo, 'y');

    expect(applyChangeToTextMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToTextMock).toHaveBeenCalledWith(textNode, 'y');
  });

  it('forバインディングはuuidがあればapplyChangeToForが呼ばれること', () => {
    const placeholder = document.createComment('for');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'for',
      node: placeholder,
      placeHolderNode: placeholder,
      propName: 'for',
      propSegments: [],
      uuid: 'test-uuid'
    } as IBindingInfo;

    applyChange(bindingInfo, [1, 2]);

    expect(applyChangeToForMock).toHaveBeenCalledTimes(1);
    expect(applyChangeToForMock).toHaveBeenCalledWith(placeholder, 'test-uuid', [1, 2]);
  });

  it('対象外のbindingTypeは何も呼ばれないこと', () => {
    const node = document.createElement('button');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'event',
      node,
      placeHolderNode: node,
      propName: 'onclick',
      propSegments: ['onclick']
    } as IBindingInfo;

    applyChange(bindingInfo, () => {});

    expect(applyChangeToTextMock).not.toHaveBeenCalled();
    expect(applyChangeToElementMock).not.toHaveBeenCalled();
    expect(applyChangeToForMock).not.toHaveBeenCalled();
  });
});
