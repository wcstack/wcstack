import { describe, it, expect, vi } from 'vitest';
import { attachEventHandler, detachEventHandler } from '../src/event/handler';
import type { IBindingInfo } from '../src/types';

function createBindingInfo(node: Element, overrides?: Partial<IBindingInfo>): IBindingInfo {
  return {
    propName: 'onclick',
    propSegments: ['onclick'],
    propModifiers: [],
    statePathName: 'handleClick',
    statePathInfo: null,
    stateName: 'default',
    filterTexts: [],
    bindingType: 'event',
    uuid: null,
    node,
    placeHolderNode: node,
    ...overrides,
  } as IBindingInfo;
}

describe('event/handler', () => {
  it('attachEventHandlerはon*以外でfalseを返すこと', () => {
    const el = document.createElement('button');
    const bindingInfo = createBindingInfo(el, {
      propName: 'value',
      propSegments: ['value'],
      statePathName: 'handleClick-none'
    });
    expect(attachEventHandler(bindingInfo)).toBe(false);
  });

  it('同じキーのハンドラを共有すること', () => {
    const el1 = document.createElement('button');
    const el2 = document.createElement('button');

    const addSpy1 = vi.spyOn(el1, 'addEventListener');
    const addSpy2 = vi.spyOn(el2, 'addEventListener');

    const binding1 = createBindingInfo(el1, { statePathName: 'handleClick-share' });
    const binding2 = createBindingInfo(el2, { statePathName: 'handleClick-share' });

    expect(attachEventHandler(binding1)).toBe(true);
    expect(attachEventHandler(binding2)).toBe(true);

    const handler1 = addSpy1.mock.calls[0]?.[1];
    const handler2 = addSpy2.mock.calls[0]?.[1];
    expect(handler1).toBe(handler2);
  });

  it('detachEventHandlerでイベント解除できること', () => {
    const el = document.createElement('button');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const removeSpy = vi.spyOn(el, 'removeEventListener');

    const binding = createBindingInfo(el, { statePathName: 'handleClick-detach' });
    attachEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1];

    expect(detachEventHandler(binding)).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith('click', handler);
    // 2回目は対象が無いのでfalse
    expect(detachEventHandler(binding)).toBe(false);
  });
});
