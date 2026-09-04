/**
 * bootstrapDevtools.ts
 *
 * `<wcs-devtools>` の登録と自動挿入（devtools-tag-design.md §2）。
 * - 既に定義済みなら再定義しない
 * - ページに `<wcs-devtools>` が無ければ body 末尾に 1 つ挿入
 *   （手動で書かれていれば挿入しない）
 * - SSR では何もしない
 */
declare function bootstrapDevtools(): void;

/**
 * protocol/types.ts
 *
 * DevTools Hook Protocol (docs/devtools-hook-protocol.md) の devtools 側型定義。
 *
 * ランタイム（@wcstack/state）側の内部型は import しない — プロトコルは
 * 「文書化された構造」への構造的型付けで両側が独立に実装する（protocol §2）。
 * そのためランタイム内部オブジェクトは *Like インターフェースとして、
 * devtools が実際に触るプロパティだけを宣言する。
 */
/** グローバル registry のプロパティ名 */
declare const DEVTOOLS_HOOK_GLOBAL = "__WCSTACK_DEVTOOLS_HOOK__";
/** プロトコル版。additive change では上げない（protocol §2） */
declare const DEVTOOLS_PROTOCOL_VERSION = 2;
interface IPathInfoLike {
    readonly path: string;
}
interface IAbsolutePathInfoLike {
    readonly stateElement: unknown;
    readonly pathInfo: IPathInfoLike;
}
interface IListIndexLike {
    readonly index: number;
    readonly indexes: number[];
}
interface IAbsoluteAddressLike {
    readonly absolutePathInfo: IAbsolutePathInfoLike;
    readonly listIndex: IListIndexLike | null;
}
interface IBindingLike {
    readonly propName: string;
    readonly statePathName: string;
    readonly bindingType: string;
    readonly node: Node;
    readonly replaceNode: Node;
}
interface IStateElementSummaryLike {
    readonly rootNode: Node;
    readonly element: unknown;
    readonly paths: {
        readonly list: ReadonlySet<string>;
        readonly element: ReadonlySet<string>;
        readonly getter: ReadonlySet<string>;
        readonly setter: ReadonlySet<string>;
    };
    readonly commandTokenNames: ReadonlySet<string>;
    readonly eventTokenNames: ReadonlySet<string>;
    readonly staticDependency: ReadonlyMap<string, readonly string[]>;
    readonly dynamicDependency: ReadonlyMap<string, readonly string[]>;
    /**
     * `$watch` の宣言パス集合（protocol v1 追補・配線カバレッジの宣言面）。
     * 旧ランタイムにはフィールド自体が無いため optional。宣言なしは null。
     */
    readonly watchPaths?: ReadonlySet<string> | null;
    /**
     * `$listKeys` で宣言されたリストパス集合（protocol v1 追補）。ワイルドカード行
     * watch に**リスト書き込み**が届く前提は「for バインド（paths.list）or
     * $listKeys 宣言」なので、前提判定の正確化に paths.list と対で使う
     *（明示 index 書き込みは前提に依らず発火し得る）。旧ランタイムにはフィールド自体が
     * 無いため optional（undefined = $listKeys 側が観測不能）。宣言なしは null。
     */
    readonly keyedListPaths?: ReadonlySet<string> | null;
}
/**
 * 宣言レベルのバインディング 1 件（getDeclaredBindings の要素・protocol v1 追補）。
 * ランタイム正本パーサの結果が構造的に流れる。宣言タプルで dedupe 済みの
 * 「宣言の集合」であり、レンダリング行数に比例したインスタンス列ではない。
 */
