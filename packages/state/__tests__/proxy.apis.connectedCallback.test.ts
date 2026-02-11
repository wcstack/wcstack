import { describe, it, expect, vi, beforeEach } from 'vitest';
import { connectedCallback } from '../src/proxy/apis/connectedCallback';
import { STATE_CONNECTED_CALLBACK_NAME } from '../src/define';

describe('proxy/apis/connectedCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('$connectedCallback が定義されている場合、receiver の this コンテキストで呼び出されること', async () => {
    const callbackFn = vi.fn().mockResolvedValue(undefined);
    const target = { [STATE_CONNECTED_CALLBACK_NAME]: callbackFn };
    const receiver = { name: 'proxy-receiver' };
    const handler = {} as any;

    await connectedCallback(target, 'connectedCallback', receiver, handler);

    expect(callbackFn).toHaveBeenCalledTimes(1);
    expect(callbackFn.mock.instances[0]).toBe(receiver);
  });

  it('$connectedCallback が非同期関数の場合、await で完了を待つこと', async () => {
    const order: string[] = [];
    const callbackFn = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      order.push('callback-done');
    });
    const target = { [STATE_CONNECTED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const handler = {} as any;

    const promise = connectedCallback(target, 'connectedCallback', receiver, handler);
    order.push('after-call');
    await promise;
    order.push('after-await');

    expect(order).toEqual(['after-call', 'callback-done', 'after-await']);
  });

  it('$connectedCallback が定義されていない場合、何もしないこと', async () => {
    const target = {};
    const receiver = {};
    const handler = {} as any;

    await expect(connectedCallback(target, 'connectedCallback', receiver, handler)).resolves.toBeUndefined();
  });

  it('$connectedCallback が関数でない場合、呼び出さないこと', async () => {
    const target = { [STATE_CONNECTED_CALLBACK_NAME]: 'not-a-function' };
    const receiver = {};
    const handler = {} as any;

    await expect(connectedCallback(target, 'connectedCallback', receiver, handler)).resolves.toBeUndefined();
  });

  it('$connectedCallback が同期関数でも動作すること', async () => {
    const callbackFn = vi.fn().mockReturnValue(undefined);
    const target = { [STATE_CONNECTED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const handler = {} as any;

    await connectedCallback(target, 'connectedCallback', receiver, handler);

    expect(callbackFn).toHaveBeenCalledTimes(1);
  });

  it('$connectedCallback が例外を投げた場合、reject されること', async () => {
    const error = new Error('callback error');
    const callbackFn = vi.fn().mockRejectedValue(error);
    const target = { [STATE_CONNECTED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const handler = {} as any;

    await expect(connectedCallback(target, 'connectedCallback', receiver, handler)).rejects.toThrow('callback error');
  });
});
