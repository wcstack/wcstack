import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { config, setConfig, getConfig } from '../src/config';

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

describe('setConfig', () => {
  // 各テスト後に設定を元に戻す
  const originalTagNames = { ...config.tagNames };
  const originalEnableShadowRoot = config.enableShadowRoot;
  const originalBasenameFileExtensions = [...config.basenameFileExtensions];

  afterEach(() => {
    setConfig({
      tagNames: originalTagNames,
      enableShadowRoot: originalEnableShadowRoot,
      basenameFileExtensions: originalBasenameFileExtensions
    });
  });

  it('setConfig関数が存在すること', () => {
    expect(setConfig).toBeDefined();
    expect(typeof setConfig).toBe('function');
  });

  it('enableShadowRootを変更できること', () => {
    const before = config.enableShadowRoot;
    setConfig({ enableShadowRoot: !before });
    expect(config.enableShadowRoot).toBe(!before);
  });

  it('basenameFileExtensionsを変更できること', () => {
    setConfig({ basenameFileExtensions: ['.html', '.php'] });
    expect(config.basenameFileExtensions).toEqual(['.html', '.php']);
  });

  it('basenameFileExtensionsを空配列に変更できること', () => {
    setConfig({ basenameFileExtensions: [] });
    expect(config.basenameFileExtensions).toEqual([]);
  });

  it('tagNamesを部分的に変更できること', () => {
    setConfig({ tagNames: { route: 'custom-route' } });
    expect(config.tagNames.route).toBe('custom-route');
    // 他のタグ名は変更されていないこと
    expect(config.tagNames.router).toBe('wcs-router');
  });

  it('複数の設定を同時に変更できること', () => {
    setConfig({
      enableShadowRoot: true,
      basenameFileExtensions: ['.php']
    });
    expect(config.enableShadowRoot).toBe(true);
    expect(config.basenameFileExtensions).toEqual(['.php']);
  });

  it('空のオブジェクトを渡しても既存の設定が維持されること', () => {
    const beforeExt = [...config.basenameFileExtensions];
    const beforeShadow = config.enableShadowRoot;
    setConfig({});
    expect(config.basenameFileExtensions).toEqual(beforeExt);
    expect(config.enableShadowRoot).toBe(beforeShadow);
  });
});

describe('getConfig', () => {
  it('getConfig関数が存在すること', () => {
    expect(getConfig).toBeDefined();
    expect(typeof getConfig).toBe('function');
  });

  it('getConfigが設定オブジェクトを返すこと', () => {
    const result = getConfig();
    expect(result).toBeDefined();
    expect(result.tagNames).toBeDefined();
    expect(result.enableShadowRoot).toBeDefined();
    expect(result.basenameFileExtensions).toBeDefined();
  });

  it('getConfigの戻り値がfreezeされていること', () => {
    const result = getConfig();
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('getConfigの戻り値のtagNamesがfreezeされていること', () => {
    const result = getConfig();
    expect(Object.isFrozen(result.tagNames)).toBe(true);
  });

  it('configとgetConfigが同じ値を返すこと', () => {
    const result = getConfig();
    expect(result.enableShadowRoot).toBe(config.enableShadowRoot);
    expect(result.tagNames.route).toBe(config.tagNames.route);
  });
});
