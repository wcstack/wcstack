/**
 * platform-capability.ts
 *
 * Phase 6(docs/architecture-hardening/09-remediation-design.md §7.2 /
 * 07-browser-capability-variance.md)の browser capability 判定と error taxonomy の
 * 汎用プリミティブ。node 固有の capability registry / error code は各パッケージが
 * 別ファイルで宣言し、この汎用層(型 + assess 機構)を import する。
 *
 * 原則:
 * - feature detection は境界(利用直前)で行う。module 評価時に browser global を
 *   参照しない(SSR / worker で import が失敗しない)。
 * - capability ID(`web.fetch` 等)は文字列を global property path として eval せず、
 *   registry が ID ごとに副作用のない presence probe を対応付ける。
 * - availability / permission / readiness / activity / operation error を 1 つの
 *   `ready / unsupported / error` enum に畳まない。required 欠如は開始しない、
 *   optional 欠如は宣言済み fallback で readiness を `degraded` にする。
 *
 * 配置: 本ファイルは /io-core/ の単一正典であり、scripts/sync-io-core.mjs が
 * 各 IO ノードの src/core/ へ生成コピー (AUTO-GENERATED, 編集禁止) を配布する。
 * `protocol/wcBindable.ts` と同じ copy-distribution 方式で、ランタイム依存を導入せず
 * 各パッケージのバンドルへ inline される (zero-runtime-dep / 自己完結 CDN を維持)。
 * 編集はこの正典に対して行い、`node scripts/sync-io-core.mjs` で再配布する。
 *
 * pure(module 評価時に browser global 非参照)。
 */
type Availability = "available" | "missing" | "unknown";
type PermissionState = "granted" | "denied" | "prompt" | "not-applicable" | "unknown";
type Readiness = "idle" | "ready" | "degraded";
type Activity = "inactive" | "active";
type PreconditionState = "satisfied" | "required" | "not-applicable";
/** operation error の phase(taxonomy)。 */
type WcsIoErrorPhase = "probe" | "start" | "execute" | "decode" | "commit" | "dispose";
/** serializable な error info(non-cloneable な cause とは分離。DevTools / remote へは info のみ)。 */
interface WcsIoErrorInfo {
    readonly code: string;
    readonly phase: WcsIoErrorPhase;
    readonly recoverable: boolean;
    readonly capabilityId?: string;
    readonly message: string;
}
interface PlatformAssessment {
    readonly availability: ReadonlyMap<string, Availability>;
    readonly permission: PermissionState;
    readonly readiness: Readiness;
    readonly activity: Activity;
    readonly preconditions: {
        readonly secureContext: PreconditionState;
        readonly userActivation: PreconditionState;
    };
    readonly epoch: number;
    readonly lastError?: WcsIoErrorInfo;
}

interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
}
interface IWcBindableInput {
    readonly name: string;
    readonly attribute?: string;
}
interface IWcBindableCommand {
    readonly name: string;
    readonly async?: boolean;
}
interface IWcBindable {
    readonly protocol: "wc-bindable";
    /** Integer protocol version. All versions >= 1 are core-compatible. */
    readonly version: number;
    readonly properties: readonly IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

interface ITagNames {
    readonly share: string;
}
interface IWritableTagNames {
    share?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * The data object passed to `navigator.share(data)` / `navigator.canShare(data)`.
 * All fields are optional per the Web Share API; a caller typically supplies a
 * subset (e.g. just `url`, or `title` + `text` + `url`, or `files`).
 */
interface WcsShareData {
    title?: string;
    text?: string;
    url?: string;
    files?: File[];
}
/**
 * Value types for ShareCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new ShareCore();
 * bind(core, (name: keyof WcsShareCoreValues, value) => { ... });
 * ```
 */
interface WcsShareCoreValues {
    /**
     * The success signal: an echo of the `data` object passed to the `share()`
     * call that just completed successfully (navigator.share() itself resolves
     * `Promise<void>`, so `value` is synthesized rather than read off the API —
     * see docs/web-share-tag-design.md §4). `null` before any successful share.
     */
    value: WcsShareData | null;
    loading: boolean;
    /**
     * A true platform failure (anything other than the user cancelling the
     * share sheet). `null` when there has been no failure yet or after a reset.
     */
    error: any;
    /**
     * `true` when the user dismissed the share sheet (AbortError). Kept
     * separate from `error` so a binding gated on `error` does not react to a
     * routine cancellation (docs/web-share-tag-design.md §3).
     */
    cancelled: boolean;
    /** Last failure's serializable taxonomy (stable code/phase/recoverable), or null. */
    errorInfo: WcsIoErrorInfo | null;
}
/**
 * Value types for the Shell (`<wcs-share>`) — identical observable surface to
 * the Core. The Shell adds no inputs: `share(data)`'s `data` is a per-call
 * argument, not a declarative attribute (docs/web-share-tag-design.md §10).
 */
type WcsShareValues = WcsShareCoreValues;

declare function bootstrapShare(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Web Share primitive. A thin, framework-agnostic wrapper around
 * `navigator.share(data)` exposed through the wc-bindable protocol.
 *
 * Concurrency is owned by the shared `OperationLane` (io-core) with the `exhaust`
 * policy: a share dialog is a single system-modal surface, so while one share() is
 * in flight a new call is rejected as an idempotent no-op instead of starting a
 * second `navigator.share()`. This replaces the earlier dispose-only `_gen` guard,
 * which relied on the platform rejecting the second call with `InvalidStateError`
 * — but that let the rejected second call reset/overwrite the still-pending first
 * call's `error`/`loading` state. The lane's owner generation still invalidates any
 * in-flight share() on dispose() (a late resolve fails the commit guard).
 *
 * `navigator.share()` accepts no `AbortSignal` and there is no platform mechanism
 * to cancel an in-flight share dialog, so the lane runs with `withSignal: false`.
 */
declare class ShareCore extends EventTarget {
    static wcBindable: IWcBindable;
    private static readonly REQUIRED_CAPABILITIES;
    private _target;
    private _value;
    private _loading;
    private _error;
    private _cancelled;
    private _errorInfo;
    private _lane;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get value(): WcsShareData | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable` / `capabilityId`), or null. Exposed as an additive wc-bindable
     * property (event `wcs-share:error-info-changed`); the existing `error`
     * property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    /**
     * Whether the required platform capability (`web.share`) is available right now —
     * decided by call-time feature detection, not User-Agent. Core-only, additive.
     */
    get supported(): boolean;
    /**
     * Full platform assessment (availability / readiness / preconditions), probed at
     * call time. Core-only opt-in dev / sidecar view.
     */
    get platformAssessment(): PlatformAssessment;
    observe(): Promise<void>;
    dispose(): void;
    private _setLoading;
    private _setValue;
    private _setError;
    private _setCancelled;
    private _setErrorInfo;
    private _commitErrorInfo;
    share(data?: WcsShareData): Promise<WcsShareData | null>;
}

/**
 * `<wcs-share>` — declarative Web Share API primitive.
 *
 * The smallest command-only Shell in the batch (docs/web-share-tag-design.md
 * §10): no attributes at all. `share(data)`'s `data` is a per-call argument,
 * not a declarative setting to park on the element ahead of time.
 */
declare class WcsShare extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get value(): WcsShareData | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    get errorInfo(): WcsIoErrorInfo | null;
    get connectedCallbackPromise(): Promise<void>;
    share(data?: WcsShareData): Promise<WcsShareData | null>;
    /**
     * Synchronous, side-effect-free delegation to `navigator.canShare(data)`
     * (docs/web-share-tag-design.md §6). Deliberately outside `wcBindable`
     * (not a `properties`/`commands` entry): the platform method takes an
     * argument that varies per call, which does not fit the "observe with no
     * arguments" shape of a bindable property, and is synchronous, which does
     * not fit the fire-and-observe-via-event shape of a command.
     *
     * No never-throw wrapping: the platform method itself is synchronous and
     * side-effect-free, so a throw here would indicate a browser bug rather
     * than a condition this Shell should paper over. `navigator.canShare` is
     * still resolved defensively (some environments lack it even when `share`
     * exists), returning `false` rather than throwing in that case.
     */
    canShare(data?: WcsShareData): boolean;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * shareCapabilities.ts
 *
 * Web Share node 固有の capability registry と error code。汎用の assess 機構・型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは分離する。
 */

/** 安定した share error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_SHARE_ERROR_CODE: {
    readonly CapabilityMissing: "capability-missing";
    readonly ShareFailed: "share-failed";
};

export { ShareCore, WCS_SHARE_ERROR_CODE, WcsShare, bootstrapShare, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsIoErrorInfo, WcsIoErrorPhase, WcsShareCoreValues, WcsShareData, WcsShareValues };
