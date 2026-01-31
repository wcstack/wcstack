import { describe, it, expect } from 'vitest';
import { applyChange } from '../src/apply/applyChange';
import type { IBindingInfo } from '../src/types';

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

    applyChange(bindingInfo, 'b');
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

    applyChange(bindingInfo, 'hello');
    expect(input.value).toBe('hello');
  });

  it('forバインディングでuuidがない場合はエラーになること', () => {
    const placeholder = document.createComment('for');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'for',
      node: placeholder,
      replaceNode: placeholder,
      propName: 'for',
      propSegments: []
    } as IBindingInfo;

    expect(() => applyChange(bindingInfo, [])).toThrow(/BindingInfo for 'for' binding must have a UUID/);
  });

  it('ifバインディングでuuidがない場合はエラーになること', () => {
    const placeholder = document.createComment('if');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'if',
      node: placeholder,
      replaceNode: placeholder,
      propName: 'if',
      propSegments: []
    } as IBindingInfo;

    expect(() => applyChange(bindingInfo, true)).toThrow(/BindingInfo for 'if' or 'else' or 'elseif' binding must have a UUID/);
  });

  it('elseバインディングでuuidがない場合はエラーになること', () => {
    const placeholder = document.createComment('else');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'else',
      node: placeholder,
      replaceNode: placeholder,
      propName: 'else',
      propSegments: []
    } as IBindingInfo;

    expect(() => applyChange(bindingInfo, true)).toThrow(/BindingInfo for 'if' or 'else' or 'elseif' binding must have a UUID/);
  });

  it('elseifバインディングでuuidがない場合はエラーになること', () => {
    const placeholder = document.createComment('elseif');
    const bindingInfo: IBindingInfo = {
      ...createBaseBindingInfo(),
      bindingType: 'elseif',
      node: placeholder,
      replaceNode: placeholder,
      propName: 'elseif',
      propSegments: []
    } as IBindingInfo;

    expect(() => applyChange(bindingInfo, true)).toThrow(/BindingInfo for 'if' or 'else' or 'elseif' binding must have a UUID/);
  });
});
