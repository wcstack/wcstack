import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Router } from '../src/components/Router';
import { createOutlet } from '../src/components/Outlet';
import { config, setConfig } from '../src/config';
import * as applyRouteModule from '../src/applyRoute';
import * as parseModule from '../src/parse';
import './setup';

describe('Router', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    delete (window as any).navigation;
    document.head.querySelectorAll('base').forEach((base) => base.remove());
    vi.restoreAllMocks();
  });

  it('Routerクラスが存在すること', () => {
    expect(Router).toBeDefined();
    expect(typeof Router).toBe('function');
  });

  it('HTMLElementを継承していること', () => {
    expect(Object.getPrototypeOf(Router.prototype)).toBe(HTMLElement.prototype);
  });

  it('インスタンスを作成できること', () => {
    const router = document.createElement('wcs-router') as Router;
    expect(router).toBeInstanceOf(Router);
    expect(router).toBeInstanceOf(HTMLElement);
  });

  it('複数インスタンスを作成できること', () => {
    const router1 = document.createElement('wcs-router') as Router;
    const router2 = document.createElement('wcs-router') as Router;
    expect(router1).toBeInstanceOf(Router);
    expect(router2).toBeInstanceOf(Router);
    expect(router1).not.toBe(router2);
  });

  it('basenameプロパティを持つこと', () => {
    const router = document.createElement('wcs-router') as Router;
    expect(router.basename).toBeDefined();
    expect(typeof router.basename).toBe('string');
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
    it('_normalizePathnameがパスを正規化すること', () => {
      const router = document.createElement('wcs-router') as Router;
      // 先頭スラッシュ付与、連続スラッシュ削除、末尾スラッシュ削除
      const normalized = (router as any)._normalizePathname('foo/bar');
      expect(normalized).toBe('/foo/bar');

      const normalizedWithSlashes = (router as any)._normalizePathname('//foo//bar');
      expect(normalizedWithSlashes).toBe('/foo/bar');

      // ルートパスは "/" のまま
      const rootPath = (router as any)._normalizePathname('/');
      expect(rootPath).toBe('/');

      // 末尾の .html は削除
      const htmlPath = (router as any)._normalizePathname('/app/index.html');
      expect(htmlPath).toBe('/app');
    });

    it('_getBasenameがbaseタグのパスを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      const base = document.createElement('base');
      base.setAttribute('href', 'http://localhost/app/');
      document.head.appendChild(base);

      // _normalizeBasenameにより末尾スラッシュは削除される
      const basename = (router as any)._getBasename();
      expect(basename).toBe('/app');
    });

    it('_getBasenameがルートの場合、空文字列を返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      const base = document.createElement('base');
      base.setAttribute('href', 'http://localhost/');
      document.head.appendChild(base);

      const basename = (router as any)._getBasename();
      expect(basename).toBe('');
    });

    it('_getBasenameがpathname空文字列の場合、空文字列を返すこと', () => {
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

    it('_normalizePathnameが空文字列やhtmlを正規化すること', () => {
      const router = document.createElement('wcs-router') as Router;
      const normalize = (router as any)._normalizePathname.bind(router);

      expect(normalize('')).toBe('/');
      expect(normalize('foo/bar')).toBe('/foo/bar');
      expect(normalize('/index.html')).toBe('/');
      expect(normalize('/app/index.html')).toBe('/app');
      expect(normalize('/foo/')).toBe('/foo');
    });

    it('_normalizePathnameがconfig.basenameFileExtensionsに従うこと', () => {
      const router = document.createElement('wcs-router') as Router;
      const normalize = (router as any)._normalizePathname.bind(router);
      const originalExts = [...config.basenameFileExtensions];

      // .php を追加
      setConfig({ basenameFileExtensions: ['.html', '.php'] });
      expect(normalize('/app/index.php')).toBe('/app');
      expect(normalize('/app/page.PHP')).toBe('/app'); // 大文字小文字を区別しない

      // .html のみ
      setConfig({ basenameFileExtensions: ['.html'] });
      expect(normalize('/app/index.php')).toBe('/app/index.php'); // .php は削除されない

      // 空配列の場合、何も削除しない
      setConfig({ basenameFileExtensions: [] });
      expect(normalize('/app/index.html')).toBe('/app/index.html');

      setConfig({ basenameFileExtensions: originalExts });
    });

    it('_normalizeBasenameがconfig.basenameFileExtensionsに従うこと', () => {
      const router = document.createElement('wcs-router') as Router;
      const normalize = (router as any)._normalizeBasename.bind(router);
      const originalExts = [...config.basenameFileExtensions];

      // .php を追加
      setConfig({ basenameFileExtensions: ['.html', '.php'] });
      expect(normalize('/app/index.php')).toBe('/app');

      // 空配列の場合、何も削除しない
      setConfig({ basenameFileExtensions: [] });
      expect(normalize('/app/index.html')).toBe('/app/index.html');

      setConfig({ basenameFileExtensions: originalExts });
    });

    it('_normalizeBasenameが正規化されること', () => {
      const router = document.createElement('wcs-router') as Router;
      const normalize = (router as any)._normalizeBasename.bind(router);

      expect(normalize('')).toBe('');
      expect(normalize('/')).toBe('');
      expect(normalize('app')).toBe('/app');
      expect(normalize('/app/')).toBe('/app');
      expect(normalize('/app/index.html')).toBe('/app');
    });

    it('_joinInternalPathがベースとパスを結合すること', () => {
      const router = document.createElement('wcs-router') as Router;
      const join = (router as any)._joinInternalPath.bind(router);

      expect(join('', '/about')).toBe('/about');
      expect(join('/app', '/')).toBe('/app/');
      expect(join('/app', 'about')).toBe('/app/about');
    });

    it('_getOutletが隣接する既存のOutletを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      const outlet = createOutlet();
      document.body.appendChild(router);
      // Router の直後に Outlet を挿入
      router.after(outlet);

      const found = (router as any)._getOutlet();
      // 同一インスタンスが返されること（新規作成されないこと）
      expect(found.tagName.toLowerCase()).toBe('wcs-outlet');
      expect(found).toBe(outlet);
    });

    it('_getOutletがOutletを生成してRouter直後に追加すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const found = (router as any)._getOutlet();
      expect(found.tagName.toLowerCase()).toBe('wcs-outlet');
      expect(router.nextElementSibling).toBe(found);
    });

    it('_getOutletがparentNodeなしの場合document.bodyに追加すること', () => {
      const router = document.createElement('wcs-router') as Router;
      // DOMに未接続の状態で呼ぶ

      const found = (router as any)._getOutlet();
      expect(found.tagName.toLowerCase()).toBe('wcs-outlet');
      expect(document.body.contains(found)).toBe(true);
    });

    it('outlet未設定の場合、エラーになること', () => {
      const router = document.createElement('wcs-router') as Router;
      expect(() => router.outlet).toThrow('[@wcstack/router] wcs-router has no outlet.');
    });

    it('template未設定の場合、エラーになること', () => {
      const router = document.createElement('wcs-router') as Router;
      expect(() => router.template).toThrow('[@wcstack/router] wcs-router has no template.');
    });
  });

  describe('navigate', () => {
    it('navigation APIがある場合、navigation.navigateを呼ぶこと', async () => {
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

    it('navigation.navigate が {finished} を返した場合、navigate() は finished を await すること', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '/base';

      let resolveFinished!: () => void;
      const finishedPromise = new Promise<void>((resolve) => {
        resolveFinished = resolve;
      });
      const navigateMock = vi.fn().mockReturnValue({
        committed: Promise.resolve(),
        finished: finishedPromise,
      });
      const navigation = {
        navigate: navigateMock,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      (window as any).navigation = navigation;

      let resolved = false;
      const navPromise = router.navigate('/path').then(() => {
        resolved = true;
      });

      // finished 未解決の状態では navigate() も未解決
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(resolved).toBe(false);

      // finished を解決すれば navigate() も解決する
      resolveFinished();
      await navPromise;
      expect(resolved).toBe(true);
    });

    it('navigation.navigate が undefined を返しても navigate() は解決すること', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '/base';
      const navigation = {
        // polyfill 等で戻り値が undefined のケース
        navigate: vi.fn().mockReturnValue(undefined),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      (window as any).navigation = navigation;

      await expect(router.navigate('/path')).resolves.toBeUndefined();
    });

    it('navigation APIがない場合、applyRouteを呼ぶこと', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '/base';
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;
      router.path = '/prev';

      const pushStateSpy = vi.spyOn(history, 'pushState');
      const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);

      await router.navigate('/path');

      expect(pushStateSpy).toHaveBeenCalledWith(null, '', '/base/path');
      expect(applySpy).toHaveBeenCalledWith(router, router.outlet, '/base/path', '/prev', '');
    });

    it('フォールバック経路: commit 後にページ先頭へスクロールすること', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '/base';
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;

      vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);
      const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

      await router.navigate('/path');

      expect(scrollSpy).toHaveBeenCalledWith(0, 0);
    });

    it('フォールバック経路: guard 拒否 (committed=false) ではスクロールしないこと', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '/base';
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;

      vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(false);
      const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

      await router.navigate('/blocked');

      expect(scrollSpy).not.toHaveBeenCalled();
    });

    // docs/router-state-contract-design.md §4.1 — クエリ / ハッシュ込みターゲットの受理
    describe('クエリ / ハッシュ込みターゲット (§4.1)', () => {
      it('Navigation API: クエリ付きターゲットは basename を pathname にのみ結合して渡すこと', async () => {
        const router = document.createElement('wcs-router') as Router;
        (router as any)._basename = '/base';
        const navigation = {
          navigate: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
        (window as any).navigation = navigation;

        await router.navigate('/products?page=2');

        expect(navigation.navigate).toHaveBeenCalledWith('/base/products?page=2');
      });

      it('フォールバック: クエリ付きターゲットで applyRoute にはクエリを渡さないこと（欠陥 6 の修理）', async () => {
        const router = document.createElement('wcs-router') as Router;
        (router as any)._basename = '/base';
        (router as any)._outlet = createOutlet();
        (router as any)._outlet.routesNode = router;
        router.path = '/prev';

        const pushStateSpy = vi.spyOn(history, 'pushState');
        const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

        await router.navigate('/products?page=2');

        // URL にはクエリを保つ
        expect(pushStateSpy).toHaveBeenCalledWith(null, '', '/base/products?page=2');
        // セグメントマッチにはクエリを渡さない（search は明示引数で渡る — §3.6）
        expect(applySpy).toHaveBeenCalledWith(router, router.outlet, '/base/products', '/prev', '?page=2');
      });

      it('クエリのみターゲット（"?page=2"）は現在の pathname を維持すること', async () => {
        const router = document.createElement('wcs-router') as Router;
        (router as any)._basename = '';
        const navigation = {
          navigate: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
        (window as any).navigation = navigation;

        const originalLocation = window.location;
        delete (window as any).location;
        (window as any).location = { pathname: '/current', href: 'http://localhost/current' };
        try {
          await router.navigate('?page=2');
        } finally {
          (window as any).location = originalLocation;
        }

        expect(navigation.navigate).toHaveBeenCalledWith('/current?page=2');
      });

      it('`?` 単独はクエリの全消去（pathname 維持・クエリ無し URL）になること', async () => {
        const router = document.createElement('wcs-router') as Router;
        (router as any)._basename = '';
        const navigation = {
          navigate: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
        (window as any).navigation = navigation;

        const originalLocation = window.location;
        delete (window as any).location;
        (window as any).location = { pathname: '/current', href: 'http://localhost/current?page=2' };
        try {
          await router.navigate('?');
        } finally {
          (window as any).location = originalLocation;
        }

        expect(navigation.navigate).toHaveBeenCalledWith('/current');
      });

      it('ハッシュは分解時に温存して URL に渡すこと', async () => {
        const router = document.createElement('wcs-router') as Router;
        (router as any)._basename = '/base';
        (router as any)._outlet = createOutlet();
        (router as any)._outlet.routesNode = router;
        router.path = '/prev';

        const pushStateSpy = vi.spyOn(history, 'pushState');
        const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

        await router.navigate('/docs?q=x#section');

        expect(pushStateSpy).toHaveBeenCalledWith(null, '', '/base/docs?q=x#section');
        expect(applySpy).toHaveBeenCalledWith(router, router.outlet, '/base/docs', '/prev', '?q=x');
      });

      it('navigate("") は従来どおりルート扱いになること', async () => {
        const router = document.createElement('wcs-router') as Router;
        (router as any)._basename = '/base';
        const navigation = {
          navigate: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
        (window as any).navigation = navigation;

        await router.navigate('');

        expect(navigation.navigate).toHaveBeenCalledWith('/base/');
      });
    });
  });

  describe('_onNavigateFunc', () => {
    it('canInterceptがfalseの場合、何もしないこと', () => {
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

    it('interceptハンドラー内部でapplyRouteを呼ぶこと', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;
      (router as any)._path = '/prev';

      const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);
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
      expect(applySpy).toHaveBeenCalledWith(router, router.outlet, '/next', '/prev', '');
    });

    it('basename配下でないURLはinterceptしないこと', () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '/app';

      const navEvent = {
        canIntercept: true,
        hashChange: false,
        downloadRequest: null,
        destination: { url: 'http://localhost/other/page' },
        intercept: vi.fn(),
      };

      (router as any)._onNavigateFunc(navEvent);
      expect(navEvent.intercept).not.toHaveBeenCalled();
    });

    it('basenameと完全一致するURLをinterceptすること', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '/app';
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;
      (router as any)._path = '/prev';

      const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);
      let capturedHandler: (() => Promise<void>) | null = null;

      const navEvent = {
        canIntercept: true,
        hashChange: false,
        downloadRequest: null,
        destination: { url: 'http://localhost/app' },
        intercept: ({ handler }: { handler: () => Promise<void> }) => {
          capturedHandler = handler;
        },
      };

      (router as any)._onNavigateFunc(navEvent);
      expect(capturedHandler).not.toBeNull();

      await capturedHandler!();
      expect(applySpy).toHaveBeenCalledWith(router, router.outlet, '/app', '/prev', '');
    });

    it('interceptハンドラ内でapplyRouteが例外を投げた場合、console.errorで通知して再スローすること', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;
      (router as any)._path = '/prev';

      const applyErr = new Error('apply boom');
      vi.spyOn(applyRouteModule, 'applyRoute').mockRejectedValue(applyErr);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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
      await expect(capturedHandler!()).rejects.toThrow('apply boom');
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('_onPopState', () => {
    it('basename配下でないURLはapplyRouteを呼ばないこと', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '/app';
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;
      (router as any)._path = '/prev';

      const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);

      const originalLocation = window.location;
      delete (window as any).location;
      (window as any).location = {
        pathname: '/other',
        href: 'http://localhost/other',
      };

      await (router as any)._onPopState();

      expect(applySpy).not.toHaveBeenCalled();

      (window as any).location = originalLocation;
    });
  });

  describe('_initialize', () => {
    it('basenameが空でbaseタグがなくパスが"/"以外の場合、エラーになること', async () => {
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
      const parseSpy = vi.spyOn(parseModule, 'parse').mockImplementation(async (r) => {
        // mock side effect: add a dummy route so it passes limit check
        (r as any).routeChildNodes.push({ path: '/' }); 
        return fragment;
      });
      const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);

      await (router as any)._initialize();

      expect(parseSpy).toHaveBeenCalledWith(router);
      expect(router.outlet).toBeDefined();
      expect(router.template).toBe(template);
      expect(applySpy).toHaveBeenCalled();
    });

    it('templateがない場合にエラーになること', async () => {
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

  describe('a11y live region (docs/a11y-design.md §3-4)', () => {
    it('_initializeで<wcs-router>直下に空のrole="status"リージョンを生成すること', async () => {
      const router = document.createElement('wcs-router') as Router;
      router.setAttribute('basename', '/app');
      const template = document.createElement('template');
      template.innerHTML = '<div>content</div>';
      router.appendChild(template);

      const fragment = document.createDocumentFragment();
      vi.spyOn(parseModule, 'parse').mockImplementation(async (r) => {
        (r as any).routeChildNodes.push({ path: '/' });
        return fragment;
      });
      vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);

      await (router as any)._initialize();

      const region = router.a11yRegion;
      expect(region).not.toBeNull();
      expect(region!.parentElement).toBe(router);
      expect(region!.getAttribute('role')).toBe('status');
      expect(region!.textContent).toBe('');
      // display:none は live region を殺すため使わない — sr-only クリップで隠す
      expect(region!.style.display).not.toBe('none');
      expect(region!.style.position).toBe('absolute');
    });

    it('disconnectedCallbackでリージョンを撤去し、再接続で回復すること', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._initialized = true;
      (router as any)._ensureA11yRegion();
      const first = router.a11yRegion;
      expect(first!.parentElement).toBe(router);

      router.disconnectedCallback();
      expect(router.a11yRegion).toBeNull();
      expect(first!.parentElement).toBeNull();

      await router.connectedCallback();
      expect(router.a11yRegion).not.toBeNull();
      expect(router.a11yRegion!.parentElement).toBe(router);
      router.disconnectedCallback();
    });
  });

  describe('focusReset の切り替え (docs/a11y-design.md §3-5)', () => {
    function interceptOptionsOf(router: Router): any {
      const captured: any[] = [];
      const navEvent = {
        canIntercept: true,
        hashChange: false,
        downloadRequest: null,
        destination: { url: 'http://localhost/path' },
        intercept: (options: any) => { captured.push(options); },
      };
      (router as any)._onNavigateFunc(navEvent);
      return captured[0];
    }

    it('focus属性なしでは仕様既定 "after-transition" を渡すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '';

      const options = interceptOptionsOf(router);
      expect(options.scroll).toBe('after-transition');
      expect(options.focusReset).toBe('after-transition');
    });

    it('focus属性があるときは "manual" を渡すこと（ブラウザ既定リセットとの二重処理防止）', () => {
      const router = document.createElement('wcs-router') as Router;
      router.setAttribute('focus', 'heading');
      (router as any)._basename = '';

      const options = interceptOptionsOf(router);
      expect(options.focusReset).toBe('manual');
      // scroll 側は focus= の影響を受けない
      expect(options.scroll).toBe('after-transition');
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

    it('初期化済みの場合、初期化を再実行しないこと', async () => {
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
      // 登録済みフラグを立てた状態で disconnect すると removeEventListener が呼ばれる
      (router as any)._listeningNavigate = true;
      const navigation = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
      (window as any).navigation = navigation;

      router.disconnectedCallback();

      expect(navigation.removeEventListener).toHaveBeenCalledWith('navigate', (router as any)._onNavigate);
      expect((router as any)._listeningNavigate).toBe(false);
    });

    it('Navigation APIがない場合にpopstateを登録すること', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._initialized = true;

      const addSpy = vi.spyOn(window, 'addEventListener');
      delete (window as any).navigation;

      await router.connectedCallback();

      expect(addSpy).toHaveBeenCalledWith('popstate', (router as any)._onPopState);
      expect((router as any)._listeningPopState).toBe(true);
    });

    it('popstateリスナー登録済みの場合に解除すること', () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._listeningPopState = true;

      const removeSpy = vi.spyOn(window, 'removeEventListener');

      router.disconnectedCallback();

      expect(removeSpy).toHaveBeenCalledWith('popstate', (router as any)._onPopState);
      expect((router as any)._listeningPopState).toBe(false);
    });

    it('_initialize中にdisconnectされた場合にリスナを登録しないこと', async () => {
      const router = document.createElement('wcs-router') as Router;
      // _initialize の awaiter として「initializing 中に切断」を再現
      (router as any)._initialize = vi.fn().mockImplementation(async () => {
        (router as any)._initialized = true;
        (router as any)._initializing = true;
        // initialize 中に disconnectedCallback を呼ぶ
        router.disconnectedCallback();
      });
      const navigation = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
      (window as any).navigation = navigation;

      await router.connectedCallback();

      expect(navigation.addEventListener).not.toHaveBeenCalledWith('navigate', expect.anything());
      expect((router as any)._disconnectedDuringInit).toBe(true);
    });
  });

  describe('_onPopState', () => {
    it('popstateでapplyRouteと通知を実行すること', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;
      (router as any)._path = '/prev';

      const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      const originalLocation = window.location;
      delete (window as any).location;
      (window as any).location = {
        pathname: '/next',
        href: 'http://localhost/next',
      };

      await (router as any)._onPopState();

      expect(applySpy).toHaveBeenCalledWith(router, router.outlet, '/next', '/prev', '');
      expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CustomEvent));

      (window as any).location = originalLocation;
    });

    it('popstateではスクロールしないこと (traverse の復元は history.scrollRestoration が正解)', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;
      (router as any)._path = '/prev';

      vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);
      const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

      const originalLocation = window.location;
      delete (window as any).location;
      (window as any).location = {
        pathname: '/next',
        href: 'http://localhost/next',
      };

      await (router as any)._onPopState();

      expect(scrollSpy).not.toHaveBeenCalled();

      (window as any).location = originalLocation;
    });
  });

  describe('wcBindable', () => {
    it('wcBindableが正しく定義されていること', () => {
      expect(Router.wcBindable.protocol).toBe('wc-bindable');
      expect(Router.wcBindable.version).toBe(1);
      expect(Router.wcBindable.properties).toHaveLength(7);
      expect(Router.wcBindable.properties[0].name).toBe('navigateUrl');
      expect(Router.wcBindable.properties[0].event).toBe('wcs-router:navigate-url-changed');
      expect(Router.wcBindable.properties[1].name).toBe('replaceUrl');
      expect(Router.wcBindable.properties[1].event).toBe('wcs-router:replace-url-changed');
      expect(Router.wcBindable.properties[2].name).toBe('path');
      expect(Router.wcBindable.properties[2].event).toBe('wcs-router:path-changed');
    });

    // docs/router-state-contract-design.md §3.1 — 観測面は output-only
    // （properties のみ・inputs に無い → state 側の既定 authority=element）
    it('観測面 params/typedParams/searchParams/routeName が properties に宣言されていること', () => {
      const names = Router.wcBindable.properties.map(p => p.name);
      expect(names).toContain('params');
      expect(names).toContain('typedParams');
      expect(names).toContain('searchParams');
      expect(names).toContain('routeName');

      const byName = (n: string) => Router.wcBindable.properties.find(p => p.name === n)!;
      expect(byName('params').event).toBe('wcs-router:params-changed');
      expect(byName('typedParams').event).toBe('wcs-router:params-changed');
      expect(byName('searchParams').event).toBe('wcs-router:search-changed');
      expect(byName('routeName').event).toBe('wcs-router:route-name-changed');

      // detail は { params, typedParams } — 両プロパティとも getter で分派する
      const detail = { params: { id: '5' }, typedParams: { id: 5 } };
      const ev = new CustomEvent('wcs-router:params-changed', { detail });
      expect(byName('params').getter!(ev)).toBe(detail.params);
      expect(byName('typedParams').getter!(ev)).toBe(detail.typedParams);

      // 観測面は inputs に無い（output-only）
      const inputNames = (Router.wcBindable.inputs ?? []).map(i => i.name);
      for (const name of ['params', 'typedParams', 'searchParams', 'routeName']) {
        expect(inputNames).not.toContain(name);
      }
    });
  });

  // docs/router-state-contract-design.md §3.4 — 発火規範 / §4.4 — same-match 判定
  describe('commitNavigation / isSameMatch', () => {
    const COMMIT = {
      params: { id: '5' },
      typedParams: { id: 5 },
      routeName: 'detail',
      search: '?q=x',
      path: '/products/5',
    };

    it('発火順序が params → route-name → search → path であること', () => {
      const router = document.createElement('wcs-router') as Router;
      const order: string[] = [];
      for (const ev of [
        'wcs-router:params-changed',
        'wcs-router:route-name-changed',
        'wcs-router:search-changed',
        'wcs-router:path-changed',
      ]) {
        router.addEventListener(ev, () => order.push(ev));
      }

      router.commitNavigation(COMMIT);

      expect(order).toEqual([
        'wcs-router:params-changed',
        'wcs-router:route-name-changed',
        'wcs-router:search-changed',
        'wcs-router:path-changed',
      ]);
    });

    it('どのイベントのリスナーからも遷移後スナップショットの一貫した値が見えること（イベント前に全値コミット）', () => {
      const router = document.createElement('wcs-router') as Router;
      const seen: Array<Record<string, unknown>> = [];
      for (const ev of [
        'wcs-router:params-changed',
        'wcs-router:route-name-changed',
        'wcs-router:search-changed',
        'wcs-router:path-changed',
      ]) {
        router.addEventListener(ev, () => {
          seen.push({
            params: router.params,
            typedParams: router.typedParams,
            routeName: router.routeName,
            searchParams: router.searchParams,
            path: router.path,
          });
        });
      }

      router.commitNavigation(COMMIT);

      expect(seen).toHaveLength(4);
      for (const snapshot of seen) {
        expect(snapshot.params).toEqual({ id: '5' });
        expect(snapshot.typedParams).toEqual({ id: 5 });
        expect(snapshot.routeName).toBe('detail');
        expect(snapshot.searchParams).toEqual({ q: 'x' });
        expect(snapshot.path).toBe('/products/5');
      }
    });

    it('params-changed の detail は { params, typedParams } であること', () => {
      const router = document.createElement('wcs-router') as Router;
      let detail: any = null;
      router.addEventListener('wcs-router:params-changed', (e) => {
        detail = (e as CustomEvent).detail;
      });

      router.commitNavigation(COMMIT);

      expect(detail.params).toEqual({ id: '5' });
      expect(detail.typedParams).toEqual({ id: 5 });
    });

    it('変化しなかった面のイベントは発火しないこと（同一 commit の再適用は全て無発火）', () => {
      const router = document.createElement('wcs-router') as Router;
      router.commitNavigation(COMMIT);

      const listeners = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
      router.addEventListener('wcs-router:params-changed', listeners[0]);
      router.addEventListener('wcs-router:route-name-changed', listeners[1]);
      router.addEventListener('wcs-router:search-changed', listeners[2]);
      router.addEventListener('wcs-router:path-changed', listeners[3]);

      router.commitNavigation({ ...COMMIT });

      for (const listener of listeners) {
        expect(listener).not.toHaveBeenCalled();
      }
    });

    it('変化しなかった面は同一性を保つこと（不変の面のオブジェクトは差し替えない）', () => {
      const router = document.createElement('wcs-router') as Router;
      router.commitNavigation(COMMIT);
      const prevParams = router.params;
      const prevSearch = router.searchParams;

      // search だけ変える
      router.commitNavigation({ ...COMMIT, search: '?q=y' });

      expect(router.params).toBe(prevParams);
      expect(router.searchParams).not.toBe(prevSearch);
      expect(router.searchParams).toEqual({ q: 'y' });
    });

    it('isSameMatch は最初の成功 commit より前は常に false であること（初回ガード）', () => {
      const router = document.createElement('wcs-router') as Router;
      // path setter は commit ではない
      router.path = '/products';
      expect(router.isSameMatch('/products')).toBe(false);

      router.commitNavigation({ ...COMMIT, path: '/products' });
      expect(router.isSameMatch('/products')).toBe(true);
      expect(router.isSameMatch('/about')).toBe(false);
    });
  });

  // docs/router-state-contract-design.md §4.4 / D6b — intercept オプションの same-match 分岐
  describe('_onNavigateFunc の same-match オプション', () => {
    function setupCommittedRouter(): Router {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '';
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;
      router.commitNavigation({
        params: {}, typedParams: {}, routeName: '', search: '', path: '/products',
      });
      return router;
    }

    function makeNavEvent(url: string, navigationType?: string) {
      return {
        canIntercept: true,
        hashChange: false,
        downloadRequest: null,
        navigationType,
        destination: { url },
        intercept: vi.fn(),
      };
    }

    it('same-match の push では scroll / focusReset が manual になること', () => {
      const router = setupCommittedRouter();
      const navEvent = makeNavEvent('http://localhost/products?page=2', 'push');

      (router as any)._onNavigateFunc(navEvent);

      const options = navEvent.intercept.mock.calls[0][0];
      expect(options.scroll).toBe('manual');
      expect(options.focusReset).toBe('manual');
    });

    it('same-match の replace でも scroll が manual になること', () => {
      const router = setupCommittedRouter();
      const navEvent = makeNavEvent('http://localhost/products?q=a', 'replace');

      (router as any)._onNavigateFunc(navEvent);

      const options = navEvent.intercept.mock.calls[0][0];
      expect(options.scroll).toBe('manual');
    });

    it('same-match の traverse では scroll が仕様既定（ブラウザ復元）のままであること (D6b)', () => {
      const router = setupCommittedRouter();
      const navEvent = makeNavEvent('http://localhost/products?page=1', 'traverse');

      (router as any)._onNavigateFunc(navEvent);

      const options = navEvent.intercept.mock.calls[0][0];
      expect(options.scroll).toBe('after-transition');
      // focusReset は same-match で常に manual
      expect(options.focusReset).toBe('manual');
    });

    it('パス遷移（same-match でない）では従来既定のままであること', () => {
      const router = setupCommittedRouter();
      const navEvent = makeNavEvent('http://localhost/about', 'push');

      (router as any)._onNavigateFunc(navEvent);

      const options = navEvent.intercept.mock.calls[0][0];
      expect(options.scroll).toBe('after-transition');
      expect(options.focusReset).toBe('after-transition');
    });

    it('フォールバック経路: same-match（クエリのみ遷移）では commit してもスクロールしないこと', async () => {
      const router = setupCommittedRouter();
      router.path = '/products';

      vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);
      const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      vi.spyOn(history, 'pushState').mockImplementation(() => {});

      const originalLocation = window.location;
      delete (window as any).location;
      (window as any).location = { pathname: '/products', href: 'http://localhost/products' };
      try {
        await router.navigate('?page=2');
      } finally {
        (window as any).location = originalLocation;
      }

      expect(scrollSpy).not.toHaveBeenCalled();
    });
  });

  describe('wcBindable (inputs / commands)', () => {
    it('inputsにbasenameが宣言されていること', () => {
      expect(Router.wcBindable.inputs).toHaveLength(3);
      expect(Router.wcBindable.inputs![0].name).toBe('basename');
      expect(Router.wcBindable.inputs![0].attribute).toBe('basename');
    });

    // navigateUrl を properties にだけ置くと、方向認識初期同期を持つ binding core が
    // output-only と判定して state → element の書き込みを止めてしまい、state からの
    // プログラム遷移が成立しなくなる。settable な面であることを宣言で固定する。
    it('inputsにnavigateUrlが宣言されていること（settableな書き込み面）', () => {
      const navigateUrl = Router.wcBindable.inputs!.find(input => input.name === 'navigateUrl');
      expect(navigateUrl).toBeDefined();
      expect(navigateUrl!.attribute).toBeUndefined();
    });

    // path の setter は navigate せず内部値を反映するだけなので、書き込み面としては
    // 宣言しない（state から書いても URL は動かず、router と乖離するだけになる）。
    it('inputsにpathを宣言しないこと（observable outputのみ）', () => {
      expect(Router.wcBindable.inputs!.some(input => input.name === 'path')).toBe(false);
    });

    it('commandsにnavigateとreplaceが宣言されていること', () => {
      expect(Router.wcBindable.commands).toHaveLength(2);
      expect(Router.wcBindable.commands![0].name).toBe('navigate');
      expect(Router.wcBindable.commands![0].async).toBe(true);
      expect(Router.wcBindable.commands![1].name).toBe('replace');
      expect(Router.wcBindable.commands![1].async).toBe(true);
    });

    // docs/router-state-contract-design.md §4.2 — replaceUrl は navigateUrl と完全同型
    it('inputsにreplaceUrlが宣言されていること（settableな書き込み面）', () => {
      const replaceUrl = Router.wcBindable.inputs!.find(input => input.name === 'replaceUrl');
      expect(replaceUrl).toBeDefined();
      expect(replaceUrl!.attribute).toBeUndefined();
    });
  });

  describe('navigateUrl', () => {
    it('navigateUrlの初期値がnullであること', () => {
      const router = document.createElement('wcs-router') as Router;
      expect(router.navigateUrl).toBeNull();
    });

    it('navigateUrl設定でnavigateが呼ばれること', async () => {
      const router = document.createElement('wcs-router') as Router;
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(undefined);

      router.navigateUrl = '/dashboard';

      expect(navigateSpy).toHaveBeenCalledWith('/dashboard');
      // navigate完了を待つ
      await vi.waitFor(() => {
        expect(router.navigateUrl).toBeNull();
      });
    });

    it('navigate完了後にリセットイベントが発火すること', async () => {
      const router = document.createElement('wcs-router') as Router;
      vi.spyOn(router, 'navigate').mockResolvedValue(undefined);

      const events: any[] = [];
      router.addEventListener('wcs-router:navigate-url-changed', (e) => {
        events.push((e as CustomEvent).detail);
      });

      router.navigateUrl = '/dashboard';
      await vi.waitFor(() => {
        expect(events).toEqual([null]);
      });
    });

    it('nullを設定しても何も起きないこと', () => {
      const router = document.createElement('wcs-router') as Router;
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(undefined);

      router.navigateUrl = null;
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('空文字列を設定しても何も起きないこと', () => {
      const router = document.createElement('wcs-router') as Router;
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(undefined);

      router.navigateUrl = '';
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('同一 navigate 中に同じ URL を再代入しても navigate を再起動しないこと', () => {
      const router = document.createElement('wcs-router') as Router;
      // navigate を pending Promise にしてリセットを保留
      let resolveNavigate!: () => void;
      const navigateSpy = vi.spyOn(router, 'navigate').mockReturnValue(
        new Promise<void>((resolve) => { resolveNavigate = resolve; })
      );

      router.navigateUrl = '/same';
      // navigate 中（_navigateUrl === '/same'）に同値を再代入
      router.navigateUrl = '/same';

      expect(navigateSpy).toHaveBeenCalledTimes(1);
      resolveNavigate();
    });

    it('navigateがrejectしてもnavigateUrlがクリアされ通知されること', async () => {
      const router = document.createElement('wcs-router') as Router;
      vi.spyOn(router, 'navigate').mockRejectedValue(new Error('boom'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const events: any[] = [];
      router.addEventListener('wcs-router:navigate-url-changed', (e) => {
        events.push((e as CustomEvent).detail);
      });

      router.navigateUrl = '/bad';

      await vi.waitFor(() => {
        expect(router.navigateUrl).toBeNull();
        expect(events).toEqual([null]);
      });
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  // docs/router-state-contract-design.md §4.2 — null-idle transient（navigateUrl と完全同型）
  describe('replaceUrl', () => {
    it('replaceUrlの初期値がnullであること', () => {
      const router = document.createElement('wcs-router') as Router;
      expect(router.replaceUrl).toBeNull();
    });

    it('replaceUrl設定でreplaceが呼ばれ、完了後に自己リセットすること', async () => {
      const router = document.createElement('wcs-router') as Router;
      const replaceSpy = vi.spyOn(router, 'replace').mockResolvedValue(undefined);

      router.replaceUrl = '?q=abc';

      expect(replaceSpy).toHaveBeenCalledWith('?q=abc');
      await vi.waitFor(() => {
        expect(router.replaceUrl).toBeNull();
      });
    });

    it('replace完了後にリセットイベント（detail: null）が発火すること', async () => {
      const router = document.createElement('wcs-router') as Router;
      vi.spyOn(router, 'replace').mockResolvedValue(undefined);

      const events: any[] = [];
      router.addEventListener('wcs-router:replace-url-changed', (e) => {
        events.push((e as CustomEvent).detail);
      });

      router.replaceUrl = '?q=abc';
      await vi.waitFor(() => {
        expect(events).toEqual([null]);
      });
    });

    it('null / undefined / 空文字列の書き込みはno-opであること', () => {
      const router = document.createElement('wcs-router') as Router;
      const replaceSpy = vi.spyOn(router, 'replace').mockResolvedValue(undefined);

      router.replaceUrl = null;
      router.replaceUrl = undefined as any;
      router.replaceUrl = '';

      expect(replaceSpy).not.toHaveBeenCalled();
    });

    it('同一 replace 中に同じ URL を再代入しても再起動しないこと', () => {
      const router = document.createElement('wcs-router') as Router;
      let resolveReplace!: () => void;
      const replaceSpy = vi.spyOn(router, 'replace').mockReturnValue(
        new Promise<void>((resolve) => { resolveReplace = resolve; })
      );

      router.replaceUrl = '?q=same';
      router.replaceUrl = '?q=same';

      expect(replaceSpy).toHaveBeenCalledTimes(1);
      resolveReplace();
    });

    it('replaceがrejectしてもreplaceUrlがクリアされ通知されること', async () => {
      const router = document.createElement('wcs-router') as Router;
      vi.spyOn(router, 'replace').mockRejectedValue(new Error('boom'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const events: any[] = [];
      router.addEventListener('wcs-router:replace-url-changed', (e) => {
        events.push((e as CustomEvent).detail);
      });

      router.replaceUrl = '/bad';

      await vi.waitFor(() => {
        expect(router.replaceUrl).toBeNull();
        expect(events).toEqual([null]);
      });
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  // docs/router-state-contract-design.md §4.2 — replace() の履歴セマンティクス
  describe('replace', () => {
    it('Navigation API がある場合、history: "replace" 付きで navigation.navigate を呼ぶこと', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '/base';
      const navigation = {
        navigate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      (window as any).navigation = navigation;

      await router.replace('/path?q=1');

      expect(navigation.navigate).toHaveBeenCalledWith('/base/path?q=1', { history: 'replace' });
    });

    it('フォールバックでは replaceState を使い履歴を増やさないこと', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '/base';
      (router as any)._outlet = createOutlet();
      (router as any)._outlet.routesNode = router;
      router.path = '/prev';

      const pushStateSpy = vi.spyOn(history, 'pushState');
      const replaceStateSpy = vi.spyOn(history, 'replaceState');
      const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);
      vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

      await router.replace('/path?q=1');

      expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/base/path?q=1');
      expect(pushStateSpy).not.toHaveBeenCalled();
      expect(applySpy).toHaveBeenCalledWith(router, router.outlet, '/base/path', '/prev', '?q=1');
    });

    it('`?` での全消去を受理すること（pathname 維持・クエリ無し URL）', async () => {
      const router = document.createElement('wcs-router') as Router;
      (router as any)._basename = '';
      const navigation = {
        navigate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      (window as any).navigation = navigation;

      const originalLocation = window.location;
      delete (window as any).location;
      (window as any).location = { pathname: '/list', href: 'http://localhost/list?page=3' };
      try {
        await router.replace('?');
      } finally {
        (window as any).location = originalLocation;
      }

      expect(navigation.navigate).toHaveBeenCalledWith('/list', { history: 'replace' });
    });
  });

  describe('path変更イベント', () => {
    it('pathが変更されたときにイベントが発火すること', () => {
      const router = document.createElement('wcs-router') as Router;
      const events: string[] = [];
      router.addEventListener('wcs-router:path-changed', (e) => {
        events.push((e as CustomEvent).detail);
      });

      router.path = '/new-path';
      expect(events).toEqual(['/new-path']);
    });

    it('同じpathを設定してもイベントが発火しないこと', () => {
      const router = document.createElement('wcs-router') as Router;
      router.path = '/same';

      const events: string[] = [];
      router.addEventListener('wcs-router:path-changed', (e) => {
        events.push((e as CustomEvent).detail);
      });

      router.path = '/same';
      expect(events).toEqual([]);
    });

    it('pathイベントがバブルすること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const events: string[] = [];
      document.body.addEventListener('wcs-router:path-changed', (e) => {
        events.push((e as CustomEvent).detail);
      });

      router.path = '/bubbled';
      expect(events).toEqual(['/bubbled']);
      router.remove();
    });
  });

  describe('error handling', () => {
    it('ルート定義が1つもない場合、詳細なエラーを投げること', async () => {
      const router = document.createElement('wcs-router') as Router;
      const template = document.createElement('template');
      template.innerHTML = `<div>No routes here</div>`;
      router.appendChild(template);

      // parse自体は実際のDOMパースを行うため、template内にwcs-routeがなければrouteChildNodesは空になる
      await expect(router.connectedCallback()).rejects.toThrow('[@wcstack/router] wcs-router has no route definitions.');
    });
  });
});
