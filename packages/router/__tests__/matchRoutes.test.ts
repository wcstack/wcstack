import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  it('ルートが存在しない場合、nullを返すこと', () => {
    const router = document.createElement('wcs-router') as Router;
    const result = matchRoutes(router, '/test');
    expect(result).toBeNull();
  });

  it('マッチするルートがない場合、nullを返すこと', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/home');
    route.initialize(router, null);
    
    const result = matchRoutes(router, '/nonexistent');
    expect(result).toBeNull();
  });

  it('単一のルートがマッチする場合、結果を返すこと', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/home');
    route.initialize(router, null);
    
    const result = matchRoutes(router, '/home');
    expect(result).not.toBeNull();
    expect(result?.routes[0]).toBe(route);
  });

  it('複数のルートから正しいルートを選択すること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const route1 = document.createElement('wcs-route') as Route;
    route1.setAttribute('path', '/home');
    route1.initialize(router, null);
    
    const route2 = document.createElement('wcs-route') as Route;
    route2.setAttribute('path', '/about');
    route2.initialize(router, null);
    
    const result = matchRoutes(router, '/about');
    expect(result).not.toBeNull();
    expect(result?.routes[0]).toBe(route2);
  });

  it('ネストされたルートをマッチできること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const parentRoute = document.createElement('wcs-route') as Route;
    parentRoute.setAttribute('path', '/users');
    parentRoute.initialize(router, null);
    
    const childRoute = document.createElement('wcs-route') as Route;
    childRoute.setAttribute('path', ':id');
    childRoute.initialize(router, parentRoute);
    
    const result = matchRoutes(router, '/users/123');
    expect(result).not.toBeNull();
    expect(result?.routes).toHaveLength(2);
    expect(result?.routes[0]).toBe(parentRoute);
    expect(result?.routes[1]).toBe(childRoute);
    expect(result?.params.id).toBe('123');
  });

  it('重み付けによってルートを選択すること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    // 静的ルート（重み高）
    const staticRoute = document.createElement('wcs-route') as Route;
    staticRoute.setAttribute('path', '/users/new');
    staticRoute.initialize(router, null);
    
    // 動的ルート（重み低）
    const dynamicRoute = document.createElement('wcs-route') as Route;
    dynamicRoute.setAttribute('path', '/users/:id');
    dynamicRoute.initialize(router, null);
    
    const result = matchRoutes(router, '/users/new');
    expect(result).not.toBeNull();
    // 重みが大きい静的ルートが優先される
    expect(result?.routes[0]).toBe(staticRoute);
  });

  it('複数のマッチ候補から最適なものを選択すること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    // セグメント数が少ないルート
    const route1 = document.createElement('wcs-route') as Route;
    route1.setAttribute('path', '/products/:id');
    route1.initialize(router, null);
    
    // セグメント数が多いルート
    const route2Parent = document.createElement('wcs-route') as Route;
    route2Parent.setAttribute('path', '/products/:id');
    route2Parent.initialize(router, null);
    
    const route2Child = document.createElement('wcs-route') as Route;
    route2Child.setAttribute('path', 'edit');
    route2Child.initialize(router, route2Parent);
    
    const result = matchRoutes(router, '/products/123/edit');
    expect(result).not.toBeNull();
    // セグメント数が多いルートが優先される
    expect(result?.routes).toHaveLength(2);
    expect(result?.routes[1]).toBe(route2Child);
  });

  it('childIndexでルートをソートすること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    // 同じパスパターンのルートを複数作成
    const route1 = document.createElement('wcs-route') as Route;
    route1.setAttribute('path', '/:id');
    route1.initialize(router, null);
    
    const route2 = document.createElement('wcs-route') as Route;
    route2.setAttribute('path', '/:name');
    route2.initialize(router, null);
    
    const result = matchRoutes(router, '/test');
    expect(result).not.toBeNull();
    // 同じ重みの場合、childIndexが小さい方が優先される
    expect(result?.routes[0]).toBe(route1);
    expect(result?.routes[0].childIndex).toBe(0);
  });

  it('catch-all(*)ルートより静的ルートを優先すること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    // 静的ルート
    const staticRoute = document.createElement('wcs-route') as Route;
    staticRoute.setAttribute('path', '/admin/profile');
    staticRoute.initialize(router, null);

    // catch-allルート
    const adminRoute = document.createElement('wcs-route') as Route;
    adminRoute.setAttribute('path', '/admin');
    adminRoute.initialize(router, null);
    
    const catchAllRoute = document.createElement('wcs-route') as Route;
    catchAllRoute.setAttribute('path', '*');
    catchAllRoute.initialize(router, adminRoute);

    const result = matchRoutes(router, '/admin/profile');
    expect(result).not.toBeNull();
    // 静的ルートが優先
    expect(result?.routes[0]).toBe(staticRoute);
  });

  it('catch-all(*)ルートがマッチすること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const adminRoute = document.createElement('wcs-route') as Route;
    adminRoute.setAttribute('path', '/admin');
    adminRoute.initialize(router, null);
    
    const catchAllRoute = document.createElement('wcs-route') as Route;
    catchAllRoute.setAttribute('path', '*');
    catchAllRoute.initialize(router, adminRoute);

    const result = matchRoutes(router, '/admin/unknown/path');
    expect(result).not.toBeNull();
    expect(result?.params['*']).toBe('unknown/path');
  });
});
