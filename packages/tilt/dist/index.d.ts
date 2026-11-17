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

/**
 * Observation semantics of a `properties` entry.
 *
 *   "state"  — current value. A snapshot may cache it, and equality-based dedupe is safe.
 *   "event"  — occurrence. Repeated identical payloads are distinct occurrences; never dedupe.
 *   "handle" — live / opaque resource with its own lifecycle (e.g. MediaStream). Not
 *              snapshot-safe and not necessarily serializable; consumers need an explicit
 *              ref / callback surface rather than a value slot.
 */
type WcBindableSemantics = "state" | "event" | "handle";
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
    /**
     * Optional, additive, forward-compatible. An absent value means **unspecified**, NOT
     * "state": a reader that finds no `semantics` MUST keep the behavior it had before this
     * field existed (deliver the update as-is; do not start deduping, caching or serializing
     * on assumption). Only an explicit value licenses a reader to change its handling.
     */
    readonly semantics?: WcBindableSemantics;
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
 * "the browser has not answered" — nothing was asked yet, or the browser
 * refused to ask (docs/device-orientation-tag-design.md §2) — not the same
 * concept as Permissions API's `"prompt"`.
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
    /** Degrees clockwise from north of the direction the top of the device points, or null until known. */
    heading: number | null;
    permissionState: TiltPermissionState;
    error: any;
    /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
    errorInfo: WcsIoErrorInfo | null;
    /** This page can use Device Orientation (the API is there and the page is not forbidden to use it). */
    supported: boolean;
}
/**
 * Value types for the Shell (`<wcs-tilt>`) — identical observable surface to
 * the Core.
 */
type WcsTiltValues = WcsTiltCoreValues;

declare function bootstrapTilt(userConfig?: IWritableConfig, registry?: CustomElementRegistry): void;

declare function getConfig(): IConfig;

/**
 * Headless Device Orientation primitive. A thin, framework-agnostic wrapper
 * around `window`'s `deviceorientation` event (and `deviceorientationabsolute`,
 * for `heading`) exposed through the wc-bindable protocol.
 *
 * The batch2 sibling of `@wcstack/idle` (docs/device-orientation-tag-design.md).
 * Unlike Idle Detection, there is no matching Permissions API entry for this
 * feature (`navigator.permissions.query` has no "device-orientation" name), so
 * `permissionState` must be tracked **locally** rather than composed with
 * `<wcs-permission>` — the defining asymmetry within batch2.
 *
 * No `_gen` generation guard: subscribing/unsubscribing to `deviceorientation`
 * (start/stop) is fully synchronous, so that path never needs one. This node
 * does have an async probe — `requestPermission()` awaits the static
 * `DeviceOrientationEvent.requestPermission()` — but its post-await write is
 * a benign `permissionState`/`error` value set + dispatch with no
 * subscription/resource management to race, so `_gen` is unneeded there too
 * (docs/device-orientation-tag-design.md §4, corrected after an earlier
 * revision mistakenly reused `@wcstack/network`'s "no async probe at all"
 * rationale).
 */
