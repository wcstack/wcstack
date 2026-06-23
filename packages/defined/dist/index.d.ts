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
    readonly defined: string;
}
interface IWritableTagNames {
    defined?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * Aggregation mode across the watched tags:
 * - `"all"` — `defined` is true only once every tag has been registered.
 * - `"any"` — `defined` is true as soon as the first tag is registered.
 */
type DefinedMode = "all" | "any";
/**
 * The state snapshot carried in every `wcs-defined:change` event `detail`. The
 * wc-bindable getters read each field from this object, so all six observable
 * properties are derived from a single event (mirroring how PermissionCore
 * exposes granted/denied/… from one `change` event).
 *
 * Invariant: `total === count + pending.length + missing.length` holds at every
 * dispatch. `pending` and `missing` partition the not-yet-defined tags, split by
 * the timeout: pending = still waiting (pre-timeout), missing = given up
 * (post-timeout) or undefinable (invalid name).
 */
interface DefinedSnapshot {
    defined: boolean;
    pending: string[];
    missing: string[];
    count: number;
    total: number;
    error: string | null;
}
/**
 * Value types for DefinedCore (headless) — the observable state properties. Use
 * with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new DefinedCore(["my-chart", "my-grid"], "all", 3000);
 * bind(core, (name: keyof WcsDefinedCoreValues, value) => { ... });
 * ```
 */
interface WcsDefinedCoreValues {
    defined: boolean;
    pending: string[];
    missing: string[];
    count: number;
    total: number;
    error: string | null;
}
/**
 * Value types for the Shell (`<wcs-defined>`) — identical observable surface to
 * the Core. The Shell adds no command-property: `whenDefined` is a pure observer,
 * so this element is a one-way element → state monitor (event-token only).
 */
type WcsDefinedValues = WcsDefinedCoreValues;
/**
 * Settable input surface for the Shell (`<wcs-defined>`) — the attributes that
 * configure what is watched. Mirrors the `inputs` entries of the wc-bindable
 * manifest; use it for compile-time typing when a binding system or tooling
 * writes these declaratively.
 */
interface WcsDefinedInputs {
    tags: string;
    mode: DefinedMode;
    timeout: number;
}

declare function bootstrapDefined(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless custom-element readiness primitive. A thin, framework-agnostic wrapper
 * around `customElements.whenDefined()` exposed through the wc-bindable protocol.
 *
 * Like `@wcstack/permission`, this is a **one-way element → state monitor** with
 * **no commands** (event-token only): there is no imperative action to "define" a
 * tag, only observation of when registration completes. Unlike permission, the
 * underlying signal is **monotonic** — once a tag is defined it never reverts — so
 * the state machine is terminal: it settles once every tag resolves, or once the
 * optional `timeout` elapses.
 *
 * The differentiator from CSS `:not(:defined)` is **timeout-based failure
 * detection**. An autoloader-imported component whose module fails to load leaves
 * `whenDefined` pending forever; CSS can only keep hiding it. Here, the `timeout`
 * moves still-pending tags into `missing`, so a load failure becomes observable
 * state (`missing.length > 0`) that can drive a fallback UI.
 *
 * Six observable properties are all derived from a single `wcs-defined:change`
 * event whose `detail` is the full {@link DefinedSnapshot} (mirroring how
 * PermissionCore exposes granted/denied/… from one event). At every dispatch the
 * invariant `total === count + pending.length + missing.length` holds; `pending`
 * and `missing` partition the not-yet-defined tags, split by the timeout.
 */
declare class DefinedCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _defined;
    private _pending;
    private _missing;
    private _count;
    private _total;
    private _error;
    private _mode;
    private _timeoutId;
    private _subscribed;
    private _gen;
    private _publishedKey;
    private _ready;
    private _resolveReady;
    /**
     * @param tags     Tag names to watch. If supplied, the watch starts immediately
     *                 (headless ergonomics); omit it and drive the first watch via
     *                 {@link observe} (the Shell does this from connectedCallback).
     * @param mode     Aggregation mode: `"all"` (default) or `"any"`.
     * @param timeoutMs Milliseconds before still-pending tags move to `missing`.
     *                 `0` (default) waits forever. Negative/non-finite are not
     *                 normalized here — pass a sane value (the Shell normalizes).
     * @param target   Optional EventTarget that `wcs-defined:change` is dispatched
     *                 on. Defaults to the Core itself. The Shell passes the custom
     *                 element so events bubble from the DOM node; direct (headless)
     *                 users normally leave it undefined and listen on the Core.
     */
    constructor(tags?: string[], mode?: DefinedMode, timeoutMs?: number, target?: EventTarget);
    get defined(): boolean;
    get pending(): string[];
    get missing(): string[];
    get count(): number;
    get total(): number;
    get error(): string | null;
    /** Resolves once the current (or initial) watch settles. */
    get ready(): Promise<void>;
    /**
     * Start watching `tags` under `mode` with an optional `timeoutMs`. Idempotent
     * while already subscribed — a second call is a no-op that just returns the live
     * `ready` (the Shell binds at a fixed connect-time config and does not re-watch
     * on attribute changes in v1). To switch config mid-life, dispose() first, then
     * observe() again. Returns a promise that resolves once the watch settles, for SSR.
     */
    observe(tags: string[], mode: DefinedMode, timeoutMs: number): Promise<void>;
    /**
     * Stop the current watch: clear the timeout and invalidate any in-flight
     * whenDefined()/timeout callbacks (via the generation counter) so they no longer
     * mutate state. Call from the Shell's `disconnectedCallback`. A later observe()
     * can re-establish the watch. Safe to call when never subscribed.
     */
    dispose(): void;
    private _init;
    private _recompute;
    private _markInvalid;
    private _appendError;
    private _snapshot;
    private _publish;
    private _finishIfDone;
}

declare class WcsDefined extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    constructor();
    get tags(): string;
    set tags(value: string);
    get mode(): DefinedMode;
    set mode(value: DefinedMode);
    get timeout(): number;
    set timeout(value: number);
    get defined(): boolean;
    get pending(): string[];
    get missing(): string[];
    get count(): number;
    get total(): number;
    get error(): string | null;
    get connectedCallbackPromise(): Promise<void>;
    private _parseTags;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { DefinedCore, WcsDefined, bootstrapDefined, getConfig };
export type { DefinedMode, DefinedSnapshot, IWritableConfig, IWritableTagNames, WcsDefinedCoreValues, WcsDefinedInputs, WcsDefinedValues };
