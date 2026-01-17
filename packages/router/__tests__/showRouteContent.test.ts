import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showRouteContent } from '../src/showRouteContent';
import { Router } from '../src/components/Router';
import { Route } from '../src/components/Route';
import { GuardCancel } from '../src/GuardCancel';
import type { IRoute, IRouteMatchResult, IRouter } from '../src/components/types';
import './setup';

describe('showRouteContent', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (Router as any)._instance = null;
    vi.clearAllMocks();
  });

  it('showRouteContent髢｢謨ｰ縺悟ｭ伜惠縺吶ｋ縺薙→', () => {
    expect(showRouteContent).toBeDefined();
    expect(typeof showRouteContent).toBe('function');
  });

  it('蜑阪・繝ｫ繝ｼ繝医ｒ髱櫁｡ｨ遉ｺ縺ｫ縺吶ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as IRouter;
    document.body.appendChild(router);

    // Create mock route objects instead of actual elements
    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(false),
    } as any;

    const route2: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(false),
    } as any;

    const matchResult: IRouteMatchResult = {
      routes: [route2],
      params: {}
    };

    await showRouteContent(router, matchResult, [route1]);

    // route1 should be hidden (not in current routes)
    expect(route1.hide).toHaveBeenCalled();
    // route2 should not be hidden (in current routes)
    expect(route2.hide).not.toHaveBeenCalled();
  });

  it('縺吶∋縺ｦ縺ｮ繝ｫ繝ｼ繝医↓蟇ｾ縺励※繧ｬ繝ｼ繝峨メ繧ｧ繝・け繧貞ｮ溯｡後☆繧九％縺ｨ', async () => {
    const router = document.createElement('wcs-router') as IRouter;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const route2: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const matchResult: IRouteMatchResult = {
      routes: [route1, route2],
      params: {}
    };

    await showRouteContent(router, matchResult, []);

    expect(route1.guardCheck).toHaveBeenCalledWith(matchResult);
    expect(route2.guardCheck).toHaveBeenCalledWith(matchResult);
  });

  it('繧ｬ繝ｼ繝峨く繝｣繝ｳ繧ｻ繝ｫ譎ゅ↓繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ繝代せ縺ｸ繝翫ン繧ｲ繝ｼ繝医☆繧九％縺ｨ', async () => {
    const router = document.createElement('wcs-router') as IRouter;
    document.body.appendChild(router);

    const guardCancel = new GuardCancel('Guard rejected', '/fallback');
    
    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockRejectedValue(guardCancel),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    router.navigate = vi.fn();

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const matchResult: IRouteMatchResult = {
      routes: [route1],
      params: {}
    };

    await showRouteContent(router, matchResult, []);

    // Wait for microtask
    await new Promise(resolve => queueMicrotask(resolve));

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Navigation cancelled')
    );
    expect(router.navigate).toHaveBeenCalledWith('/fallback');

    consoleWarnSpy.mockRestore();
  });

  it('繧ｬ繝ｼ繝我ｻ･螟悶・繧ｨ繝ｩ繝ｼ縺ｯ蜀阪せ繝ｭ繝ｼ縺吶ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as IRouter;
    document.body.appendChild(router);

    const normalError = new Error('Some other error');
    
    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockRejectedValue(normalError),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const matchResult: IRouteMatchResult = {
      routes: [route1],
      params: {}
    };

    await expect(
      showRouteContent(router, matchResult, [])
    ).rejects.toThrow('Some other error');
  });

  it('譁ｰ縺励＞繝ｫ繝ｼ繝医ｒ陦ｨ遉ｺ縺吶ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as IRouter;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const matchResult: IRouteMatchResult = {
      routes: [route1],
      params: { id: '123' }
    };

    await showRouteContent(router, matchResult, []);

    expect(route1.show).toHaveBeenCalledWith({ id: '123' });
  });

  it('shouldChange縺荊rue縺ｮ蝣ｴ蜷医↓繝ｫ繝ｼ繝医ｒ陦ｨ遉ｺ縺吶ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as IRouter;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const matchResult: IRouteMatchResult = {
      routes: [route1],
      params: {}
    };

    // route1 is in lastRoutes but shouldChange returns true
    await showRouteContent(router, matchResult, [route1]);

    expect(route1.shouldChange).toHaveBeenCalledWith({});
    expect(route1.show).toHaveBeenCalled();
  });

  it('shouldChange縺掲alse縺ｧforce=false縺ｮ蝣ｴ蜷医・show繧貞他縺ｰ縺ｪ縺・％縺ｨ', async () => {
    const router = document.createElement('wcs-router') as IRouter;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(false),
    } as any;

    const matchResult: IRouteMatchResult = {
      routes: [route1],
      params: {}
    };

    // route1 is in lastRoutes and shouldChange returns false
    await showRouteContent(router, matchResult, [route1]);

    expect(route1.shouldChange).toHaveBeenCalledWith({});
    expect(route1.show).not.toHaveBeenCalled();
  });

  it('show縺荊rue繧定ｿ斐＠縺溷ｴ蜷医↓蠕檎ｶ壹・繝ｫ繝ｼ繝医ｒ蠑ｷ蛻ｶ逧・↓陦ｨ遉ｺ縺吶ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as IRouter;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(true), // Returns true to force
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const route2: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(false), // Would normally skip
    } as any;

    const matchResult: IRouteMatchResult = {
      routes: [route1, route2],
      params: {}
    };

    await showRouteContent(router, matchResult, [route1, route2]);

    expect(route1.show).toHaveBeenCalled();
    expect(route2.show).toHaveBeenCalled(); // Forced due to route1.show returning true
  });

  it('隍・焚縺ｮ繝ｫ繝ｼ繝医〒蜑阪・繝ｫ繝ｼ繝医そ繝・ヨ繧呈ｭ｣縺励￥蜃ｦ逅・☆繧九％縺ｨ', async () => {
    const router = document.createElement('wcs-router') as IRouter;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(false),
    } as any;

    const route2: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const route3: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const matchResult: IRouteMatchResult = {
      routes: [route2, route3],
      params: {}
    };

    // route1 was in lastRoutes but not in current
    await showRouteContent(router, matchResult, [route1, route2]);

    expect(route1.hide).toHaveBeenCalled();
    expect(route2.hide).not.toHaveBeenCalled();
    expect(route3.hide).not.toHaveBeenCalled();
  });

  it('遨ｺ縺ｮ繝ｫ繝ｼ繝磯・蛻励ｒ蜃ｦ逅・〒縺阪ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as IRouter;
    document.body.appendChild(router);

    const matchResult: IRouteMatchResult = {
      routes: [],
      params: {}
    };

    await expect(
      showRouteContent(router, matchResult, [])
    ).resolves.not.toThrow();
  });

  it('蜑阪・繝ｫ繝ｼ繝医′縺ｪ縺・こ繝ｼ繧ｹ繧貞・逅・〒縺阪ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as IRouter;
    document.body.appendChild(router);

    const route1: IRoute = {
      hide: vi.fn(),
      show: vi.fn().mockReturnValue(false),
      guardCheck: vi.fn().mockResolvedValue(undefined),
      shouldChange: vi.fn().mockReturnValue(true),
    } as any;

    const matchResult: IRouteMatchResult = {
      routes: [route1],
      params: {}
    };

    await showRouteContent(router, matchResult, []);

    expect(route1.show).toHaveBeenCalled();
  });
});
