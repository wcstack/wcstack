import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Route } from '../src/components/Route';
import { Router } from '../src/components/Router';
import { GuardCancel } from '../src/GuardCancel';
import { showRoute } from '../src/showRoute';
import './setup';

function mockMatch(route: Route, params: Record<string, string> = {}) {
  return { 
    params, 
    typedParams: params, 
    path: '', 
    lastPath: '', 
    routes: [route] 
  } as any;
}

// ヘルパー関数: path属性を持つRouteを作成
function createRoute(path: string): Route {
  const div = document.createElement('div');
  document.body.appendChild(div);
  div.innerHTML = `<wcs-route path="${path}"></wcs-route>`;
  const route = div.firstElementChild as Route;
  div.remove();
  return route;
}

// ヘルパー関数: index属性を持つRouteを作成
function createIndexRoute(): Route {
  const div = document.createElement('div');
  document.body.appendChild(div);
  div.innerHTML = `<wcs-route index></wcs-route>`;
  const route = div.firstElementChild as Route;
  div.remove();
  return route;
}

// ヘルパー関数: guard属性を持つRouteを作成
function createRouteWithGuard(path: string, guardFallback: string): Route {
  const div = document.createElement('div');
  document.body.appendChild(div);
  div.innerHTML = `<wcs-route path="${path}" guard="${guardFallback}"></wcs-route>`;
  const route = div.firstElementChild as Route;
  div.remove();
  return route;
}

