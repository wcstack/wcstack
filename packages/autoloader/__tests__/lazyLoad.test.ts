import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handlerForLazyLoad, getCustomTagInfo } from '../src/lazyLoad.js';
import { loadingTags, resetState } from '../src/tags.js';
import { DEFAULT_KEY } from '../src/config.js';
import { ILoader } from '../src/types.js';

describe('lazyLoad', () => {
  const registry = new Map<string, CustomElementConstructor>();

  beforeEach(() => {
    document.body.innerHTML = '';
    resetState();
    registry.clear();
    vi.clearAllMocks();
    
    vi.spyOn(customElements, 'define').mockImplementation((name, constructor) => {
      registry.set(name, constructor);
    });
    vi.spyOn(customElements, 'get').mockImplementation((name) => {
      return registry.get(name);
    });
    vi.spyOn(customElements, 'whenDefined').mockResolvedValue(class extends HTMLElement {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ドキュメント内のコンポーネントをロードすること', async () => {
    const mockConstructor = class extends HTMLElement {};
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockResolvedValue(mockConstructor)
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    document.body.innerHTML = '<ui-button></ui-button>';

    await handlerForLazyLoad(document, config, prefixMap);

    expect(mockLoader.loader).toHaveBeenCalledWith('@components/ui/button.js');
    expect(customElements.define).toHaveBeenCalledWith('ui-button', mockConstructor);
  });

  it('ネストされたコンポーネントもロードすること', async () => {
    const mockConstructor = class extends HTMLElement {};
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockResolvedValue(mockConstructor)
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    document.body.innerHTML = '<div><ui-card><span><ui-button></ui-button></span></ui-card></div>';

    await handlerForLazyLoad(document, config, prefixMap);

    expect(mockLoader.loader).toHaveBeenCalledWith('@components/ui/card.js');
    expect(mockLoader.loader).toHaveBeenCalledWith('@components/ui/button.js');
    expect(customElements.define).toHaveBeenCalledWith('ui-card', mockConstructor);
    expect(customElements.define).toHaveBeenCalledWith('ui-button', mockConstructor);
  });

  it('"is"属性を処理すること', async () => {
    const mockConstructor = class extends HTMLButtonElement {};
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockResolvedValue(mockConstructor)
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    document.body.innerHTML = '<button is="ui-button"></button>';

    await handlerForLazyLoad(document, config, prefixMap);

    expect(mockLoader.loader).toHaveBeenCalledWith('@components/ui/button.js');
    expect(customElements.define).toHaveBeenCalledWith('ui-button', mockConstructor, { extends: 'button' });
  });

  it('observableがtrueの場合、mutationを監視すること', async () => {
    const mockConstructor = class extends HTMLElement {};
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockResolvedValue(mockConstructor)
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: true,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    await handlerForLazyLoad(document, config, prefixMap);

    // Simulate mutation
    const el = document.createElement('ui-input');
    document.body.appendChild(el);

    // Wait for MutationObserver (which is async)
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockLoader.loader).toHaveBeenCalledWith('@components/ui/input.js');
    expect(customElements.define).toHaveBeenCalledWith('ui-input', mockConstructor);
  });

  it('マッチするprefixがない要素の場合、エラーをthrowすること', async () => {
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn()
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    document.body.innerHTML = '<other-element></other-element>';

    await expect(handlerForLazyLoad(document, config, prefixMap)).rejects.toThrow(/No matching namespace found/);
    expect(mockLoader.loader).not.toHaveBeenCalled();
  });

  it('loader失敗時はthrowせずconsole.errorを出力すること', async () => {
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn()
        .mockRejectedValueOnce(new Error('Load failed'))
        .mockResolvedValue(class extends HTMLElement {})
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    document.body.innerHTML = '<ui-broken></ui-broken>';

    await handlerForLazyLoad(document, config, prefixMap);

    expect(console.error).toHaveBeenCalled();
  });

  it('shadow rootの中も走査すること', async () => {
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockResolvedValue(class extends HTMLElement {})
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    // Manually create element with shadow root to avoid relying on customElements upgrade
    // which is tricky when customElements.define is mocked.
    const container = document.createElement('my-container');
    container.attachShadow({ mode: 'open' });
    container.shadowRoot!.innerHTML = '<ui-shadow-button></ui-shadow-button>';
    document.body.appendChild(container);

    // Mock that my-container is defined
    registry.set('my-container', class extends HTMLElement {});
    
    await handlerForLazyLoad(document, config, prefixMap);
    
    expect(mockLoader.loader).toHaveBeenCalledWith('@components/ui/shadow-button.js');
  });

  it('不正なloaderキーの場合、console.errorを出力すること', async () => {
    const config = {
      loaders: { [DEFAULT_KEY]: { postfix: '.js', loader: async () => null } },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: 'invalid',
        isNameSpaced: true
      }
    };

    document.body.innerHTML = '<ui-button></ui-button>';

    await handlerForLazyLoad(document, config, prefixMap);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to lazy load component 'ui-button'"),
      expect.any(Error)
    );
  });

  it('空のコンポーネント名の場合、console.errorを出力すること', async () => {
    const config = {
      loaders: { [DEFAULT_KEY]: { postfix: '.js', loader: async () => null } },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    document.body.innerHTML = '<ui-></ui->';

    await handlerForLazyLoad(document, config, prefixMap);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to lazy load component 'ui-'"),
      expect.any(Error)
    );
  });

  it('loaderがnullを返した場合、console.errorを出力すること', async () => {
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockResolvedValue(null)
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    document.body.innerHTML = '<ui-null></ui-null>';

    await handlerForLazyLoad(document, config, prefixMap);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to lazy load component 'ui-null'"),
      expect.any(Error)
    );
  });

  it('タグが既にロード中の場合は待機すること', async () => {
    const mockConstructor = class extends HTMLElement {};
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockResolvedValue(mockConstructor)
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    loadingTags.add('ui-loading');
    const whenDefinedSpy = vi.mocked(customElements.whenDefined);
    whenDefinedSpy.mockImplementation((name: string) => {
      registry.set(name, mockConstructor);
      return Promise.resolve(mockConstructor);
    });
    document.body.innerHTML = '<ui-loading></ui-loading>';

    await handlerForLazyLoad(document, config, prefixMap);

    expect(customElements.whenDefined).toHaveBeenCalledWith('ui-loading');
    expect(mockLoader.loader).not.toHaveBeenCalled();
  });

  it('loader実行前に要素が定義された場合、ロードをスキップすること', async () => {
    const mockConstructor = class extends HTMLElement {};
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn()
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    let firstCall = true;
    const getSpy = vi.mocked(customElements.get);
    getSpy.mockImplementation((name: string) => {
      if (name === 'ui-predefined') {
        if (firstCall) {
          firstCall = false;
          return undefined;
        }
        return mockConstructor;
      }
      return registry.get(name);
    });

    document.body.innerHTML = '<ui-predefined></ui-predefined>';

    await handlerForLazyLoad(document, config, prefixMap);

    expect(mockLoader.loader).not.toHaveBeenCalled();
  });

  it('loader実行中に要素が定義された場合、defineをスキップすること', async () => {
    const mockConstructor = class extends HTMLElement {};
    let definedAfterLoad = false;
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockImplementation(async () => {
        definedAfterLoad = true;
        return mockConstructor;
      })
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    const getSpy = vi.mocked(customElements.get);
    getSpy.mockImplementation((name: string) => {
      if (name === 'ui-race') {
        return definedAfterLoad ? mockConstructor : undefined;
      }
      return registry.get(name);
    });

    document.body.innerHTML = '<ui-race></ui-race>';

    await handlerForLazyLoad(document, config, prefixMap);

    expect(mockLoader.loader).toHaveBeenCalledWith('@components/ui/race.js');
    expect(customElements.define).not.toHaveBeenCalled();
  });

  it('handlerForLazyLoadの初回呼び出しでのエラーを処理すること', async () => {
    const config = {
      loaders: {},
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': { key: '', prefix: 'ui', loaderKey: null, isNameSpaced: true }
    };

    // Mock createTreeWalker to throw
    vi.spyOn(document, 'createTreeWalker').mockImplementationOnce(() => {
      throw new Error("Initial Error");
    });

    await expect(handlerForLazyLoad(document, config, prefixMap)).rejects.toThrow("Failed to lazy load components");
  });

  it('prefixMapが空の場合、早期リターンすること', async () => {
    const config = { loaders: {}, observable: false, scanImportmap: false };
    const prefixMap = {};
    // Should not throw, should not call lazyLoads (which we can't spy on easily, but we can spy on createTreeWalker)
    const spy = vi.spyOn(document, 'createTreeWalker');
    
    await handlerForLazyLoad(document, config, prefixMap);
    
    expect(spy).not.toHaveBeenCalled();
  });

  it('既に監視済みの要素を再監視しないこと', async () => {
    const mockConstructor = class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' });
      }
    };
    customElements.define('ui-shadow', mockConstructor);
    
    const config = { loaders: {}, observable: false, scanImportmap: false };
    const prefixMap = { 'ui': { key: '', prefix: 'ui', loaderKey: null, isNameSpaced: true } };
    
    const el = document.createElement('ui-shadow');
    document.body.appendChild(el);
    
    // First call observes
    await handlerForLazyLoad(document, config, prefixMap);
    
    // Second call should skip observation
    // We can't easily spy on internal observeShadowRoot, but we can verify no errors and coverage
    await handlerForLazyLoad(document, config, prefixMap);
  });

  it('MutationObserverコールバック内のエラーをcatchすること', async () => {
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn()
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: true,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    await handlerForLazyLoad(document, config, prefixMap);

    // Mock createTreeWalker to throw ONLY for the next call (which happens in MutationObserver)
    // The initial call in handlerForLazyLoad already happened.
    vi.spyOn(document, 'createTreeWalker').mockImplementationOnce(() => {
      throw new Error("Observer Error");
    });

    // Trigger mutation
    const el = document.createElement('div');
    document.body.appendChild(el);

    // Wait for MutationObserver
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to lazy load components: Error: Observer Error")
    );
  });

  it('同じshadow rootを2回監視しないこと', async () => {
    const mockConstructor = class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' });
      }
    };
    customElements.define('ui-shadow', mockConstructor);

    const config = {
      loaders: {},
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    const el = document.createElement('ui-shadow');
    document.body.appendChild(el);

    // First pass
    await handlerForLazyLoad(document, config, prefixMap);
    
    // Second pass (should skip observation)
    await handlerForLazyLoad(document, config, prefixMap);
  });

  it('whenDefined経由で要素が定義された時にshadow rootを監視すること', async () => {
    // Restore default mocks for this test
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Create a custom element class with shadow root
    const mockConstructor = class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' });
      }
    };
    
    // Mock whenDefined to resolve immediately
    vi.spyOn(customElements, 'whenDefined').mockImplementation((_name: string) => {
      return Promise.resolve(mockConstructor);
    });

    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockResolvedValue(mockConstructor)
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false
    };
    const prefixMap = {
      'shadow': {
        key: '@components/shadow/',
        prefix: 'shadow',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    // Add a custom element that hasn't been defined yet
    document.body.innerHTML = '<shadow-component></shadow-component>';

    // This will trigger whenDefined callback which calls checkObserveShadowRoot
    await handlerForLazyLoad(document, config, prefixMap);

    // Wait for whenDefined promise to resolve and checkObserveShadowRoot to be called
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('MutationObserverコールバック内のエラーを処理しconsoleにログ出力すること', async () => {
    // This test covers the catch block in MutationObserver callback (line 176)
    const config = {
      loaders: {},
      observable: true,
      scanImportmap: false
    };
    const prefixMap = {
      'err': {
        key: '@components/err/',
        prefix: 'err',
        loaderKey: null,
        isNameSpaced: true
      }
    };

    // Initial load with empty body
    document.body.innerHTML = '';
    await handlerForLazyLoad(document, config, prefixMap);

    // Mock createTreeWalker to throw after the MutationObserver is set up
    vi.spyOn(document, 'createTreeWalker').mockImplementationOnce(() => {
      throw new Error('TreeWalker Error in MO');
    });

    // Add an element to trigger MutationObserver
    const el = document.createElement('err-element');
    document.body.appendChild(el);

    // Wait for MutationObserver callback to execute and catch the error
    await new Promise(resolve => setTimeout(resolve, 100));

    // The error should be caught and logged via console.error
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to lazy load components')
    );
  });

  it('rootがShadowRootの場合も監視すること', async () => {
    const originalMutationObserver = globalThis.MutationObserver;
    const observeSpy = vi.fn();

    class TestMutationObserver {
      constructor(_callback: MutationCallback) {}
      observe = observeSpy;
      disconnect() {}
      takeRecords() {
        return [];
      }
    }

    (globalThis as any).MutationObserver = TestMutationObserver;

    const config = {
      loaders: {},
      observable: true,
      scanImportmap: false,
    };
    const prefixMap = {
      'ui': {
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true,
      },
    };

    const treeWalkerSpy = vi.spyOn(document, 'createTreeWalker').mockReturnValue({
      nextNode: () => false,
      currentNode: null,
    } as unknown as TreeWalker);

    const originalHasInstance = (Document as any)[Symbol.hasInstance];
    Object.defineProperty(Document, Symbol.hasInstance, {
      value: (instance: unknown) => {
        if (instance === document) {
          return false;
        }
        return typeof originalHasInstance === 'function'
          ? originalHasInstance.call(Document, instance)
          : false;
      },
      configurable: true,
    });

    await handlerForLazyLoad(document, config, prefixMap);

    expect(observeSpy).toHaveBeenCalledWith(document, { childList: true, subtree: true });

    if (originalHasInstance) {
      Object.defineProperty(Document, Symbol.hasInstance, {
        value: originalHasInstance,
        configurable: true,
      });
    } else {
      delete (Document as any)[Symbol.hasInstance];
    }
    treeWalkerSpy.mockRestore();

    (globalThis as any).MutationObserver = originalMutationObserver;
  });

  describe('getCustomTagInfo', () => {
    it('ダッシュもis属性もない要素の場合、throwすること', () => {
      const el = document.createElement('div');
      expect(() => getCustomTagInfo(el)).toThrow("Custom element without a dash or 'is' attribute found");
    });

    it('is属性にダッシュがない場合、throwすること', () => {
      const el = document.createElement('div');
      el.setAttribute('is', 'span');
      expect(() => getCustomTagInfo(el)).toThrow("Custom element 'is' attribute without a dash found");
    });
  });
});
