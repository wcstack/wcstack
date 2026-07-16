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
    readonly contacts: string;
}
interface IWritableTagNames {
    contacts?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/** Field names selectable via the Contact Picker API's `properties` argument. */
type ContactProperty = "name" | "email" | "tel" | "address" | "icon";
/** Options for `select(properties, options)` — `multiple` defaults to `false`. */
interface ContactsSelectOptions {
    multiple?: boolean;
}
/**
 * A postal address entry returned for the `"address"` contact property, mirroring
 * the Contact Picker API's `ContactAddress` shape (MDN). Every field is optional:
 * the platform populates only what it has, and field coverage varies by browser /
 * OS. An index signature is kept so a future platform field does not force callers
 * into a type assertion — consistent with the design doc's "pass the platform
 * return value straight through to `value`" principle (docs/contact-picker-tag-design.md §3).
 */
interface ContactAddress {
    addressLine?: string[];
    city?: string;
    country?: string;
    dependentLocality?: string;
    organization?: string;
    phone?: string;
    postalCode?: string;
    recipient?: string;
    region?: string;
    sortingCode?: string;
    [key: string]: unknown;
}
/**
 * A single contact returned by `navigator.contacts.select()`. Every field is an
 * array (a contact can have multiple emails, phone numbers, etc.) and only the
 * fields requested via `properties` are populated.
 */
interface ContactInfo {
    name?: string[];
    email?: string[];
    tel?: string[];
    address?: ContactAddress[];
    icon?: Blob[];
}
/**
 * Value types for ContactsCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new ContactsCore();
 * bind(core, (name: keyof WcsContactsCoreValues, value) => { ... });
 * ```
 */
interface WcsContactsCoreValues {
    value: ContactInfo[] | null;
    loading: boolean;
    error: any;
    cancelled: boolean;
    errorInfo: WcsIoErrorInfo | null;
}
/**
 * Value types for the Shell (`<wcs-contacts>`) — identical observable surface
 * to the Core. The Shell adds no inputs: `select(properties, options)`'s
 * arguments are per-call, not declarative attributes.
 */
type WcsContactsValues = WcsContactsCoreValues;

declare function bootstrapContacts(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Contact Picker primitive. A thin, framework-agnostic wrapper around
 * `navigator.contacts.select(properties, options)` exposed through the
 * wc-bindable protocol.
 *
 * Concurrency is owned by the shared `OperationLane` (io-core) with the `exhaust`
 * policy: the contact picker is a single system-modal surface, so while one
 * select() is in flight a new call is rejected as an idempotent no-op instead of
 * starting a second `navigator.contacts.select()`. This replaces the earlier
 * dispose-only `_gen` guard, which relied on the platform rejecting the second call
 * with `InvalidStateError` — but that let the rejected second call reset/overwrite
 * the still-pending first call's `error`/`loading` state. The lane's owner
 * generation still invalidates any in-flight select() on dispose().
 *
 * The Contact Picker API accepts no `AbortSignal`, so the lane runs with
 * `withSignal: false`. `select()` takes **two** positional arguments
 * (`properties`, `options`) rather than one — the command-token argument
 * pass-through does not special-case argument count, so this requires no protocol
 * change.
 */
declare class ContactsCore extends EventTarget {
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
    get value(): ContactInfo[] | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable` / `capabilityId`), or null. Exposed as an additive wc-bindable
     * property (event `wcs-contacts:error-info-changed`); the existing `error`
     * property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    /**
     * Whether the required platform capability (`web.contacts`) is available right
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
    private _setLoading;
    private _setValue;
    private _setError;
    private _setCancelled;
    private _setErrorInfo;
    private _commitErrorInfo;
    select(properties: ContactProperty[], options?: ContactsSelectOptions): Promise<ContactInfo[] | null>;
}

/**
 * `<wcs-contacts>` — declarative Contact Picker API primitive.
 *
 * A thin command-only Shell (mirrors `<wcs-share>`): no attributes at all.
 * `select(properties, options)`'s arguments are per-call, not a declarative
 * setting to park on the element ahead of time.
 *
 * **Android Chrome only.** Desktop browsers entirely lack `navigator.contacts`
 * — treat `unsupported` as the default state, not an edge case, in any
 * example or consuming UI.
 */
declare class WcsContacts extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get value(): ContactInfo[] | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    get errorInfo(): WcsIoErrorInfo | null;
    get connectedCallbackPromise(): Promise<void>;
    select(properties: ContactProperty[], options?: ContactsSelectOptions): Promise<ContactInfo[] | null>;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * contactsCapabilities.ts
 *
 * Contact Picker node 固有の capability registry と error code。汎用の assess 機構・
 * 型は `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)
 * から import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは
 * 分離する。
 */

/** 安定した contacts error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_CONTACTS_ERROR_CODE: {
    readonly CapabilityMissing: "capability-missing";
    readonly SelectFailed: "select-failed";
};

export { ContactsCore, WCS_CONTACTS_ERROR_CODE, WcsContacts, bootstrapContacts, getConfig };
export type { ContactAddress, ContactInfo, ContactProperty, ContactsSelectOptions, IWritableConfig, IWritableTagNames, WcsContactsCoreValues, WcsContactsValues, WcsIoErrorInfo, WcsIoErrorPhase };
