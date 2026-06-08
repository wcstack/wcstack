interface ITagNames {
    readonly worker: string;
}
interface IWritableTagNames {
    worker?: string;
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
    readonly version: number;
    readonly properties: IWcBindableProperty[];
    readonly inputs?: IWcBindableInput[];
    readonly commands?: IWcBindableCommand[];
}
/**
 * Normalized Worker failure. `name` mirrors the underlying `DOMException.name`
 * or `Error.name`: `DataCloneError` when a posted value (or a value the worker
 * posted back) is not structured-cloneable, `InvalidStateError` when `post()` is
 * called with no running worker, and a script `Error` for an uncaught error
 * inside the worker. For a script error the optional `filename` / `lineno` /
 * `colno` carry the `ErrorEvent` location; they are absent for the other kinds.
 */
interface WcsWorkerErrorDetail {
    name: string;
    message: string;
    filename?: string;
    lineno?: number;
    colno?: number;
}
/**
 * Options for `WorkerCore.start()`.
 */
interface WcsWorkerStartOptions {
    /** Module ("module", default) or classic ("classic") worker. */
    type?: WorkerType;
    /** Optional worker name, passed to the `Worker` constructor `name` option. */
    name?: string;
    /** Re-spawn the worker after an uncaught error fires (default `false`). */
    restartOnError?: boolean;
    /** Maximum number of automatic restarts (default `Infinity`). */
    maxRestarts?: number;
    /** Delay in ms before an automatic restart (default `0`). */
    restartInterval?: number;
}
/**
 * Value types for WorkerCore (headless) — the observable state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 */
interface WcsWorkerCoreValues {
    /**
     * The most recent message posted back by the worker, reconstructed via
     * structured clone (no JSON round-trip). Re-fires on every incoming message,
     * even when the value is identical to the previous one.
     */
    message: any;
    /** The last failure (post / spawn / script error / messageerror), or `null`. */
    error: WcsWorkerErrorDetail | null;
    /** `true` while a worker is spawned and not yet terminated. */
    running: boolean;
}
/**
 * Value types for the Shell (`<wcs-worker>`) — identical observable surface to
 * the Core.
 */
type WcsWorkerValues = WcsWorkerCoreValues;
interface WcsWorkerInputs {
    /** The worker script URL. Changing it re-spawns on the new script. */
    src: string;
    /** Module ("module", default) or classic ("classic") worker. */
    type: WorkerType;
    /** Optional worker name (passed to the `Worker` constructor `name` option). */
    name: string;
    /**
     * When present, do NOT spawn the worker automatically on connect (or when the
     * `src` attribute changes). Spawn imperatively via `start()` instead.
     */
    manual: boolean;
    /**
     * When present, the worker is NOT terminated on disconnect — it outlives the
     * element. Ownership transfers to the caller, who must call `terminate()`.
     */
    keepAlive: boolean;
    /** When present, re-spawn the worker after an uncaught error. */
    restartOnError: boolean;
    /** Maximum number of automatic restarts (default `Infinity`). */
    maxRestarts: number;
    /** Delay in ms before an automatic restart (default `0`). */
    restartInterval: number;
}
interface WcsWorkerCoreCommands {
    start(src: string, options?: WcsWorkerStartOptions): void;
    post(data: any, transfer?: Transferable[]): void;
    terminate(): void;
}
/** Commands exposed on the Shell — `start()` reads the `src` / `type` attributes. */
interface WcsWorkerCommands {
    start(): void;
    post(data: any, transfer?: Transferable[]): void;
    terminate(): void;
}

declare function bootstrapWorker(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Dedicated Worker primitive. A thin, framework-agnostic wrapper around
 * the `Worker` API exposed through the wc-bindable protocol.
 *
 * A Worker is a "headless async message-passing resource that owns a child
 * thread" — structurally identical to BroadcastCore (structured-clone payloads,
 * no wire encoding, `post` is a `state → element` command-token and an incoming
 * `message` is an `element → state` event-token) with one extra axis: this Core
 * *owns* the underlying resource, so `start()` / `terminate()` spawn and tear
 * down the thread, mirroring how WebSocketCore owns its socket.
 *
 * Message model is bus-style (fire-and-forget `post`, observe `message`), not
 * RPC: there is no request/response correlation. Payloads ride structured clone
 * with NO JSON round-trip (symmetrical with BroadcastCore, deliberately unlike
 * WebSocketCore). The Core never throws — a spawn failure (bad URL, CSP block,
 * absent `Worker`), a non-cloneable `post` (`DataCloneError`), a `post` with no
 * running worker (`InvalidStateError`), an uncaught worker error, and a
 * `messageerror` all flow through the `error` property.
 */
