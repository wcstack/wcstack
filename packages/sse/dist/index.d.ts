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
    get readyState(): number;
    private _setMessage;
    private _setConnected;
    private _setLoading;
    private _setError;
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
    constructor();
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
    get readyState(): number;
    get trigger(): boolean;
    set trigger(value: boolean);
    connect(): void;
    close(): void;
    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { SseCore, WcsSse, bootstrapSse, getConfig };
export type { IWritableConfig, IWritableTagNames, SseConnectOptions, WcsSseCommands, WcsSseCoreCommands, WcsSseCoreValues, WcsSseInputs, WcsSseMessage, WcsSseValues };
