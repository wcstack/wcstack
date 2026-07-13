import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DevtoolsCore, RESERVED_STATE_NAME_PREFIX } from '../src/core/DevtoolsCore';
import { getOrCreateHookRegistry } from '../src/protocol/registry';
import {
  DEVTOOLS_HOOK_GLOBAL,
  DevtoolsEventLike,
  IAbsoluteAddressLike,
  IBindingLike,
  IDevtoolsSourceLike,
  IStateElementSummaryLike,
} from '../src/protocol/types';

function cleanupGlobal(): void {
  delete (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_GLOBAL];
}

function summaryOf(name: string, rootNode: Node = document.createElement('div')): IStateElementSummaryLike {
  return {
    name,
    rootNode,
    element: {},
    paths: {
      list: new Set<string>(),
      element: new Set<string>(),
      getter: new Set<string>(),
      setter: new Set<string>(),
    },
    commandTokenNames: new Set<string>(),
    eventTokenNames: new Set<string>(),
    staticDependency: new Map(),
    dynamicDependency: new Map(),
  };
}

interface IFakeSource extends IDevtoolsSourceLike {
  sink: ((event: DevtoolsEventLike) => void) | null;
  summaries: IStateElementSummaryLike[];
  emit(event: DevtoolsEventLike): void;
}

function createFakeSource(id: string, summaries: IStateElementSummaryLike[] = []): IFakeSource {
  const source: IFakeSource = {
    id,
    kind: 'state',
    packageVersion: '0.0.0',
    sink: null,
    summaries,
    getStateElements: vi.fn(() => source.summaries) as unknown as () => IStateElementSummaryLike[],
    keys: vi.fn(() => ['count']),
    read: vi.fn(() => 42),
    write: vi.fn(),
    _setSink(sink) {
      source.sink = sink;
    },
    emit(event) {
      source.sink!(event);
    },
  };
  return source;
}

function addressOf(stateName: string, path: string, indexes?: number[]): IAbsoluteAddressLike {
  return {
    absolutePathInfo: { stateName, pathInfo: { path } },
    listIndex: indexes !== undefined ? { index: indexes[indexes.length - 1], indexes } : null,
  };
}

function bindingOf(stateName: string, path: string, propName = 'textContent'): IBindingLike {
  return {
    propName,
    statePathName: path,
    stateName,
    bindingType: 'text',
    node: document.createElement('span'),
    replaceNode: document.createElement('span'),
  };
}

