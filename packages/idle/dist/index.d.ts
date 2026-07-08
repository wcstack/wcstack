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
    readonly idle: string;
}
interface IWritableTagNames {
    idle?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

type IdleUserState = "active" | "idle";
type IdleScreenState = "locked" | "unlocked";
/**
 * Value types for IdleCore (headless) — the observable state properties.
 * Permission state (granted/denied/prompt) is intentionally NOT included here
 * — compose with `<wcs-permission name="idle-detection">` instead
 * (docs/idle-detection-tag-design.md §0/§2).
 */
interface WcsIdleCoreValues {
    userState: IdleUserState | null;
    screenState: IdleScreenState | null;
    active: boolean;
    error: any;
}
/**
 * Value types for the Shell (`<wcs-idle>`) — identical observable surface to
 * the Core.
 */
type WcsIdleValues = WcsIdleCoreValues;

declare function bootstrapIdle(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Idle Detection primitive. A thin, framework-agnostic wrapper around
 * `IdleDetector` exposed through the wc-bindable protocol.
 *
 * Reference implementation for batch2's "gesture-gated permission" archetype
 * (docs/idle-detection-tag-design.md). `requestPermission()` wraps the static,
 * user-gesture-gated `IdleDetector.requestPermission()` — this Core never
 * calls it automatically; the caller must invoke it from within a real
 * gesture handler.
 *
 * Deliberately does NOT track the 4-value permission state (prompt/granted/
 * denied/unsupported) itself: `navigator.permissions.query({name:
 * "idle-detection"})` exists, so compose with `<wcs-permission
 * name="idle-detection">` for that instead (§0). This Core only exposes the
 * actual idle state (userState/screenState) plus the one-time
 * requestPermission()/start()/stop() actions.
 */
declare class IdleCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _userState;
    private _screenState;
    private _error;
    private _detector;
    private _abortController;
    private _gen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get userState(): IdleUserState | null;
    get screenState(): IdleScreenState | null;
    get active(): boolean;
    get error(): any;
    observe(): Promise<void>;
    dispose(): void;
    private _api;
    private _setState;
    private _setError;
    /**
     * Wraps the static, user-gesture-gated `IdleDetector.requestPermission()`.
     * MUST be invoked from within a real user gesture handler by the caller —
     * this Core cannot manufacture one. never-throw: a gesture-context
     * rejection resolves to `"denied"` and lands in `error`. Gesture violation
     * and an actual "denied" outcome are not distinguished — both mean "not
     * usable right now" (§4.1).
     */
    requestPermission(): Promise<"granted" | "denied">;
    /**
     * Start an idle-detection session. `threshold` (ms) must be >= 60000 per
     * spec — not validated here (§3): an out-of-range value is left to the
     * browser's own TypeError, which never-throw absorbs into `error`.
     */
    start(threshold?: number): Promise<void>;
    /** Stop the current session (if any) and detach its listener. Safe to call when not started. */
    stop(): void;
    private _onChange;
}

/**
 * `<wcs-idle>` — declarative Idle Detection API primitive.
 *
 * Does NOT auto-start on connect (docs/idle-detection-tag-design.md §6): the
 * permission gate sits in front of `start()`, so an unconditional
 * connectedCallback start would be guaranteed to fail before permission is
 * granted. Callers drive `requestPermission()` → `start()` explicitly, e.g.
 * from a click handler.
 *
 * Compose with `<wcs-permission name="idle-detection">` for prompt/granted/
 * denied status — this Shell only exposes the actual idle state.
 */
declare class WcsIdle extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    /**
     * Minimum idle time (ms) before `userState` becomes `"idle"`. This value is
     * read only at `start()` time — there is no `attributeChangedCallback`
     * (deliberately not declared in `observedAttributes`, mirroring
     * `<wcs-gyroscope>`'s `frequency`), so mutating the attribute/property on an
     * already-running session has no effect until the caller `stop()`s and
     * `start()`s again.
     */
    get threshold(): number;
    set threshold(value: number);
    get userState(): IdleUserState | null;
    get screenState(): IdleScreenState | null;
    get active(): boolean;
    get error(): any;
    get connectedCallbackPromise(): Promise<void>;
    requestPermission(): Promise<"granted" | "denied">;
    start(threshold?: number): Promise<void>;
    stop(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { IdleCore, WcsIdle, bootstrapIdle, getConfig };
export type { IWritableConfig, IWritableTagNames, IdleScreenState, IdleUserState, WcsIdleCoreValues, WcsIdleValues };
