interface ITagNames {
    readonly ws: string;
}
interface IWritableTagNames {
    ws?: string;
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
 * WebSocket error object.
 */
interface WcsWsError {
    code?: number;
    reason?: string;
    message?: string;
}
/**
 * Value types for WebSocketCore (headless) — the async state properties.
 */
interface WcsWsCoreValues<T = unknown> {
    message: T;
    connected: boolean;
    loading: boolean;
    error: WcsWsError | Event | null;
    readyState: number;
}
/**
 * Value types for the Shell (`<wcs-ws>`) — extends Core with `trigger` and `send`.
 */
interface WcsWsValues<T = unknown> extends WcsWsCoreValues<T> {
    trigger: boolean;
    send: unknown;
}

declare function bootstrapWebSocket(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

interface WebSocketConnectOptions {
    protocols?: string | string[];
    autoReconnect?: boolean;
    reconnectInterval?: number;
    maxReconnects?: number;
}
declare class WebSocketCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _ws;
    private _message;
    private _connected;
    private _loading;
    private _error;
    private _readyState;
    private _autoReconnect;
    private _reconnectInterval;
    private _maxReconnects;
    private _reconnectCount;
    private _reconnectTimer;
    private _url;
    private _protocols;
    private _intentionalClose;
    constructor(target?: EventTarget);
    get message(): any;
    get connected(): boolean;
    get loading(): boolean;
    get error(): any;
    get readyState(): number;
    private _setMessage;
    private _setConnected;
    private _setLoading;
    private _setError;
    private _setReadyState;
    connect(url: string, options?: WebSocketConnectOptions): void;
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
    private _doConnect;
    private _onOpen;
    private _onMessage;
    private _onError;
    private _onClose;
    private _scheduleReconnect;
    private _clearReconnectTimer;
    private _removeListeners;
    private _closeInternal;
}

declare class WcsWebSocket extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    static get observedAttributes(): string[];
    private _core;
    private _trigger;
    constructor();
    get url(): string;
    set url(value: string);
    get protocols(): string;
    set protocols(value: string);
    get autoReconnect(): boolean;
    set autoReconnect(value: boolean);
    get reconnectInterval(): number;
    set reconnectInterval(value: number);
    get maxReconnects(): number;
    set maxReconnects(value: number);
    get manual(): boolean;
    set manual(value: boolean);
    get message(): any;
    get connected(): boolean;
    get loading(): boolean;
    get error(): any;
    get readyState(): number;
    get trigger(): boolean;
    set trigger(value: boolean);
    set send(data: any);
    connect(): void;
    sendMessage(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { WcsWebSocket, WebSocketCore, bootstrapWebSocket, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsWsCoreValues, WcsWsError, WcsWsValues, WebSocketConnectOptions };
