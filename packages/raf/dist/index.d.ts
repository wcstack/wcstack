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
    readonly raf: string;
}
interface IWritableTagNames {
    raf?: string;
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
 * Payload carried by the `wcs-raf:tick` event.
 * `count` is the number of frames fired since the last reset; `elapsed` is the
 * accumulated ACTIVE milliseconds (Σdt — interruptions contribute nothing);
 * `dt` is the delta to the previous frame within a continuous run, `0` on the
 * first frame after start / resume / a visibility interruption; `timestamp` is
 * the frame's `DOMHighResTimeStamp` (`0` for the reset() notification, which
 * is not a frame).
 */
interface WcsRafTickDetail {
    count: number;
    elapsed: number;
    dt: number;
    timestamp: number;
}
/**
 * Value types for RafCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 */
interface WcsRafCoreValues {
    tick: number;
    elapsed: number;
    dt: number;
    running: boolean;
    suspended: boolean;
}
/**
 * Value types for the Shell (`<wcs-raf>`) — identical observable surface to
 * the Core, plus the DOM-driven `trigger` command-property.
 */
interface WcsRafValues extends WcsRafCoreValues {
    trigger: boolean;
}
interface WcsRafInputs {
    once: boolean;
    repeat: number;
    manual: boolean;
    trigger: boolean;
}
interface WcsRafCoreCommands {
    start(options?: {
        repeat?: number;
    }): void;
    stop(): void;
    reset(): void;
    pause(): void;
    resume(): void;
}
interface WcsRafCommands {
    start(): void;
    stop(): void;
    reset(): void;
    pause(): void;
    resume(): void;
}

declare function bootstrapRaf(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

interface RafStartOptions {
    repeat?: number;
}
/**
 * Injectable frame scheduler. The default resolves
 * `globalThis.requestAnimationFrame` / `cancelAnimationFrame` AT CALL TIME
 * (async-io-node-guidelines §3.7); tests inject a fake that pumps frames with
 * explicit timestamps (the `dt` contract is timestamp-derived, so tests must
 * control the clock, not just the callback order).
 */
interface RafScheduler {
    request(callback: (timestamp: number) => void): unknown;
    cancel(handle: unknown): void;
}
/**
 * Headless requestAnimationFrame primitive — `TimerCore`'s sibling with the
 * time source swapped from `setInterval` (a period) to rAF (the browser's
 * rendering opportunity). Exposed through the wc-bindable protocol: it streams
 * `tick` (frame counter), `elapsed` (accumulated ACTIVE milliseconds), `dt`
 * (delta to the previous frame) and the `running` / `suspended` pair, and is
 * driven by the `start` / `stop` / `reset` / `pause` / `resume` commands.
 *
 * `tick` / `elapsed` / `dt` are all surfaced via the single `wcs-raf:tick`
 * event (read through getters, mirroring how FetchCore exposes value/status
 * from one `wcs-fetch:response` event).
 *
 * Contracts specific to this node (docs/raf-tag-design.md):
 *
 * - **dt describes continuous running only.** The first frame after `start()`,
 *   `resume()`, or a visibility interruption reports `dt = 0` — a value that
 *   spans an interruption never reaches observers. There is deliberately NO
 *   upper clamp: how to treat a slow frame is the consumer's domain decision.
 * - **elapsed is Σdt (active time).** Because interruption-spanning deltas are
 *   normalized to 0, summing dt yields exactly the time frames were actually
 *   being delivered — no separate segment bookkeeping is needed, and hidden /
 *   paused periods contribute nothing. Granularity is one frame: between
 *   frames the getter returns the value as of the last tick.
 * - **running / suspended are a desired/actual pair** (the wakelock split): in
 *   a hidden tab the browser delivers no frames at all, so `running` (the
 *   started intent) stays true while `suspended` reports that delivery is
 *   actually stopped. `suspended` is only meaningful after `observe()` has
 *   subscribed to `visibilitychange`; without a document it stays false.
 * - **No `error` surface.** rAF has no persistent failure mode; on a platform
 *   without it, `start()` is a silent no-op (never-throw, resize precedent).
 */
declare class RafCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _injectedScheduler;
    private _handle;
    private _gen;
    private _runGen;
    private _ready;
    private _tick;
    private _dt;
    private _elapsed;
    private _running;
    private _suspended;
    private _paused;
    private _lastTs;
    private _repeat;
    private _runStartTick;
    private _visibilityDoc;
    constructor(target?: EventTarget, scheduler?: RafScheduler);
    get tick(): number;
    get elapsed(): number;
    get dt(): number;
    get running(): boolean;
    get suspended(): boolean;
    get ready(): Promise<void>;
    observe(): Promise<void>;
    dispose(): void;
    private _dispatchTick;
    private _setRunning;
    private _setSuspended;
    private _updateSuspended;
    start(options?: RafStartOptions): void;
    stop(): void;
    reset(): void;
    pause(): void;
    resume(): void;
    private _frame;
    private _onVisibilityChange;
    private _resolveScheduler;
    private _clearHandle;
}

declare class Raf extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _trigger;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get connectedCallbackPromise(): Promise<void>;
    get once(): boolean;
    set once(value: boolean);
    get repeat(): number;
    set repeat(value: number);
    get manual(): boolean;
    set manual(value: boolean);
    get tick(): number;
    get elapsed(): number;
    get dt(): number;
    get running(): boolean;
    get suspended(): boolean;
    get trigger(): boolean;
    set trigger(value: boolean);
    start(): void;
    stop(): void;
    reset(): void;
    pause(): void;
    resume(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { RafCore, Raf as WcsRaf, bootstrapRaf, getConfig };
export type { IWritableConfig, IWritableTagNames, RafScheduler, RafStartOptions, WcsRafCommands, WcsRafCoreCommands, WcsRafCoreValues, WcsRafInputs, WcsRafTickDetail, WcsRafValues };
