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
    readonly tilt: string;
}
interface IWritableTagNames {
    tilt?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * 3-value vocabulary, deliberately distinct from the 4-value permission state
 * (prompt/granted/denied/unsupported) used elsewhere: `"unknown"` means
 * "no gating exists on this platform, so there is nothing to have asked"
 * (docs/device-orientation-tag-design.md §2) — not the same concept as
 * Permissions API's `"prompt"`.
 */
type TiltPermissionState = "granted" | "denied" | "unknown";
/**
 * Value types for TiltCore (headless) — the observable state properties.
 */
interface WcsTiltCoreValues {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
    absolute: boolean | null;
    permissionState: TiltPermissionState;
}
/**
 * Value types for the Shell (`<wcs-tilt>`) — identical observable surface to
 * the Core.
 */
type WcsTiltValues = WcsTiltCoreValues;

declare function bootstrapTilt(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Device Orientation primitive. A thin, framework-agnostic wrapper
 * around `window`'s `deviceorientation` event exposed through the wc-bindable
 * protocol.
 *
 * The batch2 sibling of `@wcstack/idle` (docs/device-orientation-tag-design.md).
 * Unlike Idle Detection, there is no matching Permissions API entry for this
 * feature (`navigator.permissions.query` has no "device-orientation" name), so
 * `permissionState` must be tracked **locally** rather than composed with
 * `<wcs-permission>` — the defining asymmetry within batch2.
 *
 * No `_gen` generation guard: subscribing/unsubscribing to `deviceorientation`
 * is fully synchronous, same reasoning as `@wcstack/network`.
 */
declare class TiltCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _snapshot;
    private _permissionState;
    private _subscribed;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get alpha(): number | null;
    get beta(): number | null;
    get gamma(): number | null;
    get absolute(): boolean | null;
    get permissionState(): TiltPermissionState;
    observe(): Promise<void>;
    dispose(): void;
    private _deviceOrientationEventCtor;
    private _setPermissionState;
    /**
     * Wraps iOS 13+ Safari's static, gesture-gated
     * `DeviceOrientationEvent.requestPermission()`. On platforms without this
     * gate (Android Chrome, desktop) there is nothing to ask, so this resolves
     * to `"granted"` immediately without querying anything — callers can write
     * one `requestPermission()` → `start()` flow that works everywhere
     * (docs/device-orientation-tag-design.md §3).
     */
    requestPermission(): Promise<TiltPermissionState>;
    /** Subscribe to `deviceorientation`. Idempotent — a second start() while already subscribed is a no-op. */
    start(): void;
    /** Unsubscribe from `deviceorientation`. Safe to call when not started. */
    stop(): void;
    private _onOrientation;
    private _apply;
}

/**
 * `<wcs-tilt>` — declarative Device Orientation API monitor.
 *
 * Named `tilt` (not `orientation`/`device-orientation`) to avoid colliding
 * with `<wcs-screen-orientation>` (docs/device-orientation-tag-design.md §9).
 *
 * Does NOT auto-start on connect, mirroring `<wcs-idle>`: on iOS, subscribing
 * before permission is granted silently receives no events. Callers drive
 * `requestPermission()` → `start()` explicitly.
 */
declare class WcsTilt extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    constructor();
    get alpha(): number | null;
    get beta(): number | null;
    get gamma(): number | null;
    get absolute(): boolean | null;
    get permissionState(): TiltPermissionState;
    get connectedCallbackPromise(): Promise<void>;
    requestPermission(): Promise<TiltPermissionState>;
    start(): void;
    stop(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { TiltCore, WcsTilt, bootstrapTilt, getConfig };
export type { IWritableConfig, IWritableTagNames, TiltPermissionState, WcsTiltCoreValues, WcsTiltValues };
