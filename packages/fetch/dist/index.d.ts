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
 * Value types for FetchCore (headless) — the 5 async state properties.
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
}
declare class FetchCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _value;
    private _loading;
    private _error;
    private _status;
    private _objectURL;
    private _abortController;
    private _promise;
    private _gen;
    private _ready;
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
    private _setLoading;
    private _setError;
    private _setResponse;
    private _createObjectURL;
    private _revokeObjectURL;
    abort(): void;
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

export { FetchCore, Fetch as WcsFetch, InfiniteScroll as WcsInfiniteScroll, bootstrapFetch, getConfig };
export type { FetchRequestOptions, IWritableConfig, IWritableTagNames, WcsFetchCoreValues, WcsFetchHttpError, WcsFetchValues };
