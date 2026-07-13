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
declare const DEVTOOLS_PROTOCOL_VERSION = 1;
interface IPathInfoLike {
    readonly path: string;
}
interface IAbsolutePathInfoLike {
    readonly stateName: string;
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
    readonly stateName: string;
    readonly bindingType: string;
    readonly node: Node;
    readonly replaceNode: Node;
}
interface IStateElementSummaryLike {
    readonly name: string;
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
}
type DevtoolsEventLike = {
    readonly type: "state:element-registered";
    readonly name: string;
    readonly rootNode: Node;
    readonly element: unknown;
} | {
    readonly type: "state:element-unregistered";
    readonly name: string;
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
    readonly stateName: string | null;
    readonly tokenName: string;
    readonly args: readonly unknown[];
    readonly subscriberCount: number;
};
type DevtoolsSinkLike = (event: DevtoolsEventLike) => void;
interface IDevtoolsSourceLike {
    readonly id: string;
    readonly kind: string;
    readonly packageVersion: string;
    getStateElements(): IStateElementSummaryLike[];
    /** protocol v1 追補 API。古いランタイムには無い可能性があるため optional 扱いで呼ぶ */
    keys?(name: string, rootNode: Node): string[];
    read(name: string, rootNode: Node, path: string, indexes?: number[]): unknown;
    write(name: string, rootNode: Node, path: string, value: unknown, indexes?: number[]): void;
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

/** 予約 state 名 prefix（protocol §5）。この prefix の要素・イベントは常に除外 */
declare const RESERVED_STATE_NAME_PREFIX = "wcs-devtools";
type TimelineKind = "write" | "batch" | "command" | "event" | "element-registered" | "element-unregistered";
interface ITimelineEntry {
    readonly seq: number;
    readonly time: number;
    readonly sourceId: string;
    readonly kind: TimelineKind;
    readonly stateName: string | null;
    readonly label: string;
    readonly detail: string;
    readonly subscriberCount: number | null;
}
interface IRosterEntry {
    readonly sourceId: string;
    readonly name: string;
    readonly rootNode: Node;
    readonly summary: IStateElementSummaryLike;
}
interface IWiringEntry {
    readonly sourceId: string;
    readonly stateName: string;
    readonly path: string;
    readonly propName: string;
    readonly bindingType: string;
    readonly bindingRef: WeakRef<IBindingLike>;
}
type CoreChangeKind = "sources" | "roster" | "wiring" | "timeline";
type CoreChangeListener = (kind: CoreChangeKind) => void;
interface IDevtoolsCoreOptions {
    /** タイムライン ring buffer 件数（既定 500） */
    timelineCapacity?: number;
    /** 追加で除外する state 名（予約 prefix は常に除外） */
    hiddenStateNames?: readonly string[];
}
declare class DevtoolsCore {
    private _timelineCapacity;
    private _hiddenStateNames;
    private _removeListener;
    private _sources;
    private _roster;
    private _wiringByPathKey;
    private _wiringEntryByBinding;
    private _timeline;
    private _seq;
    private _paused;
    private _changeListeners;
    constructor(options?: IDevtoolsCoreOptions);
    get connected(): boolean;
    get paused(): boolean;
    set paused(value: boolean);
    /** 表示から除外する state 名か（予約 prefix + hiddenStateNames、protocol §5） */
    isHiddenStateName(name: string | null): boolean;
    connect(): void;
    /** 購読解除 + 台帳クリア（タイムラインは保持。protocol §7-2 の残留ゼロ） */
    disconnect(): void;
    onChange(listener: CoreChangeListener): () => void;
    getSources(): IDevtoolsSourceLike[];
    getRoster(): IRosterEntry[];
    /** 全 source の state 要素一覧を pull で取り直す */
    refreshRoster(): void;
    getTimeline(): readonly ITimelineEntry[];
    clearTimeline(): void;
    /** 指定パスに束縛された配線（生存している binding のみ） */
    getWiringForPath(stateName: string, path: string): IWiringEntry[];
    /** 全配線のスナップショット（生存している binding のみ） */
    getAllWiring(): IWiringEntry[];
    /** 指定ノード（またはその子孫のバインドノード）に載る配線 */
    getWiringForNode(node: Node): IWiringEntry[];
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
 * パースは表示目的の簡易版（`prop[#mod]: path[@state][|filters]` を
 * `;` 区切りで分解するだけ）。正確なセマンティクスの正本は
 * @wcstack/state の bindTextParser であり、ここでは追随しない。
 */
interface IDeclaredBinding {
    /** 宣言が載っている要素（コメント由来の場合は親要素） */
    readonly element: Element;
    readonly propName: string;
    readonly path: string;
    readonly stateName: string;
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

export { DEVTOOLS_HOOK_GLOBAL, DEVTOOLS_PROTOCOL_VERSION, DevtoolsCore, RESERVED_STATE_NAME_PREFIX, WcsDevtools, bootstrapDevtools, formatArgs, formatValue, getOrCreateHookRegistry, scanDeclaredBindings };
export type { CoreChangeKind, CoreChangeListener, DevtoolsEventLike, DevtoolsSinkLike, IAbsoluteAddressLike, IAbsolutePathInfoLike, IBindingLike, IDeclaredBinding, IDevtoolsCoreOptions, IDevtoolsHookRegistryLike, IDevtoolsListenerLike, IDevtoolsSourceLike, IListIndexLike, IPathInfoLike, IRosterEntry, IStateElementSummaryLike, ITimelineEntry, IWiringEntry, TimelineKind };
