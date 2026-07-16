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
    readonly eyedropper: string;
}
interface IWritableTagNames {
    eyedropper?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * The result of a successful `new EyeDropper().open()` call — the platform's
 * own return shape, used verbatim (no synthesis needed, unlike
 * `@wcstack/share`'s `value`; see docs/eyedropper-tag-design.md §3).
 */
interface WcsEyedropperData {
    sRGBHex: string;
}
/**
 * Value types for EyedropperCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new EyedropperCore();
 * bind(core, (name: keyof WcsEyedropperCoreValues, value) => { ... });
 * ```
 */
interface WcsEyedropperCoreValues {
    value: WcsEyedropperData | null;
    loading: boolean;
    error: any;
    cancelled: boolean;
    errorInfo: WcsIoErrorInfo | null;
}
/**
 * Value types for the Shell (`<wcs-eyedropper>`) — identical observable
 * surface to the Core. The Shell adds no inputs: `open()` takes no per-call
 * argument (docs/eyedropper-tag-design.md §5).
 */
type WcsEyedropperValues = WcsEyedropperCoreValues;

declare function bootstrapEyedropper(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless EyeDropper primitive. A thin, framework-agnostic wrapper around
 * `new EyeDropper().open(options)` exposed through the wc-bindable protocol.
 *
 * Concurrency is owned by the shared `OperationLane` (io-core) with the `latest`
 * policy: `EyeDropper.open()` accepts a `{signal}`, so — unlike Web Share / Contact
 * Picker (exhaust) — a caller has a real platform mechanism to cancel an in-flight
 * pick. A new `open()` supersedes the previous one (the lane aborts its
 * AbortController and the superseded completion fails the terminal CAS), and the
 * `abort()` command aborts the active pick. This replaces the ad-hoc `_gen` +
 * `_abortController` + finally-block identity check with the same lane FetchCore
 * uses; the lane owns the per-attempt AbortController and the commit guard.
 *
 * Both the user dismissing the picker with Escape and the caller invoking
 * `abort()` reject `open()` with the same `AbortError` — both land on `cancelled`
 * without distinction (docs/eyedropper-tag-design.md §2).
 */
declare class EyedropperCore extends EventTarget {
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
    get value(): WcsEyedropperData | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable` / `capabilityId`), or null. Exposed as an additive wc-bindable
     * property (event `wcs-eyedropper:error-info-changed`); the existing `error`
     * property/event are unchanged. Note user/abort cancellation is `cancelled`, not
     * `errorInfo`.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    /**
     * Whether the required platform capability (`web.eyedropper`) is available right
     * now — decided by call-time feature detection, not User-Agent. Core-only,
     * additive.
     */
    get supported(): boolean;
    /**
     * Full platform assessment (availability / readiness / preconditions), probed at
     * call time. Core-only opt-in dev / sidecar view.
     */
    get platformAssessment(): PlatformAssessment;
    observe(): Promise<void>;
    dispose(): void;
    private _commitStep;
    private _setLoading;
    private _setValue;
    private _setError;
    private _setCancelled;
    private _setErrorInfo;
    private _commitErrorInfo;
    /**
     * Cancels an in-flight `open()` call, if any (a no-op otherwise). Aborts the
     * lane's active AbortController — the in-flight open() then rejects with
     * `AbortError` and lands on `cancelled`. The epoch is not advanced, so the
     * aborted operation keeps eligibility to claim the `aborted` terminal.
     */
    abort(): void;
    open(): Promise<WcsEyedropperData | null>;
}

/**
 * `<wcs-eyedropper>` — declarative EyeDropper API primitive.
 *
 * The smallest command-only Shell in the batch (docs/eyedropper-tag-design.md
 * §5), mirroring `<wcs-share>`: no attributes at all. `open()` takes no
 * per-call argument — the `{signal}` option is supplied internally by the
 * Core's own AbortController, never via the command-token surface.
 */
declare class WcsEyedropper extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get value(): WcsEyedropperData | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    get errorInfo(): WcsIoErrorInfo | null;
    get connectedCallbackPromise(): Promise<void>;
    open(): Promise<WcsEyedropperData | null>;
    abort(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * eyedropperCapabilities.ts
 *
 * EyeDropper node 固有の capability registry と error code。汎用の assess 機構・型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは分離する。
 */

/** 安定した eyedropper error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_EYEDROPPER_ERROR_CODE: {
    readonly CapabilityMissing: "capability-missing";
    readonly PickFailed: "pick-failed";
};

export { EyedropperCore, WCS_EYEDROPPER_ERROR_CODE, WcsEyedropper, bootstrapEyedropper, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsEyedropperCoreValues, WcsEyedropperData, WcsEyedropperValues, WcsIoErrorInfo, WcsIoErrorPhase };
