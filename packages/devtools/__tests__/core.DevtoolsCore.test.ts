import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DevtoolsCore } from '../src/core/DevtoolsCore';
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

function summaryOf(_name: string, rootNode: Node = document.createElement('div')): IStateElementSummaryLike {
  return {
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
    absolutePathInfo: { stateElement: stateName, pathInfo: { path } },
    listIndex: indexes !== undefined ? { index: indexes[indexes.length - 1], indexes } : null,
  };
}

function bindingOf(_stateName: string, path: string, propName = 'textContent'): IBindingLike {
  return {
    propName,
    statePathName: path,
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
      expect(core.getRoster()[0]).toMatchObject({ label: 'div', sourceId: 'state:test' });
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
      expect(core.getRoster().some((entry) => entry.sourceId === 'state:late')).toBe(true);
      registry.unregister('state:late');
      expect(core.getSources()).toHaveLength(1);
      expect(core.getRoster().some((entry) => entry.sourceId === 'state:late')).toBe(false);
    });
  });

  describe('タイムライン', () => {
    it('writeイベントを整形して追記すること（oldValue付き/なし）', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'state:write', absoluteAddress: addressOf('main', 'count'), value: 5, oldValue: 1, hasOldValue: true });
      source.emit({ type: 'state:write', absoluteAddress: addressOf('main', 'items.*', [2]), value: { a: 1 }, oldValue: undefined, hasOldValue: false });
      const timeline = core.getTimeline();
      expect(timeline).toHaveLength(2);
      expect(timeline[0]).toMatchObject({ kind: 'write', label: 'count', detail: '5 (was 1)' });
      expect(timeline[1]).toMatchObject({ kind: 'write', label: 'items.*[2]', detail: '{a: 1}' });
      expect(timeline[1].seq).toBeGreaterThan(timeline[0].seq);
    });


    it('空のupdate-batchはtimeline行にしないこと', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'state:update-batch', addresses: new Set() });
      expect(core.getTimeline()).toHaveLength(0);
    });

    it('ShadowRoot ルートの roster ラベルはホストタグ名になること', () => {
      const host = document.createElement('my-card');
      const shadow = host.attachShadow({ mode: 'open' });
      const { core } = setupConnected([summaryOf('main', shadow)]);
      expect(core.getRoster()[0].label).toBe('<my-card>');
    });

    it('update-batchを集約すること', () => {
      const { core, source } = setupConnected();
      source.emit({
        type: 'state:update-batch',
        addresses: new Set([
          addressOf('main', 'a'),
          addressOf('main', 'b'),
          addressOf('main', 'c'),
          addressOf('main', 'd'),
        ]),
      });
      source.emit({ type: 'state:update-batch', addresses: new Set([addressOf('main', 'solo')]) });
      const timeline = core.getTimeline();
      expect(timeline).toHaveLength(2);
      expect(timeline[0]).toMatchObject({ kind: 'batch', label: '4 addresses' });
      expect(timeline[0].detail).toBe('a, b, c, …(4)');
      expect(timeline[1]).toMatchObject({ label: '1 address', detail: 'solo' });
    });

    it('watch-errorをphase付きで記録すること（ランタイムが握った失敗の唯一の可視化点）', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'state:watch-error', phase: 'handler', path: 'items.*.price', error: new TypeError('boom') });
      source.emit({ type: 'state:watch-error', phase: 'evaluate', path: 'total', error: 'plain string throw' });
      const [handler, evaluate] = core.getTimeline();
      expect(handler).toMatchObject({
        kind: 'watch-error',
        label: 'items.*.price',
        detail: 'handler: TypeError: boom',
      });
      expect(evaluate).toMatchObject({ kind: 'watch-error', label: 'total', detail: 'evaluate: "plain string throw"' });
    });

    it('path-unresolvedを記録すること（配線が黙って死んでいることの唯一の可視化点）', () => {
      const { core, source } = setupConnected();
      source.emit({
        type: 'state:path-unresolved',
        source: 'binding',
        path: 'user.nmae',
        missingSegment: 'nmae',
      });
      source.emit({
        type: 'state:path-unresolved',
        source: 'watch',
        path: 'cout',
        missingSegment: 'cout',
      });
      const [binding, watch] = core.getTimeline();
      expect(binding).toMatchObject({
        kind: 'path-unresolved',
        label: 'user.nmae',
        detail: 'binding: "nmae" is not declared',
      });
      expect(watch).toMatchObject({ kind: 'path-unresolved', label: 'cout', detail: 'watch: "cout" is not declared' });
    });

    it('binding-apply-errorをbindingType付きで記録すること（隔離された適用失敗）', () => {
      const { core, source } = setupConnected();
      source.emit({
        type: 'state:binding-apply-error',
        path: 'items.*.label',
        bindingType: 'text',
        error: new TypeError('boom'),
      });
      expect(core.getTimeline()).toEqual([
        expect.objectContaining({
          kind: 'binding-apply-error',
          label: 'items.*.label',
          detail: 'text: TypeError: boom',
        }),
      ]);
    });

    it('watch-chain-limitを記録すること（state名を持たないバッチ単位の打ち切り）', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'state:watch-chain-limit', maxDepth: 32, paths: ['a', 'b'] });
      expect(core.getTimeline()).toEqual([
        expect.objectContaining({
          kind: 'watch-chain-limit',
          label: 'depth > 32',
          detail: 'a, b',
        }),
      ]);
    });

    it('propagation:suppressedを記録すること（state名を持たない辺単位の抑止）', () => {
      const { core, source } = setupConnected();
      source.emit({
        type: 'propagation:suppressed',
        reason: 'visited-edge',
        transactionId: 7,
        edgeId: 3,
        node: document.createElement('input'),
        member: 'value',
      });
      expect(core.getTimeline()).toEqual([
        expect.objectContaining({
          kind: 'propagation-suppressed',
          label: 'value',
          detail: 'visited-edge (tx 7, edge 3)',
        }),
      ]);
    });

    it('propagation:coalescedとhop-limitを記録すること', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'propagation:coalesced', absoluteAddress: addressOf('main', 'count'), droppedTransactionId: 1, winnerTransactionId: 2 });
      source.emit({ type: 'propagation:hop-limit', absoluteAddress: addressOf('main', 'items.*', [0]), transactionId: 9, hop: 16 });
      const timeline = core.getTimeline();
      expect(timeline).toHaveLength(2);
      expect(timeline[0]).toMatchObject({
        kind: 'propagation-coalesced',
        label: 'count',
        detail: 'tx 1 dropped (winner tx 2)',
      });
      expect(timeline[1]).toMatchObject({
        kind: 'propagation-hop-limit',
        label: 'items.*[0]',
        detail: 'hop 16 (tx 9)',
      });
    });

    it('contract:driftをreason別の詳細付きで記録すること', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'contract:drift', reason: 'component-not-loaded', tag: 'wcs-fetch' });
      source.emit({ type: 'contract:drift', reason: 'missing-member', tag: 'wcs-fetch', member: 'data' });
      source.emit({ type: 'contract:drift', reason: 'event-mismatch', tag: 'wcs-fetch', member: 'data', sidecarEvent: 'change', liveEvent: 'fetch-data-changed' });
      const [notLoaded, missing, mismatch] = core.getTimeline();
      expect(notLoaded).toMatchObject({ kind: 'contract-drift', label: 'wcs-fetch', detail: 'component-not-loaded' });
      expect(missing).toMatchObject({ kind: 'contract-drift', detail: 'missing-member: data' });
      expect(mismatch).toMatchObject({ kind: 'contract-drift', detail: 'event-mismatch: data (sidecar change / live fetch-data-changed)' });
    });

    it('contract:manifest-readとunsupported-extensionはtimeline行にしないこと（情報イベント）', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'contract:manifest-read', tag: 'wcs-fetch', loaded: true });
      source.emit({ type: 'contract:unsupported-extension', namespace: 'vendor.x' });
      expect(core.getTimeline()).toHaveLength(0);
    });

    it('event-mismatchでoptionalなsidecarEvent/liveEventが欠落してもundefinedを表示しないこと', () => {
      // 型上 reason と optional フィールドは結合されていない（構造的型付け）ため、
      // 欠落 payload を受けても表示が壊れないことを固定する。
      const { core, source } = setupConnected();
      source.emit({ type: 'contract:drift', reason: 'event-mismatch', tag: 'wcs-fetch' });
      expect(core.getTimeline()[0]).toMatchObject({ detail: 'event-mismatch (sidecar ? / live ?)' });
    });

    it('union外の未知イベントは黙って素通しすること（additiveプロトコル）', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'future:unknown', payload: 1 } as unknown as DevtoolsEventLike);
      expect(core.getTimeline()).toHaveLength(0);
    });

    it('watch-firedはtimeline行にせず、カバレッジ台帳に積むこと', () => {
      const { core, source } = setupConnected([
        { ...summaryOf('main'), watchPaths: new Set(['count']) },
      ]);
      source.emit({ type: 'state:watch-fired', path: 'count' });
      source.emit({ type: 'state:watch-fired', path: 'count' });
      expect(core.getTimeline()).toHaveLength(0);
      const watch = core.getCoverageReport().find((e) => e.kind === 'watch' && e.name === 'count')!;
      expect(watch).toMatchObject({ status: 'fired', count: 2 });
    });

    it('token-emitをkind別に記録しsubscriberCountを保持すること', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'state:token-emit', kind: 'command', tokenName: 'play', args: ['x'], subscriberCount: 0 });
      source.emit({ type: 'state:token-emit', kind: 'event', tokenName: 'changed', args: [], subscriberCount: 2 });
      const [command, event] = core.getTimeline();
      expect(command).toMatchObject({ kind: 'command', label: 'play', detail: '"x"', subscriberCount: 0 });
      expect(event).toMatchObject({ kind: 'event', subscriberCount: 2 });
    });

    it('未知のsourceIdからの要素登録・解除イベントにも安全なこと', () => {
      const { core, source, registry } = setupConnected();
      // unregister 前の sink を捕まえておき、source 消滅後のイベント到達を再現する
      const sink = source.sink!;
      registry.unregister('state:test');
      sink({ type: 'state:element-registered', rootNode: document.createElement('div'), element: {} });
      sink({ type: 'state:element-unregistered', rootNode: document.createElement('div'), element: {} });
      expect(core.getRoster()).toHaveLength(0);
      expect(core.getTimeline().map((entry) => entry.kind)).toEqual(['element-registered', 'element-unregistered']);
    });

    it('要素登録・解除がタイムラインとrosterに反映されること', () => {
      const { core, source } = setupConnected([summaryOf('main')]);
      source.summaries = [summaryOf('main'), summaryOf('second')];
      source.emit({ type: 'state:element-registered', rootNode: document.createElement('div'), element: {} });
      expect(core.getRoster()).toHaveLength(2);
      source.summaries = [summaryOf('main')];
      source.emit({ type: 'state:element-unregistered', rootNode: document.createElement('div'), element: {} });
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
      expect(core.getWiringForPath('count')).toHaveLength(1);
      expect(core.getWiringForPath('other')).toHaveLength(0);

      // 未知のbindingのremovedは無視
      source.emit({ type: 'state:binding-removed', absoluteAddress: addressOf('main', 'count'), binding: bindingOf('main', 'count') });
      expect(core.getWiringForPath('count')).toHaveLength(1);

      source.emit({ type: 'state:binding-removed', absoluteAddress: addressOf('main', 'count'), binding });
      expect(core.getWiringForPath('count')).toHaveLength(0);
      expect(core.getAllWiring()).toHaveLength(0);
    });

    it('同一パスの一部removeでは残りが維持されること', () => {
      const { core, source } = setupConnected();
      const first = bindingOf('main', 'count');
      const second = bindingOf('main', 'count');
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: first });
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: second });
      source.emit({ type: 'state:binding-removed', absoluteAddress: addressOf('main', 'count'), binding: first });
      expect(core.getWiringForPath('count')).toHaveLength(1);
    });

    it('cleared後の同一bindingのremovedにも安全なこと', () => {
      const { core, source } = setupConnected();
      const binding = bindingOf('main', 'count');
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding });
      source.emit({ type: 'state:binding-cleared', absoluteAddress: addressOf('main', 'count') });
      // cleared はパス単位の一掃で、binding 個別台帳には残っている経路
      source.emit({ type: 'state:binding-removed', absoluteAddress: addressOf('main', 'count'), binding });
      expect(core.getWiringForPath('count')).toHaveLength(0);
    });

    it('binding-clearedでパス単位に一掃されること', () => {
      const { core, source } = setupConnected();
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: bindingOf('main', 'count') });
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: bindingOf('main', 'count') });
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'other'), binding: bindingOf('main', 'other') });
      source.emit({ type: 'state:binding-cleared', absoluteAddress: addressOf('main', 'count') });
      source.emit({ type: 'state:binding-cleared', absoluteAddress: addressOf('main', 'unknown') });
      expect(core.getWiringForPath('count')).toHaveLength(0);
      expect(core.getWiringForPath('other')).toHaveLength(1);
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
        expect(core.getWiringForPath('count')).toHaveLength(1);
        dead = true;
        expect(core.getWiringForPath('count')).toHaveLength(0);
        // 剪定済み（2回目も空）
        expect(core.getAllWiring()).toHaveLength(0);
      } finally {
        vi.stubGlobal('WeakRef', originalWeakRef);
        vi.unstubAllGlobals();
      }
    });
  });

  describe('配線カバレッジ（設計 §4: 宣言 × 実測）', () => {
    const declaredOf = (_stateName: string, propName: string, path: string, extra: Record<string, unknown> = {}) => ({
      node: null,
      propName,
      statePathName: path,
      bindingType: 'prop',
      inFilters: [],
      outFilters: [],
      origin: 'attribute' as const,
      raw: `${propName}: ${path}`,
      ...extra,
    });

    it('watchのfired/never/prerequisite-missingを区別すること', () => {
      const { core, source } = setupConnected([
        {
          ...summaryOf('main'),
          watchPaths: new Set(['count', 'items.*.price', 'rows.*.total', 'rows.*.cells.*.v']),
          paths: {
            list: new Set(['rows']), // rows は for バインド済み・items と rows.*.cells は未バインド
            element: new Set<string>(),
            getter: new Set<string>(),
            setter: new Set<string>(),
          },
        },
      ]);
      source.emit({ type: 'state:watch-fired', path: 'count' });
      const byName = new Map(core.getCoverageReport().filter((e) => e.kind === 'watch').map((e) => [e.name, e]));
      expect(byName.get('count')).toMatchObject({ status: 'fired', count: 1 });
      // ワイルドカード行 watch で対象リストが未バインド → 未発火でなく前提未成立。
      // keyedListPaths を持たない旧ランタイム（summaryOf に無い）では $listKeys 側が観測不能 —
      // （paths.list は for 由来のみで $listKeys 宣言は見えないため）
      expect(byName.get('items.*.price')).toMatchObject({ status: 'prerequisite-missing' });
      expect(byName.get('items.*.price')!.note).toContain('no for binding observed for list "items"');
      expect(byName.get('items.*.price')!.note).toContain('$listKeys');
      // リストがバインド済みなら通常の never
      expect(byName.get('rows.*.total')).toMatchObject({ status: 'never' });
      // 入れ子ワイルドカードは全 `.*` 階層を検査する（1 段目だけ見て見逃さない）
      expect(byName.get('rows.*.cells.*.v')).toMatchObject({ status: 'prerequisite-missing' });
      expect(byName.get('rows.*.cells.*.v')!.note).toContain('"rows.*.cells"');
    });

    it('$listKeys宣言（keyedListPaths）は for バインドと同格の発火前提として扱うこと', () => {
      const { core } = setupConnected([
        {
          ...summaryOf('main'),
          watchPaths: new Set(['items.*.price', 'orphan.*.x']),
          // items は for バインド無しだが $listKeys 宣言あり → 前提成立（通常の never）
          keyedListPaths: new Set(['items']),
        } as never,
      ]);
      const byName = new Map(core.getCoverageReport().filter((e) => e.kind === 'watch').map((e) => [e.name, e]));
      expect(byName.get('items.*.price')).toMatchObject({ status: 'never' });
      // keyedListPaths が観測できるランタイムでは note は断定形。ただし主張は
      // リスト書き込み経路にスコープする — 明示 index 書き込み（$resolve /
      // items.0.price 代入。$getAll で listIndex 台帳が生えた後）は for も
      // $listKeys も無くても発火し得ることを実測済みのため、「一度も発火しない」
      // とは書かない（誤 hint ゼロ）。
      expect(byName.get('orphan.*.x')).toMatchObject({ status: 'prerequisite-missing' });
      expect(byName.get('orphan.*.x')!.note).toContain('no for binding and no $listKeys declaration');
      expect(byName.get('orphan.*.x')!.note).toContain('list writes never reach its rows');
      expect(byName.get('orphan.*.x')!.note).toContain('explicit-index writes');
    });

    it('keyedListPaths を持たない旧ランタイムでは $listKeys 不在を断定しない note のままなこと', () => {
      const { core } = setupConnected([
        { ...summaryOf('main'), watchPaths: new Set(['items.*.price']) },
      ]);
      const watch = core.getCoverageReport().find((e) => e.kind === 'watch' && e.name === 'items.*.price')!;
      expect(watch.status).toBe('prerequisite-missing');
      expect(watch.note).toContain('$listKeys declaration would still let list writes fire it');
    });

    it('token宣言のemitted/neverを数えること', () => {
      const { core, source } = setupConnected([
        {
          ...summaryOf('main'),
          commandTokenNames: new Set(['play', 'stop']),
          eventTokenNames: new Set(['changed']),
        },
      ]);
      source.emit({ type: 'state:token-emit', kind: 'command', tokenName: 'play', args: [], subscriberCount: 1 });
      source.emit({ type: 'state:token-emit', kind: 'command', tokenName: 'play', args: [], subscriberCount: 1 });
      source.emit({ type: 'state:token-emit', kind: 'event', tokenName: 'changed', args: [], subscriberCount: 1 });
      const report = core.getCoverageReport();
      expect(report.find((e) => e.kind === 'command' && e.name === 'play')).toMatchObject({ status: 'emitted', count: 2, note: null });
      expect(report.find((e) => e.kind === 'command' && e.name === 'stop')).toMatchObject({ status: 'never' });
      expect(report.find((e) => e.kind === 'eventToken' && e.name === 'changed')).toMatchObject({ status: 'emitted', count: 1 });
    });

    it('全emitが空撃ち（subscriberCount 0）ならemitted-unheardとして警告すること', () => {
      const { core, source } = setupConnected([
        {
          ...summaryOf('main'),
          commandTokenNames: new Set(['play', 'seek']),
        },
      ]);
      // play: 全 2 回とも空撃ち → emitted-unheard
      source.emit({ type: 'state:token-emit', kind: 'command', tokenName: 'play', args: [], subscriberCount: 0 });
      source.emit({ type: 'state:token-emit', kind: 'command', tokenName: 'play', args: [], subscriberCount: 0 });
      // seek: 3 回中 1 回だけ空撃ち → emitted のまま note で内訳を出す
      source.emit({ type: 'state:token-emit', kind: 'command', tokenName: 'seek', args: [], subscriberCount: 0 });
      source.emit({ type: 'state:token-emit', kind: 'command', tokenName: 'seek', args: [], subscriberCount: 2 });
      source.emit({ type: 'state:token-emit', kind: 'command', tokenName: 'seek', args: [], subscriberCount: 1 });
      const report = core.getCoverageReport();
      expect(report.find((e) => e.name === 'play')).toMatchObject({
        status: 'emitted-unheard', count: 2, note: 'all 2 emit(s) had 0 subscribers',
      });
      expect(report.find((e) => e.name === 'seek')).toMatchObject({
        status: 'emitted', count: 3, note: '1/3 emit(s) had 0 subscribers',
      });
    });


    it('canonical declaredがあればbindingのattached/never-attachedを突合すること', () => {
      const { core, source } = setupConnected([summaryOf('main')]);
      (source as any).getDeclaredBindings = vi.fn(() => [
        declaredOf('main', 'textContent', 'user.name'),
        declaredOf('main', 'value', 'count'),
        declaredOf('main', 'for', 'items', { bindingType: 'for' }),          // 構造 → 対象外
        declaredOf('main', 'eventToken.value', 'changed', { bindingType: 'event' }), // token 節の担当
      ]);
      core.refreshRoster();
      // user.name だけ live 台帳に attach 済み
      source.emit({
        type: 'state:binding-added',
        absoluteAddress: addressOf('main', 'user.name'),
        binding: bindingOf('main', 'user.name'),
      });
      const bindings = core.getCoverageReport().filter((e) => e.kind === 'binding');
      expect(bindings).toHaveLength(2);
      expect(bindings.find((e) => e.name.includes('user.name'))).toMatchObject({ status: 'attached' });
      expect(bindings.find((e) => e.name.includes('count'))).toMatchObject({ status: 'never-attached' });
    });

    it('attached判定は「一度でもattachを観測したか」で行い、行の破棄で逆戻りしないこと', () => {
      const { core, source } = setupConnected([summaryOf('main')]);
      (source as any).getDeclaredBindings = vi.fn(() => [
        declaredOf('main', 'textContent', 'items.*.label'),
      ]);
      core.refreshRoster();
      // 行の実体化で attach → リスト差し替えで binding-removed（live 台帳は空に戻る）
      const binding = bindingOf('main', 'items.*.label');
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'items.*.label', [0]), binding });
      source.emit({ type: 'state:binding-removed', absoluteAddress: addressOf('main', 'items.*.label', [0]), binding });
      expect(core.getWiringForPath('items.*.label')).toHaveLength(0);
      // live 台帳は空でも「観測開始以降に一度 attach された」事実で attached のまま
      expect(core.getCoverageReport().find((e) => e.kind === 'binding')).toMatchObject({ status: 'attached' });
      // disconnect で ever 台帳もクリアされる（残留ゼロ）
      core.disconnect();
      expect(core.getCoverageReport()).toEqual([]);
    });

    it('bindingの突合は宣言（state/path/prop）単位でdedupeし、fragment由来にはnoteが付くこと', () => {
      const { core, source } = setupConnected([summaryOf('main')]);
      (source as any).getDeclaredBindings = vi.fn(() => [
        declaredOf('main', 'textContent', 'row.label', { origin: 'fragment', node: null }),
        // 同じ宣言が origin 違い（属性側）にもある形 — カバレッジ行としては同一
        declaredOf('main', 'textContent', 'row.label', { origin: 'attribute' }),
      ]);
      core.refreshRoster();
      const bindings = core.getCoverageReport().filter((e) => e.kind === 'binding');
      expect(bindings).toHaveLength(1);
      expect(bindings[0].note).toBe('template interior (attaches when rows materialize)');
    });

    it('getDeclaredBindings対応でもroster空ならcanonicalは空配列（nullではない）', () => {
      const { core, source } = setupConnected([]);
      (source as any).getDeclaredBindings = vi.fn(() => []);
      expect(core.getCanonicalDeclared()).toEqual([]);
    });

    it('getCanonicalDeclaredは未対応ランタイムでnull・対応時は宣言集合を集めること', () => {
      const { core, source } = setupConnected([summaryOf('main')]);
      expect(core.getCanonicalDeclared()).toBeNull();
      (source as any).getDeclaredBindings = vi.fn(() => [
        declaredOf('main', 'textContent', 'a'),
        declaredOf('main', 'textContent', 'x'),
      ]);
      const declared = core.getCanonicalDeclared()!;
      expect(declared).toHaveLength(2);
    });

    it('getCanonicalDeclaredはsourceをまたぐ同一宣言タプルをdedupeすること', () => {
      const { core, source, registry } = setupConnected([summaryOf('main')]);
      (source as any).getDeclaredBindings = vi.fn(() => [declaredOf('main', 'textContent', 'a')]);
      const second = createFakeSource('state:second', [summaryOf('main')]);
      (second as any).getDeclaredBindings = vi.fn(() => [
        declaredOf('main', 'textContent', 'a'), // 同一タプル（同じ root を別 source が走査した形）
        declaredOf('main', 'value', 'b'),
      ]);
      registry.register(second);
      const declared = core.getCanonicalDeclared()!;
      expect(declared).toHaveLength(2);
      expect(declared.map((d) => d.propName).sort()).toEqual(['textContent', 'value']);
    });

    it('disconnectでカバレッジ台帳と観測開始時刻がクリアされること', () => {
      const { core, source } = setupConnected([
        { ...summaryOf('main'), watchPaths: new Set(['count']) },
      ]);
      expect(core.observingSince).not.toBeNull();
      source.emit({ type: 'state:watch-fired', path: 'count' });
      core.disconnect();
      expect(core.observingSince).toBeNull();
      expect(core.getCoverageReport()).toEqual([]);
    });
  });

  describe('pull API委譲', () => {
    it('keysOf/readValue/writeValueがsourceへ委譲されること', () => {
      const { core, source } = setupConnected([summaryOf('main')]);
      const [entry] = core.getRoster();
      expect(core.keysOf(entry)).toEqual(['count']);
      expect(source.keys).toHaveBeenCalledWith(entry.rootNode);
      expect(core.readValue(entry, 'count', [1])).toBe(42);
      expect(source.read).toHaveBeenCalledWith(entry.rootNode, 'count', [1]);
      core.writeValue(entry, 'count', 9);
      expect(source.write).toHaveBeenCalledWith(entry.rootNode, 'count', 9, undefined);
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
      // binding-added は live 台帳（wiring）とカバレッジの ever 台帳（coverage）の両方を動かす
      expect(kinds).toEqual(['timeline', 'wiring', 'coverage']);
      remove();
      source.emit({ type: 'state:write', absoluteAddress: addressOf('main', 'b'), value: 1, oldValue: undefined, hasOldValue: false });
      expect(kinds).toHaveLength(3);
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
