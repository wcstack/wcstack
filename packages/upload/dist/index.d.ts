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
    readonly upload: string;
}
interface IWritableTagNames {
    upload?: string;
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
 * Upload error object.
 */
interface WcsUploadError {
    status?: number;
    statusText?: string;
    body?: string;
    message?: string;
}
/**
 * Value types for UploadCore (headless) — the async state properties.
 */
interface WcsUploadCoreValues<T = unknown> {
    value: T;
    loading: boolean;
    progress: number;
    error: WcsUploadError | Error | null;
    status: number;
    /** Last failure's serializable taxonomy (stable code/phase/recoverable), or null. */
    errorInfo: WcsIoErrorInfo | null;
}
/**
 * Value types for the Shell (`<wcs-upload>`) — extends Core with `trigger` and `files`.
 *
 * `trigger` is a write-only command surface declared as an observable property mapped to
 * `wcs-upload:trigger-changed`. Only the `false` reset (after an upload settles) is
 * observable — the `true` transition (upload start) is intentionally NOT notified. This is
 * the same pub/sub trade-off as `@wcstack/fetch`'s `trigger`: a binding system writes `true`
 * to start and observes the single `false` edge to know the command has completed.
 */
interface WcsUploadValues<T = unknown> extends WcsUploadCoreValues<T> {
    trigger: boolean;
    files: FileList | File[] | null;
}

declare function bootstrapUpload(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

interface UploadRequestOptions {
    method?: string;
    headers?: Record<string, string>;
    fieldName?: string;
}
declare class UploadCore extends EventTarget {
    static wcBindable: IWcBindable;
    private static readonly REQUIRED_CAPABILITIES;
    private _target;
    private _value;
    private _loading;
    private _progress;
    private _error;
    private _status;
    private _errorInfo;
    private _xhr;
    private _promise;
    private _lane;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    observe(): Promise<void>;
    dispose(): void;
    get value(): any;
    get loading(): boolean;
    get progress(): number;
    get error(): any;
    get status(): number;
    get promise(): Promise<any>;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable` / `capabilityId`), or null. Exposed as an additive wc-bindable
     * property (event `wcs-upload:error-info-changed`); the existing `error`
     * property/event are unchanged. An abort() is not a failure (no errorInfo).
     */
    get errorInfo(): WcsIoErrorInfo | null;
    /**
     * Whether the required platform capability (`web.xhr`) is available right now —
     * decided by call-time feature detection, not User-Agent. Core-only, additive.
     */
    get supported(): boolean;
    /**
     * Full platform assessment (availability / readiness / preconditions), probed at
     * call time. Core-only opt-in dev / sidecar view.
     */
    get platformAssessment(): PlatformAssessment;
    private _commitStep;
    private _setLoading;
    private _setProgress;
    private _setError;
    setError(error: any): void;
    private _setResponse;
    private _setErrorInfo;
    private _commitErrorInfo;
    abort(): void;
    upload(url: string, files: FileList | File[], options?: UploadRequestOptions): Promise<any>;
    private _doUpload;
}

declare class WcsUpload extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    static get observedAttributes(): string[];
    private _core;
    private _files;
    private _trigger;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get connectedCallbackPromise(): Promise<void>;
    get url(): string;
    set url(value: string);
    get method(): string;
    set method(value: string);
    get fieldName(): string;
    set fieldName(value: string);
    get multiple(): boolean;
    set multiple(value: boolean);
    get maxSize(): number;
    set maxSize(value: number);
    get accept(): string;
    set accept(value: string);
    get manual(): boolean;
    set manual(value: boolean);
    get value(): any;
    get loading(): boolean;
    get progress(): number;
    get error(): any;
    get status(): number;
    get errorInfo(): WcsIoErrorInfo | null;
    get promise(): Promise<any>;
    get trigger(): boolean;
    set trigger(value: boolean);
    get files(): FileList | File[] | null;
    set files(value: FileList | File[] | null);
    private _validate;
    abort(): void;
    upload(): Promise<any>;
    attributeChangedCallback(_name: string, _oldValue: string | null, _newValue: string | null): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * uploadCapabilities.ts
 *
 * Upload node 固有の capability registry と error code。汎用の assess 機構・型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは分離する。
 */

/** 安定した upload error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_UPLOAD_ERROR_CODE: {
    readonly CapabilityMissing: "capability-missing";
    readonly InvalidArgument: "invalid-argument";
    readonly Network: "network";
    readonly HttpError: "http-error";
};

export { UploadCore, WCS_UPLOAD_ERROR_CODE, WcsUpload, bootstrapUpload, getConfig };
export type { IWritableConfig, IWritableTagNames, UploadRequestOptions, WcsIoErrorInfo, WcsIoErrorPhase, WcsUploadCoreValues, WcsUploadError, WcsUploadValues };
