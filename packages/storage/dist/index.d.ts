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
    readonly version: 1;
    readonly properties: IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}
type StorageType = "local" | "session";
/**
 * Error returned when a storage operation fails.
 */
interface WcsStorageError {
    operation: "load" | "save" | "remove";
    message: string;
}
/**
 * Value types for StorageCore (headless) — the async state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 */
interface WcsStorageCoreValues<T = unknown> {
    value: T;
    loading: boolean;
    error: WcsStorageError | Error | null;
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
    private _key;
    private _type;
    private _storageListener;
    constructor(target?: EventTarget);
    get value(): any;
    set value(v: any);
    get loading(): boolean;
    get error(): any;
    get key(): string;
    set key(value: string);
    get type(): StorageType;
    set type(value: StorageType);
    private _getStorage;
    private _setLoading;
    private _setError;
    private _toStorageError;
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
    constructor();
    private _syncCore;
    get key(): string;
    set key(value: string);
    get type(): StorageType;
    set type(value: StorageType);
    get value(): any;
    set value(v: any);
    get loading(): boolean;
    get error(): any;
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

export { StorageCore, Storage as WcsStorage, bootstrapStorage, getConfig };
export type { IWritableConfig, IWritableTagNames, StorageType, WcsStorageCoreValues, WcsStorageError, WcsStorageValues };
