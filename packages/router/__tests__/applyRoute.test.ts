import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyRoute } from '../src/applyRoute';
import { Router } from '../src/components/Router';
import { Outlet } from '../src/components/Outlet';
import { Route } from '../src/components/Route';
import * as matchRoutesModule from '../src/matchRoutes';
import * as showRouteContentModule from '../src/showRouteContent';
import * as a11yPoliciesModule from '../src/a11yPolicies';
import './setup';

describe('applyRoute', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('basenameを持つパスを正しく処理すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    // basenameはコンストラクタで読み込まれるため、プロパティを直接設定
    (router as any)._basename = '/app';
    
    const mockRoute = {} as Route;
    const outlet = document.createElement('wcs-outlet') as Outlet;
    
    const matchResult = {
      path: '/app/test',
      routes: [mockRoute],
      params: {},
      typedParams: {},
      lastPath: ''
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);
    
    await applyRoute(router, outlet, '/app/test', '');
    
    expect(matchRoutesModule.matchRoutes).toHaveBeenCalledWith(router, '/test');
    expect(showRouteContentModule.showRouteContent).toHaveBeenCalled();
  });

  it('fullPathがbasenameと一致する場合は"/"として扱うこと', async () => {
    const router = document.createElement('wcs-router') as Router;
    (router as any)._basename = '/app';

    const mockRoute = {} as Route;
    const outlet = document.createElement('wcs-outlet') as Outlet;

    const matchResult = {
      path: '/',
      routes: [mockRoute],
      params: {},
      typedParams: {},
      lastPath: ''
    };

    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);

    await applyRoute(router, outlet, '/app', '/prev');

    expect(matchRoutesModule.matchRoutes).toHaveBeenCalledWith(router, '/');
    expect(router.path).toBe('/');
  });

  it('basenameなしのパスを正しく処理すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const mockRoute = {} as Route;
    const outlet = document.createElement('wcs-outlet') as Outlet;
    
    const matchResult = {
      path: '/home',
      routes: [mockRoute],
      params: {},
      typedParams: {},
      lastPath: ''
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);
    
    await applyRoute(router, outlet, '/home', '');
    
    expect(matchRoutesModule.matchRoutes).toHaveBeenCalledWith(router, '/home');
    expect(showRouteContentModule.showRouteContent).toHaveBeenCalled();
  });

  it('マッチするルートがない場合にエラーをthrowすること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const outlet = document.createElement('wcs-outlet') as Outlet;
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(null);
    
    await expect(async () => {
      await applyRoute(router, outlet, '/nonexistent', '');
    }).rejects.toThrow('No route matched for path');
  });

  it('マッチするルートがない場合、fallbackRouteを使用すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const fallbackRoute = document.createElement('wcs-route') as Route;
    router.fallbackRoute = fallbackRoute;

    const outlet = document.createElement('wcs-outlet') as Outlet;

    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(null);
    const showSpy = vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);

    await applyRoute(router, outlet, '/nonexistent', '/prev');

    expect(showSpy).toHaveBeenCalled();
    expect(outlet.lastRoutes).toEqual([fallbackRoute]);
    expect(router.path).toBe('/nonexistent');
  });

  it('showRouteContent成功後にrouterとoutletの状態を更新すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const mockRoute = {} as Route;
    const outlet = document.createElement('wcs-outlet') as Outlet;
    
    const matchResult = {
      path: '/page',
      routes: [mockRoute],
      params: {},
      typedParams: {},
      lastPath: '/previous'
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);
    
    const committed = await applyRoute(router, outlet, '/page', '/previous');

    // commit を返す (フォールバック経路のスクロール等のゲートに使われる)
    expect(committed).toBe(true);
    expect(router.path).toBe('/page');
    expect(outlet.lastRoutes).toEqual([mockRoute]);
    expect(matchResult.lastPath).toBe('/previous');
  });

  it('showRouteContentがエラーをthrowしても例外処理されること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const mockRoute = {} as Route;
    const outlet = document.createElement('wcs-outlet') as Outlet;
    
    const matchResult = {
      path: '/error',
      routes: [mockRoute],
      params: {},
      typedParams: {},
      lastPath: ''
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockRejectedValue(new Error('Test error'));
    
    await expect(async () => {
      await applyRoute(router, outlet, '/error', '');
    }).rejects.toThrow('Test error');
  });

  it('lastPathを正しく設定すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const mockRoute = {} as Route;
    const outlet = document.createElement('wcs-outlet') as Outlet;
    
    const matchResult = {
      path: '/current',
      routes: [mockRoute],
      params: {},
      typedParams: {},
      lastPath: ''
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);
    
    const lastPathValue = '/old-path';
    await applyRoute(router, outlet, '/current', lastPathValue);
    
    expect(matchResult.lastPath).toBe(lastPathValue);
  });

  it('outlet.lastRoutesを使用してshowRouteContentを呼び出すこと', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const mockRoute = {} as Route;
    const mockPreviousRoute = {} as Route;
    const outlet = document.createElement('wcs-outlet') as Outlet;
    outlet.lastRoutes = [mockPreviousRoute];
    
    const matchResult = {
      path: '/test',
      routes: [mockRoute],
      params: {},
      typedParams: {},
      lastPath: ''
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    const showRouteContentSpy = vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);
    
    await applyRoute(router, outlet, '/test', '');
    
    expect(showRouteContentSpy).toHaveBeenCalledWith(router, matchResult, [mockPreviousRoute]);
  });

  it('basenameで始まらないパスをそのまま使用すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    (router as any)._basename = '/admin';
    
    const mockRoute = {} as Route;
    const outlet = document.createElement('wcs-outlet') as Outlet;
    
    const matchResult = {
      path: '/user/profile',
      routes: [mockRoute],
      params: {},
      typedParams: {},
      lastPath: ''
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);
    
    // basenameは'/admin'だが、パスは'/user'で始まらない
    await applyRoute(router, outlet, '/user/profile', '');
    
    // パスはそのまま渡される
    expect(matchRoutesModule.matchRoutes).toHaveBeenCalledWith(router, '/user/profile');
  });

  it('basename境界が一致しない場合はスライスしないこと', async () => {
    const router = document.createElement('wcs-router') as Router;
    (router as any)._basename = '/app';

    const mockRoute = {} as Route;
    const outlet = document.createElement('wcs-outlet') as Outlet;

    const matchResult = {
      path: '/appX/products',
      routes: [mockRoute],
      params: {},
      typedParams: {},
      lastPath: ''
    };

    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);

    await applyRoute(router, outlet, '/appX/products', '');

    expect(matchRoutesModule.matchRoutes).toHaveBeenCalledWith(router, '/appX/products');
  });

  it('GuardCancel時 (showRouteContent が false を返す) は path / lastRoutes を更新しないこと', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const prevRoute = {} as Route;
    const newRoute = {} as Route;
    const outlet = document.createElement('wcs-outlet') as Outlet;
    outlet.lastRoutes = [prevRoute];
    // 初期値が設定済みであることを前提に、これらが上書きされないことを確認する
    (router as any)._path = '/initial';

    const matchResult = {
      path: '/blocked',
      routes: [newRoute],
      params: {},
      typedParams: {},
      lastPath: ''
    };

    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(false);

    const pathChangedListener = vi.fn();
    router.addEventListener('wcs-router:path-changed', pathChangedListener);

    const committed = await applyRoute(router, outlet, '/blocked', '/initial');

    // committed=false が呼び出し側へ見える (D4: guard 拒否では何もしない)
    expect(committed).toBe(false);
    // path / lastRoutes は更新されない
    expect(router.path).toBe('/initial');
    expect(outlet.lastRoutes).toEqual([prevRoute]);
    // 拒否されたパスでの path-changed イベントは発火されない
    expect(pathChangedListener).not.toHaveBeenCalled();
  });

  describe('a11y ポリシー適用 (commit 後フック・docs/a11y-design.md §3-4)', () => {
    function setupA11yRouter(attrs: Record<string, string>) {
      const router = document.createElement('wcs-router') as Router;
      for (const [name, value] of Object.entries(attrs)) {
        router.setAttribute(name, value);
      }
      document.body.appendChild(router);
      const region = document.createElement('div');
      router.appendChild(region);
      (router as any)._a11yRegion = region;
      const outlet = document.createElement('wcs-outlet') as Outlet;
      return { router, region, outlet };
    }

    function matchResultWith(routes: unknown[]) {
      return {
        path: '/page',
        routes: routes as Route[],
        params: {},
        typedParams: {},
        lastPath: ''
      };
    }

    it('commit 後に announce="title" で live region へ document.title が入ること', async () => {
      const { router, region, outlet } = setupA11yRouter({ announce: 'title' });
      outlet.lastRoutes = [{} as Route]; // 初回描画ではない

      vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(
        matchResultWith([{ childNodeArray: [] }])
      );
      vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);
      document.title = 'After Nav';

      await applyRoute(router, outlet, '/page', '/prev');

      expect(region.textContent).toBe('After Nav');
      document.title = '';
    });

    it('初回描画 (lastRoutes が空) では announce しないこと (§3-5)', async () => {
      const { router, region, outlet } = setupA11yRouter({ announce: 'title' });
      outlet.lastRoutes = [];

      vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(
        matchResultWith([{ childNodeArray: [] }])
      );
      vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);
      document.title = 'Initial Load';

      await applyRoute(router, outlet, '/page', '');

      expect(region.textContent).toBe('');
      document.title = '';
    });

    it('guard 拒否では announce も focus も動かないこと (D4)', async () => {
      const h1 = document.createElement('h1');
      document.body.appendChild(h1);
      const { router, region, outlet } = setupA11yRouter({ announce: 'title', focus: 'heading' });
      outlet.lastRoutes = [{} as Route];

      vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(
        matchResultWith([{ childNodeArray: [h1] }])
      );
      vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(false);
      document.title = 'Blocked';

      await applyRoute(router, outlet, '/blocked', '/prev');

      expect(region.textContent).toBe('');
      expect(h1.hasAttribute('tabindex')).toBe(false);
      document.title = '';
    });

    it('commit 後に focus="heading" でリーフ route の見出しへフォーカスすること', async () => {
      const h1 = document.createElement('h1');
      document.body.appendChild(h1);
      const { router, outlet } = setupA11yRouter({ focus: 'heading' });
      outlet.lastRoutes = [{} as Route];

      // routes はチェーン（親→リーフ）。リーフの内容だけが探索される
      vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(
        matchResultWith([{ childNodeArray: [] }, { childNodeArray: [h1] }])
      );
      vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);

      await applyRoute(router, outlet, '/page', '/prev');

      expect(h1.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(h1);
    });
  });

  // docs/router-state-contract-design.md §3 / §4.4
  describe('観測面 commit と same-match 高速パス', () => {
    function committedRouter(path: string, basename = ''): Router {
      const router = document.createElement('wcs-router') as Router;
      // appendChild すると _initialize が走って _basename を再解決してしまうため
      // detached のまま使う（イベント dispatch は detached でも動く）
      (router as any)._basename = basename;
      router.commitNavigation({
        params: {},
        typedParams: {},
        routeName: '',
        search: '',
        path,
      });
      return router;
    }

    it('commit で params / typedParams / routeName / searchParams が更新されること', async () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const outlet = document.createElement('wcs-outlet') as Outlet;

      const mockRoute = { name: 'detail' } as unknown as Route;
      const matchResult = {
        path: '/products/5',
        routes: [mockRoute],
        params: { productId: '5' },
        typedParams: { productId: 5 },
        lastPath: ''
      };
      vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
      vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);

      await applyRoute(router, outlet, '/products/5', '', '?tab=specs');

      expect(router.params).toEqual({ productId: '5' });
      expect(router.typedParams).toEqual({ productId: 5 });
      expect(router.routeName).toBe('detail');
      expect(router.searchParams).toEqual({ tab: 'specs' });
      expect(router.path).toBe('/products/5');
    });

    it('露出オブジェクトは frozen スナップショットであること', async () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const outlet = document.createElement('wcs-outlet') as Outlet;

      const matchResult = {
        path: '/p',
        routes: [{ name: '' } as unknown as Route],
        params: { id: '1' },
        typedParams: { id: 1 },
        lastPath: ''
      };
      vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
      vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);

      await applyRoute(router, outlet, '/p', '', '?a=1');

      expect(Object.isFrozen(router.params)).toBe(true);
      expect(Object.isFrozen(router.typedParams)).toBe(true);
      expect(Object.isFrozen(router.searchParams)).toBe(true);
      expect(() => { (router.params as any).x = '9'; }).toThrow();
    });

    it('fallback ルートでは params={} で routeName は fallback の name であること (D8)', async () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      router.fallbackRoute = { name: 'notfound' } as unknown as Route;
      const outlet = document.createElement('wcs-outlet') as Outlet;

      vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(null);
      vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);

      await applyRoute(router, outlet, '/nonexistent', '/prev');

      expect(router.params).toEqual({});
      expect(router.routeName).toBe('notfound');
    });

    it('無名 fallback ルートでは routeName が "" であること', async () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      router.fallbackRoute = {} as unknown as Route;
      const outlet = document.createElement('wcs-outlet') as Outlet;

      vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(null);
      vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);

      await applyRoute(router, outlet, '/nonexistent', '/prev');

      expect(router.routeName).toBe('');
    });

    it('guard 拒否では観測面イベントを一切発火しないこと (§3.4 規範 3)', async () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const outlet = document.createElement('wcs-outlet') as Outlet;

      const matchResult = {
        path: '/blocked',
        routes: [{ name: 'blocked' } as unknown as Route],
        params: { id: '1' },
        typedParams: { id: 1 },
        lastPath: ''
      };
      vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
      vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(false);

      const listeners = {
        params: vi.fn(),
        routeName: vi.fn(),
        search: vi.fn(),
        path: vi.fn(),
      };
      router.addEventListener('wcs-router:params-changed', listeners.params);
      router.addEventListener('wcs-router:route-name-changed', listeners.routeName);
      router.addEventListener('wcs-router:search-changed', listeners.search);
      router.addEventListener('wcs-router:path-changed', listeners.path);

      const committed = await applyRoute(router, outlet, '/blocked', '/prev', '?x=1');

      expect(committed).toBe(false);
      expect(listeners.params).not.toHaveBeenCalled();
      expect(listeners.routeName).not.toHaveBeenCalled();
      expect(listeners.search).not.toHaveBeenCalled();
      expect(listeners.path).not.toHaveBeenCalled();
      expect(router.params).toEqual({});
      expect(router.searchParams).toEqual({});
    });

    it('same-match では matchRoutes / showRouteContent / a11y をスキップし search のみ commit すること', async () => {
      const router = committedRouter('/products');
      const outlet = document.createElement('wcs-outlet') as Outlet;
      outlet.lastRoutes = [{} as Route];

      const matchSpy = vi.spyOn(matchRoutesModule, 'matchRoutes');
      const showSpy = vi.spyOn(showRouteContentModule, 'showRouteContent');
      const a11ySpy = vi.spyOn(a11yPoliciesModule, 'applyA11yPolicies');

      const searchListener = vi.fn();
      const pathListener = vi.fn();
      router.addEventListener('wcs-router:search-changed', searchListener);
      router.addEventListener('wcs-router:path-changed', pathListener);

      const committed = await applyRoute(router, outlet, '/products', '/products', '?page=2');

      expect(committed).toBe(true);
      // guard 相・DOM 変更・transition・a11y のいずれも通らない
      expect(matchSpy).not.toHaveBeenCalled();
      expect(showSpy).not.toHaveBeenCalled();
      expect(a11ySpy).not.toHaveBeenCalled();
      // search は commit され、search-changed のみが発火する
      expect(router.searchParams).toEqual({ page: '2' });
      expect(searchListener).toHaveBeenCalledTimes(1);
      expect(pathListener).not.toHaveBeenCalled();
    });

    it('same-match で search が不変ならイベントは発火しないこと', async () => {
      const router = committedRouter('/products');
      const outlet = document.createElement('wcs-outlet') as Outlet;

      const searchListener = vi.fn();
      router.addEventListener('wcs-router:search-changed', searchListener);

      await applyRoute(router, outlet, '/products', '/products', '');

      expect(searchListener).not.toHaveBeenCalled();
    });

    it('basename 付きでも same-match が成立すること（スライス後比較 — D6）', async () => {
      const router = committedRouter('/products', '/app');
      const outlet = document.createElement('wcs-outlet') as Outlet;

      const matchSpy = vi.spyOn(matchRoutesModule, 'matchRoutes');

      // fullPath は basename 込み。スライス後の '/products' が router.path と一致する
      const committed = await applyRoute(router, outlet, '/app/products', '/products', '?page=2');

      expect(committed).toBe(true);
      expect(matchSpy).not.toHaveBeenCalled();
      expect(router.searchParams).toEqual({ page: '2' });
    });

    it('初回 commit 前には same-match を適用しないこと（§4.4 初回ガード）', async () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      // commit を経ずに _path だけ一致させる（path setter は commit ではない）
      router.path = '/products';
      const outlet = document.createElement('wcs-outlet') as Outlet;

      const matchResult = {
        path: '/products',
        routes: [{ name: '' } as unknown as Route],
        params: {},
        typedParams: {},
        lastPath: ''
      };
      const matchSpy = vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
      vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);

      await applyRoute(router, outlet, '/products', '/products', '');

      // same-match ではなく全経路を通る
      expect(matchSpy).toHaveBeenCalledWith(router, '/products');
    });

    it('パス遷移（same-match でない）は従来どおり全経路を通ること', async () => {
      const router = committedRouter('/products');
      const outlet = document.createElement('wcs-outlet') as Outlet;

      const matchResult = {
        path: '/about',
        routes: [{ name: 'about' } as unknown as Route],
        params: {},
        typedParams: {},
        lastPath: ''
      };
      const matchSpy = vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
      const showSpy = vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(true);

      await applyRoute(router, outlet, '/about', '/products', '');

      expect(matchSpy).toHaveBeenCalledWith(router, '/about');
      expect(showSpy).toHaveBeenCalled();
      expect(router.routeName).toBe('about');
    });
  });
});
