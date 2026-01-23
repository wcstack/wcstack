import { describe, it, expect, beforeEach } from 'vitest';
import { testPath } from '../src/testPath';
import { Route } from '../src/components/Route';
import { Router } from '../src/components/Router';
import './setup';

// ヘルパー関数: path属性を持つRouteを作成
function createRoute(path: string): Route {
  const div = document.createElement('div');
  document.body.appendChild(div);
  div.innerHTML = `<wcs-route path="${path}"></wcs-route>`;
  const route = div.firstElementChild as Route;
  div.remove();
  return route;
}

describe('testPath', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (Router as any)._instance = null;
  });

  it('パスが一致する場合、マッチ結果を返すこと', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/users/:id');
    route.initialize(router, null);

    const result = testPath(route, '/users/123', ['users', '123']);
    expect(result).not.toBeNull();
    expect(result?.params).toEqual({ id: '123' });
    expect(result?.path).toBe('/users/123');
  });

  it('paramTypeが未設定でもanyとしてマッチすること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/:id');
    route.initialize(router, null);

    // paramTypeを未設定にしてフォールバック分岐を通す
    for (const info of (route as any)._segmentInfos) {
      if (info.type === 'param') {
        info.paramType = undefined;
      }
    }

    const result = testPath(route, '/123', ['123']);
    expect(result).not.toBeNull();
    expect(result?.typedParams).toEqual({ id: '123' });
  });

  it('キャッシュされた正規表現を利用してマッチできること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/users/:id');
    route.initialize(router, null);

    const first = testPath(route, '/users/111', ['users', '111']);
    const second = testPath(route, '/users/222', ['users', '222']);

    expect(first?.params).toEqual({ id: '111' });
    expect(second?.params).toEqual({ id: '222' });
  });

  it('パスが一致しない場合、nullを返すこと', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/users/:id');
    route.initialize(router, null);

    const result = testPath(route, '/posts/123', ['posts', '123']);
    expect(result).toBeNull();
  });

  it('複数のパラメータを含むパスをテストできること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/users/:userId/posts/:postId');
    route.initialize(router, null);

    const result = testPath(route, '/users/123/posts/456', ['users', '123', 'posts', '456']);
    expect(result?.params).toEqual({ userId: '123', postId: '456' });
  });

  it('catch-all(*)パスをテストできること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/files/*');
    route.initialize(router, null);

    const result = testPath(route, '/files/path/to/file.txt', ['files', 'path', 'to', 'file.txt']);
    expect(result).not.toBeNull();
    expect(result?.params).toEqual({ '*': 'path/to/file.txt' });
  });

  it('末尾スラッシュのあるパスをテストできること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/users');
    route.initialize(router, null);

    const result = testPath(route, '/users/', ['users', '']);
    expect(result).not.toBeNull();
    expect(result?.path).toBe('/users/');
  });

  it('index属性を持つルートをテストできること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const parentRoute = document.createElement('wcs-route') as Route;
    parentRoute.setAttribute('path', '/users');
    parentRoute.initialize(router, null);

    const indexRoute = document.createElement('wcs-route') as Route;
    indexRoute.setAttribute('index', '');
    indexRoute.initialize(router, parentRoute);

    const result = testPath(indexRoute, '/users', ['users']);
    expect(result).not.toBeNull();
    expect(result?.path).toBe('/users');
  });

  it('指定された型でパラメータをパースできること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = createRoute('/:id(int)');
    route.initialize(router, null);
    const match = testPath(route, '/123', ['123']);
    expect(match).not.toBeNull();
    expect(match?.params['id']).toBe('123');
    expect(match?.typedParams['id']).toBe(123);
  });

  it('int以外の型も正常に取り込めること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const cases = [
      { path: '/:id(float)', segment: '1.5', key: 'id', expected: 1.5 },
      { path: '/:flag(bool)', segment: '1', key: 'flag', expected: true },
      { path: '/:uuid(uuid)', segment: '123e4567-e89b-12d3-a456-426614174000', key: 'uuid', expected: '123e4567-e89b-12d3-a456-426614174000' },
      { path: '/:slug(slug)', segment: 'hello-world', key: 'slug', expected: 'hello-world' },
      { path: '/:any(any)', segment: 'anything', key: 'any', expected: 'anything' },
    ];

    for (const c of cases) {
      const route = createRoute(c.path);
      route.initialize(router, null);
      const match = testPath(route, `/${c.segment}`, [c.segment]);
      expect(match).not.toBeNull();
      expect(match?.typedParams[c.key]).toBe(c.expected);
    }

    const isoRoute = createRoute('/:date(isoDate)');
    isoRoute.initialize(router, null);
    const isoMatch = testPath(isoRoute, '/2024-01-23', ['2024-01-23']);
    expect(isoMatch).not.toBeNull();
    const date = isoMatch?.typedParams['date'] as Date;
    expect(date).toBeInstanceOf(Date);
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(23);
  });

  it('不正な型指定の場合はデフォルト(any)として扱われること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = createRoute('/:id(invalid)');
    route.initialize(router, null);
    const match = testPath(route, '/val', ['val']);
    expect(match).not.toBeNull();
    expect(match?.params['id']).toBe('val');
  });

  it('型指定の構文が不正な場合はパラメータ名のみとして扱われること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = createRoute('/:id(');
    route.initialize(router, null);
    const match = testPath(route, '/val', ['val']);
    expect(match).not.toBeNull();
    expect(match?.params['id(']).toBe('val');
  });

  it('パラメータ名が空の場合はparamsに追加しないこと', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = createRoute('/:');
    route.initialize(router, null);
    const match = testPath(route, '/val', ['val']);
    expect(match).not.toBeNull();
    expect(match?.params).toEqual({});
    expect(match?.typedParams).toEqual({});
  });

  it('パースエラーの場合はマッチしないこと', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = createRoute('/:id(int)');
    route.initialize(router, null);
    const match = testPath(route, '/abc', ['abc']);
    expect(match).toBeNull();
  });

  it('セグメントが足りない場合はマッチしないこと', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/users/:id/details');
    route.initialize(router, null);

    const result = testPath(route, '/users/123', ['users', '123']);
    expect(result).toBeNull();
  });
});