declare class TiltCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _snapshot;
    private _heading;
    private _permissionState;
    private _error;
    private _errorInfo;
    private _subscribed;
    private _supportedPublished;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get alpha(): number | null;
    get beta(): number | null;
    get gamma(): number | null;
    get absolute(): boolean | null;
    /**
     * Degrees clockwise from north of the direction the top of the device points
     * (0 = north, 90 = east), or null until an event says it.
     */
    get heading(): number | null;
    get permissionState(): TiltPermissionState;
    get error(): any;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-tilt:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    /**
     * Whether this page can use Device Orientation: `DeviceOrientationEvent` is
     * there, and neither an insecure context nor a Permissions-Policy that
     * forbids `accelerometer` / `gyroscope` (Chromium sends no
     * `deviceorientation` under one) is in the way. Read at call time, never
     * cached. It cannot say whether the device has a sensor.
     */
    get supported(): boolean;
    /**
     * Dispatch `wcs-tilt:supported-changed` when `supported` differs from the
     * value last dispatched (false before the first). The Shell calls it on
     * connect (through observe()), so a listener other than a binding — which
     * reads the property when it binds — learns the value too.
     */
    publishSupported(): void;
    observe(): Promise<void>;
    dispose(): void;
    private _deviceOrientationEventCtor;
    private _setHeading;
    private _setPermissionState;
    private _setError;
    private _commitErrorInfo;
    /**
     * Wraps iOS 13+ Safari's static, gesture-gated
     * `DeviceOrientationEvent.requestPermission()`. On platforms without this
     * gate (Android Chrome, desktop) there is nothing to ask, so this resolves
     * to `"granted"` immediately without querying anything — callers can write
     * one `requestPermission()` → `start()` flow that works everywhere
     * (docs/device-orientation-tag-design.md §3).
     *
     * `permissionState` changes only when the browser answers. A rejection is
     * not an answer: iOS rejects (`NotAllowedError`) when the call does not come
     * from a tap, without showing the question, and a later call from a tap can
     * still be granted. So a rejection leaves `permissionState` as it was, puts
     * the raw error in `error` (never-throw, §3.6) and resolves to the unchanged
     * state. Where the browser has no `DeviceOrientationEvent` at all it is the
     * same: `error` says so (`capability-missing`) and the state stays.
     *
     * Any answer — granted, a plain denied, the immediate granted of a platform
     * without the gate — supersedes a stale `error` from an earlier attempt, as
     * in `<wcs-idle>`'s `requestPermission()` (docs/idle-detection-tag-design.md
     * §4.1).
     */
    requestPermission(): Promise<TiltPermissionState>;
    /**
     * Subscribe to `deviceorientation`, and to `deviceorientationabsolute` where
     * the browser has it (the event Android Chrome carries north in). Idempotent
     * — a second start() while already subscribed is a no-op. Where the browser
     * has no `DeviceOrientationEvent`, no event can come: `error` says so and
     * nothing is subscribed.
     */
    start(): void;
    /** Unsubscribe from both events. Safe to call when not started. */
    stop(): void;
    private _onOrientation;
    private _onAbsoluteOrientation;
    private _applyAbsoluteAlpha;
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
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get alpha(): number | null;
    get beta(): number | null;
    get gamma(): number | null;
    get absolute(): boolean | null;
    get heading(): number | null;
    get permissionState(): TiltPermissionState;
    get error(): any;
    get errorInfo(): WcsIoErrorInfo | null;
    get supported(): boolean;
    get connectedCallbackPromise(): Promise<void>;
    requestPermission(): Promise<TiltPermissionState>;
    start(): void;
    stop(): void;
    connectedCallback(): void;
    connectedMoveCallback(): void;
    disconnectedCallback(): void;
}

/**
 * tiltCapabilities.ts
 *
 * Tilt(Device Orientation)node 固有の error code(taxonomy)と derivation。汎用の
 * error info 型は `./platformCapability.js`(/io-core/ から copy-distribution される
 * 生成ファイル)から import する。tilt は監視系(deviceorientation の subscribe/
 * unsubscribe)で競合する operation を持たないため lane は持たず、error taxonomy
 * (errorInfo)のみを採用する。
 *
 * sensor 4 兄弟(accelerometer / gyroscope / magnetometer / ambient-light-sensor)と
 * 違い、tilt の error 面は **異なる shape** を持つ:
 * - sensor 族の error detail は `{ error: <Error.name>, message }`(name/message は文字列)。
 * - tilt の error detail は `{ error: <生の rejection reason> }`(TiltCore._setError が
 *   `requestPermission()` の catch で `{ error: e }` を渡す。`e` は生の Error/reason)。
 *
 * したがって derive は「wrap された生の値」から name/message を取り出す。error として
 * _setError に届くのは 2 種類:
 * - iOS の `requestPermission()` の reject。タップ(user gesture)の外から呼ぶと iOS は
 *   質問を出さずに `NotAllowedError` で reject する。利用者の拒否ではない(利用者が
 *   拒否したときは reject ではなく `"denied"` で resolve する)。
 * - `DeviceOrientationEvent` そのものが無い環境(一部のデスクトップ、Windows 上の
 *   Playwright の WebKit)。`requestPermission()` / `start()` が `{ error: { name:
 *   "unsupported", message } }` を渡す → capability-missing。`DeviceOrientationEvent` は
 *   あるが `requestPermission` が無い環境(Android・デスクトップ)は error にせず
 *   `"granted"` に倒す(docs/device-orientation-tag-design.md §3)。
 */

/** 安定した tilt error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_TILT_ERROR_CODE: {
    /** `DeviceOrientationEvent` がこのブラウザに無い。 */
    readonly CapabilityMissing: "capability-missing";
    /** `NotAllowedError` — iOS が質問を出さなかった(タップの外からの `requestPermission()`)。 */
    readonly NotAllowed: "not-allowed";
    /** その他の `requestPermission()` reject(想定外の失敗)。 */
    readonly TiltError: "tilt-error";
};

declare global {
    interface HTMLElementTagNameMap {
        "wcs-tilt": WcsTilt;
    }
}

export { TiltCore, WCS_TILT_ERROR_CODE, WcsTilt, bootstrapTilt, getConfig };
export type { IWritableConfig, IWritableTagNames, TiltPermissionState, WcsIoErrorInfo, WcsIoErrorPhase, WcsTiltCoreValues, WcsTiltValues };
