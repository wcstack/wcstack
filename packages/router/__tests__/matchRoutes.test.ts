import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { matchRoutes } from '../src/matchRoutes';
import { Router } from '../src/components/Router';
import { Route } from '../src/components/Route';
import './setup';

describe('matchRoutes', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (Router as any)._instance = null;
  });

  afterEach(() => {
    (Router as any)._instance = null;
  });

  it('matchRoutes関数が存在すること', () => {
    expect(matchRoutes).toBeDefined();
    expect(typeof matchRoutes).toBe('function');
  });

  it('ルートが存在しなぁE��合、nullを返すこと', () => {
    const router = document.createElement('wcs-router') as Router;
    const result = matchRoutes(router, '/test');
    expect(result).toBeNull();
  });

  it('マッチするルートがなぁE��合、nullを返すこと', () => {
    const router = document.createElement('wcs-router') as Router;
    // routeChildNodesはチE��ォルトで空配�E
    
    const result = matchRoutes(router, '/nonexistent');
    expect(result).toBeNull();
  });

  it('単一のルートがマッチする場合、結果を返すこと', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const mockRoute = {
      testPath: vi.fn().mockReturnValue({
        routes: [],
        params: {},
        lastPath: ''
      }),
      routeChildNodes: [],
      absoluteWeight: 100,
      childIndex: 0
    } as any;
    
    (router as any)._routeChildNodes = [mockRoute];
    
    const result = matchRoutes(router, '/home');
    expect(result).not.toBeNull();
    expect(mockRoute.testPath).toHaveBeenCalledWith('/home');
  });

  it('褁E��のルートから正しいルートを選択すること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const mockRoute1 = {
      testPath: vi.fn().mockReturnValue(null),
      routeChildNodes: [],
      absoluteWeight: 100,
      childIndex: 0
    } as any;
    
    const mockRoute2 = {
      absoluteWeight: 100,
      childIndex: 1
    } as any;
    
    mockRoute2.testPath = vi.fn().mockReturnValue({
      routes: [mockRoute2],
      params: {},
      lastPath: ''
    });
    mockRoute2.routeChildNodes = [];
    
    (router as any)._routeChildNodes = [mockRoute1, mockRoute2];
    
    const result = matchRoutes(router, '/about');
    expect(result).not.toBeNull();
    expect(mockRoute2.testPath).toHaveBeenCalledWith('/about');
  });

  it('ネストされたルートをマッチできること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const childRoute = {
      testPath: vi.fn().mockReturnValue({
        routes: [],
        params: { id: '123' },
        lastPath: ''
      }),
      routeChildNodes: [],
      absoluteWeight: 90,
      childIndex: 0
    } as any;
    
    const parentRoute = {
      testPath: vi.fn().mockReturnValue(null),
      routeChildNodes: [childRoute],
      absoluteWeight: 100,
      childIndex: 0
    } as any;
    
    (router as any)._routeChildNodes = [parentRoute];
    
    const result = matchRoutes(router, '/users/123');
    expect(result).not.toBeNull();
    expect(childRoute.testPath).toHaveBeenCalledWith('/users/123');
  });

  it('重み付けによってルートを選択すること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const staticRoute = {
      absoluteWeight: 100,
      childIndex: 0
    } as any;
    staticRoute.testPath = vi.fn().mockReturnValue({
      routes: [staticRoute],
      params: {},
      lastPath: ''
    });
    staticRoute.routeChildNodes = [];
    
    const dynamicRoute = {
      absoluteWeight: 50,
      childIndex: 1
    } as any;
    dynamicRoute.testPath = vi.fn().mockReturnValue({
      routes: [dynamicRoute],
      params: { id: 'new' },
      lastPath: ''
    });
    dynamicRoute.routeChildNodes = [];
    
    (router as any)._routeChildNodes = [staticRoute, dynamicRoute];
    
    const result = matchRoutes(router, '/users/new');
    expect(result).not.toBeNull();
    // 重みが大きい方が優先される
    expect(result?.routes[0]).toBe(staticRoute);
  });

  it('褁E��のマッチ候補から最適なも�Eを選択すること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const route1 = {
      absoluteWeight: 80,
      childIndex: 0
    } as any;
    route1.testPath = vi.fn().mockReturnValue({
      routes: [route1],
      params: {},
      lastPath: ''
    });
    route1.routeChildNodes = [];
    
    const route2 = {
      absoluteWeight: 90,
      childIndex: 1
    } as any;
    route2.testPath = vi.fn().mockReturnValue({
      routes: [route2],
      params: {},
      lastPath: ''
    });
    route2.routeChildNodes = [];
    
    (router as any)._routeChildNodes = [route1, route2];
    
    const result = matchRoutes(router, '/products/123/edit');
    expect(result).not.toBeNull();
    // より高い重みのルートが選択される
    expect(result?.routes[0]).toBe(route2);
  });

  it('childIndexでルートをソートすること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const route1 = {
      testPath: vi.fn().mockReturnValue({
        routes: [{ absoluteWeight: 50, childIndex: 0 }],
        params: {},
        lastPath: ''
      }),
      routeChildNodes: [],
      absoluteWeight: 50,
      childIndex: 0
    } as any;
    
    const route2 = {
      testPath: vi.fn().mockReturnValue({
        routes: [{ absoluteWeight: 50, childIndex: 1 }],
        params: {},
        lastPath: ''
      }),
      routeChildNodes: [],
      absoluteWeight: 50,
      childIndex: 1
    } as any;
    
    (router as any)._routeChildNodes = [route1, route2];
    
    const result = matchRoutes(router, '/test');
    expect(result).not.toBeNull();
    // 同じ重みの場合、childIndexが小さぁE��が優先される
    expect(result?.routes[0].childIndex).toBe(0);
  });
});
