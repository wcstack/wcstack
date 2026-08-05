import { describe, it, expect, vi } from 'vitest';
import { getterFn, setterFn, callFn, isInternalProperty } from '../src/dcc/dccPropertyFactories';

describe('dcc/dccPropertyFactories', () => {
  function createMockElement(initialized = true) {
    const stateObj: Record<string, any> = {};
    return {
      stateElement: {
        initialized,
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

    // §2.2: state のロード前は「まだ値が無い」だけなので警告しない。
    // fragment 上の行に対する初期スナップショット読みが必ずここを通るため。
    it('未初期化のstateElementでは警告せずundefinedを返すこと', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { stateElement, stateObj } = createMockElement(false);
      stateObj.count = 42;

      expect(getterFn('count').call({ stateElement } as any)).toBeUndefined();
      expect(stateElement.createState).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('createStateがエラーの場合はconsole.warnで通知してundefinedを返すこと', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const stateElement = {
        initialized: true,
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
    // §2.2: getter は同期なので、setter を常に initializePromise 経由にすると
    // `el.count = 5; el.count` が旧値を返す。初期化済みなら同期で書く。
    it('初期化済みなら同期で書き込むこと', () => {
      const { stateElement, stateObj } = createMockElement();
      setterFn('count').call({ stateElement } as any, 99);
      expect(stateObj.count).toBe(99);
      expect(stateElement.createState).toHaveBeenCalledWith('writable', expect.any(Function));
    });

    // §1.4: 未接続の行に書かれた値が捨てられないための遅延経路は残す。
    it('未初期化なら初期化後に書き込むこと', async () => {
      const { stateElement, stateObj } = createMockElement(false);
      setterFn('count').call({ stateElement } as any, 99);
      expect(stateObj.count).toBeUndefined();

      await Promise.resolve();
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
