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
    expect(config.tagNames.route).toBe('wcs-route');
    expect(config.tagNames.router).toBe('wcs-router');
    expect(config.tagNames.outlet).toBe('wcs-outlet');
    expect(config.tagNames.layout).toBe('wcs-layout');
    expect(config.tagNames.layoutOutlet).toBe('wcs-layout-outlet');
    expect(config.tagNames.link).toBe('wcs-link');
  });

  it('enableShadowRoot設定が存在すること', () => {
    expect(config.enableShadowRoot).toBeDefined();
    expect(typeof config.enableShadowRoot).toBe('boolean');
  });

  it('basenameFileExtensions設定が存在すること', () => {
    expect(config.basenameFileExtensions).toBeDefined();
    expect(Array.isArray(config.basenameFileExtensions)).toBe(true);
  });

  it('basenameFileExtensionsのデフォルト値が[".html"]であること', () => {
    expect(config.basenameFileExtensions).toEqual(['.html']);
  });
});
