import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCustomElementRegistry,
  upgradeCustomElement,
} from '../src/platform/customElementRegistry';

describe('customElementRegistry platform adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('既定ではglobal registryをoperation時に解決する', () => {
    expect(getCustomElementRegistry()?.get).toBeTypeOf('function');
    expect(getCustomElementRegistry()?.whenDefined).toBeTypeOf('function');
  });

  it('owner固有registryをglobalより優先する', () => {
    const registry = {
      get: vi.fn(),
      whenDefined: vi.fn(),
      upgrade: vi.fn(),
    };

    expect(getCustomElementRegistry({ customElements: registry })).toBe(registry);
  });

  it('browser globalが無い環境ではnullを返しmodule importを妨げない', () => {
    vi.stubGlobal('customElements', undefined);
    expect(getCustomElementRegistry()).toBeNull();
  });

  it('必要なregistry surfaceが欠けるownerを拒否する', () => {
    expect(getCustomElementRegistry({ customElements: {} })).toBeNull();
    expect(getCustomElementRegistry({ customElements: { get() {} } })).toBeNull();
  });

  it('利用可能なupgradeだけを呼ぶ', () => {
    const root = document.createElement('div');
    const upgrade = vi.fn();
    upgradeCustomElement({ get: vi.fn(), whenDefined: vi.fn(), upgrade }, root);
    upgradeCustomElement({ get: vi.fn(), whenDefined: vi.fn() }, root);
    expect(upgrade).toHaveBeenCalledWith(root);
  });
});
