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
    readonly fetch: string;
    readonly fetchHeader: string;
    readonly fetchBody: string;
    readonly infiniteScroll: string;
}
interface IWritableTagNames {
    fetch?: string;
    fetchHeader?: string;
    fetchBody?: string;
    infiniteScroll?: string;
}
interface IConfig {
    readonly autoTrigger: boolean;
    readonly triggerAttribute: string;
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    autoTrigger?: boolean;
    triggerAttribute?: string;
    tagNames?: IWritableTagNames;
}

/**
 * HTTP error returned when the server responds with a non-ok status (>= 400).
 */
interface WcsFetchHttpError {
    status: number;
    statusText: string;
    body: string;
}
/**
 * Value types for FetchCore (headless) — the 6 async state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * interface User { id: number; name: string; }
 * const core = new FetchCore();
 * bind(core, (name: keyof WcsFetchCoreValues<User>, value) => { ... });
 * ```
 */
interface WcsFetchCoreValues<T = unknown> {
    value: T;
    loading: boolean;
    error: WcsFetchHttpError | Error | null;
    status: number;
    /** Managed object URL for a `responseType: "blob"` response; null otherwise. */
    objectURL: string | null;
    /** Last failure's serializable taxonomy (stable code/phase/recoverable), or null. */
    errorInfo: WcsIoErrorInfo | null;
}
/**
 * Value types for the Shell (`<wcs-fetch>`) — extends Core with `trigger`.
 * Use with framework adapters for compile-time type checking.
 *
 * @example
 * ```tsx
 * // React
 * interface User { id: number; name: string; }
 * const [ref, values] = useWcBindable<HTMLElement, WcsFetchValues<User>>();
 * values.value   // User
 * values.loading // boolean
 * ```
 */
interface WcsFetchValues<T = unknown> extends WcsFetchCoreValues<T> {
    trigger: boolean;
}

declare function bootstrapFetch(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

type FetchResponseType = "auto" | "json" | "text" | "blob" | "arrayBuffer";
interface FetchRequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    contentType?: string | null;
    forceText?: boolean;
    responseType?: FetchResponseType;
    timeout?: number;
}
declare class FetchCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _value;
    private _loading;
    private _error;
    private _status;
    private _objectURL;
    private _promise;
    private _lane;
    private _ready;
    private _errorInfo;
    private static readonly REQUIRED_CAPABILITIES;
    private static readonly OPTIONAL_CAPABILITIES;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    observe(): Promise<void>;
    dispose(): void;
    get value(): any;
    get loading(): boolean;
    get error(): any;
    get status(): number;
    get objectURL(): string | null;
    get promise(): Promise<any>;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable` / `capabilityId`), or null. Exposed as an additive wc-bindable
     * property (event `wcs-fetch:error-info-changed`); the existing `error`
     * property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    /**
     * Whether the required platform capabilities (`web.fetch`) are available right
     * now — the minimal "supported" signal, decided by call-time feature detection,
     * not User-Agent. Additive.
     */
    get supported(): boolean;
    /**
     * Full platform assessment (availability / readiness / preconditions), probed
     * at call time. `readiness` is `degraded` when only the optional
     * `web.abort-controller` is missing. Dev / sidecar view.
     */
    get platformAssessment(): PlatformAssessment;
    private _setErrorInfo;
    private _commitErrorInfo;
    private _setLoading;
    private _setError;
    private _setResponse;
    private _createObjectURL;
    private _revokeObjectURL;
    abort(): void;
    private _commitStep;
    fetch(url: string, options?: FetchRequestOptions): Promise<any>;
    private _doFetch;
}

declare class Fetch extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    static get observedAttributes(): string[];
    private _core;
    private _body;
    private _trigger;
    private _connectedCallbackPromise;
    private _autoPending;
    private _connectResolve;
    private _lastFetchedUrl;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get url(): string;
    set url(value: string | null);
    get method(): string;
    set method(value: string | null);
    get target(): string | null;
    set target(value: string | null);
    get responseType(): FetchResponseType;
    set responseType(value: string | null);
    get value(): any;
    get loading(): boolean;
    get error(): any;
    get status(): number;
    get objectURL(): string | null;
    get errorInfo(): WcsIoErrorInfo | null;
    get promise(): Promise<any>;
    get connectedCallbackPromise(): Promise<void>;
    get manual(): boolean;
    set manual(value: boolean);
    get body(): any;
    set body(value: any);
    get trigger(): boolean;
    set trigger(value: boolean);
    private _collectHeaders;
    private _isNativeBodyInit;
    private _collectBody;
    abort(): void;
    /**
     * Coalesce auto-fetch requests in the current task into a single microtask.
     *
     * Multiple synchronous input writes in the same tick — e.g. a `...` spread
     * writing `url` before `manual` — collapse into one decision made against the
     * FINAL element state, so the spread application order can no longer trigger a
     * stray fetch. The microtask re-reads `isConnected` / `manual` / `url` at fire
     * time; whatever was written last wins.
     *
     * Only the implicit auto-fetch (url attribute change, connect-time) is routed
     * here. Explicit triggers — the `trigger` setter, the `fetch` command, and
     * autoTrigger (data-fetchtarget clicks) — must fire immediately and stay on
     * their own synchronous paths.
     *
     * The connect-time promise (connectedCallbackPromise) is resolved here in
     * EVERY exit path, including the no-fetch branch, so awaiting it never hangs
     * when the final state turns out to be manual / url-less / disconnected.
     */
    private _scheduleAutoFetch;
    fetch(): Promise<any>;
    attributeChangedCallback(name: string, _oldValue: string | null, _newValue: string | null): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

declare class InfiniteScroll extends HTMLElement {
    static get observedAttributes(): string[];
    private _observer;
    private _done;
    get target(): string;
    set target(value: string);
    get root(): string | null;
    set root(value: string | null);
    get rootMargin(): string;
    set rootMargin(value: string);
    get threshold(): number;
    set threshold(value: number);
    get disabled(): boolean;
    set disabled(value: boolean);
    get once(): boolean;
    set once(value: boolean);
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(): void;
    private _observe;
    private _disconnectObserver;
    private _resolveRoot;
    private _triggerFetch;
}

/**
 * fetchCapabilities.ts
 *
 * fetch node 固有の capability registry と error code。汎用の assess 機構・型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは分離する。
 */

/** 安定した fetch error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_FETCH_ERROR_CODE: {
    readonly CapabilityMissing: "capability-missing";
    readonly InvalidArgument: "invalid-argument";
    readonly Network: "network";
    readonly HttpError: "http-error";
    readonly Timeout: "timeout";
    readonly Aborted: "aborted";
};

export { FetchCore, WCS_FETCH_ERROR_CODE, Fetch as WcsFetch, InfiniteScroll as WcsInfiniteScroll, bootstrapFetch, getConfig };
export type { FetchRequestOptions, IWritableConfig, IWritableTagNames, WcsFetchCoreValues, WcsFetchHttpError, WcsFetchValues, WcsIoErrorInfo, WcsIoErrorPhase };
