/**
 * A lazy load that fails never defines its tag. Anything that waits on
 * `whenDefined()` for such a tag therefore waits forever, so these tests pin
 * the two places that used to do exactly that.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handlerForLazyLoad } from '../src/lazyLoad.js';
import { resetState } from '../src/tags.js';
import { DEFAULT_KEY } from '../src/config.js';
import { ILoader } from '../src/types.js';

// A registry whose whenDefined() behaves like the real one: it stays pending
// until define() is called. The global mock used elsewhere resolves eagerly,
// which hides precisely the defect under test.
function createFakeRegistry() {
  const defined = new Map<string, CustomElementConstructor>();
  const waiters = new Map<string, ((ctor: CustomElementConstructor) => void)[]>();
  return {
    get: vi.fn((name: string) => defined.get(name)),
    whenDefined: vi.fn((name: string) => {
      const ctor = defined.get(name);
      if (ctor !== undefined) return Promise.resolve(ctor);
      return new Promise<CustomElementConstructor>((resolve) => {
        const list = waiters.get(name) ?? [];
        list.push(resolve);
        waiters.set(name, list);
      });
    }),
    define: vi.fn((name: string, ctor: CustomElementConstructor) => {
      defined.set(name, ctor);
      for (const resolve of waiters.get(name) ?? []) resolve(ctor);
      waiters.delete(name);
    }),
  };
}

function mountScopedRoot(html: string, registry: object): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = html;
  Object.defineProperty(root, 'customElementRegistry', { value: registry });
  return root;
}

const PREFIX_MAP = {
  ui: { key: '@components/ui/', prefix: 'ui', loaderKey: null, isNameSpaced: true },
};

/** Resolves to 'hung' if `work` has not settled within `ms`. */
function raceAgainstHang<T>(work: Promise<T>, ms: number): Promise<T | 'hung'> {
  return Promise.race([
    work,
    new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), ms)),
  ]);
}

describe('lazyLoad: 失敗したロードの後始末', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetState();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('先行ロードが失敗しても、同じタグを待つ側がハングしないこと', async () => {
    // 待機側が whenDefined を待つと、失敗したロードは define しないので
    // 永久 pending になり、その上の handlerForLazyLoad ごと詰まる
    // = MutationObserver が設置されず、以後そのページの遅延ロードが全停止する。
    let rejectLoad: (e: Error) => void = () => undefined;
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn(() => new Promise<never>((_r, reject) => { rejectLoad = reject; })),
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false,
    };
    const registry = createFakeRegistry();
    const root = mountScopedRoot('<ui-button></ui-button>', registry);

    // 1 本目がロード中に入ったところへ 2 本目を重ねる。
    const first = handlerForLazyLoad(root, config, PREFIX_MAP);
    const second = handlerForLazyLoad(root, config, PREFIX_MAP);
    expect(mockLoader.loader).toHaveBeenCalledTimes(1);

    rejectLoad(new Error('boom'));

    const outcome = await raceAgainstHang(
      Promise.all([first, second]).then(() => 'settled' as const),
      300,
    );
    expect(outcome).toBe('settled');
    expect(registry.define).not.toHaveBeenCalled();
  });

  it('未定義要素のupgrade追跡が走査のたびに増えないこと', async () => {
    // lazyLoads は tagCount が 0 になるまで走査を繰り返し、MutationObserver は
    // DOM 変更のたびにそれを再実行する。走査ごとに whenDefined を張り直すと、
    // 永久に定義されないタグのクロージャが青天井に積み上がる。
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false,
    };
    const registry = createFakeRegistry();
    const root = mountScopedRoot('<ui-button></ui-button>', registry);

    await handlerForLazyLoad(root, config, PREFIX_MAP);

    const hooks = registry.whenDefined.mock.calls.filter((c) => c[0] === 'ui-button');
    expect(hooks).toHaveLength(1);
  });

  it('失敗後に再度走査してもロードを繰り返さないこと', async () => {
    const mockLoader: ILoader = {
      postfix: '.js',
      loader: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const config = {
      loaders: { [DEFAULT_KEY]: mockLoader },
      observable: false,
      scanImportmap: false,
    };
    const registry = createFakeRegistry();
    const root = mountScopedRoot('<ui-button></ui-button>', registry);

    await handlerForLazyLoad(root, config, PREFIX_MAP);
    await handlerForLazyLoad(root, config, PREFIX_MAP);

    expect(mockLoader.loader).toHaveBeenCalledTimes(1);
  });
});
