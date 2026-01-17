import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyRoute } from '../src/applyRoute';
import { Router } from '../src/components/Router';
import { Outlet } from '../src/components/Outlet';
import { Route } from '../src/components/Route';
import * as matchRoutesModule from '../src/matchRoutes';
import * as showRouteContentModule from '../src/showRouteContent';
import './setup';

describe('applyRoute', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (Router as any)._instance = null;
    vi.clearAllMocks();
  });

  it('basenameを持つパスを正しく処理すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    // basenameはコンストラクタで読み込まれるため、プロパティを直接設定
    (router as any)._basename = '/app';
    document.body.appendChild(router);
    
    const mockRoute = {} as Route;
    const outlet = document.createElement('wcs-outlet') as Outlet;
    
    const matchResult = {
      path: '/app/test',
      routes: [mockRoute],
      params: {},
      lastPath: ''
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(undefined);
    
    await applyRoute(router, outlet, '/app/test', '');
    
    expect(matchRoutesModule.matchRoutes).toHaveBeenCalledWith(router, '/app/test');
    expect(showRouteContentModule.showRouteContent).toHaveBeenCalled();
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
      lastPath: ''
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(undefined);
    
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
    const showSpy = vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(undefined);

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
      lastPath: '/previous'
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(undefined);
    
    await applyRoute(router, outlet, '/page', '/previous');
    
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
      lastPath: ''
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(undefined);
    
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
      lastPath: ''
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    const showRouteContentSpy = vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(undefined);
    
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
      lastPath: ''
    };
    
    vi.spyOn(matchRoutesModule, 'matchRoutes').mockReturnValue(matchResult);
    vi.spyOn(showRouteContentModule, 'showRouteContent').mockResolvedValue(undefined);
    
    // basenameは'/admin'だが、パスは'/user'で始まらない
    await applyRoute(router, outlet, '/user/profile', '');
    
    // パスはそのまま渡される
    expect(matchRoutesModule.matchRoutes).toHaveBeenCalledWith(router, '/user/profile');
  });
});
