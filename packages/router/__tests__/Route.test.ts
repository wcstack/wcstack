import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Route } from '../src/components/Route';
import { Router } from '../src/components/Router';
import { LayoutOutlet } from '../src/components/LayoutOutlet';
import { GuardCancel } from '../src/GuardCancel';
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
      expect(route.patternText).toBe('\\/users\\/([^\\/]+)\\/posts\\/([^\\/]+)');
      expect(route.weight).toBe(7);
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
      expect(route.patternText).toBe('\\/admin\\/(.*)');
      expect(route.weight).toBe(3); // initial(-1) + ""(2) + admin(2) + *(0) = 3
      expect(route.segmentCount).toBe(2); // /admin counts, * doesn't
    });

    it('catch-all(*)以降のセグメントは無視されること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const route = createRoute('/files/*/ignored');
      document.body.appendChild(route);
      route.initialize(router, null);
      // * 以降は無視される
      expect(route.patternText).toBe('\\/files\\/(.*)');
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

  describe('rootElement', () => {
    it('shadowRootがない場合、自身を返すこと', () => {
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test');
      expect(route.rootElement).toBe(route);
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

  describe('testPath', () => {
    it('パスが一致する場合、マッチ結果を返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      const result = route.testPath('/users/123');
      expect(result).not.toBeNull();
      expect(result?.params).toEqual({ id: '123' });
      expect(result?.path).toBe('/users/123');
    });

    it('キャッシュされた正規表現を利用してマッチできること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      const first = route.testPath('/users/111');
      const second = route.testPath('/users/222');

      expect(first?.params).toEqual({ id: '111' });
      expect(second?.params).toEqual({ id: '222' });
    });

    it('パスが一致しない場合、nullを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      const result = route.testPath('/posts/123');
      expect(result).toBeNull();
    });

    it('複数のパラメータを含むパスをテストできること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:userId/posts/:postId');
      route.initialize(router, null);

      const result = route.testPath('/users/123/posts/456');
      expect(result?.params).toEqual({ userId: '123', postId: '456' });
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

  describe('absolutePatternText', () => {
    it('絶対パスの場合、patternTextをそのまま返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

        const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      expect(route.absolutePatternText).toBe('\\/users\\/([^\\/]+)');
    });

    it('相対パスで親がある場合、親のパターンと結合すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent');
      parentRoute.initialize(router, null);

      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', 'child/:id');
      childRoute.initialize(router, parentRoute);

      expect(childRoute.absolutePatternText).toBe('\\/parent\\/child\\/([^\\/]+)');
    });

    it('親のパターンが\\/で終わる場合、\\/を追加しないこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent/');
      parentRoute.initialize(router, null);

      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', 'child');
      childRoute.initialize(router, parentRoute);

      expect(childRoute.absolutePatternText).toBe('\\/parent\\/child');
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
  });

  describe('weight', () => {
    it('パスのweightを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);
      // 初期値-1 + / (+2) + 静的セグメント"users"(+2) + パラメータ":id"(+1) = 4
      expect(route.weight).toBe(4);
    });
  });

  describe('absoluteWeight', () => {
    it('絶対パスの場合、weightを返すこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/users/:id');
      route.initialize(router, null);

      expect(route.absoluteWeight).toBe(4);
    });

    it('相対パスで親がある場合、親のabsoluteWeightと自身のweightを合計すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/parent');
      parentRoute.initialize(router, null);

      const childRoute = document.createElement('wcs-route') as Route;
      childRoute.setAttribute('path', 'child');
      childRoute.initialize(router, parentRoute);

      expect(childRoute.absoluteWeight).toBe(4);
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

      await expect(route.guardCheck({ path: '/test', routes: [], params: {}, lastPath: '' })).resolves.toBeUndefined();
    });

    it('guardがある場合、guardHandlerを呼び出してからチェックすること', async () => {
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/protected');
      route.setAttribute('guard', '/login');

        const guardHandler = vi.fn().mockResolvedValue(true);
      route.guardHandler = guardHandler;

      await route.guardCheck({ path: '/protected', routes: [], params: {}, lastPath: '/' });

      expect(guardHandler).toHaveBeenCalledWith('/protected', '/');
    });

    it('guardHandlerがfalseを返す場合、GuardCancelをthrowすること', async () => {
      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/protected');
      route.setAttribute('guard', '/login');

      const guardHandler = vi.fn().mockResolvedValue(false);
      route.guardHandler = guardHandler;

      await expect(
        route.guardCheck({ path: '/protected', routes: [], params: {}, lastPath: '/' })
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
        await route.guardCheck({ path: '/protected', routes: [], params: {}, lastPath: '/' });
      } catch (error) {
        expect(error).toBeInstanceOf(GuardCancel);
        expect((error as GuardCancel).fallbackPath).toBe('/custom-login');
      }
    });
  });

  describe('show', () => {
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

      const result = route.show({ id: '123' });

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

      route.show({ id: '123' });

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

      route.show({});

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

      route.show({});

      expect(container.lastChild).toBe(span);
    });
  });

  describe('hide', () => {
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

      route.show({ id: '123' });
      expect(container.contains(span)).toBe(true);

      route.hide();
      expect(container.contains(span)).toBe(false);
      expect(route.params).toEqual({});
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

      route.show({ id: '123' });

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

      route.show({ id: '123' });

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

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/');
      parentRoute.initialize(router, null);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('fallback', '');

      route.initialize(router, parentRoute);

      expect(route.path).toBe('');
      expect(router.fallbackRoute).toBe(route);
    });

    it('fallbackRouteが既に設定されている場合、エラーを投げること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const parentRoute = document.createElement('wcs-route') as Route;
      parentRoute.setAttribute('path', '/');
      parentRoute.initialize(router, null);

      const first = document.createElement('wcs-route') as Route;
      first.setAttribute('fallback', '');
      first.initialize(router, parentRoute);

      const second = document.createElement('wcs-route') as Route;
      second.setAttribute('fallback', '');

      expect(() => {
        second.initialize(router, parentRoute);
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
  });

  describe('show - 追加カバレッジ', () => {
    it('ルート要素自体がdata-bind属性を持つ場合にパラメータを割り当てること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const route = document.createElement('wcs-route') as Route;
      route.setAttribute('path', '/test/:id');
      route.initialize(router, null);

      const div = document.createElement('div');
      div.setAttribute('data-bind', ''); // 空文字列は有効なbindType
      route.appendChild(div);

      const container = document.createElement('div');
      container.appendChild(route.placeHolder);

      route.show({ id: '123' });

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

      route.show({ id: '123' });

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

      route.show({ id: '123' });

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
      (route as any)._isMadeArray = true;

      const result = route.show({});

      expect(result).toBe(true);
      expect(container.textContent).toContain('text');
    });
  });
});
