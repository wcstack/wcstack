import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Autoloader } from '../src/components/Autoloader';
import * as importmapModule from '../src/importmap';
import * as eagerLoadModule from '../src/eagerload';
import * as lazyLoadModule from '../src/lazyLoad';
import { config } from '../src/config';

if (!customElements.get('wcs-autoloader')) {
  customElements.define('wcs-autoloader', Autoloader);
}

describe('Autoloader', () => {
  let instance: Autoloader | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (instance) {
      instance.disconnectedCallback();
      instance = null;
    }
    vi.restoreAllMocks();
  });

  it('importmapが存在しない場合、buildMapが呼ばれないこと', () => {
    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(null);
    const buildMapSpy = vi.spyOn(importmapModule, 'buildMap');

    instance = document.createElement('wcs-autoloader') as Autoloader;

    expect(buildMapSpy).not.toHaveBeenCalled();
  });

  it('importmapが存在する場合、eagerLoadが開始されること', () => {
    const mockImportmap = { imports: {} };
    const mockLoadMap = { 'my-tag': {} as any };
    const mockPrefixMap = {};

    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(mockImportmap);
    vi.spyOn(importmapModule, 'buildMap').mockReturnValue({
      loadMap: mockLoadMap,
      prefixMap: mockPrefixMap
    } as any);
    const eagerLoadSpy = vi.spyOn(eagerLoadModule, 'eagerLoad').mockResolvedValue();

    instance = document.createElement('wcs-autoloader') as Autoloader;

    expect(eagerLoadSpy).toHaveBeenCalledWith(mockLoadMap, config.loaders);
  });

  it('connectedCallbackでlazyLoadが実行されること', async () => {
    const mockImportmap = { imports: {} };
    const mockLoadMap = {};
    const mockPrefixMap = { 'ui': {} as any };

    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(mockImportmap);
    vi.spyOn(importmapModule, 'buildMap').mockReturnValue({
      loadMap: mockLoadMap,
      prefixMap: mockPrefixMap
    } as any);
    vi.spyOn(eagerLoadModule, 'eagerLoad').mockResolvedValue();
    const lazyLoadSpy = vi.spyOn(lazyLoadModule, 'handlerForLazyLoad').mockResolvedValue(null);

    instance = document.createElement('wcs-autoloader') as Autoloader;
    await instance.connectedCallback();

    expect(lazyLoadSpy).toHaveBeenCalledWith(document, config, mockPrefixMap);
  });

  it('document.readyStateがloadingの場合、DOMContentLoadedを待つこと', async () => {
    const mockImportmap = { imports: {} };
    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(mockImportmap);
    vi.spyOn(importmapModule, 'buildMap').mockReturnValue({
      loadMap: {},
      prefixMap: { 'ui': {} as any }
    } as any);
    vi.spyOn(eagerLoadModule, 'eagerLoad').mockResolvedValue();
    const lazyLoadSpy = vi.spyOn(lazyLoadModule, 'handlerForLazyLoad').mockResolvedValue(null);

    const originalReadyState = document.readyState;
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });

    instance = document.createElement('wcs-autoloader') as Autoloader;
    const connectedPromise = instance.connectedCallback();

    // DOMContentLoaded前はlazyLoadが呼ばれないこと
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(lazyLoadSpy).not.toHaveBeenCalled();

    // DOMContentLoadedを発火
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await connectedPromise;

    expect(lazyLoadSpy).toHaveBeenCalled();

    Object.defineProperty(document, 'readyState', { value: originalReadyState, configurable: true });
  });

  it('2回目のインスタンス生成でエラーがスローされること', () => {
    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(null);

    instance = document.createElement('wcs-autoloader') as Autoloader;

    expect(() => new Autoloader()).toThrow(/can only be instantiated once/);
  });

  it('eagerLoadが失敗した場合、console.errorが出力されること', async () => {
    const mockImportmap = { imports: {} };
    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(mockImportmap);
    vi.spyOn(importmapModule, 'buildMap').mockReturnValue({
      loadMap: { 'my-tag': {} as any },
      prefixMap: {}
    } as any);
    vi.spyOn(eagerLoadModule, 'eagerLoad').mockRejectedValue(new Error('Eager load failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    instance = document.createElement('wcs-autoloader') as Autoloader;

    // fire-and-forgetのPromiseが解決するのを待つ
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to eager load components:',
      expect.any(Error)
    );
  });

  it('2回目のconnectedCallbackではlazyLoadが実行されないこと', async () => {
    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue({ imports: {} });
    vi.spyOn(importmapModule, 'buildMap').mockReturnValue({
      loadMap: {},
      prefixMap: { 'ui': {} as any }
    } as any);
    vi.spyOn(eagerLoadModule, 'eagerLoad').mockResolvedValue();
    const lazyLoadSpy = vi.spyOn(lazyLoadModule, 'handlerForLazyLoad').mockResolvedValue(null);

    instance = document.createElement('wcs-autoloader') as Autoloader;
    await instance.connectedCallback();
    expect(lazyLoadSpy).toHaveBeenCalledTimes(1);

    await instance.connectedCallback();
    expect(lazyLoadSpy).toHaveBeenCalledTimes(1);
  });

  it('disconnectedCallbackでMutationObserverがdisconnectされること', async () => {
    const mockObserver = { disconnect: vi.fn(), observe: vi.fn(), takeRecords: vi.fn() };

    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue({ imports: {} });
    vi.spyOn(importmapModule, 'buildMap').mockReturnValue({
      loadMap: {},
      prefixMap: { 'ui': {} as any }
    } as any);
    vi.spyOn(eagerLoadModule, 'eagerLoad').mockResolvedValue();
    vi.spyOn(lazyLoadModule, 'handlerForLazyLoad').mockResolvedValue(mockObserver as any);

    instance = document.createElement('wcs-autoloader') as Autoloader;
    await instance.connectedCallback();

    instance.disconnectedCallback();
    expect(mockObserver.disconnect).toHaveBeenCalled();
    instance = null;
  });

  it('disconnectedCallbackでシングルトンがクリアされ再生成可能になること', () => {
    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(null);

    instance = document.createElement('wcs-autoloader') as Autoloader;
    instance.disconnectedCallback();

    // シングルトンがクリアされたので新しいインスタンスが作れる
    const instance2 = document.createElement('wcs-autoloader') as Autoloader;
    expect(instance2).toBeInstanceOf(Autoloader);

    instance = instance2;
  });

  it('シングルトンでないインスタンスのdisconnectedCallbackはシングルトンをクリアしないこと', () => {
    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(null);

    // instanceAを作成→シングルトンになる
    const instanceA = document.createElement('wcs-autoloader') as Autoloader;
    // instanceAをdisconnect→シングルトンクリア
    instanceA.disconnectedCallback();

    // instanceBを作成→新しいシングルトンになる
    const instanceB = document.createElement('wcs-autoloader') as Autoloader;

    // instanceAのdisconnectedCallbackを再度呼ぶ→instanceBはクリアされない
    instanceA.disconnectedCallback();

    // instanceBはまだ有効なので、新しいインスタンスは作れない
    expect(() => new Autoloader()).toThrow(/can only be instantiated once/);

    instance = instanceB;
  });

  it('prefixMapが空の場合、connectedCallbackでlazyLoadが実行されないこと', async () => {
    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(null);
    const lazyLoadSpy = vi.spyOn(lazyLoadModule, 'handlerForLazyLoad');

    instance = document.createElement('wcs-autoloader') as Autoloader;
    await instance.connectedCallback();

    expect(lazyLoadSpy).not.toHaveBeenCalled();
  });
});
