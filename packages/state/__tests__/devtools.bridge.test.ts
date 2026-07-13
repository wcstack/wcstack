import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getOrCreateHookRegistry,
  registerDevtoolsSource,
  __resetDevtoolsBridgeForTest,
  __getRegisteredSourceForTest,
} from '../src/devtools/bridge';
import { DEVTOOLS_HOOK_GLOBAL, DEVTOOLS_PROTOCOL_VERSION, IDevtoolsListener } from '../src/devtools/types';
import { devtoolsSink } from '../src/devtools/sink';
import { setStateElementByName } from '../src/stateElementByName';
import { getUpdater } from '../src/updater/updater';
import { CommandToken } from '../src/command/CommandToken';

function cleanupGlobal(): void {
  delete (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_GLOBAL];
}

function createMockStateElement(name: string, overrides?: Partial<any>): any {
  return {
    name,
    rootNode: document.createElement('div'),
    listPaths: new Set<string>(),
    elementPaths: new Set<string>(),
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    commandTokenNames: new Set<string>(),
    eventTokenNames: new Set<string>(),
    staticDependency: new Map<string, string[]>(),
    dynamicDependency: new Map<string, string[]>(),
    createState: vi.fn(),
    ...overrides,
  };
}

describe('devtools/bridge', () => {
  beforeEach(() => {
    cleanupGlobal();
    __resetDevtoolsBridgeForTest();
    document.documentElement.removeAttribute('data-wcs-server');
  });

  afterEach(() => {
    cleanupGlobal();
    __resetDevtoolsBridgeForTest();
    document.documentElement.removeAttribute('data-wcs-server');
  });

  describe('getOrCreateHookRegistry', () => {
    it('グローバルにregistryを生成し、2回目は同一インスタンスを返すこと', () => {
      const registry = getOrCreateHookRegistry();
      expect(registry.version).toBe(DEVTOOLS_PROTOCOL_VERSION);
      expect((globalThis as any)[DEVTOOLS_HOOK_GLOBAL]).toBe(registry);
      expect(getOrCreateHookRegistry()).toBe(registry);
    });

    it('版不一致の既存registryは警告の上で先勝ちすること', () => {
      const foreign = { version: 999, sources: new Map(), register: vi.fn(), unregister: vi.fn(), addListener: vi.fn() };
      (globalThis as any)[DEVTOOLS_HOOK_GLOBAL] = foreign;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(getOrCreateHookRegistry()).toBe(foreign);
        expect(warnSpy).toHaveBeenCalledOnce();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('registerDevtoolsSource', () => {
    it('sourceをregistryに登録すること（冪等）', () => {
      registerDevtoolsSource();
      const registry = getOrCreateHookRegistry();
      expect(registry.sources.size).toBe(1);
      const source = __getRegisteredSourceForTest()!;
      expect(source.kind).toBe('state');
      expect(source.id.startsWith('state:')).toBe(true);
      expect(typeof source.packageVersion).toBe('string');
      // 冪等
      registerDevtoolsSource();
      expect(registry.sources.size).toBe(1);
    });

    it('SSR環境では登録しないこと', () => {
      document.documentElement.setAttribute('data-wcs-server', '');
      registerDevtoolsSource();
      expect(__getRegisteredSourceForTest()).toBeNull();
      expect((globalThis as any)[DEVTOOLS_HOOK_GLOBAL]).toBeUndefined();
    });
  });

  describe('listener と sink の配線', () => {
    it('listener追加でsinkが接続され、既登録sourceがリプレイされること', () => {
      registerDevtoolsSource();
      const registry = getOrCreateHookRegistry();
      const onSourceRegistered = vi.fn();
      const onEvent = vi.fn();
      const removeListener = registry.addListener({ onSourceRegistered, onEvent });

      expect(onSourceRegistered).toHaveBeenCalledWith(__getRegisteredSourceForTest());
      expect(devtoolsSink).not.toBeNull();

      // 計装点（token emit）からのイベントが sourceId 付きで届くこと
      const token = new CommandToken('go', 'main');
      token.emit(1, 2);
      expect(onEvent).toHaveBeenCalledWith(
        __getRegisteredSourceForTest()!.id,
        expect.objectContaining({ type: 'state:token-emit', kind: 'command', tokenName: 'go', stateName: 'main' })
      );

      removeListener();
      expect(devtoolsSink).toBeNull();
    });

    it('sourceより先にlistenerが居ても、register時に通知とsink接続が行われること', () => {
      const registry = getOrCreateHookRegistry();
      const onSourceRegistered = vi.fn();
      registry.addListener({ onSourceRegistered });
      registerDevtoolsSource();
      expect(onSourceRegistered).toHaveBeenCalledOnce();
      expect(devtoolsSink).not.toBeNull();
    });

    it('sink接続中はdrainバッチがstate:update-batchとして転送されること', () => {
      registerDevtoolsSource();
      const registry = getOrCreateHookRegistry();
      const onEvent = vi.fn();
      const removeListener = registry.addListener({ onEvent });

      getUpdater().testApplyChange([]);
      expect(onEvent).toHaveBeenCalledWith(
        __getRegisteredSourceForTest()!.id,
        expect.objectContaining({ type: 'state:update-batch' })
      );

      // detach 後は updater リスナーも解除されること（残留ゼロ、protocol §7-2）
      removeListener();
      onEvent.mockClear();
      getUpdater().testApplyChange([]);
      expect(onEvent).not.toHaveBeenCalled();
    });

    it('listener解除関数は二重呼び出しに安全なこと', () => {
      registerDevtoolsSource();
      const registry = getOrCreateHookRegistry();
      const removeListener = registry.addListener({});
      removeListener();
      expect(() => removeListener()).not.toThrow();
      expect(devtoolsSink).toBeNull();
    });
  });

  describe('registry の register/unregister', () => {
    it('同一idの二重registerは無視されること', () => {
      const registry = getOrCreateHookRegistry();
      const source: any = { id: 'state:dup', kind: 'state', packageVersion: '0', getStateElements: vi.fn(), read: vi.fn(), write: vi.fn(), _setSink: vi.fn() };
      registry.register(source);
      registry.register(source);
      expect(registry.sources.size).toBe(1);
    });

    it('unregisterでsinkが切断されonSourceUnregisteredが呼ばれること', () => {
      const registry = getOrCreateHookRegistry();
      const setSinkSpy = vi.fn();
      const source: any = { id: 'state:x', kind: 'state', packageVersion: '0', getStateElements: vi.fn(), read: vi.fn(), write: vi.fn(), _setSink: setSinkSpy };
      const onSourceUnregistered = vi.fn();
      registry.addListener({ onSourceUnregistered });
      registry.register(source);
      registry.unregister('state:x');
      expect(setSinkSpy).toHaveBeenLastCalledWith(null);
      expect(onSourceUnregistered).toHaveBeenCalledWith('state:x');
      expect(registry.sources.size).toBe(0);
      // 未知idは no-op
      expect(() => registry.unregister('state:unknown')).not.toThrow();
    });
  });

  describe('source の pull API', () => {
    it('getStateElementsが登録中の要素のsummaryを返すこと', () => {
      registerDevtoolsSource();
      const source = __getRegisteredSourceForTest()!;
      const element = createMockStateElement('summary-test', {
        listPaths: new Set(['items']),
        getterPaths: new Set(['total']),
        commandTokenNames: new Set(['go']),
      });
      const rootNode = element.rootNode;
      setStateElementByName(rootNode, 'summary-test', element);
      try {
        const summaries = source.getStateElements();
        const summary = summaries.find((s) => s.name === 'summary-test')!;
        expect(summary).toBeDefined();
        expect(summary.element).toBe(element);
        expect(summary.rootNode).toBe(rootNode);
        expect(summary.paths.list.has('items')).toBe(true);
        expect(summary.paths.getter.has('total')).toBe(true);
        expect(summary.commandTokenNames.has('go')).toBe(true);
      } finally {
        setStateElementByName(rootNode, 'summary-test', null);
      }
    });

    it('readがreadonly createState経由で$resolveを呼ぶこと', () => {
      registerDevtoolsSource();
      const source = __getRegisteredSourceForTest()!;
      const resolveMock = vi.fn().mockReturnValue(42);
      const element = createMockStateElement('read-test', {
        createState: vi.fn((mutability: string, cb: (s: any) => void) => {
          expect(mutability).toBe('readonly');
          cb({ $resolve: resolveMock });
        }),
      });
      setStateElementByName(element.rootNode, 'read-test', element);
      try {
        const result = source.read('read-test', element.rootNode, 'items.*.name', [2]);
        expect(result).toBe(42);
        expect(resolveMock).toHaveBeenCalledWith('items.*.name', [2]);
        // indexes 省略時は [] で呼ぶこと
        source.read('read-test', element.rootNode, 'count');
        expect(resolveMock).toHaveBeenLastCalledWith('count', []);
      } finally {
        setStateElementByName(element.rootNode, 'read-test', null);
      }
    });

    it('writeはindexes有無で$resolveと直接代入を使い分けること', () => {
      registerDevtoolsSource();
      const source = __getRegisteredSourceForTest()!;
      const resolveMock = vi.fn();
      const plainState: Record<string, unknown> = { $resolve: resolveMock };
      const element = createMockStateElement('write-test', {
        createState: vi.fn((mutability: string, cb: (s: any) => void) => {
          expect(mutability).toBe('writable');
          cb(plainState);
        }),
      });
      setStateElementByName(element.rootNode, 'write-test', element);
      try {
        source.write('write-test', element.rootNode, 'items.*.name', 'x', [1]);
        expect(resolveMock).toHaveBeenCalledWith('items.*.name', [1], 'x');
        source.write('write-test', element.rootNode, 'count', 9);
        expect(plainState['count']).toBe(9);
        // indexes が空配列なら直接代入side
        source.write('write-test', element.rootNode, 'count', 10, []);
        expect(plainState['count']).toBe(10);
      } finally {
        setStateElementByName(element.rootNode, 'write-test', null);
      }
    });

    it('read/writeは未登録のstate要素でthrowすること', () => {
      registerDevtoolsSource();
      const source = __getRegisteredSourceForTest()!;
      const rootNode = document.createElement('div');
      expect(() => source.read('missing', rootNode, 'a')).toThrow(/state element not found/);
      expect(() => source.write('missing', rootNode, 'a', 1)).toThrow(/state element not found/);
    });
  });
});
