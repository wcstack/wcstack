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
    readonly timer: string;
}
interface IWritableTagNames {
    timer?: string;
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
 * Payload carried by the `wcs-timer:tick` event.
 * `count` is the number of ticks fired since the last reset; `elapsed` is the
 * milliseconds the timer has been running since the last reset.
 */
interface WcsTimerTickDetail {
    count: number;
    elapsed: number;
}
/**
 * Value types for TimerCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new TimerCore();
 * bind(core, (name: keyof WcsTimerCoreValues, value) => { ... });
 * ```
 */
interface WcsTimerCoreValues {
    tick: number;
    elapsed: number;
    running: boolean;
}
/**
 * Value types for the Shell (`<wcs-timer>`) — identical observable surface to
 * the Core, plus the DOM-driven `trigger` command-property.
 */
interface WcsTimerValues extends WcsTimerCoreValues {
    trigger: boolean;
}
interface WcsTimerInputs {
    interval: number;
    once: boolean;
    repeat: number;
    immediate: boolean;
    manual: boolean;
    trigger: boolean;
}
interface WcsTimerCoreCommands {
    start(options?: {
        interval?: number;
        repeat?: number;
        immediate?: boolean;
    }): void;
    stop(): void;
    reset(): void;
    pause(): void;
    resume(): void;
}
interface WcsTimerCommands {
    start(): void;
    stop(): void;
    reset(): void;
    pause(): void;
    resume(): void;
}

declare function bootstrapTimer(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

interface TimerStartOptions {
    interval?: number;
    repeat?: number;
    immediate?: boolean;
}
/**
 * Headless timer primitive. A thin, framework-agnostic wrapper around
 * `setInterval` exposed through the wc-bindable protocol: it streams `tick`
 * (a monotonically increasing counter), `elapsed` (running time in ms) and a
 * `running` flag, and is driven by the `start` / `stop` / `reset` / `pause` /
 * `resume` commands.
 *
 * `tick` and `elapsed` are both surfaced via the single `wcs-timer:tick` event
 * (read through getters, mirroring how FetchCore exposes value/status from one
 * `wcs-fetch:response` event), so an observer that binds either property is
 * notified on every fire.
 */
declare class TimerCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _timerId;
    private _gen;
    private _runGen;
    private _ready;
    private _tick;
    private _running;
    private _paused;
    private _runStartTick;
    private _interval;
    private _repeat;
    private _accumulatedElapsed;
    private _segmentStart;
    constructor(target?: EventTarget);
    get tick(): number;
    get elapsed(): number;
    get running(): boolean;
    get ready(): Promise<void>;
    observe(): Promise<void>;
    dispose(): void;
    private _dispatchTick;
    private _setRunning;
    start(options?: TimerStartOptions): void;
    changeInterval(interval: number): void;
    stop(): void;
    reset(): void;
    pause(): void;
    resume(): void;
    private _onResumeBoundary;
    private _fire;
    private _clearTimer;
    private _foldElapsed;
    private _currentElapsed;
}

declare class Timer extends HTMLElement {
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
    get interval(): number;
    set interval(value: number);
    get once(): boolean;
    set once(value: boolean);
    get repeat(): number;
    set repeat(value: number);
    get immediate(): boolean;
    set immediate(value: boolean);
    get manual(): boolean;
    set manual(value: boolean);
    get tick(): number;
    get elapsed(): number;
    get running(): boolean;
    get trigger(): boolean;
    set trigger(value: boolean);
    start(): void;
    stop(): void;
    reset(): void;
    pause(): void;
    resume(): void;
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { TimerCore, Timer as WcsTimer, bootstrapTimer, getConfig };
export type { IWritableConfig, IWritableTagNames, TimerStartOptions, WcsTimerCommands, WcsTimerCoreCommands, WcsTimerCoreValues, WcsTimerInputs, WcsTimerTickDetail, WcsTimerValues };
