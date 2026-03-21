interface IWritableTagNames {
    fetch?: string;
    fetchHeader?: string;
    fetchBody?: string;
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
 * Value types for FetchCore (headless) — the 4 async state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new FetchCore();
 * bind(core, (name: keyof WcsFetchCoreValues, value) => { ... });
 * ```
 */
interface WcsFetchCoreValues {
    value: unknown;
    loading: boolean;
    error: {
        status: number;
        statusText: string;
        body: string;
    } | null;
    status: number;
}
/**
 * Value types for the Shell (`<wcs-fetch>`) — extends Core with `trigger`.
 * Use with framework adapters for compile-time type checking.
 *
 * @example
 * ```tsx
 * // React
 * const [ref, values] = useWcBindable<HTMLElement, WcsFetchValues>();
 * values.loading // boolean
 * ```
 */
interface WcsFetchValues extends WcsFetchCoreValues {
    trigger: boolean;
}

declare function bootstrapFetch(userConfig?: IWritableConfig): void;

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
    constructor(target?: EventTarget);
    get value(): any;
    get loading(): boolean;
    get error(): any;
    get status(): number;
    private _setLoading;
    private _setError;
    private _setResponse;
    abort(): void;
    fetch(url: string, options?: FetchRequestOptions): Promise<any>;
}

export { FetchCore, bootstrapFetch };
export type { FetchRequestOptions, IWritableConfig, IWritableTagNames, WcsFetchCoreValues, WcsFetchValues };
