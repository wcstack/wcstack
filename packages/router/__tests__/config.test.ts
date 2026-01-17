import { describe, it, expect } from 'vitest';
import { config } from '../src/config';

describe('config', () => {
  it('設定オブジェクトが存在すること', () => {
    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
  });

  it('tagNamesプロパティを持つこと', () => {
    expect(config.tagNames).toBeDefined();
    expect(typeof config.tagNames).toBe('object');
  });

  it('すべてのタグ名が定義されていること', () => {
    expect(config.tagNames.route).toBe('wc-route');
    expect(config.tagNames.router).toBe('wc-router');
    expect(config.tagNames.outlet).toBe('wc-outlet');
    expect(config.tagNames.layout).toBe('wc-layout');
    expect(config.tagNames.layoutOutlet).toBe('wc-layout-outlet');
    expect(config.tagNames.link).toBe('wc-link');
  });

  it('enableShadowRoot設定が存在すること', () => {
    expect(config.enableShadowRoot).toBeDefined();
    expect(typeof config.enableShadowRoot).toBe('boolean');
  });
});
