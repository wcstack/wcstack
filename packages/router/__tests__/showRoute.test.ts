import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showRoute } from '../src/showRoute';
import { Route } from '../src/components/Route';
import { Router } from '../src/components/Router';
import { LayoutOutlet } from '../src/components/LayoutOutlet';
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

describe('showRoute', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (Router as any)._instance = null;
  });

  it('ノードを表示し、paramsを設定すること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/users/:id');
    route.initialize(router, null);

    const span = document.createElement('span');
    route.appendChild(span);

    const container = document.createElement('div');
    container.appendChild(route.placeHolder);

    const result = showRoute(route, mockMatch(route, { id: '123' }));

    expect(result).toBe(true);
    expect(route.params).toEqual({ id: '123' });
    expect(container.contains(span)).toBe(true);
  });

  it('data-bind属性を持つ要素にparamsを適用すること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/users/:id');
    route.initialize(router, null);

    const div = document.createElement('div');
    const span = document.createElement('span');
    span.setAttribute('data-bind', '');
    div.appendChild(span);
    route.appendChild(div);

    const container = document.createElement('div');
    container.appendChild(route.placeHolder);

    showRoute(route, mockMatch(route, { id: '123' }));

    expect((span as any).id).toBe('123');
  });

  it('nextSiblingがある場合、insertBeforeを使用すること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/test');
    route.initialize(router, null);

    const span = document.createElement('span');
    route.appendChild(span);

    const nextElement = document.createElement('div');
    const container = document.createElement('div');
    container.appendChild(route.placeHolder);
    container.appendChild(nextElement);

    showRoute(route, mockMatch(route, {}));

    expect(span.nextSibling).toBe(nextElement);
  });

  it('nextSiblingがない場合、appendChildを使用すること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/test');
    route.initialize(router, null);

    const span = document.createElement('span');
    route.appendChild(span);

    const container = document.createElement('div');
    container.appendChild(route.placeHolder);

    showRoute(route, mockMatch(route, {}));

    expect(container.lastChild).toBe(span);
  });

  it('ルート要素自体がdata-bind属性を持つ場合にパラメータを割り当てること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/test/:id');
    route.initialize(router, null);

    const div = document.createElement('div');
    div.setAttribute('data-bind', '');
    route.appendChild(div);

    const container = document.createElement('div');
    container.appendChild(route.placeHolder);

    showRoute(route, mockMatch(route, { id: '123' }));

    expect((div as any).id).toBe('123');
  });

  it('layoutOutlet要素を含む場合にassignParamsを呼び出すこと', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/test/:id');
    route.initialize(router, null);

    const container = document.createElement('div');
    const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
    container.appendChild(layoutOutlet);
    route.appendChild(container);

    const placeholderContainer = document.createElement('div');
    placeholderContainer.appendChild(route.placeHolder);

    const assignParamsSpy = vi.spyOn(layoutOutlet, 'assignParams');

    showRoute(route, mockMatch(route, { id: '123' }));

    expect(assignParamsSpy).toHaveBeenCalledWith({ id: '123' });
  });

  it('ルート要素自体がlayoutOutletの場合にassignParamsを呼び出すこと', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/test/:id');
    route.initialize(router, null);

    const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
    route.appendChild(layoutOutlet);

    const container = document.createElement('div');
    container.appendChild(route.placeHolder);

    const assignParamsSpy = vi.spyOn(layoutOutlet, 'assignParams');

    showRoute(route, mockMatch(route, { id: '123' }));

    expect(assignParamsSpy).toHaveBeenCalledWith({ id: '123' });
  });

  it('非Element childNodeでも表示処理できること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/test');
    route.initialize(router, null);

    const container = document.createElement('div');
    container.appendChild(route.placeHolder);

    (route as any)._childNodeArray = [document.createTextNode('text')];

    const result = showRoute(route, mockMatch(route, {}));

    expect(result).toBe(true);
    expect(container.textContent).toContain('text');
  });
});