describe('DevtoolsCore', () => {
  beforeEach(cleanupGlobal);
  afterEach(cleanupGlobal);

  function setupConnected(summaries: IStateElementSummaryLike[] = []) {
    const registry = getOrCreateHookRegistry();
    const source = createFakeSource('state:test', summaries);
    registry.register(source);
    const core = new DevtoolsCore();
    core.connect();
    return { registry, source, core };
  }

  describe('connect / disconnect', () => {
    it('接続時に既存sourceとrosterを取り込むこと（冪等）', () => {
      const { core, source } = setupConnected([summaryOf('main')]);
      expect(core.connected).toBe(true);
      expect(core.getSources()).toEqual([source]);
      expect(core.getRoster()).toHaveLength(1);
      expect(core.getRoster()[0]).toMatchObject({ name: 'main', sourceId: 'state:test' });
      core.connect(); // 冪等
      expect(core.getSources()).toHaveLength(1);
    });

    it('切断で台帳がクリアされイベントも届かなくなること（冪等）', () => {
      const { core, source } = setupConnected([summaryOf('main')]);
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: bindingOf('main', 'count') });
      expect(core.getAllWiring()).toHaveLength(1);

      core.disconnect();
      expect(core.connected).toBe(false);
      expect(core.getSources()).toHaveLength(0);
      expect(core.getRoster()).toHaveLength(0);
      expect(core.getAllWiring()).toHaveLength(0);
      expect(source.sink).toBeNull();
      core.disconnect(); // 冪等
    });

    it('接続後のsource登録・解除に追随すること', () => {
      const { core, registry } = setupConnected();
      const late = createFakeSource('state:late', [summaryOf('extra')]);
      registry.register(late);
      expect(core.getSources()).toHaveLength(2);
      expect(core.getRoster().some((entry) => entry.name === 'extra')).toBe(true);
      registry.unregister('state:late');
      expect(core.getSources()).toHaveLength(1);
      expect(core.getRoster().some((entry) => entry.name === 'extra')).toBe(false);
    });
  });

  describe('自己除外（protocol §5）', () => {
    it('予約prefixと追加hidden名をrosterから除外すること', () => {
      cleanupGlobal();
      const registry = getOrCreateHookRegistry();
      const source = createFakeSource('state:test', [
        summaryOf('main'),
        summaryOf(`${RESERVED_STATE_NAME_PREFIX}-ui`),
        summaryOf('secret'),
      ]);
      registry.register(source);
      const core = new DevtoolsCore({ hiddenStateNames: ['secret'] });
      core.connect();
      expect(core.getRoster().map((entry) => entry.name)).toEqual(['main']);
      expect(core.isHiddenStateName(null)).toBe(false);
    });
  });

  describe('タイムライン', () => {
    it('writeイベントを整形して追記すること（oldValue付き/なし）', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'state:write', absoluteAddress: addressOf('main', 'count'), value: 5, oldValue: 1, hasOldValue: true });
      source.emit({ type: 'state:write', absoluteAddress: addressOf('main', 'items.*', [2]), value: { a: 1 }, oldValue: undefined, hasOldValue: false });
      const timeline = core.getTimeline();
      expect(timeline).toHaveLength(2);
      expect(timeline[0]).toMatchObject({ kind: 'write', stateName: 'main', label: 'count', detail: '5 (was 1)' });
      expect(timeline[1]).toMatchObject({ kind: 'write', label: 'items.*[2]', detail: '{a: 1}' });
      expect(timeline[1].seq).toBeGreaterThan(timeline[0].seq);
    });

    it('hidden stateのwrite・token・要素登録イベントを無視すること', () => {
      const { core, source } = setupConnected();
      const hidden = `${RESERVED_STATE_NAME_PREFIX}-ui`;
      source.emit({ type: 'state:write', absoluteAddress: addressOf(hidden, 'x'), value: 1, oldValue: undefined, hasOldValue: false });
      source.emit({ type: 'state:token-emit', kind: 'command', stateName: hidden, tokenName: 't', args: [], subscriberCount: 1 });
      source.emit({ type: 'state:element-registered', name: hidden, rootNode: document.createElement('div'), element: {} });
      source.emit({ type: 'state:element-unregistered', name: hidden, rootNode: document.createElement('div'), element: {} });
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf(hidden, 'x'), binding: bindingOf(hidden, 'x') });
      expect(core.getTimeline()).toHaveLength(0);
      expect(core.getAllWiring()).toHaveLength(0);
    });

    it('update-batchを集約し、hiddenのみのバッチは無視すること', () => {
      const { core, source } = setupConnected();
      source.emit({
        type: 'state:update-batch',
        addresses: new Set([
          addressOf('main', 'a'),
          addressOf('main', 'b'),
          addressOf('main', 'c'),
          addressOf('main', 'd'),
          addressOf(`${RESERVED_STATE_NAME_PREFIX}-ui`, 'x'),
        ]),
      });
      source.emit({
        type: 'state:update-batch',
        addresses: new Set([addressOf(`${RESERVED_STATE_NAME_PREFIX}-ui`, 'x')]),
      });
      source.emit({ type: 'state:update-batch', addresses: new Set([addressOf('main', 'solo')]) });
      const timeline = core.getTimeline();
      expect(timeline).toHaveLength(2);
      expect(timeline[0]).toMatchObject({ kind: 'batch', label: '4 addresses' });
      expect(timeline[0].detail).toBe('a, b, c, …(4)');
      expect(timeline[1]).toMatchObject({ label: '1 address', detail: 'solo' });
    });

    it('token-emitをkind別に記録しsubscriberCountを保持すること', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'state:token-emit', kind: 'command', stateName: 'main', tokenName: 'play', args: ['x'], subscriberCount: 0 });
      source.emit({ type: 'state:token-emit', kind: 'event', stateName: null, tokenName: 'changed', args: [], subscriberCount: 2 });
      const [command, event] = core.getTimeline();
      expect(command).toMatchObject({ kind: 'command', label: 'play', detail: '"x"', subscriberCount: 0 });
      expect(event).toMatchObject({ kind: 'event', stateName: null, subscriberCount: 2 });
    });

    it('未知のsourceIdからの要素登録・解除イベントにも安全なこと', () => {
      const { core, source, registry } = setupConnected();
      // unregister 前の sink を捕まえておき、source 消滅後のイベント到達を再現する
      const sink = source.sink!;
      registry.unregister('state:test');
      sink({ type: 'state:element-registered', name: 'ghost', rootNode: document.createElement('div'), element: {} });
      sink({ type: 'state:element-unregistered', name: 'ghost', rootNode: document.createElement('div'), element: {} });
      expect(core.getRoster()).toHaveLength(0);
      expect(core.getTimeline().map((entry) => entry.kind)).toEqual(['element-registered', 'element-unregistered']);
    });

    it('要素登録・解除がタイムラインとrosterに反映されること', () => {
      const { core, source } = setupConnected([summaryOf('main')]);
      source.summaries = [summaryOf('main'), summaryOf('second')];
      source.emit({ type: 'state:element-registered', name: 'second', rootNode: document.createElement('div'), element: {} });
      expect(core.getRoster()).toHaveLength(2);
      source.summaries = [summaryOf('main')];
      source.emit({ type: 'state:element-unregistered', name: 'second', rootNode: document.createElement('div'), element: {} });
      expect(core.getRoster()).toHaveLength(1);
      expect(core.getTimeline().map((entry) => entry.kind)).toEqual(['element-registered', 'element-unregistered']);
    });

    it('pause中は追記されず、capacity超過で先頭から捨てられること', () => {
      cleanupGlobal();
      const registry = getOrCreateHookRegistry();
      const source = createFakeSource('state:test');
      registry.register(source);
      const core = new DevtoolsCore({ timelineCapacity: 2 });
      core.connect();

      core.paused = true;
      source.emit({ type: 'state:write', absoluteAddress: addressOf('main', 'a'), value: 1, oldValue: undefined, hasOldValue: false });
      expect(core.getTimeline()).toHaveLength(0);
      core.paused = false;

      for (const path of ['a', 'b', 'c']) {
        source.emit({ type: 'state:write', absoluteAddress: addressOf('main', path), value: 1, oldValue: undefined, hasOldValue: false });
      }
      expect(core.getTimeline().map((entry) => entry.label)).toEqual(['b', 'c']);

      core.clearTimeline();
      expect(core.getTimeline()).toHaveLength(0);
    });
  });

  describe('配線台帳', () => {
    it('binding-added/removedで台帳が増減すること', () => {
      const { core, source } = setupConnected();
      const binding = bindingOf('main', 'count');
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding });
      expect(core.getWiringForPath('main', 'count')).toHaveLength(1);
      expect(core.getWiringForPath('main', 'other')).toHaveLength(0);

      // 未知のbindingのremovedは無視
      source.emit({ type: 'state:binding-removed', absoluteAddress: addressOf('main', 'count'), binding: bindingOf('main', 'count') });
      expect(core.getWiringForPath('main', 'count')).toHaveLength(1);

      source.emit({ type: 'state:binding-removed', absoluteAddress: addressOf('main', 'count'), binding });
      expect(core.getWiringForPath('main', 'count')).toHaveLength(0);
      expect(core.getAllWiring()).toHaveLength(0);
    });

    it('同一パスの一部removeでは残りが維持されること', () => {
      const { core, source } = setupConnected();
      const first = bindingOf('main', 'count');
      const second = bindingOf('main', 'count');
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: first });
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: second });
      source.emit({ type: 'state:binding-removed', absoluteAddress: addressOf('main', 'count'), binding: first });
      expect(core.getWiringForPath('main', 'count')).toHaveLength(1);
    });

    it('cleared後の同一bindingのremovedにも安全なこと', () => {
      const { core, source } = setupConnected();
      const binding = bindingOf('main', 'count');
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding });
      source.emit({ type: 'state:binding-cleared', absoluteAddress: addressOf('main', 'count') });
      // cleared はパス単位の一掃で、binding 個別台帳には残っている経路
      source.emit({ type: 'state:binding-removed', absoluteAddress: addressOf('main', 'count'), binding });
      expect(core.getWiringForPath('main', 'count')).toHaveLength(0);
    });

    it('binding-clearedでパス単位に一掃されること', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: bindingOf('main', 'count') });
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: bindingOf('main', 'count') });
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'other'), binding: bindingOf('main', 'other') });
      source.emit({ type: 'state:binding-cleared', absoluteAddress: addressOf('main', 'count') });
      source.emit({ type: 'state:binding-cleared', absoluteAddress: addressOf('main', 'unknown') });
      expect(core.getWiringForPath('main', 'count')).toHaveLength(0);
      expect(core.getWiringForPath('main', 'other')).toHaveLength(1);
    });

    it('getWiringForNodeがノード包含で配線を引けること', () => {
      const { core, source } = setupConnected();
      const container = document.createElement('div');
      const inner = document.createElement('span');
      container.append(inner);
      const binding: IBindingLike = { ...bindingOf('main', 'count'), node: inner, replaceNode: inner };
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding });
      expect(core.getWiringForNode(inner)).toHaveLength(1);
      expect(core.getWiringForNode(container)).toHaveLength(1);
      expect(core.getWiringForNode(document.createElement('p'))).toHaveLength(0);
    });

    it('GC済みbinding（WeakRef切れ）は遅延剪定されること', () => {
      const originalWeakRef = globalThis.WeakRef;
      let dead = false;
      class FakeWeakRef<T extends object> {
        private _target: T;
        constructor(target: T) {
          this._target = target;
        }
        deref(): T | undefined {
          return dead ? undefined : this._target;
        }
      }
      vi.stubGlobal('WeakRef', FakeWeakRef);
      try {
        const { core, source } = setupConnected();
        source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: bindingOf('main', 'count') });
        expect(core.getWiringForPath('main', 'count')).toHaveLength(1);
        dead = true;
        expect(core.getWiringForPath('main', 'count')).toHaveLength(0);
        // 剪定済み（2回目も空）
        expect(core.getAllWiring()).toHaveLength(0);
      } finally {
        vi.stubGlobal('WeakRef', originalWeakRef);
        vi.unstubAllGlobals();
      }
    });
  });

  describe('pull API委譲', () => {
    it('keysOf/readValue/writeValueがsourceへ委譲されること', () => {
      const { core, source } = setupConnected([summaryOf('main')]);
      const [entry] = core.getRoster();
      expect(core.keysOf(entry)).toEqual(['count']);
      expect(source.keys).toHaveBeenCalledWith('main', entry.rootNode);
      expect(core.readValue(entry, 'count', [1])).toBe(42);
      expect(source.read).toHaveBeenCalledWith('main', entry.rootNode, 'count', [1]);
      core.writeValue(entry, 'count', 9);
      expect(source.write).toHaveBeenCalledWith('main', entry.rootNode, 'count', 9, undefined);
    });

    it('source消滅後・keys未実装ランタイムに安全なこと', () => {
      const { core, source, registry } = setupConnected([summaryOf('main')]);
      const [entry] = core.getRoster();
      // keys API の無い古いランタイム
      (source as { keys?: unknown }).keys = undefined;
      expect(core.keysOf(entry)).toEqual([]);
      registry.unregister('state:test');
      expect(core.keysOf(entry)).toEqual([]);
      expect(core.readValue(entry, 'count')).toBeUndefined();
      expect(() => core.writeValue(entry, 'count', 1)).not.toThrow();
    });
  });

  describe('onChange', () => {
    it('変更種別が通知され、解除後は呼ばれないこと', () => {
      const { core, source } = setupConnected();
      const kinds: string[] = [];
      const remove = core.onChange((kind) => kinds.push(kind));
      source.emit({ type: 'state:write', absoluteAddress: addressOf('main', 'a'), value: 1, oldValue: undefined, hasOldValue: false });
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'a'), binding: bindingOf('main', 'a') });
      expect(kinds).toEqual(['timeline', 'wiring']);
      remove();
      source.emit({ type: 'state:write', absoluteAddress: addressOf('main', 'b'), value: 1, oldValue: undefined, hasOldValue: false });
      expect(kinds).toHaveLength(2);
    });

    it('refreshRosterがrosterを取り直して通知すること', () => {
      const { core, source } = setupConnected([summaryOf('main')]);
      const kinds: string[] = [];
      core.onChange((kind) => kinds.push(kind));
      source.summaries = [summaryOf('main'), summaryOf('added')];
      core.refreshRoster();
      expect(core.getRoster()).toHaveLength(2);
      expect(kinds).toContain('roster');
    });
  });
});
