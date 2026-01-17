import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eagerLoad } from '../src/eagerload.js';
import { resetState } from '../src/tags.js';
import { DEFAULT_KEY } from '../src/config.js';
import { ILoader } from '../src/types.js';

describe('eagerLoad', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    vi.spyOn(customElements, 'define');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should define custom elements', async () => {
    const mockConstructor = class extends HTMLElement {};
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockResolvedValue(mockConstructor)
    };
    const loaders = { [DEFAULT_KEY]: mockLoader };
    const loadMap = {
      'my-element': {
        key: '@components/my-element',
        tagName: 'my-element',
        loaderKey: null,
        extends: null,
        isNameSpaced: false
      }
    };

    await eagerLoad(loadMap, loaders);

    expect(mockLoader.loader).toHaveBeenCalledWith('@components/my-element');
    expect(customElements.define).toHaveBeenCalledWith('my-element', mockConstructor);
  });

  it('should handle extends option', async () => {
    const mockConstructor = class extends HTMLButtonElement {};
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockResolvedValue(mockConstructor)
    };
    const loaders = { [DEFAULT_KEY]: mockLoader };
    const loadMap = {
      'my-button': {
        key: '@components/my-button',
        tagName: 'my-button',
        loaderKey: null,
        extends: 'button',
        isNameSpaced: false
      }
    };

    await eagerLoad(loadMap, loaders);

    expect(customElements.define).toHaveBeenCalledWith('my-button', mockConstructor, { extends: 'button' });
  });

  it('should auto-detect extends from prototype', async () => {
    const mockConstructor = class extends HTMLInputElement {};
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockResolvedValue(mockConstructor)
    };
    const loaders = { [DEFAULT_KEY]: mockLoader };
    const loadMap = {
      'my-input': {
        key: '@components/my-input',
        tagName: 'my-input',
        loaderKey: null,
        extends: null,
        isNameSpaced: false
      }
    };

    await eagerLoad(loadMap, loaders);

    expect(customElements.define).toHaveBeenCalledWith('my-input', mockConstructor, { extends: 'input' });
  });

  it('should handle loader failure', async () => {
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockRejectedValue(new Error('Load failed'))
    };
    const loaders = { [DEFAULT_KEY]: mockLoader };
    const loadMap = {
      'my-element': {
        key: '@components/my-element',
        tagName: 'my-element',
        loaderKey: null,
        extends: null,
        isNameSpaced: false
      }
    };

    await eagerLoad(loadMap, loaders);

    expect(console.error).toHaveBeenCalled();
    expect(customElements.define).not.toHaveBeenCalled();
  });

  it('should load multiple components in parallel', async () => {
    const mockConstructor1 = class extends HTMLElement {};
    const mockConstructor2 = class extends HTMLElement {};
    
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockImplementation(async (path) => {
        if (path === '@components/comp1') return mockConstructor1;
        if (path === '@components/comp2') return mockConstructor2;
        return null;
      })
    };
    const loaders = { [DEFAULT_KEY]: mockLoader };
    const loadMap = {
      'comp-1': {
        key: '@components/comp1',
        tagName: 'comp-1',
        loaderKey: null,
        extends: null,
        isNameSpaced: false
      },
      'comp-2': {
        key: '@components/comp2',
        tagName: 'comp-2',
        loaderKey: null,
        extends: null,
        isNameSpaced: false
      }
    };

    await eagerLoad(loadMap, loaders);

    expect(customElements.define).toHaveBeenCalledWith('comp-1', mockConstructor1);
    expect(customElements.define).toHaveBeenCalledWith('comp-2', mockConstructor2);
  });

  it('should continue loading other components if one fails', async () => {
    const mockConstructor = class extends HTMLElement {};
    
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockImplementation(async (path) => {
        if (path === '@components/success') return mockConstructor;
        if (path === '@components/fail') throw new Error('Failed');
        return null;
      })
    };
    const loaders = { [DEFAULT_KEY]: mockLoader };
    const loadMap = {
      'comp-success': {
        key: '@components/success',
        tagName: 'comp-success',
        loaderKey: null,
        extends: null,
        isNameSpaced: false
      },
      'comp-fail': {
        key: '@components/fail',
        tagName: 'comp-fail',
        loaderKey: null,
        extends: null,
        isNameSpaced: false
      }
    };

    await eagerLoad(loadMap, loaders);

    expect(customElements.define).toHaveBeenCalledWith('comp-success', mockConstructor);
    expect(console.error).toHaveBeenCalled();
  });

  it('should not retry failed tags', async () => {
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockRejectedValue(new Error('Load failed'))
    };
    const loaders = { [DEFAULT_KEY]: mockLoader };
    const loadMap = {
      'my-element': {
        key: '@components/my-element',
        tagName: 'my-element',
        loaderKey: null,
        extends: null,
        isNameSpaced: false
      }
    };

    await eagerLoad(loadMap, loaders);
    await eagerLoad(loadMap, loaders);

    expect(console.error).toHaveBeenCalledTimes(1); // Only logs once
  });

  it('should throw error if loader redirection is attempted', async () => {
    const loaders = { 
        [DEFAULT_KEY]: { postfix: '.js', loader: async () => null },
        'alias': 'other' 
    };
    const loadMap = {
      'my-element': {
        key: '@components/my-element',
        tagName: 'my-element',
        loaderKey: 'alias',
        extends: null,
        isNameSpaced: false
      }
    };

    await expect(eagerLoad(loadMap, loaders)).rejects.toThrow(/Loader redirection is not supported/);
  });

  it('should execute top-level window check', async () => {
    vi.resetModules();
    await import('../src/eagerload.js');
  });

  it('should handle window undefined', async () => {
    vi.resetModules();
    const originalWindow = global.window;
    vi.stubGlobal('window', undefined);
    
    try {
      await import('../src/eagerload.js');
    } finally {
      vi.stubGlobal('window', originalWindow);
    }
  });

  it('should handle undefined HTML classes', async () => {
    vi.resetModules();
    const originalButton = global.HTMLButtonElement;
    vi.stubGlobal('HTMLButtonElement', undefined);
    
    try {
      await import('../src/eagerload.js');
    } finally {
      vi.stubGlobal('HTMLButtonElement', originalButton);
    }
  });

  it('should handle loader returning null', async () => {
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockResolvedValue(null)
    };
    const loaders = { [DEFAULT_KEY]: mockLoader };
    const loadMap = {
      'my-element': {
        key: '@components/my-element',
        tagName: 'my-element',
        loaderKey: null,
        extends: null,
        isNameSpaced: false
      }
    };

    await eagerLoad(loadMap, loaders);

    expect(mockLoader.loader).toHaveBeenCalledWith('@components/my-element');
    expect(customElements.define).not.toHaveBeenCalled();
  });
});
