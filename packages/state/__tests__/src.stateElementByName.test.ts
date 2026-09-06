import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

vi.mock('../src/buildBindings', () => ({
  buildBindings: vi.fn().mockResolvedValue(undefined)
}));

import { getStateElement, setStateElement, getBindingsReady } from '../src/stateElementByName';
import { buildBindings } from '../src/buildBindings';
import { config } from '../src/config';


describe('stateElementByName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    setStateElement(document, null);
    setStateElement(document, null);
    setStateElement(document, null);
  });

  it('set/getできること', () => {
    const fake = { name: 'custom' } as any;
    setStateElement(document, fake);
    expect(getStateElement(document)).toBe(fake);

    setStateElement(document, null);
    expect(getStateElement(document)).toBeNull();
  });

  it('同じ名前で二重登録するとエラーになること', () => {
    const fake1 = { name: 'custom' } as any;
    const fake2 = { name: 'custom' } as any;
    setStateElement(document, fake1);
    expect(() => setStateElement(document, fake2)).toThrow(/already registered/);
  });

  it('解除後は再登録できること', () => {
    const fake1 = { name: 'custom' } as any;
    const fake2 = { name: 'custom' } as any;
    setStateElement(document, fake1);
    setStateElement(document, null);
    setStateElement(document, fake2);
    expect(getStateElement(document)).toBe(fake2);
  });

  it('未登録の名前はnullを返すこと', () => {
    expect(getStateElement(document)).toBeNull();
  });

  it('debugモードがfalseの場合でも動作すること', () => {
    const originalDebug = config.debug;
    config.debug = false;
    try {
      const fake = { name: 'debug' } as any;
      setStateElement(document, fake);
      expect(getStateElement(document)).toBe(fake);
      setStateElement(document, null);
      expect(getStateElement(document)).toBeNull();
    } finally {
      config.debug = originalDebug;
    }
  });

  it('未登録のrootNodeに対してgetするとnullを返すこと', () => {
    const freshNode = document.createElement('div');
    expect(getStateElement(freshNode)).toBeNull();
  });

  it('debugモードがtrueの場合、登録・解除でconsole.debugが呼ばれること', () => {
    const originalDebug = config.debug;
    config.debug = true;
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const freshNode = document.createElement('div');
      const fake = { name: 'test' } as any;

      setStateElement(freshNode, fake);
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('registered'),
        fake
      );

      debugSpy.mockClear();

      setStateElement(freshNode, null);
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
      setStateElement(document, fake);

      // queueMicrotaskで非同期実行されるため、次のマイクロタスクを待つ
      await new Promise(resolve => queueMicrotask(resolve));

      expect(buildBindings).toHaveBeenCalledWith(document);
    });

    it('ShadowRootに初めて登録する場合、buildBindingsが呼ばれること', async () => {
      const component = document.createElement('div');
      const shadowRoot = component.attachShadow({ mode: 'open' });
      const fake = { name: 'test' } as any;

      setStateElement(shadowRoot, fake);

      // queueMicrotaskで非同期実行されるため、次のマイクロタスクを待つ
      await new Promise(resolve => queueMicrotask(resolve));

      expect(buildBindings).toHaveBeenCalledWith(shadowRoot);
    });

    it('同じrootNodeへの2回目の登録は v2 でエラーになり、buildBindingsも再実行されないこと', async () => {
      const fake1 = { name: 'test1' } as any;
      const fake2 = { name: 'test2' } as any;

      setStateElement(document, fake1);
      await new Promise(resolve => queueMicrotask(resolve));

      vi.mocked(buildBindings).mockClear();

      expect(() => setStateElement(document, fake2)).toThrow(/already registered on this root/);
      await new Promise(resolve => queueMicrotask(resolve));

      expect(buildBindings).not.toHaveBeenCalled();
    });

    it('通常のNodeに登録する場合、buildBindingsは呼ばれないこと', async () => {
      const normalNode = document.createElement('div');
      const fake = { name: 'test' } as any;

      setStateElement(normalNode, fake);
      await new Promise(resolve => queueMicrotask(resolve));

      expect(buildBindings).not.toHaveBeenCalled();
    });
  });

  describe('getBindingsReady', () => {
    it('未登録の rootNode に対して即座に解決する Promise を返す', async () => {
      const node = document.createElement('div');
      const result = await getBindingsReady(node);
      expect(result).toBeUndefined();
    });

    // §8.2: reject を配管しないと ready が永久に未解決のまま残り、
    // await getBindingsReady() の先が無言でハングする
    // （docs/state-bind-component-nested-for-design.md §8.2）
    it('Document の buildBindings が throw した場合、ready promise が reject すること', async () => {
      const freshDocument = document.implementation.createHTMLDocument();
      vi.mocked(buildBindings).mockRejectedValueOnce(new Error('binding init failed'));
      const fake = { name: 'failing' } as any;

      setStateElement(freshDocument, fake);
      // queueMicrotask 実行前（同期）にハンドラを取り付ける
      const ready = getBindingsReady(freshDocument);

      await expect(ready).rejects.toThrow('binding init failed');
      setStateElement(freshDocument, null);
    });

    it('ShadowRoot の buildBindings が throw した場合、ready promise が reject すること', async () => {
      const component = document.createElement('div');
      const shadowRoot = component.attachShadow({ mode: 'open' });
      vi.mocked(buildBindings).mockRejectedValueOnce(new Error('shadow binding init failed'));
      const fake = { name: 'failing' } as any;

      setStateElement(shadowRoot, fake);
      const ready = getBindingsReady(shadowRoot);

      await expect(ready).rejects.toThrow('shadow binding init failed');
      setStateElement(shadowRoot, null);
    });
  });
});
