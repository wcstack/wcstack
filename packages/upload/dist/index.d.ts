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

declare class WcsUpload extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    static get observedAttributes(): string[];
    private _core;
    private _files;
    private _trigger;
    constructor();
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

export { UploadCore, WcsUpload, bootstrapUpload, getConfig };
export type { IWritableConfig, IWritableTagNames, UploadRequestOptions, WcsUploadCoreValues, WcsUploadError, WcsUploadValues };