interface IDeclaredBindingLike {
    /** 代表ノード（fragment 由来 = 構造テンプレート内部は null）。 */
    readonly node: Node | null;
    readonly propName: string;
    readonly statePathName: string;
    readonly bindingType: string;
    readonly inFilters: readonly {
        readonly filterName: string;
        readonly args: readonly string[];
    }[];
    readonly outFilters: readonly {
        readonly filterName: string;
        readonly args: readonly string[];
    }[];
    readonly origin: "attribute" | "comment" | "fragment";
    readonly raw: string;
}
type DevtoolsEventLike = {
    readonly type: "state:element-registered";
    readonly rootNode: Node;
    readonly element: unknown;
} | {
    readonly type: "state:element-unregistered";
    readonly rootNode: Node;
    readonly element: unknown;
} | {
    readonly type: "state:write";
    readonly absoluteAddress: IAbsoluteAddressLike;
    readonly value: unknown;
    readonly oldValue: unknown;
    readonly hasOldValue: boolean;
} | {
    readonly type: "state:update-batch";
    readonly addresses: ReadonlySet<IAbsoluteAddressLike>;
} | {
    readonly type: "state:binding-added";
    readonly absoluteAddress: IAbsoluteAddressLike;
    readonly binding: IBindingLike;
} | {
    readonly type: "state:binding-removed";
    readonly absoluteAddress: IAbsoluteAddressLike;
    readonly binding: IBindingLike;
} | {
    readonly type: "state:binding-cleared";
    readonly absoluteAddress: IAbsoluteAddressLike;
} | {
    readonly type: "state:token-emit";
    readonly kind: "command" | "event";
    readonly tokenName: string;
    readonly args: readonly unknown[];
    readonly subscriberCount: number;
} | {
    readonly type: "state:watch-error";
    readonly phase: "prime" | "evaluate" | "handler";
    readonly path: string;
    readonly error: unknown;
} | {
    readonly type: "state:watch-chain-limit";
    readonly maxDepth: number;
    readonly paths: readonly string[];
} | {
    readonly type: "state:watch-fired";
    readonly path: string;
} | {
    readonly type: "state:path-unresolved";
    readonly source: "binding" | "watch";
    readonly path: string;
    readonly missingSegment: string;
} | {
    readonly type: "state:binding-apply-error";
    readonly path: string;
    readonly bindingType: string;
    readonly error: unknown;
} | {
    readonly type: "propagation:suppressed";
    readonly reason: "confirmation" | "visited-edge";
    readonly transactionId: number;
    readonly edgeId: number;
    readonly node: Node;
    readonly member: string;
} | {
    readonly type: "propagation:coalesced";
    readonly absoluteAddress: IAbsoluteAddressLike;
    readonly droppedTransactionId: number;
    readonly winnerTransactionId: number;
} | {
    readonly type: "propagation:hop-limit";
    readonly absoluteAddress: IAbsoluteAddressLike;
    readonly transactionId: number;
    readonly hop: number;
} | {
    readonly type: "contract:manifest-read";
    readonly tag: string;
    readonly loaded: boolean;
} | {
    readonly type: "contract:unsupported-extension";
    readonly namespace: string;
} | {
    readonly type: "contract:drift";
    readonly reason: "component-not-loaded" | "missing-member" | "event-mismatch";
    readonly tag: string;
    readonly member?: string;
    readonly sidecarEvent?: string;
    readonly liveEvent?: string;
};
type DevtoolsSinkLike = (event: DevtoolsEventLike) => void;
interface IDevtoolsSourceLike {
    readonly id: string;
    readonly kind: string;
    readonly packageVersion: string;
    getStateElements(): IStateElementSummaryLike[];
    /** protocol v1 追補 API。古いランタイムには無い可能性があるため optional 扱いで呼ぶ */
    keys?(rootNode: Node): string[];
    read(rootNode: Node, path: string, indexes?: number[]): unknown;
    write(rootNode: Node, path: string, value: unknown, indexes?: number[]): void;
    /**
     * protocol v1 追補 API（optional 扱いで呼ぶ）。ランタイム正本パーサによる
     * 宣言レベルバインディングの集合（declaredScan の簡易パーサを置き換える正本）。
     */
    getDeclaredBindings?(rootNode: Node): IDeclaredBindingLike[];
    _setSink(sink: DevtoolsSinkLike | null): void;
}
interface IDevtoolsListenerLike {
    onSourceRegistered?(source: IDevtoolsSourceLike): void;
    onSourceUnregistered?(sourceId: string): void;
    onEvent?(sourceId: string, event: DevtoolsEventLike): void;
}
interface IDevtoolsHookRegistryLike {
    readonly version: number;
    readonly sources: Map<string, IDevtoolsSourceLike>;
    register(source: IDevtoolsSourceLike): void;
    unregister(sourceId: string): void;
    addListener(listener: IDevtoolsListenerLike): () => void;
}

/**
 * core/DevtoolsCore.ts
 *
 * hook client（devtools-tag-design.md §1）。DOM 非依存の純ロジック層。
 *
 * - registry への addListener / 解除（connect / disconnect）
 * - source 管理と roster（state 要素一覧）の維持
 * - 配線台帳（binding-added/removed イベントから構築。binding は WeakRef 保持）
 * - タイムライン ring buffer（既定 500 件 FIFO）
 * - 予約 prefix `wcs-devtools` の自己除外（protocol §5）
 *
 * 台帳はすべて devtools 側に置く（protocol 原則 2）。disconnect で
 * sources / roster / wiring をクリアし、残留参照を持たない。
 */

