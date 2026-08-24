import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showRouteContent } from '../src/showRouteContent';
import { Router } from '../src/components/Router';
import { TRANSITION_RUNNER_KEY } from '../src/protocol/transitionRunner';
import type { IRoute, IRouteMatchResult } from '../src/components/types';
import './setup';

// transition-runner protocol の最小実装。@wcstack/view-transition には依存しない
// （パッケージ間依存ゼロ。ルータはグローバル symbol 越しにしか arbiter を知らない）。
function installRunner(options: { accepts?: (source: string) => boolean } = {}) {
  const deferred: Array<() => void> = [];
  const sources: string[] = [];
  const runner = {
    protocol: "wcs-transition-runner",
    version: 1,
    naming: "manual",
    namingLimit: 200,
    accepts: options.accepts ?? (() => true),
    run(mutate: () => void, runOptions?: { source?: string }) {
      sources.push(runOptions?.source ?? "");
      return new Promise<void>((resolve, reject) => {
        deferred.push(() => {
          try {
            mutate();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    },
  };
  (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY] = runner;
  return { deferred, sources };
}

function createMockRoute(overrides: Partial<IRoute> = {}): IRoute {
  const placeholder = document.createComment('@@route:mock');
  const params: Record<string, string> = {};
  const typedParams: Record<string, any> = {};
  return {
    clearParams: vi.fn(),
    setParams: vi.fn(),
    childNodeArray: [],
    paramNames: [],
    params,
    typedParams,
    placeHolder: placeholder,
    guardCheck: vi.fn().mockResolvedValue(undefined),
    shouldChange: vi.fn().mockReturnValue(true),
    ...overrides,
  } as any;
}

const createMatchResult = (routes: IRoute[]): IRouteMatchResult => ({
  routes,
  params: {},
  typedParams: {},
  path: '/',
  lastPath: '',
});

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('showRouteContent — transition-runner 連携', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY];
    document.body.innerHTML = '';
  });

  it('arbiter が居ると hide/show は 1 つの変更として遅延され、完了まで解決しない', async () => {
    const runner = installRunner();
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const container = document.createElement('div');
    const placeholder = document.createComment('@@route:next');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    const previous = createMockRoute();
    const next = createMockRoute({ placeHolder: placeholder });

    let settled = false;
    const promise = showRouteContent(router, createMatchResult([next]), [previous]).then((result) => {
      settled = true;
      return result;
    });

    await settle();
    // ガードは済んでいるが DOM 変更はまだ arbiter の手の中
    expect(next.guardCheck).toHaveBeenCalled();
    expect(previous.clearParams).not.toHaveBeenCalled();
    expect(next.setParams).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    expect(runner.deferred).toHaveLength(1);
    expect(runner.sources).toEqual(['router']);

    runner.deferred[0]();
    await expect(promise).resolves.toBe(true);
    expect(previous.clearParams).toHaveBeenCalled();
    expect(next.setParams).toHaveBeenCalled();
  });

  it('ガードが拒否したときは DOM 変更を arbiter へ渡さない（旧ルートも消えない）', async () => {
    const runner = installRunner();
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    router.navigate = vi.fn().mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });

    const previous = createMockRoute();
    const next = createMockRoute({
      guardCheck: vi.fn().mockRejectedValue(
        new (await import('../src/GuardCancel')).GuardCancel('nope', '/fallback'),
      ),
    });

    const result = await showRouteContent(router, createMatchResult([next]), [previous]);
    expect(result).toBe(false);
    expect(runner.deferred).toHaveLength(0);
    expect(previous.clearParams).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('router を受け付けない arbiter では従来どおり同期適用する', async () => {
    const runner = installRunner({ accepts: (source) => source !== 'router' });
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const container = document.createElement('div');
    const placeholder = document.createComment('@@route:next');
    container.appendChild(placeholder);
    document.body.appendChild(container);

    const next = createMockRoute({ placeHolder: placeholder });
    await showRouteContent(router, createMatchResult([next]), []);

    expect(runner.deferred).toHaveLength(0);
    expect(next.setParams).toHaveBeenCalled();
  });
});
