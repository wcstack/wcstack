import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showRouteContent } from '../src/showRouteContent';
import { Router } from '../src/components/Router';
import { GuardCancel } from '../src/GuardCancel';
import type { IRoute, IRouteMatchResult } from '../src/components/types';
import './setup';

// モックルートを作成するヘルパー関数
function createMockRoute(overrides: Partial<IRoute> = {}): IRoute {
  const placeholder = document.createComment('@@route:mock');
  const params: Record<string, string> = {};
  const typedParams: Record<string, any> = {};
  
  return {
    clearParams: vi.fn(() => {
      Object.keys(params).forEach(key => delete params[key]);
      Object.keys(typedParams).forEach(key => delete typedParams[key]);
    }),
    childNodeArray: [],
    paramNames: [],
    params,
    typedParams,
    placeHolder: placeholder,
    guardCheck: vi.fn().mockResolvedValue(undefined),
    shouldChange: vi.fn().mockReturnValue(false),
    ...overrides,
  } as any;
}

const createMatchResult = (
  routes: IRoute[],
  params: Record<string, string> = {},
  path = '/',
  lastPath = ''
): IRouteMatchResult => ({
  routes,
  params,
  typedParams: params,
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

    const container = document.createElement('div');
    const placeholder2 = document.createComment('@@route:mock2');
    container.appendChild(placeholder2);
    document.body.appendChild(container);

    const route1 = createMockRoute();
    const route2 = createMockRoute({
      shouldChange: vi.fn().mockReturnValue(false),
      placeHolder: placeholder2,
    });

    const matchResult = createMatchResult([route2]);

    await showRouteContent(router, matchResult, [route1]);

    // route1 should be hidden (not in current routes)
    expect(route1.clearParams).toHaveBeenCalled();
    // route2 should not be shown because shouldChange returns false and it's in lastRoutes
    // But since route2 is NOT in lastRoutes, it should be shown
  });

  it('すべてのルートに対してガードチェックを実行すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route1 = createMockRoute({ shouldChange: vi.fn().mockReturnValue(true) });
    const route2 = createMockRoute({ shouldChange: vi.fn().mockReturnValue(true) });

    const matchResult = createMatchResult([route1, route2]);

    await showRouteContent(router, matchResult, []);

    expect(route1.guardCheck).toHaveBeenCalledWith(matchResult);
    expect(route2.guardCheck).toHaveBeenCalledWith(matchResult);
  });

  it('ガードキャンセル時にフォールバックパスへナビゲートすること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const guardCancel = new GuardCancel('Guard rejected', '/fallback');
    
    const route1 = createMockRoute({
      guardCheck: vi.fn().mockRejectedValue(guardCancel),
      shouldChange: vi.fn().mockReturnValue(true),
    });

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
    
    const route1 = createMockRoute({
      guardCheck: vi.fn().mockRejectedValue(normalError),
      shouldChange: vi.fn().mockReturnValue(true),
    });

    const matchResult = createMatchResult([route1]);

    await expect(
      showRouteContent(router, matchResult, [])
    ).rejects.toThrow('Some other error');
  });

  it('新しいルートを表示すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const container = document.createElement('div');
    const placeholder = document.createComment('@@route:mock');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    const route1 = createMockRoute({
      shouldChange: vi.fn().mockReturnValue(true),
      placeHolder: placeholder,
      paramNames: ['id'],
    });

    const matchResult = createMatchResult([route1], { id: '123' });

    await showRouteContent(router, matchResult, []);

    // clearParamsが呼ばれてからパラメータが設定される
    expect(route1.clearParams).toHaveBeenCalled();
  });

  it('shouldChangeがtrueの場合にルートを表示すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const container = document.createElement('div');
    const placeholder = document.createComment('@@route:mock');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    const route1 = createMockRoute({
      shouldChange: vi.fn().mockReturnValue(true),
      placeHolder: placeholder,
    });

    const matchResult = createMatchResult([route1]);

    // route1 is in lastRoutes but shouldChange returns true
    await showRouteContent(router, matchResult, [route1]);

    expect(route1.shouldChange).toHaveBeenCalledWith({});
    expect(route1.clearParams).toHaveBeenCalled(); // showRoute calls clearParams
  });

  it('shouldChangeがfalseでforce=falseの場合、showRouteを呼ばないこと', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route1 = createMockRoute({
      shouldChange: vi.fn().mockReturnValue(false),
    });

    const matchResult = createMatchResult([route1]);

    // route1 is in lastRoutes and shouldChange returns false
    await showRouteContent(router, matchResult, [route1]);

    expect(route1.shouldChange).toHaveBeenCalledWith({});
    // clearParams should NOT be called because showRoute is not called
    expect(route1.clearParams).not.toHaveBeenCalled();
  });

  it('showRoute後に後続ルートを強制表示すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const container = document.createElement('div');
    const placeholder1 = document.createComment('@@route:mock1');
    const placeholder2 = document.createComment('@@route:mock2');
    container.appendChild(placeholder1);
    container.appendChild(placeholder2);
    document.body.appendChild(container);

    const route1 = createMockRoute({
      shouldChange: vi.fn().mockReturnValue(true),
      placeHolder: placeholder1,
    });

    const route2 = createMockRoute({
      shouldChange: vi.fn().mockReturnValue(false), // Would normally skip
      placeHolder: placeholder2,
    });

    const matchResult = createMatchResult([route1, route2]);

    await showRouteContent(router, matchResult, [route1, route2]);

    // Both routes should be shown because showRoute returns true, triggering force
    expect(route1.clearParams).toHaveBeenCalled();
    expect(route2.clearParams).toHaveBeenCalled();
  });

  it('複数のルートで前のルートセットを正しく処理すること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const container = document.createElement('div');
    const placeholder2 = document.createComment('@@route:mock2');
    const placeholder3 = document.createComment('@@route:mock3');
    container.appendChild(placeholder2);
    container.appendChild(placeholder3);
    document.body.appendChild(container);

    const route1 = createMockRoute();
    const route2 = createMockRoute({
      shouldChange: vi.fn().mockReturnValue(true),
      placeHolder: placeholder2,
    });
    const route3 = createMockRoute({
      shouldChange: vi.fn().mockReturnValue(true),
      placeHolder: placeholder3,
    });

    const matchResult = createMatchResult([route2, route3]);

    // route1 was in lastRoutes but not in current
    await showRouteContent(router, matchResult, [route1, route2]);

    expect(route1.clearParams).toHaveBeenCalled(); // hideRoute calls clearParams
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

    const container = document.createElement('div');
    const placeholder = document.createComment('@@route:mock');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    const route1 = createMockRoute({
      shouldChange: vi.fn().mockReturnValue(true),
      placeHolder: placeholder,
    });

    const matchResult = createMatchResult([route1]);

    await showRouteContent(router, matchResult, []);

    expect(route1.clearParams).toHaveBeenCalled();
  });
});
