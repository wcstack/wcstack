import { describe, it, expect, vi } from 'vitest';
import { registerComponents } from '../src/registerComponents';
import { config } from '../src/config';

const ORIGINAL_TAG = config.tagNames.state;

function ensureTag(tag: string) {
  if (!customElements.get(tag)) {
    // no-op constructor
    customElements.define(tag, class extends HTMLElement {});
  }
}

describe('registerComponents', () => {
  it('未登録ならdefineされること', () => {
    const tag = 'wcs-state-test-register';
    config.tagNames.state = tag;

    const defineSpy = vi.spyOn(customElements, 'define');
    registerComponents();

    expect(defineSpy).toHaveBeenCalled();
    expect(customElements.get(tag)).toBeDefined();

    defineSpy.mockRestore();
  });

  it('既に登録済みならdefineされないこと', () => {
    const tag = 'wcs-state-test-register-2';
    config.tagNames.state = tag;
    ensureTag(tag);

    const defineSpy = vi.spyOn(customElements, 'define');
    registerComponents();

    expect(defineSpy).not.toHaveBeenCalled();
    defineSpy.mockRestore();
  });

  afterEach(() => {
    config.tagNames.state = ORIGINAL_TAG;
  });
});
