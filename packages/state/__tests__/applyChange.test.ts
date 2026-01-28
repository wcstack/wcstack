import { describe, it, expect } from 'vitest';
import { applyChange } from '../src/apply/applyChange';
import type { IBindingInfo } from '../src/types';

function createBaseBindingInfo(): Omit<IBindingInfo, 'bindingType' | 'node' | 'placeHolderNode' | 'propSegments' | 'propName'> {
  return {
    statePathName: 'value',
    statePathInfo: null,
    stateName: 'default',
    filterTexts: [],
    propModifiers: [],
    uuid: null,
    node: document.createTextNode(''),
    placeHolderNode: document.createTextNode('')
  } as any;
}

describe('applyChange', () => {
  it('textバインディングでテキストを更新できること', () => {
    const textNode = document.createTextNode('a');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'text',
      node: textNode,
      placeHolderNode: textNode,
      propName: 'text',
      propSegments: []
    } as IBindingInfo;

    applyChange(bindingInfo, 'b');
    expect(textNode.nodeValue).toBe('b');
  });

  it('propバインディングでプロパティを更新できること', () => {
    const input = document.createElement('input');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'prop',
      node: input,
      placeHolderNode: input,
      propName: 'value',
      propSegments: ['value']
    } as IBindingInfo;

    applyChange(bindingInfo, 'hello');
    expect(input.value).toBe('hello');
  });

  it('forバインディングでuuidがない場合はエラーになること', () => {
    const placeholder = document.createComment('for');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'for',
      node: placeholder,
      placeHolderNode: placeholder,
      propName: 'for',
      propSegments: []
    } as IBindingInfo;

    expect(() => applyChange(bindingInfo, [])).toThrow(/BindingInfo for 'for' binding must have a UUID/);
  });
});