type TimelineKind = "write" | "batch" | "command" | "event" | "element-registered" | "element-unregistered" | "watch-error" | "watch-chain-limit" | "path-unresolved" | "binding-apply-error" | "propagation-suppressed" | "propagation-coalesced" | "propagation-hop-limit" | "contract-drift";
interface ITimelineEntry {
    readonly seq: number;
    readonly time: number;
    readonly sourceId: string;
    readonly kind: TimelineKind;
    readonly label: string;
    readonly detail: string;
    readonly subscriberCount: number | null;
}
interface IRosterEntry {
    readonly sourceId: string;
    /** 表示・選択用のルート由来ラベル（document / ホストタグ、重複は #n を付ける） */
    readonly label: string;
    readonly rootNode: Node;
    readonly summary: IStateElementSummaryLike;
}
interface IWiringEntry {
    readonly sourceId: string;
    readonly path: string;
    readonly propName: string;
    readonly bindingType: string;
    readonly bindingRef: WeakRef<IBindingLike>;
    /**
     * 属する state 要素（absoluteAddress.absolutePathInfo.stateElement）。v2 は名前次元が
     * 無いため、複数ツリーの同名パスは要素同一性で区別する（getWiringForPath のスコープ）。
     * WeakRef なのはこの台帳が要素の寿命を延ばさないため。payload に無ければ null。
     */
    readonly stateElementRef: WeakRef<object> | null;
}
type CoreChangeKind = "sources" | "roster" | "wiring" | "timeline" | "coverage";
type CoreChangeListener = (kind: CoreChangeKind) => void;
/**
 * 配線カバレッジ 1 行（static-wiring-dx-design.md §4 — 宣言 × 実測の突合）。
 * - watch: `fired`（count 回）/ `never` / `prerequisite-missing`
 *   （ワイルドカード行 watch は「for バインド or $listKeys 宣言」が無いと
 *   リスト書き込みが行へ届かない — 「未発火」と区別しないと誤警告になる）
 * - command / eventToken: `emitted`（count 回）/ `never` /
 *   `emitted-unheard`（全 emit が subscriberCount 0 = 空撃ち。§4 の突合対象）
 * - binding: canonical declared がある場合のみ。`attached` / `never-attached`
 *   （attached は「観測開始以降に一度でも attach された」— live 台帳は WeakRef
 *   pruning で縮むため、瞬間値で判定すると attached が never-attached へ戻る）
 */
