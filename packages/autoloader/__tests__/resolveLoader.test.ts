import { describe, it, expect } from 'vitest';
import { resolveLoader } from '../src/resolveLoader.js'; // Note: filename typo in source
import { DEFAULT_KEY } from '../src/config.js';
import { ILoader } from '../src/types.js';

describe('resolveLoader', () => {
  const mockLoader: ILoader = {
    postfix: '.js',
    loader: async () => null
  };
  
  const tsLoader: ILoader = {
    postfix: '.ts',
    loader: async () => null
  };

  const loaders = {
    [DEFAULT_KEY]: mockLoader,
    'ts': tsLoader,
    'alias': 'ts'
  };

  it('loaderKeyがnullの場合、デフォルトloaderを解決すること', () => {
    const result = resolveLoader('test.js', null, loaders);
    expect(result).toBe(mockLoader);
  });

  it('loaderKeyが空文字の場合、デフォルトloaderを解決すること', () => {
    const result = resolveLoader('test.js', '', loaders);
    expect(result).toBe(mockLoader);
  });

  it('loaderKeyがDEFAULT_KEYの場合、デフォルトloaderを解決すること', () => {
    const result = resolveLoader('test.js', DEFAULT_KEY, loaders);
    expect(result).toBe(mockLoader);
  });

  it('キー指定で特定のloaderを解決すること', () => {
    const result = resolveLoader('test.ts', 'ts', loaders);
    expect(result).toBe(tsLoader);
  });

  it('loaderKey未指定の場合、postfixからloaderを解決すること', () => {
    const result = resolveLoader('test.ts', null, loaders);
    expect(result).toBe(tsLoader);
  });

  it('より長いpostfixのマッチを優先すること', () => {
    const jsxLoader: ILoader = { postfix: '.jsx', loader: async () => null };
    const xLoader: ILoader = { postfix: '.x', loader: async () => null };
    
    const customLoaders = {
      [DEFAULT_KEY]: mockLoader,
      'jsx': jsxLoader,
      'x': xLoader
    };

    const result = resolveLoader('test.jsx', null, customLoaders);
    expect(result).toBe(jsxLoader);
  });

  it('postfixがマッチしない場合、デフォルトloaderにフォールバックすること', () => {
    const result = resolveLoader('test.unknown', null, loaders);
    expect(result).toBe(mockLoader);
  });

  it('エイリアスされたloader（loaders内の文字列値）を明示指定した場合、エラーをthrowすること', () => {
    // Note: The implementation handles string values in DEFAULT_KEY fallback, 
    // but throws "Loader redirection is not supported here" if explicitly requested?
    // Let's check the code:
    // if (typeof loader === "string") { throw ... }
    // So explicit alias usage like resolveLoader(..., 'alias', ...) might throw if 'alias' points to a string.
    
    // Wait, let's check the source code again.
    /*
    } else {
      loader = loaders[loaderKey];
    }

    if (typeof loader === "string") {
      throw new Error("Loader redirection is not supported here");
    }
    */
    // Yes, it throws.
    
    expect(() => resolveLoader('test.ts', 'alias', loaders)).toThrow("Loader redirection is not supported here");
  });

  it('デフォルトloaderがエイリアスの場合も解決できること', () => {
    const aliasLoaders = {
      [DEFAULT_KEY]: 'real',
      'real': mockLoader
    };
    
    // Use a file extension that doesn't match any loader's postfix to force fallback to DEFAULT_KEY
    const result = resolveLoader('test.txt', null, aliasLoaders);
    expect(result).toBe(mockLoader);
  });

  it('デフォルトloaderがエイリアスの場合も解決できること（38行目のカバレッジ用）', () => {
    // This is effectively the same as above, but ensuring we hit the line
    const aliasLoaders = {
      [DEFAULT_KEY]: 'real',
      'real': mockLoader
    };
    const result = resolveLoader('test.js', '', aliasLoaders);
    expect(result).toBe(mockLoader);
  });

  it('postfix解決では再帰的なエイリアスを無視すること', () => {
    const loadersWithRecursiveAlias = {
      [DEFAULT_KEY]: mockLoader,
      'alias': 'recursive',
      'recursive': 'alias', // Cycle
      'valid': tsLoader
    };
    // Should ignore the cycle and find valid loader if it matches, or default
    // Here 'test.ts' matches 'valid' (tsLoader)
    const result = resolveLoader('test.ts', null, loadersWithRecursiveAlias);
    expect(result).toBe(tsLoader);
  });
});
