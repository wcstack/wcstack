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
    readonly debounce: string;
    readonly throttle: string;
}
interface IWritableTagNames {
    debounce?: string;
    throttle?: string;
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
 * Tuning options for {@link DebounceCore}. Mirrors lodash's `debounce` knobs.
 * - `wait`: quiet period (ms) the signal must be idle before a trailing fire.
 * - `leading`: fire on the first signal of a burst.
 * - `trailing`: fire after the quiet period at the end of a burst.
 * - `maxWait`: cap the total time a fire can be deferred under continuous input.
 *   (Throttle is expressed as `maxWait === wait`.)
 */
interface DebounceOptions {
    wait?: number;
    leading?: boolean;
    trailing?: boolean;
    maxWait?: number;
}
/**
 * Payload carried by the `<prefix>:settled` event (the value surface).
 * `value` is the debounced value of the most recent `source` write.
 */
interface WcsDebounceSettledDetail {
    value: any;
}
/**
 * Payload carried by the `<prefix>:fired` event (the signal surface).
 * `args` are the coalesced arguments of the most recent `trigger(...args)` pulse.
 */
interface WcsDebounceFiredDetail {
    args: any[];
}
/**
 * Value types for DebounceCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 */
interface WcsDebounceCoreValues {
    value: any;
    fired: any[];
    pending: boolean;
}
/**
 * Value types for the Shell (`<wcs-debounce>` / `<wcs-throttle>`) — identical
 * observable surface to the Core.
 */
type WcsDebounceValues = WcsDebounceCoreValues;
interface WcsDebounceInputs {
    source: any;
    wait: number;
    leading: boolean;
    trailing: boolean;
    maxWait?: number;
}
interface WcsDebounceCoreCommands {
    trigger(...args: any[]): void;
    cancel(): void;
    flush(): void;
}
type WcsDebounceCommands = WcsDebounceCoreCommands;

declare function bootstrapDebounce(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless debounce/throttle primitive. A framework-agnostic port of lodash's
 * `debounce` algorithm (`shouldInvoke` / `leadingEdge` / `trailingEdge` /
 * `remainingWait`, timed via `Date.now()`), exposed through the wc-bindable
 * protocol.
 *
 * It coalesces a stream of *signals* and emits at most one per quiet period.
 * Two surfaces share the single timer:
 *
 * - **value** — writing {@link setSource} schedules a settle; on fire the
 *   debounced value is published via the `<prefix>:settled` event and the
 *   `value` getter. Wire it as `source: src; value: debounced`.
 * - **signal** — calling {@link trigger}`(...args)` coalesces a burst of pulses;
 *   on fire one `<prefix>:fired` event carries the latest args (relayed by state
 *   through the command-token / event-token protocols).
 *
 * A given instance is meant to be used for one surface at a time. Because each
 * surface keeps its own field (`_value` vs `_lastArgs`), the getters never
 * pollute each other; if both are driven on one instance the *last* scheduled
 * signal wins (lodash's last-args semantics).
 *
 * Throttle is the same engine with `maxWait === wait` (and `leading` on by
 * default), so `<wcs-throttle>` reuses this class with a different `eventPrefix`.
 */
declare class DebounceCore extends EventTarget {
    static wcBindable: IWcBindable;
    private readonly _prefix;
    private _target;
    private _wait;
    private _leading;
    private _trailing;
    private _maxWait;
    private _hasMaxWait;
    private _lastCallTime;
    private _lastInvokeTime;
    private _timerId;
    private _timerGen;
    private _pendingKind;
    private _pendingValue;
    private _pendingArgs;
    private _value;
    private _lastArgs;
    private _pending;
    private _gen;
    private _ready;
    constructor(prefix?: string, target?: EventTarget, options?: DebounceOptions);
    get ready(): Promise<void>;
    observe(): Promise<void>;
    dispose(): void;
    /**
     * Update the tuning knobs. The Shell calls this with the element's current
     * attributes before each schedule, so live attribute edits take effect on the
     * next signal. `maxWait` is clamped to at least `wait` (lodash semantics); an
     * absent / invalid `maxWait` disables maxWait entirely.
     */
    configure(options?: DebounceOptions): void;
    get value(): any;
    get fired(): any[];
    get pending(): boolean;
    /** Value surface: schedule a settle carrying `value` (last write wins). */
    setSource(value: any): void;
    /** Signal surface: coalesce a pulse carrying `args` (last call wins). */
    trigger(...args: any[]): void;
    /** Drop any pending fire without emitting. Getters keep their last values. */
    cancel(): void;
    /**
     * Emit any buffered payload immediately, then clear pending. Unlike lodash's
     * `flush` (which honours `trailing`), this fires whatever is buffered — the
     * command's intent is "publish now" — but is a no-op when nothing is pending.
     */
    flush(): void;
    private _schedule;
    private _shouldInvoke;
    private _remainingWait;
    private _timerExpired;
    private _leadingEdge;
    private _trailingEdge;
    private _invoke;
    private _setPending;
    private _dispatch;
    private _armTimer;
    private _clearTimer;
}

/**
 * Build the wc-bindable `properties` list for a debounce/throttle element, with
 * every event name derived from a single `prefix`. `<wcs-debounce>` uses
 * `"wcs-debounce"`, `<wcs-throttle>` uses `"wcs-throttle"`, so the two tags share
 * one engine (DebounceCore) yet advertise distinct event namespaces from one
 * source of truth — no hand-duplicated property tables (cf. the geolocation Shell
 * which overrode its wcBindable by hand).
 *
 * - `value`   — the debounced value of the latest `source` write (value surface),
 *               read from the `<prefix>:settled` event.
 * - `fired`   — the coalesced args of the latest `trigger()` pulse (signal
 *               surface), read from the `<prefix>:fired` event. Declared as a
 *               property (not just an event) so state can subscribe via the
 *               event-token protocol (`eventToken.fired: <name>`).
 * - `pending` — whether a debounce is currently in flight.
 */
declare function makeDebounceProperties(prefix: string): IWcBindableProperty[];

/**
 * `<wcs-debounce>` — declarative debounce. See {@link DebounceCore} for the
 * engine. The `eventPrefix` defaults to `"wcs-debounce"`; `<wcs-throttle>`
 * subclasses this with `"wcs-throttle"` and throttle defaults.
 */
declare class Debounce extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    protected static eventPrefix: string;
    static wcBindable: IWcBindable;
    protected _core: DebounceCore;
    private _source;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get connectedCallbackPromise(): Promise<void>;
    get wait(): number;
    set wait(value: number);
    get leading(): boolean;
    set leading(value: boolean);
    get trailing(): boolean;
    set trailing(value: boolean);
    get maxWait(): number | undefined;
    set maxWait(value: number);
    get source(): any;
    set source(value: any);
    get value(): any;
    get fired(): any[];
    get pending(): boolean;
    trigger(...args: any[]): void;
    cancel(): void;
    flush(): void;
    protected _defaultWait(): number;
    protected _resolveLeading(): boolean;
    protected _defaultMaxWait(): number | undefined;
    protected _options(): DebounceOptions;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * `<wcs-throttle>` — the same {@link DebounceCore} engine biased to throttle:
 * `maxWait === wait` (a fire happens at least every `wait` ms under continuous
 * input) and `leading` on by default. It advertises its own `wcs-throttle:*`
 * event namespace (via `makeDebounceProperties("wcs-throttle")`), and the Core
 * dispatches under that prefix because the constructor passes it through.
 */
declare class Throttle extends Debounce {
    protected static eventPrefix: string;
    static wcBindable: IWcBindable;
    protected _resolveLeading(): boolean;
    protected _defaultMaxWait(): number | undefined;
}

export { DebounceCore, Debounce as WcsDebounce, Throttle as WcsThrottle, bootstrapDebounce, getConfig, makeDebounceProperties };
export type { DebounceOptions, IWritableConfig, IWritableTagNames, WcsDebounceCommands, WcsDebounceCoreCommands, WcsDebounceCoreValues, WcsDebounceFiredDetail, WcsDebounceInputs, WcsDebounceSettledDetail, WcsDebounceValues };
