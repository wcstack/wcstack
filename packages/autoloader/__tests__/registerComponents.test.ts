import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerComponents } from '../src/registerComponents';
import { config } from '../src/config';

describe('registerComponents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wcs-autoloaderが未定義の場合、customElements.defineが呼ばれること', () => {
    const getSpy = vi.spyOn(customElements, 'get').mockReturnValue(undefined);
    const defineSpy = vi.spyOn(customElements, 'define').mockImplementation(() => {});

    registerComponents();

    expect(getSpy).toHaveBeenCalledWith(config.tagNames.autoloader);
    expect(defineSpy).toHaveBeenCalledWith(config.tagNames.autoloader, expect.any(Function));
  });

  it('wcs-autoloaderが定義済みの場合、customElements.defineが呼ばれないこと', () => {
    const getSpy = vi.spyOn(customElements, 'get').mockReturnValue(class extends HTMLElement {});
    const defineSpy = vi.spyOn(customElements, 'define').mockImplementation(() => {});

    registerComponents();

    expect(getSpy).toHaveBeenCalledWith(config.tagNames.autoloader);
    expect(defineSpy).not.toHaveBeenCalled();
  });
});
