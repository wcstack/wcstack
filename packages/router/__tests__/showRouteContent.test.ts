import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showRouteContent } from '../src/showRouteContent';
import { Router } from '../src/components/Router';
import { Route } from '../src/components/Route';
import { GuardCancel } from '../src/GuardCancel';
import type { IRoute, IRouteMatchResult } from '../src/components/types';
import './setup';

const createMatchResult = (
  routes: IRoute[],
  params: Record<string, string> = {},
  path = '/',
  lastPath = ''
): IRouteMatchResult => ({
  routes,
  params,
  path,
  lastPath,
});

describe('showRouteContent', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (Router as any)._instance = null;
    vi.clearAllMocks();
  });

  it('showRouteContent関数が存在すること', () => {
    expect(showRouteContent).toBeDefined();
    expect(typeof showRouteContent).toBe('function');
  });

  it('前のルートを非表示にすること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    // Create mock route objects instead of actual elements
    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(false),
    } as any;

    const route2: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(false),
    } as any;

    const matchResult = createMatchResult([route2]);

    await showRouteContent(router, matchResult, [route1]);

    // route1 should be hidden (not in current routes)
    expect(route1.hide).toHaveBeenCalled();
    // route2 should not be hidden (in current routes)
    expect(route2.hide).not.toHaveBeenCalled();
  });

  it('すべてのルートに対してガードチェックを実行すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const route2: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const matchResult = createMatchResult([route1, route2]);

    await showRouteContent(router, matchResult, []);

    expect(route1.guardCheck).toHaveBeenCalledWith(matchResult);
    expect(route2.guardCheck).toHaveBeenCalledWith(matchResult);
  });

  it('ガードキャンセル時にフォールバックパスへナビゲートすること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const guardCancel = new GuardCancel('Guard rejected', '/fallback');
    
    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockRejectedValue(guardCancel),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    router.navigate = vi.fn();

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const matchResult = createMatchResult([route1]);

    await showRouteContent(router, matchResult, []);

    // Wait for microtask
    await new Promise<void>(resolve => queueMicrotask(() => resolve()));

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Navigation cancelled')
    );
    expect(router.navigate).toHaveBeenCalledWith('/fallback');

    consoleWarnSpy.mockRestore();
  });

  it('ガード以外のエラーは再スローすること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const normalError = new Error('Some other error');
    
    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockRejectedValue(normalError),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const matchResult = createMatchResult([route1]);

    await expect(
      showRouteContent(router, matchResult, [])
    ).rejects.toThrow('Some other error');
  });

  it('新しいルートを表示すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const matchResult = createMatchResult([route1], { id: '123' });

    await showRouteContent(router, matchResult, []);

    expect(route1.show).toHaveBeenCalledWith({ id: '123' });
  });

  it('shouldChangeがtrueの場合にルートを表示すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const matchResult = createMatchResult([route1]);

    // route1 is in lastRoutes but shouldChange returns true
    await showRouteContent(router, matchResult, [route1]);

    expect(route1.shouldChange).toHaveBeenCalledWith({});
    expect(route1.show).toHaveBeenCalled();
  });

  it('shouldChangeがfalseでforce=falseの場合、showを呼ばないこと', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(false),
    } as any;

    const matchResult = createMatchResult([route1]);

    // route1 is in lastRoutes and shouldChange returns false
    await showRouteContent(router, matchResult, [route1]);

    expect(route1.shouldChange).toHaveBeenCalledWith({});
    expect(route1.show).not.toHaveBeenCalled();
  });

  it('showがtrueを返した場合に後続ルートを強制表示すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(true), // Returns true to force
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const route2: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(false), // Would normally skip
    } as any;

    const matchResult = createMatchResult([route1, route2]);

    await showRouteContent(router, matchResult, [route1, route2]);

    expect(route1.show).toHaveBeenCalled();
    expect(route2.show).toHaveBeenCalled(); // Forced due to route1.show returning true
  });

  it('複数のルートで前のルートセットを正しく処理すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(false),
    } as any;

    const route2: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const route3: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const matchResult = createMatchResult([route2, route3]);

    // route1 was in lastRoutes but not in current
    await showRouteContent(router, matchResult, [route1, route2]);

    expect(route1.hide).toHaveBeenCalled();
    expect(route2.hide).not.toHaveBeenCalled();
    expect(route3.hide).not.toHaveBeenCalled();
  });

  it('空のルート配列を処理できること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const matchResult = createMatchResult([]);

    await expect(
      showRouteContent(router, matchResult, [])
    ).resolves.not.toThrow();
  });

  it('前のルートがないケースを処理できること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const matchResult = createMatchResult([route1]);

    await showRouteContent(router, matchResult, []);

    expect(route1.show).toHaveBeenCalled();
  });
});
