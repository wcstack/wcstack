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
    readonly broadcast: string;
}
interface IWritableTagNames {
    broadcast?: string;
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
 * Normalized BroadcastChannel failure. `name` mirrors the `DOMException.name`
 * (e.g. `DataCloneError` when a posted value is not structured-cloneable,
 * `DataError` for a `messageerror` deserialization failure); `unsupported` is
 * surfaced as `NotSupportedError` when the `BroadcastChannel` constructor is
 * absent (older browsers, or a non-window environment).
 */
interface WcsBroadcastErrorDetail {
    name: string;
    message: string;
}
/**
 * Value types for BroadcastCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new BroadcastCore();
 * bind(core, (name: keyof WcsBroadcastCoreValues, value) => { ... });
 * ```
 */
interface WcsBroadcastCoreValues {
    /**
     * The most recent message received from *another* same-origin context on the
     * channel. A context never receives its own posts (BroadcastChannel
     * self-exclusion), so within a single tab `message` only updates from another
     * `<wcs-broadcast>` on the same channel name. The value is whatever was
     * posted, reconstructed via structured clone (no JSON round-trip).
     */
    message: any;
    /** The last error (post failure / deserialization failure / unsupported), or `null`. */
    error: WcsBroadcastErrorDetail | null;
    /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable), or `null`. */
    errorInfo: WcsIoErrorInfo | null;
}
/**
 * Value types for the Shell (`<wcs-broadcast>`) — identical observable surface
 * to the Core.
 */
type WcsBroadcastValues = WcsBroadcastCoreValues;
interface WcsBroadcastInputs {
    /** The channel name to join. Changing it re-opens on the new channel. */
    name: string;
    /**
     * When present, do NOT open the channel automatically on connect (or when the
     * `name` attribute changes). Open imperatively via `open()` instead.
     */
    manual: boolean;
}
interface WcsBroadcastCoreCommands {
    open(name: string): void;
    post(data: any): void;
    close(): void;
}
/** Commands exposed on the Shell — `open()` reads the `name` attribute. */
interface WcsBroadcastCommands {
    open(): void;
    post(data: any): void;
    close(): void;
}

declare function bootstrapBroadcast(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless cross-tab messaging primitive. A thin, framework-agnostic wrapper
 * around the BroadcastChannel API exposed through the wc-bindable protocol.
 *
 * BroadcastChannel is a same-origin pub/sub bus: every context (tab, iframe,
 * worker) that opens a channel with the same `name` receives every other
 * context's posts — but NOT its own. This self-exclusion is the whole point:
 * `post` is a `state → element` action (command-token) and an incoming
 * `message` is an `element → state` notification (event-token), but the two
 * only close the loop *across* a context boundary. Within a single tab a lone
 * `<wcs-broadcast>` never hears itself; open the page in two tabs to see the
 * round-trip.
 *
 * Unlike WebSocketCore there is no connection state, no reconnect, and no wire
 * encoding: a channel is "open" the moment it is constructed, and payloads ride
 * the browser's structured clone (objects pass through as-is, no JSON
 * round-trip). The only failure surfaces are a non-cloneable `post`
 * (`DataCloneError`), a `messageerror` (a peer posted something this context
 * cannot deserialize), and an absent `BroadcastChannel` constructor
 * (`unsupported`). All three flow through the `error` property — the Core never
 * throws — symmetrical with FetchCore / ClipboardCore.
 */
declare class BroadcastCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _channel;
    private _name;
    private _message;
    private _error;
    private _errorInfo;
    private _gen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get message(): any;
    get error(): WcsBroadcastErrorDetail | null;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-broadcast:error-info-changed`), derived from `error`; the existing
     * `error` property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    observe(): Promise<void>;
    private _setMessage;
    private _setError;
    private _commitErrorInfo;
    /**
     * Join the named channel. Any previously-open channel is closed first, so
     * calling `open()` again switches channels. When the BroadcastChannel
     * constructor is unavailable this surfaces an `unsupported` error and leaves
     * the Core channel-less (a later `post()` then errors loudly rather than
     * silently dropping).
     */
    open(name: string): void;
    /**
     * Post a structured-cloneable value to every other context on the channel.
     * The local context never receives it (self-exclusion). Never throws:
     * a non-cloneable value surfaces as a `DataCloneError` through `error`, and
     * posting with no open channel surfaces an `InvalidStateError`.
     */
    post(data: any): void;
    /** Leave the channel. Idempotent — a no-op when no channel is open. */
    close(): void;
    /**
     * Tear the Core down for a disconnected Shell: close the channel and reset the
     * error shadow silently (no dispatch on a torn-down element). A later
     * reconnect re-opens via the Shell's connectedCallback.
     *
     * Asymmetry by design: `_message` is deliberately NOT reset. `error` is
     * transient connection state — a stale error from a previous channel would be
     * misleading after a reconnect, so it is cleared. `message` is the last value
     * received (an event payload), not connection state; it is retained as the
     * Core's last-known datum so a binding still reads it across a disconnect/
     * reconnect, and it is naturally overwritten by the next incoming message.
     */
    dispose(): void;
    private _onMessage;
    private _onMessageError;
    private _closeChannel;
    private _hasBroadcastChannel;
    private _normalizeError;
    private _unsupportedError;
}

declare class WcsBroadcast extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    static get observedAttributes(): string[];
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get connectedCallbackPromise(): Promise<void>;
    get name(): string;
    set name(value: string);
    get manual(): boolean;
    set manual(value: boolean);
    get message(): any;
    get error(): WcsBroadcastErrorDetail | null;
    get errorInfo(): WcsIoErrorInfo | null;
    open(): void;
    post(data: any): void;
    close(): void;
    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * broadcastCapabilities.ts
 *
 * Broadcast node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。BroadcastChannel の post / message は concurrent-independent(競合しない)
 * ため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 */

/** 安定した broadcast error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_BROADCAST_ERROR_CODE: {
    /** BroadcastChannel コンストラクタ不在(`_unsupportedError()` の `NotSupportedError`)。 */
    readonly CapabilityMissing: "capability-missing";
    /** structured clone 不可な payload を post(`DataCloneError`)。呼び出し側入力の不備。 */
    readonly InvalidArgument: "invalid-argument";
    /** その他の post / channel 失敗(DataError / InvalidStateError / "Error" fallback など)。 */
    readonly BroadcastError: "broadcast-error";
};

export { BroadcastCore, WCS_BROADCAST_ERROR_CODE, WcsBroadcast, bootstrapBroadcast, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsBroadcastCommands, WcsBroadcastCoreCommands, WcsBroadcastCoreValues, WcsBroadcastErrorDetail, WcsBroadcastInputs, WcsBroadcastValues, WcsIoErrorInfo, WcsIoErrorPhase };
