import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerComponents, registerComponentDefiner } from '../src/registerComponents';
import { bootstrapState } from '../src/bootstrapState';
import { installSsr } from '../src/ssr/install';
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

  it('registryを渡すとglobalではなくそちらへdefineされること', () => {
    // scoped registry は global の定義を継承しないので、そのツリーで使うには
    // そのレジストリ自身への define が要る。
    // `<wcs-ssr>` は SSR 機能のタグなので、機能の install がレジストリへ届ける（設計案 H8）。
    // full / auto では bootstrapState() が呼ぶ
    installSsr();
    const defineSpy = vi.spyOn(customElements, 'define');
    const scoped = {
      get: vi.fn(() => undefined),
      define: vi.fn(),
    } as unknown as CustomElementRegistry;

    registerComponents(scoped);

    expect(scoped.define).toHaveBeenCalledWith(config.tagNames.state, expect.any(Function));
    expect(scoped.define).toHaveBeenCalledWith(config.tagNames.ssr, expect.any(Function));
    expect(defineSpy).not.toHaveBeenCalled();

    defineSpy.mockRestore();
  });

  it('定義済みのレジストリには機能のタグも state も define しないこと', () => {
    installSsr();
    const defined = {
      get: vi.fn(() => class extends HTMLElement {}),
      define: vi.fn(),
    } as unknown as CustomElementRegistry;

    registerComponents(defined);

    expect(defined.define).not.toHaveBeenCalled();
  });

  it('同じ definer の再登録は 1 回として扱うこと（機能の install は冪等）', () => {
    const definer = vi.fn();
    registerComponentDefiner(definer);
    registerComponentDefiner(definer);
    const scoped = {
      get: vi.fn(() => undefined),
      define: vi.fn(),
    } as unknown as CustomElementRegistry;

    registerComponents(scoped);

    expect(definer).toHaveBeenCalledTimes(1);
  });

  it('bootstrapStateがregistryを素通しすること', () => {
    const defineSpy = vi.spyOn(customElements, 'define');
    const scoped = {
      get: vi.fn(() => undefined),
      define: vi.fn(),
    } as unknown as CustomElementRegistry;

    bootstrapState(undefined, scoped);

    expect(scoped.define).toHaveBeenCalledWith(config.tagNames.state, expect.any(Function));
    expect(defineSpy).not.toHaveBeenCalled();

    defineSpy.mockRestore();
  });

  afterEach(() => {
    config.tagNames.state = ORIGINAL_TAG;
  });
});
