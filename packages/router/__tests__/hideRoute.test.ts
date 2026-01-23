import { describe, it, expect, beforeEach } from 'vitest';
import { hideRoute } from '../src/hideRoute';
import { showRoute } from '../src/showRoute';
import { Route } from '../src/components/Route';
import { Router } from '../src/components/Router';
import type { IRouteMatchResult } from '../src/components/types';
import './setup';

function mockMatch(route: Route, params: Record<string, string> = {}): IRouteMatchResult {
  return { 
    params, 
    typedParams: params, 
    path: '', 
    lastPath: '', 
    routes: [route] 
  };
}

describe('hideRoute', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (Router as any)._instance = null;
  });

  it('ノードを非表示にし、paramsをクリアすること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/users/:id');
    route.initialize(router, null);

    const span = document.createElement('span');
    route.appendChild(span);

    const container = document.createElement('div');
    container.appendChild(route.placeHolder);

    showRoute(route, mockMatch(route, { id: '123' }));
    expect(container.contains(span)).toBe(true);

    hideRoute(route);
    expect(container.contains(span)).toBe(false);
    expect(route.params).toEqual({});
  });

  it('子ノードが既に親から外れている場合、エラーにならずスキップすること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/test');
    route.initialize(router, null);

    const span = document.createElement('span');
    route.appendChild(span);

    const container = document.createElement('div');
    container.appendChild(route.placeHolder);

    // showRoute で container に span が移動する
    showRoute(route, mockMatch(route, {}));
    expect(container.contains(span)).toBe(true);

    // 手動で削除しておく
    span.remove(); 

    // hideRoute を呼ぶ。node.parentNode?.removeChild(node) で parentNode は null なのでスキップされるはず
    expect(() => hideRoute(route)).not.toThrow();
  });
});
