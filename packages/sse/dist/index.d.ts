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
    readonly sse: string;
}
interface IWritableTagNames {
    sse?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * Options for `SseCore.connect()` / the headless `connect` command.
 * Single source of truth — referenced by both `SseCore.connect` and
 * `WcsSseCoreCommands.connect`.
 */
interface SseConnectOptions {
    withCredentials?: boolean;
    /** Named SSE events (`event:` field) to subscribe to, besides the unnamed `message`. */
    events?: string[];
    /** When true, skip JSON auto-parsing and keep `data` as the raw string. */
    raw?: boolean;
}
/**
 * Detail payload of the `message` property.
 *
 * SSE streams can carry named events (`event: foo\ndata: ...`). All subscribed
 * events — the unnamed `message` plus any names listed in the `events` input —
 * are funneled into the single `message` property; the `event` field tells which
 * one fired. State-side code branches on `event`.
 */
interface WcsSseMessage<T = unknown> {
    /** The event type that fired (`"message"` for unnamed events). */
    event: string;
    /** The parsed (or raw, when `raw` is set) payload. */
    data: T;
    /** The `id:` field of the SSE event, if any. */
    lastEventId: string;
}
/**
 * Value types for SseCore (headless) — the async state properties.
 *
 * `error` is the raw failure: the `error` Event dispatched by EventSource on
 * connection loss, or the Error thrown by the `EventSource` constructor (e.g. an
 * invalid URL). SSE error events carry no structured fields (unlike WebSocket's
 * CloseEvent), so there is nothing to normalize — the raw value is surfaced.
 */
interface WcsSseCoreValues<T = unknown> {
    message: WcsSseMessage<T> | null;
    connected: boolean;
    loading: boolean;
    error: Event | Error | null;
    /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
    errorInfo: WcsIoErrorInfo | null;
    readyState: number;
}
/**
 * Value types for the Shell (`<wcs-sse>`) — extends Core with `trigger`.
 */
interface WcsSseValues<T = unknown> extends WcsSseCoreValues<T> {
    trigger: boolean;
}
interface WcsSseInputs {
    url: string;
    withCredentials: boolean;
    events: string;
    raw: boolean;
    manual: boolean;
    trigger: boolean;
}
interface WcsSseCoreCommands {
    connect(url: string, options?: SseConnectOptions): void;
    close(): void;
}
interface WcsSseCommands {
    connect(): void;
    close(): void;
}

declare function bootstrapSse(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

declare class SseCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _es;
    private _message;
    private _connected;
    private _loading;
    private _error;
    private _errorInfo;
    private _readyState;
    private _url;
    private _withCredentials;
    private _events;
    private _raw;
    private _gen;
    private _connGen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    observe(): Promise<void>;
    dispose(): void;
    get message(): WcsSseMessage | null;
    get connected(): boolean;
    get loading(): boolean;
    get error(): Event | Error | null;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-sse:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged. `recoverable=true` only for a transient
     * CONNECTING drop (the browser auto-reconnects).
     */
    get errorInfo(): WcsIoErrorInfo | null;
    get readyState(): number;
    private _setMessage;
    private _setConnected;
    private _setLoading;
    private _setError;
    private _commitErrorInfo;
    private _errorMessage;
    private _setReadyState;
    /**
     * Open an SSE connection. Required `url`; `options` are evaluated once at the
     * time the EventSource is created.
     *
     * Idempotency / headless note: if already connected (CONNECTING/OPEN) to the
     * *same* url, a re-`connect()` is a no-op — including when `options`
     * (events/raw/withCredentials) differ. The guard keys on url only (see the
     * inline comment below), so to apply new options to a live stream a headless
     * caller must `close()` first, then `connect()` with the new options. After a
     * permanent failure (readyState CLOSED) the guard is bypassed and `connect()`
     * reconnects with the supplied options.
     */
    connect(url: string, options?: SseConnectOptions): void;
    close(): void;
    private _doConnect;
    private _onOpen;
    private _onMessage;
    private _onError;
    private _removeListeners;
    private _closeInternal;
}

declare class WcsSse extends HTMLElement {
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
    get connectedCallbackPromise(): Promise<void>;
    get url(): string;
    set url(value: string);
    get withCredentials(): boolean;
    set withCredentials(value: boolean);
    get events(): string;
    set events(value: string);
    get raw(): boolean;
    set raw(value: boolean);
    get manual(): boolean;
    set manual(value: boolean);
    get message(): WcsSseMessage | null;
    get connected(): boolean;
    get loading(): boolean;
    get error(): Event | Error | null;
    get errorInfo(): WcsIoErrorInfo | null;
    get readyState(): number;
    get trigger(): boolean;
    set trigger(value: boolean);
    connect(): void;
    close(): void;
    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * sseCapabilities.ts
 *
 * SSE node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。SSE は session/streaming の監視系(持続接続、競合する operation を持たない)
 * なので lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * `SseCore._setError(error, kind?)` は 3 形態の入力を受ける:
 *   1. synthetic な validation `Error`(`new Error("url is required.")`) — 入力不備。
 *   2. caught された EventSource 構築失敗(`new EventSource()` の throw、Error/DOMException)。
 *   3. EventSource が切断/再接続時に発火する生の `error` **Event**(message を持たない)。
 * 生の Event と Error を message coupling 無しに弁別し、さらに EventSource の
 * `error` Event が「恒久エラー(readyState CLOSED)」か「トランジェント再接続中
 * (readyState CONNECTING、ブラウザが自動再接続)」かは *raw な値では判別できない* ため、
 * 呼び出し側が明示的な `kind` discriminator を渡す(storage の
 * `deriveStorageErrorInfo(error, name)` / screen-orientation の
 * `deriveScreenOrientationErrorInfo(name, message)` と同じ discriminator 技法)。
 * derive 側は mixed shape を reverse-engineer しない。
 */

/** 安定した SSE error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_SSE_ERROR_CODE: {
    /** `url` 未指定などの入力不備。retry では回復しない。 */
    readonly InvalidArgument: "invalid-argument";
    /**
     * EventSource の生成失敗、または稼働中ストリームの切断。EventSource は
     * CloseEvent を持たず error が切断も兼ねるため、生成失敗・恒久切断・トランジェント
     * 再接続を 1 つの code に畳み、`phase` / `recoverable` で区別する。
     */
    readonly ConnectionError: "connection-error";
};

export { SseCore, WCS_SSE_ERROR_CODE, WcsSse, bootstrapSse, getConfig };
export type { IWritableConfig, IWritableTagNames, SseConnectOptions, WcsIoErrorInfo, WcsIoErrorPhase, WcsSseCommands, WcsSseCoreCommands, WcsSseCoreValues, WcsSseInputs, WcsSseMessage, WcsSseValues };
