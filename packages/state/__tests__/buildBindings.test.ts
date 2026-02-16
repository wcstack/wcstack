import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/bindings/initializeBindingPromiseByNode', () => ({
  waitInitializeBinding: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../src/bindings/initializeBindings', () => ({
  initializeBindings: vi.fn()
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

import { buildBindings } from '../src/buildBindings';
import { waitInitializeBinding } from '../src/bindings/initializeBindingPromiseByNode';
import { initializeBindings } from '../src/bindings/initializeBindings';
import { convertMustacheToComments } from '../src/mustache/convertMustacheToComments';
import { collectStructuralFragments } from '../src/structural/collectStructuralFragments';
import { waitForStateInitialize } from '../src/waitForStateInitialize';
import { config } from '../src/config';

describe('buildBindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Documentの場合', () => {
    it('正常にバインディングを構築すること', async () => {
      await buildBindings(document);

      expect(waitForStateInitialize).toHaveBeenCalledWith(document);
      expect(convertMustacheToComments).toHaveBeenCalledWith(document);
      expect(collectStructuralFragments).toHaveBeenCalledWith(document, document);
      expect(initializeBindings).toHaveBeenCalledWith(document.body, null);

      // ShadowRoot用の処理は呼ばれない
      expect(waitInitializeBinding).not.toHaveBeenCalled();
    });

    it('各処理が正しい順序で呼ばれること', async () => {
      const callOrder: string[] = [];

      vi.mocked(waitForStateInitialize).mockImplementation(async () => {
        callOrder.push('waitForStateInitialize');
      });
      vi.mocked(convertMustacheToComments).mockImplementation(() => {
        callOrder.push('convertMustacheToComments');
      });
      vi.mocked(collectStructuralFragments).mockImplementation(() => {
        callOrder.push('collectStructuralFragments');
      });
      vi.mocked(initializeBindings).mockImplementation(() => {
        callOrder.push('initializeBindings');
      });

      await buildBindings(document);

      expect(callOrder).toEqual([
        'waitForStateInitialize',
        'convertMustacheToComments',
        'collectStructuralFragments',
        'initializeBindings'
      ]);
    });
  });

  describe('ShadowRootの場合', () => {
    let shadowRoot: ShadowRoot;
    let component: Element;

    beforeEach(() => {
      component = document.createElement('div');
      shadowRoot = component.attachShadow({ mode: 'open' });
    });

    it('bindAttributeNameがない場合はwaitInitializeBindingが呼ばれないこと', async () => {
      await buildBindings(shadowRoot);

      expect(waitInitializeBinding).not.toHaveBeenCalled();
      expect(waitForStateInitialize).toHaveBeenCalledWith(shadowRoot);
      expect(convertMustacheToComments).toHaveBeenCalledWith(shadowRoot);
      expect(collectStructuralFragments).toHaveBeenCalledWith(shadowRoot, shadowRoot);
      expect(initializeBindings).toHaveBeenCalledWith(shadowRoot, null);
    });

    it('bindAttributeNameがある場合はwaitInitializeBindingが呼ばれること', async () => {
      component.setAttribute(config.bindAttributeName, 'state:prop');

      await buildBindings(shadowRoot);

      expect(waitInitializeBinding).toHaveBeenCalledWith(component);
      expect(waitForStateInitialize).toHaveBeenCalledWith(shadowRoot);
      expect(convertMustacheToComments).toHaveBeenCalledWith(shadowRoot);
      expect(collectStructuralFragments).toHaveBeenCalledWith(shadowRoot, shadowRoot);
      expect(initializeBindings).toHaveBeenCalledWith(shadowRoot, null);
    });

    it('bindAttributeNameがある場合の各処理の呼び出し順序が正しいこと', async () => {
      component.setAttribute(config.bindAttributeName, 'state:prop');
      const callOrder: string[] = [];

      vi.mocked(waitInitializeBinding).mockImplementation(async () => {
        callOrder.push('waitInitializeBinding');
      });
      vi.mocked(waitForStateInitialize).mockImplementation(async () => {
        callOrder.push('waitForStateInitialize');
      });
      vi.mocked(convertMustacheToComments).mockImplementation(() => {
        callOrder.push('convertMustacheToComments');
      });
      vi.mocked(collectStructuralFragments).mockImplementation(() => {
        callOrder.push('collectStructuralFragments');
      });
      vi.mocked(initializeBindings).mockImplementation(() => {
        callOrder.push('initializeBindings');
      });

      await buildBindings(shadowRoot);

      expect(callOrder).toEqual([
        'waitInitializeBinding',
        'waitForStateInitialize',
        'convertMustacheToComments',
        'collectStructuralFragments',
        'initializeBindings'
      ]);
    });

    it('bindAttributeNameがない場合の各処理の呼び出し順序が正しいこと', async () => {
      const callOrder: string[] = [];

      vi.mocked(waitForStateInitialize).mockImplementation(async () => {
        callOrder.push('waitForStateInitialize');
      });
      vi.mocked(convertMustacheToComments).mockImplementation(() => {
        callOrder.push('convertMustacheToComments');
      });
      vi.mocked(collectStructuralFragments).mockImplementation(() => {
        callOrder.push('collectStructuralFragments');
      });
      vi.mocked(initializeBindings).mockImplementation(() => {
        callOrder.push('initializeBindings');
      });

      await buildBindings(shadowRoot);

      expect(callOrder).toEqual([
        'waitForStateInitialize',
        'convertMustacheToComments',
        'collectStructuralFragments',
        'initializeBindings'
      ]);
    });
  });
});
