import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Router } from '../src/components/Router';
import { createOutlet } from '../src/components/Outlet';
import * as applyRouteModule from '../src/applyRoute';
import * as parseModule from '../src/parse';
import './setup';

describe('Router', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (Router as any)._instance = null;
  });

  afterEach(() => {
    (Router as any)._instance = null;
    delete (window as any).navigation;
    document.head.querySelectorAll('base').forEach((base) => base.remove());
  });

  it('Routerクラスが存在すること', () => {
    expect(Router).toBeDefined();
    expect(typeof Router).toBe('function');
  });

  it('HTMLElementを継承してぁE��こと', () => {
    expect(Object.getPrototypeOf(Router.prototype)).toBe(HTMLElement.prototype);
  });

  it('インスタンスを作�Eできること', () => {
    const router = document.createElement('wcs-router') as Router;
    expect(router).toBeInstanceOf(Router);
    expect(router).toBeInstanceOf(HTMLElement);
  });

  it('シングルトンパターンであること', () => {
    const router1 = document.createElement('wcs-router') as Router;
    expect(() => {
      document.createElement('wcs-router');
    }).toThrow();
  });

  it('静的なinstanceプロパティでインスタンスにアクセスできること', () => {
    const router = document.createElement('wcs-router') as Router;
    expect(Router.instance).toBe(router);
  });

  it('インスタンス化前にinstanceにアクセスするとエラーになること', () => {
    expect(() => {
      Router.instance;
    }).toThrow();
  });

  it('basenameプロパティを持つこと', () => {
    const router = document.createElement('wcs-router') as Router;
    expect(router.basename).toBeDefined();
    expect(typeof router.basename).toBe('string');
  });

  it('navigate静的メソチE��を持つこと', () => {
    expect(typeof Router.navigate).toBe('function');
  });

  it('静的navigateがインスタンスのnavigateを呼ぶこと', async () => {
    const router = document.createElement('wcs-router') as Router;
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(undefined);

    Router.navigate('/static');

    expect(navigateSpy).toHaveBeenCalledWith('/static');
  });

  describe('properties', () => {
    it('routeChildNodesを取得できること', () => {
      const router = document.createElement('wcs-router') as Router;
      const list = router.routeChildNodes;
      expect(Array.isArray(list)).toBe(true);
      expect(list).toBe((router as any)._routeChildNodes);
    });

    it('pathのgetter/setterが動作すること', () => {
      const router = document.createElement('wcs-router') as Router;
      router.path = '/current';
      expect(router.path).toBe('/current');
    });
  });

  describe('private helpers', () => {
    it('_normalizePathがパスを正規化すること', () => {
      const router = document.createElement('wcs-router') as Router;
      const normalized = (router as any)._normalizePath('foo/bar');
      expect(normalized).toBe('/foo/');

      const normalizedWithSlashes = (router as any)._normalizePath('//foo//bar');
      expect(normalizedWithSlashes).toBe('/foo/');
    });

    it('_getBasenameがbaseタグのパスを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      const base = document.createElement('base');
      base.setAttribute('href', 'http://localhost/app/');
      document.head.appendChild(base);

      const basename = (router as any)._getBasename();
      expect(basename).toBe('/app/');
    });

    it('_getBasenameがルート�E場合�E空斁E��を返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      const base = document.createElement('base');
      base.setAttribute('href', 'http://localhost/');
      document.head.appendChild(base);

      const basename = (router as any)._getBasename();
      expect(basename).toBe('');
    });

    it('_getBasenameがpathname空斁E���E場合�E空斁E��を返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      const originalURL = (globalThis as any).URL;
      class MockURL {
        pathname = '';
        constructor(_: string) {}
      }
      (globalThis as any).URL = MockURL as any;

      const basename = (router as any)._getBasename();
      expect(basename).toBe('');

      (globalThis as any).URL = originalURL;
    });

    it('_getOutletが既存�EOutletを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      const outlet = createOutlet();
      document.body.appendChild(outlet);

      const found = (router as any)._getOutlet();
      expect(found).toBe(outlet);
    });

    it('_getOutletがOutletを生成して追加すること', () => {
      const router = document.createElement('wcs-router') as Router;
      const found = (router as any)._getOutlet();
      expect(found.tagName.toLowerCase()).toBe('wcs-outlet');
      expect(document.body.contains(found)).toBe(true);
    });

    it('outlet未設定�E場合�Eエラーになること', () => {
      const router = document.createElement('wcs-router') as Router;
      expect(() => router.outlet).toThrow('[@wcstack/router] wcs-router has no outlet.');
    });

    it('template未設定�E場合�Eエラーになること', () => {
      const router = document.createElement('wcs-router') as Router;
      expect(() => router.template).toThrow('[@wcstack/router] wcs-router has no template.');
    });
  });

  describe('navigate', () => {
    it('navigation APIがある場合�Enavigation.navigateを呼ぶこと', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '/base';
      const navigation = {
        navigate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      (window as any).navigation = navigation;

      await router.navigate('/path');

      expect(navigation.navigate).toHaveBeenCalledWith('/base/path');
    });

    it('navigation APIがなぁE��合�EapplyRouteを呼ぶこと', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '/base';
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;
      router.path = '/prev';

      const pushStateSpy = vi.spyOn(history, 'pushState');
      const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(undefined);

      await router.navigate('/path');

      expect(pushStateSpy).toHaveBeenCalledWith(null, '', '/base/path');
      expect(applySpy).toHaveBeenCalledWith(router, router.outlet, '/base/path', '/prev');
    });
  });

  describe('_onNavigateFunc', () => {
    it('canInterceptがfalseの場合�E何もしなぁE��と', () => {
      const router = document.createElement('wcs-router') as Router;
      const navEvent = {
        canIntercept: false,
        hashChange: false,
        downloadRequest: null,
        intercept: vi.fn(),
      };

      (router as any)._onNavigateFunc(navEvent);
      expect(navEvent.intercept).not.toHaveBeenCalled();
    });

    it('interceptハンドラー冁E��applyRouteを呼ぶこと', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;
      (router as any)._path = '/prev';

      const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(undefined);
      let capturedHandler: (() => Promise<void>) | null = null;

      const navEvent = {
        canIntercept: true,
        hashChange: false,
        downloadRequest: null,
        destination: { url: 'http://localhost/next' },
        intercept: ({ handler }: { handler: () => Promise<void> }) => {
          capturedHandler = handler;
        },
      };

      (router as any)._onNavigateFunc(navEvent);
      expect(capturedHandler).not.toBeNull();

      await capturedHandler!.call({ _path: '/prev' });
      expect(applySpy).toHaveBeenCalledWith(router, router.outlet, '/next', '/prev');
    });
  });

  describe('_initialize', () => {
    it('basenameが空でbaseタグがなくパスぁE以外�E場合�Eエラーになること', async () => {
      const router = document.createElement('wcs-router') as Router;
      router.setAttribute('basename', '');

      (router as any)._getBasename = vi.fn(() => '');

      const originalURL = (globalThis as any).URL;
      class MockURL {
        pathname = '/other';
        constructor(_: string) {}
      }
      (globalThis as any).URL = MockURL as any;

      let errorThrown = false;
      try {
        await (router as any)._initialize();
      } catch (error) {
        errorThrown = true;
        expect((error as Error).message).toBe('[@wcstack/router] wcs-router basename is empty, but current path is not "/".');
      }
      expect(errorThrown).toBe(true);

      (globalThis as any).URL = originalURL;
    });

    it('templateとoutletを設定し初期化できること', async () => {
      const router = document.createElement('wcs-router') as Router;
      router.setAttribute('basename', '/app');

      const template = document.createElement('template');
      template.innerHTML = '<div>content</div>';
      router.appendChild(template);

      const fragment = document.createDocumentFragment();
      fragment.appendChild(document.createElement('div'));
      const parseSpy = vi.spyOn(parseModule, 'parse').mockResolvedValue(fragment);
      const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(undefined);

      await (router as any)._initialize();

      expect(parseSpy).toHaveBeenCalledWith(router);
      expect(router.outlet).toBeDefined();
      expect(router.template).toBe(template);
      expect(applySpy).toHaveBeenCalled();
    });

    it('templateがなぁE��合にエラーになること', async () => {
      const router = document.createElement('wcs-router') as Router;
      router.setAttribute('basename', '/app');

      let errorThrown = false;
      try {
        await (router as any)._initialize();
      } catch (error) {
        errorThrown = true;
        expect((error as Error).message).toBe('[@wcstack/router] wcs-router should have a <template> child element.');
      }
      expect(errorThrown).toBe(true);
    });
  });

  describe('connected/disconnected', () => {
    it('connectedCallbackで初期化しnavigateイベントを登録すること', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._initialize = vi.fn().mockResolvedValue(undefined);

      const navigation = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
      (window as any).navigation = navigation;

      await router.connectedCallback();

      expect((router as any)._initialize).toHaveBeenCalled();
      expect(navigation.addEventListener).toHaveBeenCalledWith('navigate', (router as any)._onNavigate);
    });

    it('初期化済みの場合�E初期化を再実行しなぁE��と', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._initialized = true;
      (router as any)._initialize = vi.fn().mockResolvedValue(undefined);

      const navigation = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
      (window as any).navigation = navigation;

      await router.connectedCallback();

      expect((router as any)._initialize).not.toHaveBeenCalled();
      expect(navigation.addEventListener).toHaveBeenCalledWith('navigate', (router as any)._onNavigate);
    });

    it('disconnectedCallbackでnavigateイベントを解除すること', () => {
      const router = document.createElement('wcs-router') as Router;
      const navigation = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
      (window as any).navigation = navigation;

      router.disconnectedCallback();

      expect(navigation.removeEventListener).toHaveBeenCalledWith('navigate', (router as any)._onNavigate);
    });
  });
});