type CoverageStatus = "fired" | "emitted" | "emitted-unheard" | "attached" | "never" | "prerequisite-missing" | "never-attached";
interface ICoverageEntry {
    readonly kind: "watch" | "command" | "eventToken" | "binding";
    readonly name: string;
    readonly status: CoverageStatus;
    readonly count: number;
    readonly note: string | null;
}
interface IDevtoolsCoreOptions {
    /** タイムライン ring buffer 件数（既定 500） */
    timelineCapacity?: number;
}
declare class DevtoolsCore {
    private _timelineCapacity;
    private _removeListener;
    private _sources;
    private _roster;
    private _wiringByPathKey;
    private _wiringEntryByBinding;
    private _timeline;
    private _seq;
    private _paused;
    private _changeListeners;
    /** 観測開始時刻（connect 時の performance.now。未接続は null）。 */
    private _observingSince;
    /** watch 発火回数（path → count）。カバレッジの実測面。
     *  既知の限界: `state:watch-fired` / `state:token-emit` の payload はツリー識別を
     *  持たないため、複数ツリーが同名の watch パス / token 名を宣言するページでは
     *  実測が合算される（ツリー別に分けるにはプロトコル追補が要る — slice 29 記録）。 */
    private _watchFiredCounts;
    /** token emit 実測（kind + NUL + name → 回数と空撃ち回数）。上の限界注記と同じ。 */
    private _tokenEmitCounts;
    /** 観測開始以降に一度でも attach を観測した宣言キー（attachKeyOf）。
     *  live 配線台帳は WeakRef pruning / binding-removed で縮むため、binding
     *  カバレッジの attached 判定はこちらで行う（瞬間値で判定すると行の
     *  破棄・GC のたびに attached が never-attached へ逆戻りする）。 */
    private _everAttachedKeys;
    constructor(options?: IDevtoolsCoreOptions);
    get connected(): boolean;
    get paused(): boolean;
    set paused(value: boolean);
    connect(): void;
    /** 購読解除 + 台帳クリア（タイムラインは保持。protocol §7-2 の残留ゼロ） */
    disconnect(): void;
    /** 観測開始時刻（performance.now 基準。未接続は null）。 */
    get observingSince(): number | null;
    onChange(listener: CoreChangeListener): () => void;
    getSources(): IDevtoolsSourceLike[];
    getRoster(): IRosterEntry[];
    /** 全 source の state 要素一覧を pull で取り直す */
    refreshRoster(): void;
    getTimeline(): readonly ITimelineEntry[];
    clearTimeline(): void;
    /**
     * 指定パスに束縛された配線（生存している binding のみ）。
     * stateElement を渡すとそのツリーの配線だけに絞る（v2 は名前次元が無いため、
     * 複数ツリーの同名パスは要素同一性で区別する）。stateElement を持たない
     * 旧 payload 由来の entry は絞り込みでも残す（欠測を欠落にしない）。
     */
    getWiringForPath(path: string, stateElement?: unknown): IWiringEntry[];
    /** 全配線のスナップショット（生存している binding のみ） */
    getAllWiring(): IWiringEntry[];
    /** 指定ノード（またはその子孫のバインドノード）に載る配線 */
    getWiringForNode(node: Node): IWiringEntry[];
    /**
     * ランタイム正本パーサによる宣言バインディング集合（protocol v1 追補）。
     * getDeclaredBindings を実装した source が 1 つも無ければ null（消費側は
     * declaredScan の簡易パーサへフォールバックする）。root は roster の rootNode
     * を source ごとに重複排除して渡す。
     */
    getCanonicalDeclared(): IDeclaredBindingLike[] | null;
    /**
     * 配線カバレッジ（§4）: 宣言面（watchPaths / token 宣言 / canonical declared）と
     * 実測面（watch-fired・token-emit の台帳・live 配線台帳）の突合。
     * 「観測開始以降」の実測であることは observingSince を UI が常時表示して明示する。
     */
    getCoverageReport(): ICoverageEntry[];
    /** roster entry の state からトップレベルキーを列挙（keys 未実装ランタイムは空） */
    keysOf(entry: IRosterEntry): string[];
    readValue(entry: IRosterEntry, path: string, indexes?: number[]): unknown;
    writeValue(entry: IRosterEntry, path: string, value: unknown, indexes?: number[]): void;
    private _notify;
    private _refreshRosterOf;
    private _collectAlive;
    private _appendTimeline;
    private _labelOf;
    private _ingest;
}

/**
 * shell/WcsDevtools.ts
 *
 * `<wcs-devtools>` — ページ内オーバーレイ DevTools 本体（devtools-tag-design.md）。
 *
 * - ShadowRoot 内で完結（ページの CSS/DOM を変更しない）
 * - ハイライトはページ要素の style/class を触らず、fixed 配置の
 *   オーバーレイ枠で描く（devtools-tag-design.md §2）
 * - UI レンダリングは vanilla DOM（記録済み決定: inspected ランタイムの
 *   updater キューに devtools 描画負荷を混ぜない = 観測者効果の排除。
 *   wcs-state ドッグフーディングは Phase 2 で再評価）
 * - 描画は Core の change 通知を rAF で 1 回に合流（イベント毎 DOM 追加禁止、
 *   devtools-tag-design.md §3.3）
 */

declare class WcsDevtools extends HTMLElement {
    static get observedAttributes(): string[];
    private _core;
    private _removeCoreListener;
    private _panel;
    private _badge;
    private _stateSelect;
    private _paneElements;
    /** Wiring ペインの表示モード（配線一覧 / カバレッジ突合）。 */
    private _wiringView;
    private _highlightLayer;
    private _dirtyPanes;
    private _renderScheduled;
    private _selectedRosterKey;
    private _selectedPath;
    private _pickedNode;
    private _pickMode;
    private _expanded;
    private _hotkeyHandler;
    private _pickHandler;
    get core(): DevtoolsCore | null;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string): void;
    /** テスト用: rAF を待たずに保留中の描画を実行する */
    __flushRenderForTest(): void;
    private _buildShadow;
    private _headerButton;
    get open(): boolean;
    toggle(force?: boolean): void;
    private _applyOpen;
    private _applyDock;
    private _installHotkey;
    private _uninstallHotkey;
    private _enterPickMode;
    private _exitPickMode;
    private _markDirty;
    private _renderDirty;
    private _rosterKey;
    private _selectedRoster;
    private _renderStatePane;
    private _renderTreeNode;
    private _beginEdit;
    private _renderWiringPane;
    /**
     * カバレッジビュー: 宣言（watchPaths / token 宣言 / canonical declared）×
     * 実測（発火・emit・attach）の突合表。観測開始以降の実測であることを常時明示する
     * （protocol §6 — 台帳の過去は再構成できない）。
     */
    private _renderCoverageView;
    /** canonical declared（正本パーサ由来・宣言集合）の 1 行。 */
    private _canonicalDeclaredRow;
    private _scanRootOf;
    private _wiringRow;
    private _declaredRow;
    private _renderTimelinePane;
    private _timelineRow;
    private _emptyRow;
    private _highlightPath;
    private _highlightNodes;
}

