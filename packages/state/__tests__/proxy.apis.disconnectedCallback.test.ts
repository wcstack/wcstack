import { describe, it, expect, vi, beforeEach } from 'vitest';
import { disconnectedCallback } from '../src/proxy/apis/disconnectedCallback';
import { STATE_DISCONNECTED_CALLBACK_NAME } from '../src/define';

describe('proxy/apis/disconnectedCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('$disconnectedCallback が定義されている場合、receiver の this コンテキストで呼び出されること', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_DISCONNECTED_CALLBACK_NAME]: callbackFn };
    const receiver = { name: 'proxy-receiver' };
    const handler = {} as any;

    disconnectedCallback(target, 'disconnectedCallback', receiver, handler);

    expect(callbackFn).toHaveBeenCalledTimes(1);
    expect(callbackFn.mock.instances[0]).toBe(receiver);
  });

  it('$disconnectedCallback が定義されていない場合、何もしないこと', () => {
    const target = {};
    const receiver = {};
    const handler = {} as any;

    expect(() => disconnectedCallback(target, 'disconnectedCallback', receiver, handler)).not.toThrow();
  });

  it('$disconnectedCallback が関数でない場合、呼び出さないこと', () => {
    const target = { [STATE_DISCONNECTED_CALLBACK_NAME]: 42 };
    const receiver = {};
    const handler = {} as any;

    expect(() => disconnectedCallback(target, 'disconnectedCallback', receiver, handler)).not.toThrow();
  });

  it('同期的に実行されること（Promise を返さないこと）', () => {
    const callbackFn = vi.fn();
    const target = { [STATE_DISCONNECTED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const handler = {} as any;

    const result = disconnectedCallback(target, 'disconnectedCallback', receiver, handler);

    expect(result).toBeUndefined();
    expect(callbackFn).toHaveBeenCalledTimes(1);
  });

  it('$disconnectedCallback が例外を投げた場合、そのまま throw されること', () => {
    const error = new Error('cleanup error');
    const callbackFn = vi.fn().mockImplementation(() => { throw error; });
    const target = { [STATE_DISCONNECTED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const handler = {} as any;

    expect(() => disconnectedCallback(target, 'disconnectedCallback', receiver, handler)).toThrow('cleanup error');
  });

  it('async 関数が渡された場合、await せず同期的に戻ること', () => {
    const callbackFn = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    const target = { [STATE_DISCONNECTED_CALLBACK_NAME]: callbackFn };
    const receiver = {};
    const handler = {} as any;

    const result = disconnectedCallback(target, 'disconnectedCallback', receiver, handler);

    // 同期関数なので void を返す（Promise を返さない）
    expect(result).toBeUndefined();
    expect(callbackFn).toHaveBeenCalledTimes(1);
  });
});
