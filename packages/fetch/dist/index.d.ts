interface ITagNames {
    readonly fetch: string;
    readonly fetchHeader: string;
    readonly fetchBody: string;
}
interface IWritableTagNames {
    fetch?: string;
    fetchHeader?: string;
    fetchBody?: string;
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
interface IWcBindable {
    readonly protocol: "wc-bindable";
    readonly version: number;
    readonly properties: IWcBindableProperty[];
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
 * Value types for FetchCore (headless) — the 4 async state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
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

interface FetchRequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    contentType?: string | null;
    forceText?: boolean;
}
declare class FetchCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _value;
    private _loading;
    private _error;
    private _status;
    private _abortController;
    private _promise;
    constructor(target?: EventTarget);
    get value(): any;
    get loading(): boolean;
    get error(): any;
    get status(): number;
    get promise(): Promise<any>;
    private _setLoading;
    private _setError;
    private _setResponse;
    abort(): void;
    fetch(url: string, options?: FetchRequestOptions): Promise<any>;
    private _doFetch;
}

export { FetchCore, bootstrapFetch, getConfig };
export type { FetchRequestOptions, IWritableConfig, IWritableTagNames, WcsFetchCoreValues, WcsFetchHttpError, WcsFetchValues };
