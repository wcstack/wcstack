import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Outlet, createOutlet } from '../src/components/Outlet';
import { config } from '../src/config';
import { Router } from '../src/components/Router';
import './setup';

describe('Outlet', () => {
  let originalEnableShadowRoot: boolean;

  beforeEach(() => {
    originalEnableShadowRoot = config.enableShadowRoot;
  });

  afterEach(() => {
    config.enableShadowRoot = originalEnableShadowRoot;
  });

  it('Outlet繧ｯ繝ｩ繧ｹ縺悟ｭ伜惠縺吶ｋ縺薙→', () => {
    expect(Outlet).toBeDefined();
    expect(typeof Outlet).toBe('function');
  });

  it('HTMLElement繧堤ｶ呎価縺励※縺・ｋ縺薙→', () => {
    expect(Object.getPrototypeOf(Outlet.prototype)).toBe(HTMLElement.prototype);
  });

  it('繧､繝ｳ繧ｹ繧ｿ繝ｳ繧ｹ繧剃ｽ懈・縺ｧ縺阪ｋ縺薙→', () => {
    const outlet = document.createElement('wcs-outlet') as Outlet;
    expect(outlet).toBeInstanceOf(Outlet);
    expect(outlet).toBeInstanceOf(HTMLElement);
  });

  describe('constructor', () => {
    it('enableShadowRoot縺荊rue縺ｮ蝣ｴ蜷医《hadowRoot繧剃ｽ懈・縺吶ｋ縺薙→', () => {
      config.enableShadowRoot = true;
      const outlet = document.createElement('wcs-outlet') as Outlet;
      document.body.appendChild(outlet);
      expect(outlet.shadowRoot).not.toBeNull();
    });

    it('enableShadowRoot縺掲alse縺ｮ蝣ｴ蜷医《hadowRoot繧剃ｽ懈・縺励↑縺・％縺ｨ', () => {
      config.enableShadowRoot = false;
      const outlet = document.createElement('wcs-outlet') as Outlet;
      expect(outlet.shadowRoot).toBeNull();
    });
  });

  describe('routesNode', () => {
    it('routesNode縺瑚ｨｭ螳壹＆繧後※縺・↑縺・ｴ蜷医“etter縺ｧ繧ｨ繝ｩ繝ｼ繧呈兜縺偵ｋ縺薙→', () => {
      const outlet = document.createElement('wcs-outlet') as Outlet;
      expect(() => outlet.routesNode).toThrow('[@wcstack/router] wcs-outlet has no routesNode.');
    });

    it('routesNode繧痴etter縺ｧ險ｭ螳壹＠縲“etter縺ｧ蜿門ｾ励〒縺阪ｋ縺薙→', () => {
      const outlet = document.createElement('wcs-outlet') as Outlet;
      const router = document.createElement('wcs-router') as Router;
      
      outlet.routesNode = router;
      expect(outlet.routesNode).toBe(router);
    });
  });

  describe('rootNode', () => {
    it('shadowRoot縺後≠繧句ｴ蜷医《hadowRoot繧定ｿ斐☆縺薙→', () => {
      config.enableShadowRoot = true;
      const outlet = document.createElement('wcs-outlet') as Outlet;
      document.body.appendChild(outlet);
      expect(outlet.rootNode).toBe(outlet.shadowRoot);
      expect(outlet.rootNode).not.toBe(outlet);
    });

    it('shadowRoot縺後↑縺・ｴ蜷医∬・霄ｫ繧定ｿ斐☆縺薙→', () => {
      config.enableShadowRoot = false;
      const outlet = document.createElement('wcs-outlet') as Outlet;
      expect(outlet.rootNode).toBe(outlet);
    });
  });

  describe('lastRoutes', () => {
    it('蛻晄悄迥ｶ諷九〒縺ｯ遨ｺ驟榊・繧定ｿ斐☆縺薙→', () => {
      const outlet = document.createElement('wcs-outlet') as Outlet;
      expect(outlet.lastRoutes).toEqual([]);
    });

    it('lastRoutes繧痴etter縺ｧ險ｭ螳壹＠縲“etter縺ｧ蜿門ｾ励〒縺阪ｋ縺薙→', () => {
      const outlet = document.createElement('wcs-outlet') as Outlet;
      const routes = [
        { path: '/test1', component: () => {} },
        { path: '/test2', component: () => {} }
      ] as any[];
      
      outlet.lastRoutes = routes;
      expect(outlet.lastRoutes).toEqual(routes);
      // 驟榊・縺ｮ繧ｳ繝斐・縺御ｽ懈・縺輔ｌ繧九％縺ｨ繧堤｢ｺ隱・
      expect(outlet.lastRoutes).not.toBe(routes);
    });
  });

  describe('connectedCallback', () => {
    it('connectedCallback縺悟他縺ｰ繧後※繧ゅお繝ｩ繝ｼ縺ｫ縺ｪ繧峨↑縺・％縺ｨ', () => {
      const outlet = document.createElement('wcs-outlet') as Outlet;
      expect(() => {
        document.body.appendChild(outlet);
      }).not.toThrow();
    });

    it('蛻晄悄蛹匁ｸ医∩縺ｮ蝣ｴ蜷医・_ initialize繧貞ｮ溯｡後＠縺ｪ縺・％縺ｨ', () => {
      config.enableShadowRoot = true;
      const outlet = document.createElement('wcs-outlet') as Outlet;
      (outlet as any)._initialized = true;

      outlet.connectedCallback();

      expect(outlet.shadowRoot).toBeNull();
    });
  });

  describe('createOutlet', () => {
    it('Outlet縺ｮ繧､繝ｳ繧ｹ繧ｿ繝ｳ繧ｹ繧剃ｽ懈・縺ｧ縺阪ｋ縺薙→', () => {
      const outlet = createOutlet();
      expect(outlet).toBeInstanceOf(Outlet);
      expect(outlet).toBeInstanceOf(HTMLElement);
    });
  });
});
