import { describe, it, expect } from 'vitest';
import { load } from '../src/vanilla.js';
import { resolve } from 'path';

describe('vanilla loader', () => {
  it('should import module and return default export', async () => {
    // Use a real file relative to this test file
    // But load() takes a path. If it's used in browser, it's URL.
    // In Node/Vitest, import() works with file paths.
    
    // We need absolute path or relative to CWD?
    // import() in Node resolves relative to current file if using relative path?
    // But load() is in src/vanilla.ts.
    // So relative path passed to load() will be resolved relative to src/vanilla.ts?
    // No, import(path) resolves relative to the file containing the import statement.
    // So src/vanilla.ts.
    
    // So we need path relative to src/vanilla.ts.
    // src/vanilla.ts is in packages/core/src.
    // fixture is in packages/core/__tests__/fixtures/dummy.js.
    // Relative path: ../__tests__/fixtures/dummy.js.
    
    const path = '../__tests__/fixtures/dummy.js';
    const Constructor = await load(path);
    
    expect(Constructor).toBeDefined();
    
    // To instantiate, we must define it
    customElements.define('dummy-element', Constructor);
    const el = new Constructor();
    expect(el).toBeInstanceOf(HTMLElement);
  });
});