declare class WorkerCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _worker;
    private _message;
    private _error;
    private _running;
    private _src;
    private _type;
    private _name;
    private _restartOnError;
    private _maxRestarts;
    private _restartInterval;
    private _restartCount;
    private _restartTimer;
    constructor(target?: EventTarget);
    get message(): any;
    get error(): WcsWorkerErrorDetail | null;
    get running(): boolean;
    private _setMessage;
    private _setError;
    private _setRunning;
    /**
     * Spawn the worker from `src`. Any previously-spawned worker is terminated
     * first, so calling `start()` again with a different `src` switches scripts.
     * Idempotent on the same `src` (re-spawning the script we are already running
     * is pure churn) — this also absorbs the custom-element upgrade path where a
     * connected element with a `src` attribute triggers both
     * attributeChangedCallback and connectedCallback, calling start() twice. A
     * consequence of this guard: changing only the options (`type`, `name`,
     * restart-*) while running the same `src` is ignored — call `terminate()`
     * then `start()` to re-spawn with new options. Never throws: a spawn failure
     * surfaces through `error`.
     */
    start(src: string, options?: WcsWorkerStartOptions): void;
    /**
     * Post a structured-cloneable value to the worker. The optional `transfer`
     * list moves ownership of `Transferable`s (ArrayBuffer, MessagePort, ...) — the
     * escape hatch the declarative layer cannot express. Never throws: a
     * non-cloneable value surfaces as `DataCloneError` and posting with no running
     * worker surfaces an `InvalidStateError`, both through `error`.
     */
    post(data: any, transfer?: Transferable[]): void;
    /** Terminate the worker. Idempotent — a no-op when none is running. */
    terminate(): void;
    /**
     * Tear the Core down for a disconnected Shell: terminate the worker and reset
     * the error shadow. Only the `error` clear is silent — it mutates the shadow
     * without dispatching. Terminating a *running* worker still dispatches
     * `wcs-worker:running-changed` (true→false) via `_terminateWorker`, so a
     * dispose on a worker that was live does emit one event on the (now
     * disconnected) element; only a no-op dispose (no worker running) is fully
     * silent.
     *
     * Asymmetry by design: `_message` is deliberately NOT reset. `error` is
     * transient state — a stale error from a previous worker would mislead after a
     * reconnect, so it is cleared. `message` is the last value received (an event
     * payload); it is retained as the Core's last-known datum and is naturally
     * overwritten by the next incoming message.
     */
    dispose(): void;
    private _spawn;
    private _onMessage;
    private _onMessageError;
    private _onError;
    private _scheduleRestart;
    private _clearRestartTimer;
    private _terminateWorker;
    private _normalizeError;
}

declare class WcsWorker extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    static get observedAttributes(): string[];
    private _core;
    constructor();
    get src(): string;
    set src(value: string);
    get type(): WorkerType;
    set type(value: WorkerType);
    get name(): string;
    set name(value: string);
    get manual(): boolean;
    set manual(value: boolean);
    get keepAlive(): boolean;
    set keepAlive(value: boolean);
    get restartOnError(): boolean;
    set restartOnError(value: boolean);
    get maxRestarts(): number;
    set maxRestarts(value: number);
    get restartInterval(): number;
    set restartInterval(value: number);
    get message(): any;
    get error(): WcsWorkerErrorDetail | null;
    get running(): boolean;
    start(): void;
    post(data: any, transfer?: Transferable[]): void;
    terminate(): void;
    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { WcsWorker, WorkerCore, bootstrapWorker, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsWorkerCommands, WcsWorkerCoreCommands, WcsWorkerCoreValues, WcsWorkerErrorDetail, WcsWorkerInputs, WcsWorkerStartOptions, WcsWorkerValues };
