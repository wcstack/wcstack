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

/**
 * Observation semantics of a `properties` entry.
 *
 *   "state"  — current value. A snapshot may cache it, and equality-based dedupe is safe.
 *   "event"  — occurrence. Repeated identical payloads are distinct occurrences; never dedupe.
 *   "handle" — live / opaque resource with its own lifecycle (e.g. MediaStream). Not
 *              snapshot-safe and not necessarily serializable; consumers need an explicit
 *              ref / callback surface rather than a value slot.
 */
type WcBindableSemantics = "state" | "event" | "handle";
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
    /**
     * Optional, additive, forward-compatible. An absent value means **unspecified**, NOT
     * "state": a reader that finds no `semantics` MUST keep the behavior it had before this
     * field existed (deliver the update as-is; do not start deduping, caching or serializing
     * on assumption). Only an explicit value licenses a reader to change its handling.
     */
    readonly semantics?: WcBindableSemantics;
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
    readonly credential: string;
}
interface IWritableTagNames {
    credential?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * v1 scope: password/federated credentials only (docs/credential-tag-design.md
 * §0). `publicKey` (WebAuthn) is a much larger surface — attestation,
 * authenticator selection, platform vs cross-platform, RP configuration —
 * that deserves its own dedicated node in a future batch. This Core validates
 * and strips a `publicKey` key if a caller passes one, rather than silently
 * forwarding it (which would accidentally support WebAuthn through a side
 * door this package explicitly does not claim to support).
 */
interface CredentialGetOptions {
    password?: boolean;
    federated?: {
        providers?: string[];
        protocols?: string[];
    };
    mediation?: "silent" | "optional" | "required";
    signal?: AbortSignal;
}
/** A password or federated credential, as accepted by `navigator.credentials.store()`. */
type StorableCredential = Credential;
/**
 * A password credential as plain data, for `store()`: when the argument is not a
 * `Credential` instance and has a string `id` and `password`, the element builds
 * `new PasswordCredential(...)` from it (only the members given) and stores that.
 * Lets a state method pass `{ id, password }` without touching a browser class
 * that exists in Chromium only.
 */
interface WcsPasswordCredentialData {
    id: string;
    password: string;
    name?: string;
    iconURL?: string;
}
/**
 * Value types for CredentialCore (headless) — the observable state properties.
 */
interface WcsCredentialCoreValues {
    value: Credential | null;
    loading: boolean;
    error: any;
    cancelled: boolean;
    errorInfo: WcsIoErrorInfo | null;
    supported: boolean;
}
/**
 * Value types for the Shell (`<wcs-credential>`) — identical observable
 * surface to the Core.
 */
type WcsCredentialValues = WcsCredentialCoreValues;

declare function bootstrapCredential(userConfig?: IWritableConfig, registry?: CustomElementRegistry): void;

declare function getConfig(): IConfig;

/**
 * Headless Credential Management primitive. A thin, framework-agnostic wrapper
 * around `navigator.credentials.get()`/`.store()` exposed through the wc-bindable
 * protocol.
 *
 * Concurrency is owned by the shared `OperationLane` (io-core) with the `latest`
 * policy — **`get()` and `store()` share one lane**. A later call supersedes the
 * earlier one (the earlier completion fails the terminal CAS), preserving the v1
 * "single generation" behavior (docs/multi-promise-io-node-design.md): these two
 * operations are used sequentially in real auth flows (store after login, get
 * before one), not naturally concurrently on the same instance. If both ARE
 * invoked concurrently, the later call's result wins; use two separate
 * `<wcs-credential>` instances if that bites. The lane runs with
 * `withSignal: false` — the Credential Management API takes no `AbortSignal`;
 * dispose() invalidates any in-flight call via the owner generation.
 *
 * **v1 scope excludes WebAuthn (`publicKey`)** (docs/credential-tag-design.md §0):
 * `get()` validates+strips a `publicKey` option and `store()` rejects a
 * `PublicKeyCredential`, surfacing the attempt as a scope-violation `error`
 * (`errorInfo.code === "out-of-scope"`) rather than a WebAuthn backdoor.
 *
 * Note the cancellation signal is **`NotAllowedError`, NOT `AbortError`**: unlike
 * Web Share / Contact Picker, `credentials.get()/store()` reject with
 * `NotAllowedError` when the user dismisses the native chooser. That maps to
 * `cancelled`; every other name flows to `error`/`errorInfo`.
 *
 * **Password credentials are Chromium only.** Firefox and Safari have
 * `navigator.credentials` (for WebAuthn) and no `PasswordCredential`. A `get()` that
 * asks for `password` / `federated`, and every `store()`, is refused there as
 * `capability-missing` without calling the browser, and `supported` is false.
 * `preventSilentAccess()` (sign-out) is not on the lane and does nothing where the
 * method is missing.
 */
declare class CredentialCore extends EventTarget {
    static wcBindable: IWcBindable;
    private static readonly CONTAINER_CAPABILITY;
    private static readonly PASSWORD_CAPABILITY;
    private static readonly REQUIRED_CAPABILITIES;
    private _target;
    private _value;
    private _loading;
    private _error;
    private _cancelled;
    private _errorInfo;
    private _supportedPublished;
    private _lane;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get value(): Credential | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable` / `capabilityId`), or null. Exposed as an additive wc-bindable
     * property (event `wcs-credential:error-info-changed`); the existing `error`
     * property/event are unchanged. A `NotAllowedError` user cancellation is
     * `cancelled`, not `errorInfo`.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    /**
     * Whether this page can use password credentials right now: `navigator.credentials`
     * is there **and** `PasswordCredential` is a class — decided by call-time feature
     * detection, not User-Agent. False in Firefox and Safari, which have the container
     * (for WebAuthn) and no `PasswordCredential`. It does not say a credential is
     * saved, or that the user will choose one. A wc-bindable output (event
     * `wcs-credential:supported-changed`).
     */
    get supported(): boolean;
    /**
     * Full platform assessment (availability / readiness / preconditions), probed at
     * call time. Core-only opt-in dev / sidecar view. Both capabilities are required:
     * without `PasswordCredential` the readiness is "idle".
     */
    get platformAssessment(): PlatformAssessment;
    observe(): Promise<void>;
    dispose(): void;
    private _commitStep;
    private _publishSupported;
    private _setLoading;
    private _setValue;
    private _setError;
    private _setCancelled;
    private _setErrorInfo;
    private _commitErrorInfo;
    private _normalizeError;
    private _isCancellation;
    private _run;
    private _capabilitiesPresent;
    /**
     * `get(options)` — v1 scope excludes `publicKey` (WebAuthn). If present, it is
     * stripped and the call surfaces a scope-violation `error` instead of forwarding
     * it to the platform API. `navigator.credentials.get()` does not require a user
     * gesture, so this can be invoked automatically on page load for silent sign-in.
     * Options that ask for `password` or `federated` need the `PasswordCredential`
     * class; without it the call ends as `capability-missing` and the browser is not
     * asked. Anything that is not an object (`null`, `undefined`) asks for nothing.
     */
    get(options?: (CredentialGetOptions & {
        publicKey?: unknown;
    }) | null): Promise<Credential | null>;
    /**
     * `store(credential)` — shares the same single lane as `get()`.
     * `navigator.credentials.store()` resolves `Promise<void>`, so `value` is
     * synthesized as an echo of the credential stored. A `PublicKeyCredential`
     * (`type === "public-key"`, WebAuthn) is rejected as a scope violation before
     * touching the platform API. A plain `{ id, password, name?, iconURL? }` is made
     * into a `PasswordCredential` first; a `Credential` instance is stored as it is.
     * Needs the `PasswordCredential` class (`capability-missing` without it).
     */
    store(credential: StorableCredential | WcsPasswordCredentialData): Promise<Credential | null>;
    private _toCredential;
    /**
     * `preventSilentAccess()` — sign-out. Asks the browser not to hand this origin's
     * credential over without the user (`navigator.credentials.preventSilentAccess()`):
     * otherwise the next visit's `get({ mediation: "silent" })` signs the user straight
     * back in. Never-throw: success clears `error`, a rejection lands in `error` /
     * `errorInfo` (`credential-failed`). Where `navigator.credentials` or the method is
     * missing it resolves having done nothing — signing out must work everywhere, and
     * there is nothing to switch off. It does not touch `value` or `loading`.
     *
     * Not on the lane: it has no result to race, so a get()/store() in flight neither
     * supersedes it nor is superseded by it. Only a dispose() drops its completion.
     */
    preventSilentAccess(): Promise<void>;
}

/**
 * `<wcs-credential>` — declarative Credential Management API primitive
 * (password/federated only — see docs/credential-tag-design.md §0 for the
 * WebAuthn scope exclusion).
 *
 * A thin command-only Shell (mirrors `<wcs-share>`): no attributes at all.
 * `get(options)`/`store(credential)`'s arguments are per-call;
 * `preventSilentAccess()` (sign-out) takes none.
 */
declare class WcsCredential extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get value(): Credential | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    get errorInfo(): WcsIoErrorInfo | null;
    get supported(): boolean;
    get connectedCallbackPromise(): Promise<void>;
    get(options?: CredentialGetOptions | null): Promise<Credential | null>;
    store(credential: StorableCredential | WcsPasswordCredentialData): Promise<Credential | null>;
    preventSilentAccess(): Promise<void>;
    connectedCallback(): void;
    connectedMoveCallback(): void;
    disconnectedCallback(): void;
}

/**
 * credentialCapabilities.ts
 *
 * Credential Management node 固有の capability registry と error code。汎用の assess
 * 機構・型は `./platformCapability.js`(/io-core/ から copy-distribution される生成
 * ファイル)から import する。node 固有の宣言はこのハンドライトファイルに置き、生成
 * コピーとは分離する。
 */

/** 安定した credential error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_CREDENTIAL_ERROR_CODE: {
    readonly CapabilityMissing: "capability-missing";
    /** WebAuthn(publicKey) は v1 スコープ外 — get()/store() 双方で拒否する。 */
    readonly OutOfScope: "out-of-scope";
    /** get()/store() の真のプラットフォーム失敗(NotAllowedError=cancelled は除く)。 */
    readonly CredentialFailed: "credential-failed";
};

declare global {
    interface HTMLElementTagNameMap {
        "wcs-credential": WcsCredential;
    }
}

export { CredentialCore, WCS_CREDENTIAL_ERROR_CODE, WcsCredential, bootstrapCredential, getConfig };
export type { CredentialGetOptions, IWritableConfig, IWritableTagNames, StorableCredential, WcsCredentialCoreValues, WcsCredentialValues, WcsIoErrorInfo, WcsIoErrorPhase, WcsPasswordCredentialData };
