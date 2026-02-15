import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

vi.mock('../src/buildBindings', () => ({
  buildBindings: vi.fn().mockResolvedValue(undefined)
}));

import { getStateElementByName, setStateElementByName } from '../src/stateElementByName';
import { buildBindings } from '../src/buildBindings';
import { config } from '../src/config';


describe('stateElementByName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    setStateElementByName(document, 'default', null);
    setStateElementByName(document, 'custom', null);
    setStateElementByName(document, 'debug', null);
  });

  it('set/getできること', () => {
    const fake = { name: 'custom' } as any;
    setStateElementByName(document, 'custom', fake);
    expect(getStateElementByName(document, 'custom')).toBe(fake);

    setStateElementByName(document, 'custom', null);
    expect(getStateElementByName(document, 'custom')).toBeNull();
  });

  it('同じ名前で二重登録するとエラーになること', () => {
    const fake1 = { name: 'custom' } as any;
    const fake2 = { name: 'custom' } as any;
    setStateElementByName(document, 'custom', fake1);
    expect(() => setStateElementByName(document, 'custom', fake2)).toThrow(/already registered/);
  });

  it('解除後は再登録できること', () => {
    const fake1 = { name: 'custom' } as any;
    const fake2 = { name: 'custom' } as any;
    setStateElementByName(document, 'custom', fake1);
    setStateElementByName(document, 'custom', null);
    setStateElementByName(document, 'custom', fake2);
    expect(getStateElementByName(document, 'custom')).toBe(fake2);
  });

  it('未登録の名前はnullを返すこと', () => {
    expect(getStateElementByName(document, 'nonexistent')).toBeNull();
  });

  it('debugモードがfalseの場合でも動作すること', () => {
    const originalDebug = config.debug;
    config.debug = false;
    try {
      const fake = { name: 'debug' } as any;
      setStateElementByName(document, 'debug', fake);
      expect(getStateElementByName(document, 'debug')).toBe(fake);
      setStateElementByName(document, 'debug', null);
      expect(getStateElementByName(document, 'debug')).toBeNull();
    } finally {
      config.debug = originalDebug;
    }
  });

  it('未登録のrootNodeに対してgetするとnullを返すこと', () => {
    const freshNode = document.createElement('div');
    expect(getStateElementByName(freshNode, 'any')).toBeNull();
  });

  it('debugモードがtrueの場合、登録・解除でconsole.debugが呼ばれること', () => {
    const originalDebug = config.debug;
    config.debug = true;
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const freshNode = document.createElement('div');
      const fake = { name: 'test' } as any;

      setStateElementByName(freshNode, 'test', fake);
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('registered'),
        fake
      );

      debugSpy.mockClear();

      setStateElementByName(freshNode, 'test', null);
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('unregistered')
      );
    } finally {
      debugSpy.mockRestore();
      config.debug = originalDebug;
    }
  });

  describe('buildBindings自動呼び出し', () => {
    it('Documentに初めて登録する場合、buildBindingsが呼ばれること', async () => {
      const fake = { name: 'test' } as any;
      setStateElementByName(document, 'test', fake);

      // queueMicrotaskで非同期実行されるため、次のマイクロタスクを待つ
      await new Promise(resolve => queueMicrotask(resolve));

      expect(buildBindings).toHaveBeenCalledWith(document);
    });

    it('ShadowRootに初めて登録する場合、buildBindingsが呼ばれること', async () => {
      const component = document.createElement('div');
      const shadowRoot = component.attachShadow({ mode: 'open' });
      const fake = { name: 'test' } as any;

      setStateElementByName(shadowRoot, 'test', fake);

      // queueMicrotaskで非同期実行されるため、次のマイクロタスクを待つ
      await new Promise(resolve => queueMicrotask(resolve));

      expect(buildBindings).toHaveBeenCalledWith(shadowRoot);
    });

    it('同じrootNodeに2回目の登録をする場合、buildBindingsは呼ばれないこと', async () => {
      const fake1 = { name: 'test1' } as any;
      const fake2 = { name: 'test2' } as any;

      setStateElementByName(document, 'test1', fake1);
      await new Promise(resolve => queueMicrotask(resolve));

      vi.mocked(buildBindings).mockClear();

      setStateElementByName(document, 'test2', fake2);
      await new Promise(resolve => queueMicrotask(resolve));

      expect(buildBindings).not.toHaveBeenCalled();
    });

    it('通常のNodeに登録する場合、buildBindingsは呼ばれないこと', async () => {
      const normalNode = document.createElement('div');
      const fake = { name: 'test' } as any;

      setStateElementByName(normalNode, 'test', fake);
      await new Promise(resolve => queueMicrotask(resolve));

      expect(buildBindings).not.toHaveBeenCalled();
    });
  });
});
