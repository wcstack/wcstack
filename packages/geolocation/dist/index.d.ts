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
    readonly geo: string;
}
interface IWritableTagNames {
    geo?: string;
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
 * Permission state for the Geolocation API, mirroring the Permissions API
 * `PermissionState` plus `"unsupported"` for environments without
 * `navigator.permissions` (or where the `geolocation` permission cannot be
 * queried).
 */
type GeoPermissionState = "prompt" | "granted" | "denied" | "unsupported";
/**
 * Payload carried by the `wcs-geo:position` event — a structured-clone-friendly
 * snapshot of `GeolocationPosition`. Unlike the live `GeolocationCoordinates`
 * object, every field is a plain value so it can flow through data binding and
 * be serialized.
 *
 * The coordinate fields are intentionally exposed twice: flattened at the top
 * level (so `latitude` / `longitude` bind directly) and nested under `coords`
 * (a `GeolocationPosition`-compatible copy, for consumers that expect the
 * native shape). The two views always hold the same values.
 */
interface WcsGeoPositionDetail {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
    timestamp: number;
    coords: WcsGeoCoords;
}
interface WcsGeoCoords {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
}
/**
 * Normalized `GeolocationPositionError`. `code` mirrors the spec constants
 * (PERMISSION_DENIED=1, POSITION_UNAVAILABLE=2, TIMEOUT=3); `unsupported` is
 * surfaced via code 2 with a descriptive message when `navigator.geolocation`
 * is absent.
 */
interface WcsGeoErrorDetail {
    code: number;
    message: string;
}
/**
 * Options accepted by `getCurrentPosition` / `watch`, mirroring
 * `PositionOptions`.
 */
interface GeoOptions {
    enableHighAccuracy?: boolean;
    timeout?: number;
    maximumAge?: number;
}
/**
 * Value types for GeolocationCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new GeolocationCore();
 * bind(core, (name: keyof WcsGeoCoreValues, value) => { ... });
 * ```
 */
interface WcsGeoCoreValues {
    position: WcsGeoPositionDetail | null;
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    coords: WcsGeoCoords | null;
    timestamp: number | null;
    watching: boolean;
    loading: boolean;
    error: WcsGeoErrorDetail | null;
    permission: GeoPermissionState;
}
/**
 * Value types for the Shell (`<wcs-geo>`) — identical observable surface to the
 * Core, plus the DOM-driven `trigger` command-property.
 */
interface WcsGeoValues extends WcsGeoCoreValues {
    trigger: boolean;
}
interface WcsGeoInputs {
    highAccuracy: boolean;
    timeout: number;
    maximumAge: number;
    watch: boolean;
    manual: boolean;
    /**
     * Momentary command-property (no mirrored attribute): a `false`→`true` write
     * requests a single fix, then the flag immediately resets to `false`. Unlike
     * the other inputs it does not reflect to an HTML attribute.
     */
    trigger: boolean;
}
interface WcsGeoCoreCommands {
    getCurrentPosition(options?: GeoOptions): Promise<void>;
    watch(options?: GeoOptions): void;
    clearWatch(): void;
}
interface WcsGeoCommands {
    getCurrentPosition(): Promise<void>;
    watchPosition(): void;
    clearWatch(): void;
}

declare function bootstrapGeolocation(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless geolocation primitive. A thin, framework-agnostic wrapper around the
 * Geolocation API exposed through the wc-bindable protocol.
 *
 * It has two phases, mirroring the two distinct shapes of the underlying API:
 * - **one-shot** — `getCurrentPosition()` resolves a single fix (like FetchCore's
 *   one-shot `fetch()`), toggling `loading` around the async call.
 * - **continuous** — `watch()` / `clearWatch()` stream fixes (like TimerCore's
 *   `start()` / `stop()`), toggling the `watching` flag.
 *
 * Every successful fix is published via the single `wcs-geo:position` event;
 * `latitude` / `longitude` / `accuracy` / `coords` / `timestamp` are read from
 * it through getters (mirroring how TimerCore exposes count/elapsed from one
 * `wcs-timer:tick` event), so an observer that binds any of them is notified on
 * every fix.
 *
 * Geolocation also has a permission gate absent from timer/websocket: the
 * `permission` property reflects `navigator.permissions.query({name:
 * "geolocation"})` (`prompt` / `granted` / `denied`, or `unsupported`) and
 * tracks its live `change` event. It is a read-only sensor — there is no
 * element-bound "send" path; element → state only.
 */
declare class GeolocationCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _watchId;
    private _position;
    private _watching;
    private _loading;
    private _error;
    private _permission;
    private _permissionStatus;
    private _permissionSubscribed;
    private _permGen;
    private _acqGen;
    private _watchGen;
    private _ready;
    constructor(target?: EventTarget);
    get position(): WcsGeoPositionDetail | null;
    get latitude(): number | null;
    get longitude(): number | null;
    get accuracy(): number | null;
    get coords(): WcsGeoCoords | null;
    get timestamp(): number | null;
    get watching(): boolean;
    get loading(): boolean;
    get error(): WcsGeoErrorDetail | null;
    get permission(): GeoPermissionState;
    /** Resolves once the first (or most recent) permission probe settles (§3.8). */
    get ready(): Promise<void>;
    private _setPosition;
    private _setWatching;
    private _setLoading;
    private _setError;
    private _setPermission;
    /**
     * Acquire a single position fix. Resolves once the fix arrives or the request
     * fails — never rejects: failures are surfaced through the `error` property so
     * they flow into the declarative state, symmetrical with FetchCore.
     */
    getCurrentPosition(options?: GeoOptions): Promise<void>;
    /**
     * Begin continuously watching the position. Idempotent while already
     * watching: a redundant watch() must not register a second `watchPosition`
     * (which would leak the handle and double the fix rate). Reconfiguring is done
     * via clearWatch() + watch().
     */
    watch(options?: GeoOptions): void;
    clearWatch(): void;
    /**
     * Establish permission monitoring (§3.5). Idempotent: a no-op while a
     * subscription is already live (so the first connect after construction does
     * not double-subscribe), and re-subscribes after a dispose() — e.g. the Shell
     * element was disconnected and then reconnected (reparented). Returns the
     * `ready` promise, which resolves once the (re)established probe settles, so
     * the Shell can expose it as connectedCallbackPromise for SSR. Position
     * acquisition (one-shot / watch) is command-driven and the Shell drives it
     * separately from connectedCallback.
     */
    observe(): Promise<void>;
    /**
     * Re-establish the permission `change` subscription after a dispose() — e.g.
     * the Shell element was disconnected and then reconnected (reparented). No-op
     * while a subscription is already live, so the first connect after
     * construction does not double-subscribe. This keeps permission tracking
     * symmetric with position acquisition, which the Shell also revives on
     * reconnect.
     *
     * Retained as a thin alias of observe() for the Shell's existing reconnect
     * path; observe() is the canonical §3.5 lifecycle entry point.
     */
    reinitPermission(): void;
    /**
     * Detach the live permission `change` listener. Call from the Shell's
     * `disconnectedCallback` so a removed element does not leak the subscription.
     * A later reconnect can re-subscribe via reinitPermission().
     */
    dispose(): void;
    private _hasGeolocation;
    private _initPermission;
    private _onPermissionChange;
    private _normalizePosition;
    private _normalizeError;
    private _unsupportedError;
    private _unexpectedError;
}

declare class WcsGeolocation extends HTMLElement {
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
    get highAccuracy(): boolean;
    set highAccuracy(value: boolean);
    get timeout(): number;
    set timeout(value: number);
    get maximumAge(): number;
    set maximumAge(value: number);
    get watch(): boolean;
    set watch(value: boolean);
    get manual(): boolean;
    set manual(value: boolean);
    get position(): WcsGeoPositionDetail | null;
    get latitude(): number | null;
    get longitude(): number | null;
    get accuracy(): number | null;
    get coords(): WcsGeoCoords | null;
    get timestamp(): number | null;
    get watching(): boolean;
    get loading(): boolean;
    get error(): WcsGeoErrorDetail | null;
    get permission(): GeoPermissionState;
    get connectedCallbackPromise(): Promise<void>;
    get trigger(): boolean;
    set trigger(value: boolean);
    getCurrentPosition(): Promise<void>;
    watchPosition(): void;
    clearWatch(): void;
    private _options;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { GeolocationCore, WcsGeolocation, bootstrapGeolocation, getConfig };
export type { GeoOptions, GeoPermissionState, IWritableConfig, IWritableTagNames, WcsGeoCommands, WcsGeoCoords, WcsGeoCoreCommands, WcsGeoCoreValues, WcsGeoErrorDetail, WcsGeoInputs, WcsGeoPositionDetail, WcsGeoValues };