/**
 * core/formatValue.ts
 *
 * 値フォーマッタ（devtools-tag-design.md §6）。
 *
 * 規範:
 * - primitive はそのまま（文字列は引用 + 80 文字上限）
 * - 配列 / plain object は深さ制限 + 要素数制限つきの要約
 * - それ以外（MediaStream, Blob, Element, class インスタンス等）は
 *   `[[ClassName]]` タグ表示のみ
 * - structuredClone / JSON.stringify を全値に無差別適用しない
 *   （生ハンドル・循環・巨大値対策。camera G1 との共存）
 */
/**
 * 任意の値を表示用の短い文字列へ変換する。
 * @param value 対象値
 * @param depth 再帰許容深さ（既定 2。0 で複合値は要約タグのみ）
 */
declare function formatValue(value: unknown, depth?: number): string;
/**
 * token 引数の要約（先頭 3 引数 × 各 80 文字上限、devtools-tag-design.md §6）。
 */
declare function formatArgs(args: readonly unknown[]): string;

/**
 * core/declaredScan.ts
 *
 * 遅延アタッチ時の declared ビュー（protocol §6）。
 *
 * binding 台帳はフック接続前の分を復元できないため、DOM に残っている
 * `data-wcs` 属性と `<!--wcs-*: -->` コメントを再スキャンして
 * 「宣言レベルの配線ビュー」を組む。ライブ台帳と違い binding 実体・
 * 接続状態は分からない（UI では "declared" バッジで区別する）。
 *
 * パースは表示目的の簡易版（`prop[#mod]: path[|filters]` を
 * `;` 区切りで分解するだけ）。正確なセマンティクスの正本は
 * @wcstack/state の bindTextParser であり、ここでは追随しない。
 */
interface IDeclaredBinding {
    /** 宣言が載っている要素（コメント由来の場合は親要素） */
    readonly element: Element;
    readonly propName: string;
    readonly path: string;
    readonly filters: readonly string[];
    /** 宣言ソース: data-wcs 属性か comment ノードか */
    readonly origin: "attribute" | "comment";
    readonly raw: string;
}
/**
 * rootNode 配下の宣言配線を列挙する。
 * @param root 走査起点（Document / ShadowRoot / Element）
 * @param bindAttributeName バインド属性名（既定 data-wcs。setConfig で変えたページ用）
 */
declare function scanDeclaredBindings(root: ParentNode, bindAttributeName?: string): IDeclaredBinding[];

/**
 * protocol/registry.ts
 *
 * registry 最小実装の devtools 側コピー（protocol §2）。
 * ロード順非依存にするため、ランタイム側（@wcstack/state の bridge）と
 * devtools 側の両方が同一仕様の最小実装を持ち、先にロードされた方が
 * globalThis に置く（先勝ち・振る舞い差し替えなし）。
 */

declare function getOrCreateHookRegistry(): IDevtoolsHookRegistryLike;

declare global {
    interface HTMLElementTagNameMap {
        "wcs-devtools": WcsDevtools;
    }
}

export { DEVTOOLS_HOOK_GLOBAL, DEVTOOLS_PROTOCOL_VERSION, DevtoolsCore, WcsDevtools, bootstrapDevtools, formatArgs, formatValue, getOrCreateHookRegistry, scanDeclaredBindings };
export type { CoreChangeKind, CoreChangeListener, DevtoolsEventLike, DevtoolsSinkLike, IAbsoluteAddressLike, IAbsolutePathInfoLike, IBindingLike, IDeclaredBinding, IDevtoolsCoreOptions, IDevtoolsHookRegistryLike, IDevtoolsListenerLike, IDevtoolsSourceLike, IListIndexLike, IPathInfoLike, IRosterEntry, IStateElementSummaryLike, ITimelineEntry, IWiringEntry, TimelineKind };
