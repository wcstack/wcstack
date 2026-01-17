import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerComponents } from '../src/registerComponents';
import { Router } from '../src/components/Router';
import { Route } from '../src/components/Route';
import { Outlet } from '../src/components/Outlet';
import { Link } from '../src/components/Link';
import { Layout } from '../src/components/Layout';
import { LayoutOutlet } from '../src/components/LayoutOutlet';
import { config } from '../src/config';
// Don't import setup.ts to test fresh registration

describe('registerComponents', () => {
  const originalCustomElements = globalThis.customElements;

  beforeEach(() => {
    const RegistryCtor = (originalCustomElements as any).constructor as {
      new (window: Window): CustomElementRegistry;
    };
    const freshRegistry = new RegistryCtor(window);
    (globalThis as any).customElements = freshRegistry;
    if (globalThis.window) {
      (globalThis.window as any).customElements = freshRegistry;
    }

    // Clear the document
    document.body.innerHTML = '';
    (Router as any)._instance = null;
  });

  afterEach(() => {
    (globalThis as any).customElements = originalCustomElements;
    if (globalThis.window) {
      (globalThis.window as any).customElements = originalCustomElements;
    }
  });

  it('registerComponents関数が存在すること', () => {
    expect(registerComponents).toBeDefined();
    expect(typeof registerComponents).toBe('function');
  });

  it('registerComponents関数を呼び出してカスタム要素を登録できること', () => {
    // Call registerComponents to register all elements
    registerComponents();

    // Verify all elements are now registered
    expect(customElements.get(config.tagNames.router)).toBeDefined();
    expect(customElements.get(config.tagNames.route)).toBeDefined();
    expect(customElements.get(config.tagNames.outlet)).toBeDefined();
    expect(customElements.get(config.tagNames.link)).toBeDefined();
    expect(customElements.get(config.tagNames.layout)).toBeDefined();
    expect(customElements.get(config.tagNames.layoutOutlet)).toBeDefined();
  });

  it('登録されたカスタム要素が正しいクラスであること', () => {
    registerComponents();
    expect(customElements.get(config.tagNames.router)).toBe(Router);
    expect(customElements.get(config.tagNames.route)).toBe(Route);
    expect(customElements.get(config.tagNames.outlet)).toBe(Outlet);
    expect(customElements.get(config.tagNames.link)).toBe(Link);
    expect(customElements.get(config.tagNames.layout)).toBe(Layout);
    expect(customElements.get(config.tagNames.layoutOutlet)).toBe(LayoutOutlet);
  });

  it('registerComponents関数を複数回呼び出してもエラーが発生しないこと', () => {
    // Should not throw when called multiple times (elements already registered)
    registerComponents();
    expect(() => registerComponents()).not.toThrow();
    expect(() => registerComponents()).not.toThrow();
    expect(() => registerComponents()).not.toThrow();
  });

  it('登録後に一部のカスタム要素をDOM内で使用できること', () => {
    registerComponents();
    // Create elements that don't require parent nodes
    const router = document.createElement('wc-router');
    const outlet = document.createElement('wc-outlet');
    const layout = document.createElement('wc-layout');
    const layoutOutlet = document.createElement('wc-layout-outlet');

    expect(router).toBeInstanceOf(Router);
    expect(outlet).toBeInstanceOf(Outlet);
    expect(layout).toBeInstanceOf(Layout);
    expect(layoutOutlet).toBeInstanceOf(LayoutOutlet);
  });

  it('config.tagNamesで定義された名前でカスタム要素が登録されていること', () => {
    registerComponents();
    // Verify that the tag names from config are used
    expect(config.tagNames.router).toBe('wc-router');
    expect(config.tagNames.route).toBe('wc-route');
    expect(config.tagNames.outlet).toBe('wc-outlet');
    expect(config.tagNames.link).toBe('wc-link');
    expect(config.tagNames.layout).toBe('wc-layout');
    expect(config.tagNames.layoutOutlet).toBe('wc-layout-outlet');

    // Verify elements are registered with these names
    expect(customElements.get('wc-router')).toBe(Router);
    expect(customElements.get('wc-route')).toBe(Route);
    expect(customElements.get('wc-outlet')).toBe(Outlet);
    expect(customElements.get('wc-link')).toBe(Link);
    expect(customElements.get('wc-layout')).toBe(Layout);
    expect(customElements.get('wc-layout-outlet')).toBe(LayoutOutlet);
  });

  it('registerComponentsの内部ロジックをテストすること', () => {
    registerComponents();
    // Test that all conditional checks work correctly
    // Since elements are already registered, verify the function handles this gracefully
    
    // Get initial registration state
    const initialRouter = customElements.get(config.tagNames.router);
    const initialRoute = customElements.get(config.tagNames.route);
    const initialOutlet = customElements.get(config.tagNames.outlet);
    const initialLink = customElements.get(config.tagNames.link);
    const initialLayout = customElements.get(config.tagNames.layout);
    const initialLayoutOutlet = customElements.get(config.tagNames.layoutOutlet);
    
    // Call registerComponents
    registerComponents();
    
    // Verify registrations haven't changed (no re-registration)
    expect(customElements.get(config.tagNames.router)).toBe(initialRouter);
    expect(customElements.get(config.tagNames.route)).toBe(initialRoute);
    expect(customElements.get(config.tagNames.outlet)).toBe(initialOutlet);
    expect(customElements.get(config.tagNames.link)).toBe(initialLink);
    expect(customElements.get(config.tagNames.layout)).toBe(initialLayout);
    expect(customElements.get(config.tagNames.layoutOutlet)).toBe(initialLayoutOutlet);
  });
});
