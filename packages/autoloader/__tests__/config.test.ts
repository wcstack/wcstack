import { describe, it, expect, beforeEach } from 'vitest';
import { config, getConfig, setConfig, DEFAULT_KEY, VANILLA_KEY, VANILLA_LOADER } from '../src/config';

describe('config', () => {
  describe('定数', () => {
    it('DEFAULT_KEYは"*"であること', () => {
      expect(DEFAULT_KEY).toBe('*');
    });

    it('VANILLA_KEYは"vanilla"であること', () => {
      expect(VANILLA_KEY).toBe('vanilla');
    });

    it('VANILLA_LOADERはpostfixとloaderを持つこと', () => {
      expect(VANILLA_LOADER.postfix).toBe('.js');
      expect(typeof VANILLA_LOADER.loader).toBe('function');
    });
  });

  describe('config', () => {
    it('デフォルト設定が正しいこと', () => {
      expect(config.scanImportmap).toBe(true);
      expect(config.observable).toBe(true);
      expect(config.loaders[VANILLA_KEY]).toBe(VANILLA_LOADER);
      expect(config.loaders[DEFAULT_KEY]).toBe(VANILLA_KEY);
    });
  });

  describe('getConfig', () => {
    it('フリーズされた設定を返すこと', () => {
      const frozenConfig = getConfig();
      expect(Object.isFrozen(frozenConfig)).toBe(true);
    });

    it('同じインスタンスを返すこと', () => {
      const config1 = getConfig();
      const config2 = getConfig();
      expect(config1).toBe(config2);
    });
  });

  describe('setConfig', () => {
    it('scanImportmapを変更できること', () => {
      const original = config.scanImportmap;
      setConfig({ scanImportmap: false });
      expect(config.scanImportmap).toBe(false);
      
      // リセット
      setConfig({ scanImportmap: original });
    });

    it('observableを変更できること', () => {
      const original = config.observable;
      setConfig({ observable: false });
      expect(config.observable).toBe(false);
      
      // リセット
      setConfig({ observable: original });
    });

    it('loadersを追加できること', () => {
      const customLoader = {
        postfix: '.custom.js',
        loader: async (path: string) => null
      };
      setConfig({ loaders: { 'custom': customLoader } });
      expect(config.loaders['custom']).toBe(customLoader);
    });

    it('設定変更後にgetConfigは新しいフリーズ済みインスタンスを返すこと', () => {
      const config1 = getConfig();
      setConfig({ observable: !config.observable });
      const config2 = getConfig();
      
      // 新しいインスタンスが返される（フリーズがリセットされるため）
      expect(config1).not.toBe(config2);
      
      // リセット
      setConfig({ observable: !config.observable });
    });
  });
});
