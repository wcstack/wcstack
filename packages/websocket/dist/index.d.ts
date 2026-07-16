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
    /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
    errorInfo: WcsIoErrorInfo | null;
    readyState: number;
}
/**
 * Value types for the Shell (`<wcs-ws>`) — extends Core with `trigger` and `send`.
 */
interface WcsWsValues<T = unknown> extends WcsWsCoreValues<T> {
    trigger: boolean;
    send: unknown;
}
interface WcsWsInputs {
    url: string;
    protocols: string;
    autoReconnect: boolean;
    reconnectInterval: number;
    maxReconnects: number;
    binaryType: BinaryType;
    manual: boolean;
    trigger: boolean;
    send: unknown;
}
interface WcsWsCoreCommands {
    connect(url: string, options?: {
        protocols?: string | string[];
        autoReconnect?: boolean;
        reconnectInterval?: number;
        maxReconnects?: number;
        binaryType?: BinaryType;
    }): void;
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
}
interface WcsWsCommands {
    connect(): void;
    sendMessage(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
}

declare function bootstrapWebSocket(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

interface WebSocketConnectOptions {
    protocols?: string | string[];
    autoReconnect?: boolean;
    reconnectInterval?: number;
    maxReconnects?: number;
    binaryType?: BinaryType;
}
declare class WebSocketCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _ws;
    private _message;
    private _connected;
    private _loading;
    private _error;
    private _errorInfo;
    private _readyState;
    private _autoReconnect;
    private _reconnectInterval;
    private _maxReconnects;
    private _reconnectCount;
    private _reconnectTimer;
    private _url;
    private _protocols;
    private _binaryType;
    private _intentionalClose;
    private _gen;
    private _socketGen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    observe(): Promise<void>;
    dispose(): void;
    get message(): any;
    get connected(): boolean;
    get loading(): boolean;
    get error(): any;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-ws:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    get readyState(): number;
    private _setMessage;
    private _setConnected;
    private _setLoading;
    private _setError;
    private _commitErrorInfo;
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
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get connectedCallbackPromise(): Promise<void>;
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
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
    get binaryType(): BinaryType;
    set binaryType(value: string | null);
    get manual(): boolean;
    set manual(value: boolean);
    get message(): any;
    get connected(): boolean;
    get loading(): boolean;
    get error(): any;
    get errorInfo(): WcsIoErrorInfo | null;
    get readyState(): number;
    get trigger(): boolean;
    set trigger(value: boolean);
    get send(): any;
    set send(data: any);
    connect(): void;
    sendMessage(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * websocketCapabilities.ts
 *
 * WebSocket node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。WebSocket は持続的な session / monitor node(1 本の接続を張り続ける)で、
 * 競合する operation を持たないため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * この node の `_setError` は 4 形態の非 null 入力を受ける(いずれも公開 `error` shape は不変):
 *   1. synthetic な `{ message: "url is required." }`(`.name` 無し)— connect() の引数不備。
 *   2. synthetic な `{ message: "WebSocket is not connected." }`(`.name` 無し)— open 前の send()。
 *   3. caught された生の構築例外 `e`(`new WebSocket()` の同期 throw)。
 *   4. platform の WebSocket `error` Event(`Event`。`.name`/`.message` を持たない)。
 *
 * これらは shape がバラバラで、message からの分類は脆い。そこで呼び出し側が明示的な
 * taxonomy code を discriminator として渡す(storage の `deriveStorageErrorInfo(error, name)`
 * と同じ技法)。derive 側は synthetic / Event / Error を reverse-engineer せず、渡された
 * code で phase / recoverable を決め、message だけを防御的に抽出する。
 */

/** 安定した websocket error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_WEBSOCKET_ERROR_CODE: {
    /** connect() の `url` 未指定 — 開始前の入力不備。retry では回復しない。 */
    readonly InvalidArgument: "invalid-argument";
    /** open 前の send() — 接続が OPEN でない状態での送信。retry では回復しない(先に connect が要る)。 */
    readonly InvalidState: "invalid-state";
    /**
     * 接続の確立 / 維持に失敗(`new WebSocket()` の同期例外、または platform の error Event)。
     * WebSocket のエラーは通常一過性で、再接続で回復しうる(recoverable=true)。
     */
    readonly ConnectionError: "connection-error";
};

export { WCS_WEBSOCKET_ERROR_CODE, WcsWebSocket, WebSocketCore, bootstrapWebSocket, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsIoErrorInfo, WcsIoErrorPhase, WcsWsCommands, WcsWsCoreCommands, WcsWsCoreValues, WcsWsError, WcsWsInputs, WcsWsValues, WebSocketConnectOptions };
