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
}
/**
 * Value types for the Shell (`<wcs-upload>`) — extends Core with `trigger` and `files`.
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
    private _target;
    private _value;
    private _loading;
    private _progress;
    private _error;
    private _status;
    private _xhr;
    private _promise;
    constructor(target?: EventTarget);
    get value(): any;
    get loading(): boolean;
    get progress(): number;
    get error(): any;
    get status(): number;
    get promise(): Promise<any>;
    private _setLoading;
    private _setProgress;
    private _setError;
    private _setResponse;
    abort(): void;
    upload(url: string, files: FileList | File[], options?: UploadRequestOptions): Promise<any>;
    private _doUpload;
}

export { UploadCore, bootstrapUpload, getConfig };
export type { IWritableConfig, IWritableTagNames, UploadRequestOptions, WcsUploadCoreValues, WcsUploadError, WcsUploadValues };