describe('Route', () => {
  beforeEach(() => {
    (Router as any)._instance = null;
  });

  it('Routeクラスが存在すること', () => {
    expect(Route).toBeDefined();
    expect(typeof Route).toBe('function');
  });

  it('HTMLElementを継承していること', () => {
    expect(Object.getPrototypeOf(Route.prototype)).toBe(HTMLElement.prototype);
  });

  it('uuidを取得できること', () => {
    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', '/test');
    const uuid = route.uuid;
    expect(typeof uuid).toBe('string');
    expect(uuid.length).toBeGreaterThan(0);
  });

  describe('constructor', () => {
    it('path属性を持つRouteを作成できること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const route = createRoute('/test');
      document.body.appendChild(route);
      route.initialize(router, null);
      expect(route.path).toBe('/test');
    });

    it('index属性を持つRouteを作成できること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent');
      parentRoute.initialize(router, null);

      const route = createIndexRoute();
      document.body.appendChild(route);
      route.initialize(router, parentRoute);
      expect(route.path).toBe('');
    });

    it('パラメータを含むpathを解析すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const route = createRoute('/users/:id/posts/:postId');
      document.body.appendChild(route);
      route.initialize(router, null);
      // セグメントベースのマッチングに移行したため、segmentInfosで確認
      expect(route.segmentInfos.length).toBe(5); // '', 'users', ':id', 'posts', ':postId'
      expect(route.segmentInfos.map(s => s.type)).toEqual(['static', 'static', 'param', 'static', 'param']);
      expect(route.weight).toBe(8); // '' + users + posts = 6, :id + :postId = 2 → 8
    });

    it('guard属性を持つRouteを作成できること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const route = createRouteWithGuard('/protected', '/login');
      document.body.appendChild(route);
      route.initialize(router, null);
      expect((route as any)._hasGuard).toBe(true);
      expect((route as any)._guardFallbackPath).toBe('/login');
    });

    it('catch-all(*)を含むpathを解析すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const route = createRoute('/admin/*');
      document.body.appendChild(route);
      route.initialize(router, null);
      // セグメントベースのマッチングに移行したため、segmentInfosで確認
      expect(route.segmentInfos.length).toBe(3); // '', 'admin', '*'
      expect(route.segmentInfos.map(s => s.type)).toEqual(['static', 'static', 'catch-all']);
      expect(route.weight).toBe(4); // '' + admin = 4, * = 0
      expect(route.segmentCount).toBe(2); // catch-all is not counted
    });

    it('catch-all(*)以降のセグメントは無視されること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const route = createRoute('/files/*/ignored');
      document.body.appendChild(route);
      route.initialize(router, null);
      // * 以降は無視される
      expect(route.segmentInfos.length).toBe(3); // '', 'files', '*'
      expect(route.segmentInfos.map(s => s.type)).toEqual(['static', 'static', 'catch-all']);
      expect(route.segmentCount).toBe(2); // /files のみカウント
    });
  });

  describe('segmentCount', () => {
    it('segmentCountとabsoluteSegmentCountを取得できること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = createRoute('/products');
      document.body.appendChild(parentRoute);
      parentRoute.initialize(router, null);

      const childRoute = createRoute(':id');
      document.body.appendChild(childRoute);
      childRoute.initialize(router, parentRoute);

      expect(parentRoute.segmentCount).toBe(2);
      expect(parentRoute.absoluteSegmentCount).toBe(2);
      expect(childRoute.segmentCount).toBe(1);
      expect(childRoute.absoluteSegmentCount).toBe(3);
    });

    it('indexパスのsegmentCountが0になること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/');
      parentRoute.initialize(router, null);

      const indexRoute = document.createElement('wcs-route') as Route;
      indexRoute.setAttribute('index', '');
      indexRoute.initialize(router, parentRoute);

      expect(indexRoute.segmentCount).toBe(0);
      expect(indexRoute.absoluteSegmentCount).toBe(1);
    });
  });

  describe('routeParentNode', () => {
    it('親ノードを設定し取得できること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

        const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent');
      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', 'child');

      parentRoute.initialize(router, null);
      childRoute.initialize(router, parentRoute);

      expect(childRoute.routeParentNode).toBe(parentRoute);
      expect(parentRoute.routeChildNodes).toContain(childRoute);
      expect(childRoute.childIndex).toBe(0);
    });

    it('親ノードがnullの場合、routerのrouteChildNodesに追加されること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

        const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      route.initialize(router, null);

      expect(router.routeChildNodes).toContain(route);
    });
  });

  describe('routerNode', () => {
    it('routerNodeが設定されていない場合、getterでエラーを投げること', () => {
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      expect(() => route.routerNode).toThrow('[@wcstack/router] wcs-route has no routerNode.');
    });

    it('initializeでrouterNodeを設定し、getterで取得できること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      route.initialize(router, null);

      expect(route.routerNode).toBe(router);
    });

    it('typedParamsを返すこと', () => {
      const route = document.createElement('wcs-route') as Route;
      expect(route.typedParams).toEqual({});
    });
  });

  describe('isRelative', () => {
    it('絶対パス（/で始まり）の場合、falseを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/absolute');
      document.body.appendChild(route);
      route.initialize(router, null);
      expect(route.isRelative).toBe(false);
    });

    it('相対パス（/なし）の場合、trueを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent');
      parentRoute.initialize(router, null);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', 'relative');
      document.body.appendChild(route);
      route.initialize(router, parentRoute);
      expect(route.isRelative).toBe(true);
    });
  });

  describe('_checkParentNode', () => {
    it('相対パスで親がない場合、エラーを投げること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', 'relative');
      document.body.appendChild(route);

      expect(() => {
        route.initialize(router, null);
      }).toThrow('[@wcstack/router] wcs-route is relative but has no parent route.');
    });

    it('絶対パスで親がある場合、エラーを投げること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent');
      document.body.appendChild(parentRoute);
      parentRoute.initialize(router, null);

      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', '/absolute');
      document.body.appendChild(childRoute);

      expect(() => {
        childRoute.initialize(router, parentRoute);
      }).toThrow('[@wcstack/router] wcs-route is absolute but has a parent route.');
    });
  });

  describe('absolutePath', () => {
    it('絶対パスの場合、そのまま返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      route.initialize(router, null);

      expect(route.absolutePath).toBe('/test');
    });

    it('相対パスで親がある場合、親のパスと結合すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent');
      parentRoute.initialize(router, null);

      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', 'child');
      childRoute.initialize(router, parentRoute);

      expect(childRoute.absolutePath).toBe('/parent/child');
    });

    it('親のパスが/で終わる場合、/を追加しないこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent/');
      parentRoute.initialize(router, null);

      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', 'child');
      childRoute.initialize(router, parentRoute);

      expect(childRoute.absolutePath).toBe('/parent/child');
    });
  });

  describe('placeHolder', () => {
    it('placeHolderが初期化時に自動作成されること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      route.initialize(router, null);
      expect(route.placeHolder).toBeInstanceOf(Comment);
    });

    it('placeHolderからuuidを含むコメントを取得できること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      route.initialize(router, null);
      expect(route.placeHolder.textContent).toContain('@@route:');
    });
  });

  describe('childNodeArray', () => {
    it('子ノードの配列を返すこと', () => {
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      const span = document.createElement('span');
      route.appendChild(span);
      
      const childNodes = route.childNodeArray;
      expect(childNodes).toHaveLength(1);
      expect(childNodes[0]).toBe(span);
    });

    it('2回目の呼び出しで同じ配列を返すこと（キャッシュ）', () => {
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      const span = document.createElement('span');
      route.appendChild(span);
      
      const childNodes1 = route.childNodeArray;
      const childNodes2 = route.childNodeArray;
      expect(childNodes1).toBe(childNodes2);
    });
  });

  describe('routes', () => {
    it('親がない場合、自身のみの配列を返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

        const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      route.initialize(router, null);

      expect(route.routes).toEqual([route]);
    });

    it('親がある場合、親のroutesと自身を結合した配列を返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent');
      parentRoute.initialize(router, null);

      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', 'child');
      childRoute.initialize(router, parentRoute);

      expect(childRoute.routes).toEqual([parentRoute, childRoute]);
    });
  });

  describe('absoluteSegmentInfos', () => {
    it('絶対パスの場合、segmentInfosをそのまま返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      expect(route.absoluteSegmentInfos.length).toBe(3); // '', 'users', ':id'
      expect(route.absoluteSegmentInfos.map(s => s.type)).toEqual(['static', 'static', 'param']);
    });

    it('相対パスで親がある場合、親のセグメントと結合すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent');
      parentRoute.initialize(router, null);

      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', 'child/:id');
      childRoute.initialize(router, parentRoute);

      // parent: ['', 'parent'], child: ['child', ':id'] → ['', 'parent', 'child', ':id']
      expect(childRoute.absoluteSegmentInfos.length).toBe(4);
      expect(childRoute.absoluteSegmentInfos.map(s => s.segmentText)).toEqual(['', 'parent', 'child', ':id']);
    });

    it('親のパスが/で終わる場合、末尾の空セグメントはスキップされること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent/');
      parentRoute.initialize(router, null);

      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', 'child');
      childRoute.initialize(router, parentRoute);

      // parent: ['', 'parent'] (末尾の '' はスキップ), child: ['child'] → ['', 'parent', 'child']
      expect(childRoute.absoluteSegmentInfos.length).toBe(3);
      expect(childRoute.absoluteSegmentInfos.map(s => s.segmentText)).toEqual(['', 'parent', 'child']);
    });
  });

  describe('paramNames', () => {
    it('パラメータがない場合は空配列を返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/static/path');
      route.initialize(router, null);

      expect(route.paramNames).toEqual([]);
    });

    it('キャッシュされたparamNamesを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      const first = route.paramNames;
      const second = route.paramNames;
      expect(first).toBe(second);
      expect(first).toEqual(['id']);
    });
  });

  describe('absoluteParamNames', () => {
    it('絶対パスの場合、自身のparamNamesを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

        const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      expect(route.absoluteParamNames).toEqual(['id']);
    });

    it('相対パスで親がある場合、親と自身のparamNamesを結合すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/users/:userId');
      parentRoute.initialize(router, null);

      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', 'posts/:postId');
      childRoute.initialize(router, parentRoute);

      expect(childRoute.absoluteParamNames).toEqual(['userId', 'postId']);
    });

    it('パラメータがない場合は空配列を返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/static/path');
      route.initialize(router, null);

      expect(route.absoluteParamNames).toEqual([]);
    });

    it('キャッシュされたabsoluteParamNamesを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      const first = route.absoluteParamNames;
      const second = route.absoluteParamNames;
      expect(first).toBe(second);
      expect(first).toEqual(['id']);
    });
  });

  describe('weight', () => {
    it('パスのweightを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);
      // 静的セグメント""(+2) + 静的セグメント"users"(+2) + パラメータ":id"(+1) = 5
      expect(route.weight).toBe(5);
    });

    it('catch-allを含むパスのweightを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/files/*');
      route.initialize(router, null);

      // 静的セグメント""(+2) + 静的セグメント"files"(+2) + catch-all(+0) = 4
      expect(route.weight).toBe(4);
    });

    it('相対パスのcatch-allのweightを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/files');
      parentRoute.initialize(router, null);

      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', '*');
      childRoute.initialize(router, parentRoute);

      // catch-allのみなので重みは0
      expect(childRoute.weight).toBe(0);
    });

    it('catch-allのみのsegmentInfosでweightを計算できること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/dummy');
      route.initialize(router, null);

      (route as any)._segmentInfos = [
        {
          type: 'catch-all',
          segmentText: '*',
          paramName: '*',
          pattern: /^(.*)$/
        }
      ];
      (route as any)._weight = undefined;

      expect(route.weight).toBe(0);
    });

    it('キャッシュされたweightを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      const first = route.weight;
      const second = route.weight;
      expect(first).toBe(second);
    });
  });

  describe('absoluteWeight', () => {
    it('絶対パスの場合、weightを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      expect(route.absoluteWeight).toBe(5);
    });

    it('相対パスで親がある場合、親のabsoluteWeightと自身のweightを合計すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent');
      parentRoute.initialize(router, null);
      // parent: '' + 'parent' = 2 + 2 = 4

      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', 'child');
      childRoute.initialize(router, parentRoute);
      // child: 'child' = 2
      // total: 4 + 2 = 6

      expect(childRoute.absoluteWeight).toBe(6);
    });

    it('キャッシュされたabsoluteWeightを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      route.initialize(router, null);

      const weight1 = route.absoluteWeight;
      const weight2 = route.absoluteWeight;
      expect(weight1).toBe(weight2);
    });
  });

  describe('name', () => {
    it('nameを返すこと', () => {
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      expect(route.name).toBe('');
    });

    it('name属性を設定するとinitialize後に取得できること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      route.setAttribute('name', 'test-route');
      route.initialize(router, null);

      expect(route.name).toBe('test-route');
    });
  });

  describe('fullpath', () => {
    it('initialize時にfullpath属性が設定されること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      route.initialize(router, null);

      expect(route.fullpath).toBe('/test');
      expect(route.getAttribute('fullpath')).toBe('/test');
    });
  });

  describe('guardCheck', () => {
    it('guardがない場合、何もせずにresolveすること', async () => {
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');

      await expect(route.guardCheck({ path: '/test', routes: [], params: {}, typedParams: {}, lastPath: '' })).resolves.toBeUndefined();
    });

    it('guardがある場合、guardHandlerを呼び出してからチェックすること', async () => {
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/protected');
      route.setAttribute('guard', '/login');

        const guardHandler = vi.fn().mockResolvedValue(true);
      route.guardHandler = guardHandler;

      await route.guardCheck({ path: '/protected', routes: [], params: {}, typedParams: {}, lastPath: '/' });

      expect(guardHandler).toHaveBeenCalledWith('/protected', '/');
    });

    it('guardHandlerがfalseを返す場合、GuardCancelをthrowすること', async () => {
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/protected');
      route.setAttribute('guard', '/login');

      const guardHandler = vi.fn().mockResolvedValue(false);
      route.guardHandler = guardHandler;

      await expect(
        route.guardCheck({ path: '/protected', routes: [], params: {}, typedParams: {}, lastPath: '/' })
      ).rejects.toThrow(GuardCancel);
    });

    it('GuardCancelに正しいfallbackPathが含まれること', async () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/protected');
      route.setAttribute('guard', '/custom-login');
      route.initialize(router, null);

      const guardHandler = vi.fn().mockResolvedValue(false);
      route.guardHandler = guardHandler;

      try {
        await route.guardCheck({ path: '/protected', routes: [], params: {}, typedParams: {}, lastPath: '/' });
      } catch (error) {
        expect(error).toBeInstanceOf(GuardCancel);
        expect((error as GuardCancel).fallbackPath).toBe('/custom-login');
      }
    });
  });

  describe('shouldChange', () => {
    it('paramsが変更された場合、trueを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      const container = document.createElement('div');
      container.appendChild(route.placeHolder);

      showRoute(route, mockMatch(route, { id: '123' }));

      expect(route.shouldChange({ id: '456' })).toBe(true);
    });

    it('paramsが同じ場合、falseを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      const container = document.createElement('div');
      container.appendChild(route.placeHolder);

      showRoute(route, mockMatch(route, { id: '123' }));

      expect(route.shouldChange({ id: '123' })).toBe(false);
    });
  });

  describe('guardHandler', () => {
    it('guardHandlerが設定されていない場合、getterでエラーを投げること', () => {
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      expect(() => route.guardHandler).toThrow('[@wcstack/router] wcs-route has no guardHandler.');
    });

    it('guardHandlerをsetterで設定し、getterで取得できること', () => {
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      route.setAttribute('guard', '/login');

      const handler = vi.fn().mockResolvedValue(true);
      route.guardHandler = handler;

      expect(route.guardHandler).toBe(handler);
    });
  });

  describe('initialize', () => {
    it('path属性もindex属性もない場合、エラーを投げること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      
        const route = document.createElement('wcs-route') as Route;
      
      let errorThrown = false;
      try {
        route.initialize(router, null);
      } catch (error) {
        errorThrown = true;
        expect((error as Error).message).toBe('[@wcstack/router] wcs-route should have a "path" or "index" attribute.');
      }
      expect(errorThrown).toBe(true);
    });

    it('fallback属性がある場合、fallbackRouteとして登録されること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('fallback', '');

      route.initialize(router, null);

      expect(route.path).toBe('');
      expect(router.fallbackRoute).toBe(route);
    });

    it('fallbackRouteが既に設定されている場合、エラーを投げること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const first = document.createElement('wcs-route') as Route;
      first.setAttribute('fallback', '');
      first.initialize(router, null);

      const second = document.createElement('wcs-route') as Route;
      second.setAttribute('fallback', '');

      expect(() => {
        second.initialize(router, null);
      }).toThrow('[@wcstack/router] wcs-router can have only one fallback route.');
    });

    it('path属性が空の場合、空文字列を設定すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/');
      parentRoute.initialize(router, null);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '');

      route.initialize(router, parentRoute);

      expect(route.path).toBe('');
    });

    it('guard属性が空の場合、フォールバックを"/"にすること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      route.setAttribute('guard', '');

      route.initialize(router, null);

      expect((route as any)._guardFallbackPath).toBe('/');
    });

    it('初期化済みの場合、何もしないこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/before');

      route.initialize(router, null);
      route.setAttribute('path', '/after');

      // 再度initializeを呼んでも何も変わらない
      route.initialize(router, null);

      expect(route.path).toBe('/before');
    });

    it('fallback属性がルーター直下の場合、正常に登録されること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('fallback', '');

      expect(() => {
        route.initialize(router, null);
      }).not.toThrow();
      
      expect(router.fallbackRoute).toBe(route);
    });

    it('fallback属性が親ルートを持つ場合、エラーを投げること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent');
      parentRoute.initialize(router, null);

      const fallbackRoute = document.createElement('wcs-route') as Route;
      fallbackRoute.setAttribute('fallback', '');

      expect(() => {
        fallbackRoute.initialize(router, parentRoute);
      }).toThrow('[@wcstack/router] wcs-route with fallback attribute must be a direct child of wcs-router.');
    });
  });

  describe('testAncestorNode', () => {
    it('祖先ノードである場合、trueを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const grandpa = document.createElement('wcs-route') as Route;
      grandpa.setAttribute('path', '/grandpa');
      grandpa.initialize(router, null);

      const parent = document.createElement('wcs-route') as Route;
      parent.setAttribute('path', 'parent');
      parent.initialize(router, grandpa);

      const me = document.createElement('wcs-route') as Route;
      me.setAttribute('path', 'me');
      me.initialize(router, parent);

      expect(me.testAncestorNode(parent)).toBe(true);
      expect(me.testAncestorNode(grandpa)).toBe(true);
    });

    it('祖先ノードでない場合、falseを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parent = document.createElement('wcs-route') as Route;
      parent.setAttribute('path', '/parent');
      parent.initialize(router, null);

      const other = document.createElement('wcs-route') as Route;
      other.setAttribute('path', '/other');
      other.initialize(router, null);

      const me = document.createElement('wcs-route') as Route;
      me.setAttribute('path', 'me');
      me.initialize(router, parent);

      expect(me.testAncestorNode(other)).toBe(false);
      expect(me.testAncestorNode(me)).toBe(false); // 自分自身は祖先ではない
    });

    it('親がいない場合、falseを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const me = document.createElement('wcs-route') as Route;
      me.setAttribute('path', '/me');
      me.initialize(router, null);

      const other = document.createElement('wcs-route') as Route;
      other.setAttribute('path', '/other');
      other.initialize(router, null);

      expect(me.testAncestorNode(other)).toBe(false);
    });
  });

  describe('guardCheck - 追加カバレッジ', () => {
    it('guardHandlerが設定されるまで待機すること', async () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/protected');
      route.setAttribute('guard', '/login');
      // initialize 時に promise が作られる
      route.initialize(router, null);

      let checked = false;
      const guardCheckPromise = route.guardCheck({ 
        path: '/protected', routes: [], params: {}, typedParams: {}, lastPath: '/' 
      }).then(() => {
        checked = true;
      });

      // まだ待機中のはず
      await new Promise(r => setTimeout(r, 10));
      expect(checked).toBe(false);

      // guardHandlerを設定するとPromiseが解決される
      const handler = vi.fn().mockResolvedValue(true);
      route.guardHandler = handler;

      await guardCheckPromise;
      expect(checked).toBe(true);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('clearParams', () => {
    it('paramsとtypedParamsをクリアすること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      const container = document.createElement('div');
      container.appendChild(route.placeHolder);

      showRoute(route, mockMatch(route, { id: '123' }));
      expect(route.params).toEqual({ id: '123' });

      route.clearParams();
      expect(route.params).toEqual({});
      expect(route.typedParams).toEqual({});
    });
  });
});
