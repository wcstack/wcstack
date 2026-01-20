import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Outlet, createOutlet } from '../src/components/Outlet';
import { config, setConfig } from '../src/config';
import { Router } from '../src/components/Router';
import './setup';

describe('Outlet', () => {
  let originalEnableShadowRoot: boolean;

  beforeEach(() => {
    originalEnableShadowRoot = config.enableShadowRoot;
  });

  afterEach(() => {
    setConfig({ enableShadowRoot: originalEnableShadowRoot });
  });

  it('Outletクラスが存在すること', () => {
    expect(Outlet).toBeDefined();
    expect(typeof Outlet).toBe('function');
  });

  it('HTMLElementを継承していること', () => {
    expect(Object.getPrototypeOf(Outlet.prototype)).toBe(HTMLElement.prototype);
  });

  it('インスタンスを作成できること', () => {
    const outlet = document.createElement('wcs-outlet') as Outlet;
    expect(outlet).toBeInstanceOf(Outlet);
    expect(outlet).toBeInstanceOf(HTMLElement);
  });

  describe('constructor', () => {
    it('enableShadowRootがtrueの場合、shadowRootを作成すること', () => {
      setConfig({ enableShadowRoot: true });
      const outlet = document.createElement('wcs-outlet') as Outlet;
      document.body.appendChild(outlet);
      expect(outlet.shadowRoot).not.toBeNull();
    });

    it('enableShadowRootがfalseの場合、shadowRootを作成しないこと', () => {
      setConfig({ enableShadowRoot: false });
      const outlet = document.createElement('wcs-outlet') as Outlet;
      expect(outlet.shadowRoot).toBeNull();
    });
  });

  describe('routesNode', () => {
    it('routesNodeが設定されていない場合、getterでエラーを投げること', () => {
      const outlet = document.createElement('wcs-outlet') as Outlet;
      expect(() => outlet.routesNode).toThrow('[@wcstack/router] wcs-outlet has no routesNode.');
    });

    it('routesNodeをsetterで設定し、getterで取得できること', () => {
      const outlet = document.createElement('wcs-outlet') as Outlet;
      const router = document.createElement('wcs-router') as Router;
      
      outlet.routesNode = router;
      expect(outlet.routesNode).toBe(router);
    });
  });

  describe('rootNode', () => {
    it('shadowRootがある場合、shadowRootを返すこと', () => {
      setConfig({ enableShadowRoot: true });
      const outlet = document.createElement('wcs-outlet') as Outlet;
      document.body.appendChild(outlet);
      expect(outlet.rootNode).toBe(outlet.shadowRoot);
      expect(outlet.rootNode).not.toBe(outlet);
    });

    it('shadowRootがない場合、自身を返すこと', () => {
      setConfig({ enableShadowRoot: false });
      const outlet = document.createElement('wcs-outlet') as Outlet;
      expect(outlet.rootNode).toBe(outlet);
    });
  });

  describe('lastRoutes', () => {
    it('初期状態では空配列を返すこと', () => {
      const outlet = document.createElement('wcs-outlet') as Outlet;
      expect(outlet.lastRoutes).toEqual([]);
    });

    it('lastRoutesをsetterで設定し、getterで取得できること', () => {
      const outlet = document.createElement('wcs-outlet') as Outlet;
      const routes = [
        { path: '/test1', component: () => {} },
        { path: '/test2', component: () => {} }
      ] as any[];
      
      outlet.lastRoutes = routes;
      expect(outlet.lastRoutes).toEqual(routes);
      // 配列のコピーが作成されることを確認
      expect(outlet.lastRoutes).not.toBe(routes);
    });
  });

  describe('connectedCallback', () => {
    it('connectedCallbackが呼ばれてもエラーにならないこと', () => {
      const outlet = document.createElement('wcs-outlet') as Outlet;
      expect(() => {
        document.body.appendChild(outlet);
      }).not.toThrow();
    });

    it('初期化済みの場合、_initializeを実行しないこと', () => {
      setConfig({ enableShadowRoot: true });
      const outlet = document.createElement('wcs-outlet') as Outlet;
      (outlet as any)._initialized = true;

      outlet.connectedCallback();

      expect(outlet.shadowRoot).toBeNull();
    });
  });

  describe('createOutlet', () => {
    it('Outletのインスタンスを作成できること', () => {
      const outlet = createOutlet();
      expect(outlet).toBeInstanceOf(Outlet);
      expect(outlet).toBeInstanceOf(HTMLElement);
    });
  });
});
