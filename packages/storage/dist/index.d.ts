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

interface ITagNames {
    readonly storage: string;
}
interface IWritableTagNames {
    storage?: string;
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

type StorageType = "local" | "session";
/**
 * Error returned when a storage operation fails. `operation` names the failing
 * call: `load` / `save` / `remove`, or `type` for an invalid `type` assignment
 * (a value other than `"local"` / `"session"`).
 */
interface WcsStorageError {
    operation: "load" | "save" | "remove" | "type";
    message: string;
}
/**
 * Value types for StorageCore (headless) — the async state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 */
interface WcsStorageCoreValues<T = unknown> {
    value: T;
    loading: boolean;
    error: WcsStorageError | Error | null;
    /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
    errorInfo: WcsIoErrorInfo | null;
}
/**
 * Value types for the Shell (`<wcs-storage>`) — extends Core with `trigger`.
 * Use with framework adapters for compile-time type checking.
 */
interface WcsStorageValues<T = unknown> extends WcsStorageCoreValues<T> {
    trigger: boolean;
}

declare function bootstrapStorage(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

declare class StorageCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _value;
    private _loading;
    private _error;
    private _errorInfo;
    private _key;
    private _type;
    private _storageListener;
    private _gen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    observe(): Promise<void>;
    dispose(): void;
    get value(): any;
    set value(v: any);
    get loading(): boolean;
    get error(): any;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-storage:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    get key(): string;
    set key(value: string);
    get type(): StorageType;
    set type(value: StorageType);
    private _getStorage;
    private _setLoading;
    private _setError;
    private _commitErrorInfo;
    private _toStorageError;
    private _errName;
    private _setValue;
    load(): any;
    save(value: any): void;
    remove(): void;
    startSync(): void;
    stopSync(): void;
}

declare class Storage extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    static get observedAttributes(): string[];
    private _core;
    private _trigger;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    private _syncCore;
    get key(): string;
    set key(value: string);
    get type(): StorageType;
    set type(value: StorageType);
    get value(): any;
    set value(v: any);
    get loading(): boolean;
    get error(): any;
    get errorInfo(): WcsIoErrorInfo | null;
    get connectedCallbackPromise(): Promise<void>;
    get manual(): boolean;
    set manual(value: boolean);
    get trigger(): boolean;
    set trigger(value: boolean);
    load(): any;
    save(): void;
    remove(): void;
    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * storageCapabilities.ts
 *
 * Storage node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。storage の load / save / remove は同期で互いに競合しないため lane は
 * 持たず、error taxonomy(errorInfo)のみを採用する。
 */

/** 安定した storage error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_STORAGE_ERROR_CODE: {
    /** `key` 未設定 / 不正な `type` などの入力不備。retry では回復しない。 */
    readonly InvalidArgument: "invalid-argument";
    /** `QuotaExceededError` — 容量超過。空きを作れば回復しうる(環境要因)。 */
    readonly QuotaExceeded: "quota-exceeded";
    /** `SecurityError` — storage アクセス拒否(cookie 無効 / third-party context 等)。retry では回復しない。 */
    readonly NotAllowed: "not-allowed";
    /** その他の caught 例外。 */
    readonly StorageError: "storage-error";
};

export { StorageCore, WCS_STORAGE_ERROR_CODE, Storage as WcsStorage, bootstrapStorage, getConfig };
export type { IWritableConfig, IWritableTagNames, StorageType, WcsIoErrorInfo, WcsIoErrorPhase, WcsStorageCoreValues, WcsStorageError, WcsStorageValues };
