import { afterEach, describe, expect, it, vi } from 'vitest';

describe('HTMLElementBase platform guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('browser環境ではnative HTMLElementを使う', async () => {
    const { HTMLElementBase } = await import('../src/platform/HTMLElementBase');
    expect(HTMLElementBase).toBe(HTMLElement);
  });

  it('headless環境ではmodule import可能なinert baseへfallbackする', async () => {
    vi.stubGlobal('HTMLElement', undefined);
    vi.resetModules();
    const { HTMLElementBase } = await import('../src/platform/HTMLElementBase');
    expect(() => new HTMLElementBase()).not.toThrow();
  });
});
