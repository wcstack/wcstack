import { describe, it, expect, vi } from 'vitest';
import { attachTwowayEventHandler, detachTwowayEventHandler } from '../src/event/twowayHandler';
import type { IBindingInfo } from '../src/types';

function createBindingInfo(node: Element, overrides?: Partial<IBindingInfo>): IBindingInfo {
  return {
    propName: 'value',
    propSegments: ['value'],
    propModifiers: [],
    statePathName: 'users.*.name',
    statePathInfo: null,
    stateName: 'default',
    filterTexts: [],
    bindingType: 'prop',
    uuid: null,
    node,
    placeHolderNode: node,
    ...overrides,
  } as IBindingInfo;
}

describe('event/twowayHandler', () => {
  it('two-way対象でイベントを登録できること', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const addSpy = vi.spyOn(input, 'addEventListener');

    const binding = createBindingInfo(input, { statePathName: 'users.*.name-input' });
    expect(attachTwowayEventHandler(binding)).toBe(true);
    expect(addSpy).toHaveBeenCalledWith('input', expect.any(Function));
  });

  it('modifierでイベント名を変更できること', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const addSpy = vi.spyOn(input, 'addEventListener');

    const binding = createBindingInfo(input, { propModifiers: ['onchange'], statePathName: 'users.*.name-change' });
    attachTwowayEventHandler(binding);
    expect(addSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('同じキーならハンドラを共有すること', () => {
    const input1 = document.createElement('input');
    input1.setAttribute('type', 'text');
    const input2 = document.createElement('input');
    input2.setAttribute('type', 'text');

    const addSpy1 = vi.spyOn(input1, 'addEventListener');
    const addSpy2 = vi.spyOn(input2, 'addEventListener');

    const binding1 = createBindingInfo(input1, { statePathName: 'users.*.name-share' });
    const binding2 = createBindingInfo(input2, { statePathName: 'users.*.name-share' });

    attachTwowayEventHandler(binding1);
    attachTwowayEventHandler(binding2);

    const handler1 = addSpy1.mock.calls[0]?.[1];
    const handler2 = addSpy2.mock.calls[0]?.[1];
    expect(handler1).toBe(handler2);
  });

  it('detachTwowayEventHandlerで解除できること', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const addSpy = vi.spyOn(input, 'addEventListener');
    const removeSpy = vi.spyOn(input, 'removeEventListener');

    const binding = createBindingInfo(input, { statePathName: 'users.*.name-detach' });
    attachTwowayEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1];

    expect(detachTwowayEventHandler(binding)).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith('input', handler);
    expect(detachTwowayEventHandler(binding)).toBe(false);
  });

  it('two-way対象外はfalseを返すこと', () => {
    const div = document.createElement('div');
    const binding = createBindingInfo(div, { propName: 'value', statePathName: 'users.*.name-non' });
    expect(attachTwowayEventHandler(binding)).toBe(false);
  });
});
