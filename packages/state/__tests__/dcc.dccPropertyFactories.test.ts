import { describe, it, expect, vi } from 'vitest';
import { getterFn, setterFn, callFn, isInternalProperty } from '../src/dcc/dccPropertyFactories';

describe('dcc/dccPropertyFactories', () => {
  function createMockElement() {
    const stateObj: Record<string, any> = {};
    return {
      stateElement: {
        initializePromise: Promise.resolve(),
        createState: vi.fn((mutability: string, callback: (state: any) => void) => {
          callback(stateObj);
        }),
        createStateAsync: vi.fn(async (mutability: string, callback: (state: any) => Promise<void>) => {
          await callback(stateObj);
        }),
      },
      stateObj,
    };
  }

  describe('getterFn', () => {
    it('stateElementから値を読み取るgetterを返すこと', () => {
      const { stateElement, stateObj } = createMockElement();
      stateObj.count = 42;
      const getter = getterFn('count');
      const result = getter.call({ stateElement } as any);
      expect(result).toBe(42);
      expect(stateElement.createState).toHaveBeenCalledWith('readonly', expect.any(Function));
    });

    it('stateElementがnullの場合はundefinedを返すこと', () => {
      const getter = getterFn('count');
      const result = getter.call({ stateElement: null } as any);
      expect(result).toBeUndefined();
    });

    it('createStateがエラーの場合はconsole.warnで通知してundefinedを返すこと', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const stateElement = {
        createState: () => { throw new Error('not initialized'); },
      };
      const getter = getterFn('count');
      const result = getter.call({ stateElement } as any);
      expect(result).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('DCC getter "count" failed'),
        expect.any(Error)
      );
      warnSpy.mockRestore();
    });
  });

  describe('setterFn', () => {
    it('stateElementに値を書き込むsetterを返すこと', async () => {
      const { stateElement, stateObj } = createMockElement();
      const setter = setterFn('count');
      setter.call({ stateElement } as any, 99);
      // initializePromise.then 経由なのでマイクロタスクを待つ
      await Promise.resolve();
      expect(stateObj.count).toBe(99);
      expect(stateElement.createState).toHaveBeenCalledWith('writable', expect.any(Function));
    });

    it('stateElementがnullの場合は何もしないこと', () => {
      const setter = setterFn('count');
      expect(() => setter.call({ stateElement: null } as any, 99)).not.toThrow();
    });
  });

  describe('callFn', () => {
    it('同期関数を呼び出すメソッドを返すこと', async () => {
      const { stateElement, stateObj } = createMockElement();
      const mockFn = vi.fn();
      stateObj.inc = mockFn;
      const method = callFn('inc', false);
      method.call({ stateElement } as any, 1, 2);
      await Promise.resolve();
      expect(mockFn).toHaveBeenCalledWith(1, 2);
      expect(stateElement.createState).toHaveBeenCalledWith('writable', expect.any(Function));
    });

    it('非同期関数を呼び出すメソッドを返すこと', async () => {
      const { stateElement, stateObj } = createMockElement();
      const mockFn = vi.fn().mockResolvedValue(undefined);
      stateObj.fetchData = mockFn;
      const method = callFn('fetchData', true);
      await method.call({ stateElement } as any, 'arg1');
      expect(mockFn).toHaveBeenCalledWith('arg1');
      expect(stateElement.createStateAsync).toHaveBeenCalledWith('writable', expect.any(Function));
    });

    it('同期関数の戻り値をPromiseで返すこと', async () => {
      const { stateElement, stateObj } = createMockElement();
      stateObj.add = (a: number, b: number) => a + b;
      const method = callFn('add', false);
      const result = await method.call({ stateElement } as any, 2, 3);
      expect(result).toBe(5);
    });

    it('非同期関数の戻り値をPromiseで返すこと', async () => {
      const { stateElement, stateObj } = createMockElement();
      stateObj.fetchValue = async () => 'fetched';
      const method = callFn('fetchValue', true);
      const result = await method.call({ stateElement } as any);
      expect(result).toBe('fetched');
    });

    it('stateElementがnullの場合は何もしないこと', () => {
      const syncMethod = callFn('inc', false);
      expect(() => syncMethod.call({ stateElement: null } as any)).not.toThrow();
      const asyncMethod = callFn('fetch', true);
      expect(() => asyncMethod.call({ stateElement: null } as any)).not.toThrow();
    });
  });

  describe('isInternalProperty', () => {
    it('$プレフィックスのプロパティはtrueを返すこと', () => {
      expect(isInternalProperty('$bindables')).toBe(true);
      expect(isInternalProperty('$connectedCallback')).toBe(true);
    });

    it('通常のプロパティはfalseを返すこと', () => {
      expect(isInternalProperty('count')).toBe(false);
      expect(isInternalProperty('name')).toBe(false);
    });
  });
});
