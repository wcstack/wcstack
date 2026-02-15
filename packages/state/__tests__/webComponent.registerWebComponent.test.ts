import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/bindings/initializeBindingPromiseByNode', () => ({
  waitInitializeBinding: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../src/mustache/convertMustacheToComments', () => ({
  convertMustacheToComments: vi.fn()
}));
vi.mock('../src/structural/collectStructuralFragments', () => ({
  collectStructuralFragments: vi.fn()
}));
vi.mock('../src/waitForStateInitialize', () => ({
  waitForStateInitialize: vi.fn().mockResolvedValue(undefined)
}));

import { registerWebComponent, isWebComponentRegistered } from '../src/webComponent/registerWebComponent';
import { waitInitializeBinding } from '../src/bindings/initializeBindingPromiseByNode';
import { convertMustacheToComments } from '../src/mustache/convertMustacheToComments';
import { collectStructuralFragments } from '../src/structural/collectStructuralFragments';
import { waitForStateInitialize } from '../src/waitForStateInitialize';

describe('registerWebComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerWebComponent', () => {
    it('shadowRootがない場合はエラーになること', async () => {
      const component = document.createElement('div');

      await expect(registerWebComponent(component)).rejects.toThrow(/no shadow root/);
    });

    it('正常にWebComponentを登録すること', async () => {
      const component = document.createElement('div');
      component.attachShadow({ mode: 'open' });

      await registerWebComponent(component);

      expect(waitForStateInitialize).toHaveBeenCalledWith(component.shadowRoot);
      expect(convertMustacheToComments).toHaveBeenCalledWith(component.shadowRoot);
      expect(collectStructuralFragments).toHaveBeenCalledWith(component.shadowRoot, component.shadowRoot);
      expect(waitInitializeBinding).toHaveBeenCalledWith(component);
    });

    it('登録後はisWebComponentRegisteredがtrueを返すこと', async () => {
      const component = document.createElement('div');
      component.attachShadow({ mode: 'open' });

      expect(isWebComponentRegistered(component)).toBe(false);

      await registerWebComponent(component);

      expect(isWebComponentRegistered(component)).toBe(true);
    });

    it('同じWebComponentを2回登録しても1回のみ処理されること', async () => {
      const component = document.createElement('div');
      component.attachShadow({ mode: 'open' });

      await registerWebComponent(component);
      await registerWebComponent(component);

      // 各関数が1回のみ呼ばれること
      expect(waitForStateInitialize).toHaveBeenCalledTimes(1);
      expect(convertMustacheToComments).toHaveBeenCalledTimes(1);
      expect(collectStructuralFragments).toHaveBeenCalledTimes(1);
      expect(waitInitializeBinding).toHaveBeenCalledTimes(1);
    });

    it('異なるWebComponentは独立して登録されること', async () => {
      const component1 = document.createElement('div');
      const component2 = document.createElement('div');
      component1.attachShadow({ mode: 'open' });
      component2.attachShadow({ mode: 'open' });

      await registerWebComponent(component1);

      expect(isWebComponentRegistered(component1)).toBe(true);
      expect(isWebComponentRegistered(component2)).toBe(false);

      await registerWebComponent(component2);

      expect(isWebComponentRegistered(component1)).toBe(true);
      expect(isWebComponentRegistered(component2)).toBe(true);
    });
  });

  describe('isWebComponentRegistered', () => {
    it('未登録のWebComponentに対してfalseを返すこと', () => {
      const component = document.createElement('div');

      expect(isWebComponentRegistered(component)).toBe(false);
    });
  });
});
