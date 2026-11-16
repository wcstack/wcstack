import { IWcBindable, TiltPermissionState } from "../types.js";
import { WcsIoErrorInfo, featureUnavailable } from "./platformCapability.js";
import { deriveTiltErrorInfo } from "./tiltCapabilities.js";

interface DeviceOrientationEventCtor {
  requestPermission?: () => Promise<"granted" | "denied">;
}

interface WcsTiltSnapshot {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean | null;
}

const UNSUPPORTED_SNAPSHOT: WcsTiltSnapshot = Object.freeze({
  alpha: null,
  beta: null,
  gamma: null,
  absolute: null,
});

// The browser has no `DeviceOrientationEvent` at all (some desktop browsers,
// Playwright's WebKit on Windows): nothing can be asked and no event can come.
// One shared object, so the `===` guard in _setError says it once however often
// requestPermission() / start() are called there (the shape screen-orientation
// uses for its "unsupported", docs/timing-and-firing-contract.md §7.4).
const UNSUPPORTED_ERROR = Object.freeze({
  error: Object.freeze({
    name: "unsupported",
    message: "DeviceOrientationEvent is not supported in this browser.",
  }),
});

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
export class TiltCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "alpha", event: "wcs-tilt:change", semantics: "state", getter: (e: Event) => (e as CustomEvent).detail.alpha },
      { name: "beta", event: "wcs-tilt:change", semantics: "state", getter: (e: Event) => (e as CustomEvent).detail.beta },
      { name: "gamma", event: "wcs-tilt:change", semantics: "state", getter: (e: Event) => (e as CustomEvent).detail.gamma },
      { name: "absolute", event: "wcs-tilt:change", semantics: "state", getter: (e: Event) => (e as CustomEvent).detail.absolute },
      // Degrees clockwise from north of the direction the top of the device
      // points, or null until an event says it. Its own event: north comes from
      // `deviceorientationabsolute` (Android Chrome) or `webkitCompassHeading`
      // (iOS Safari), not from the fields of wcs-tilt:change.
      { name: "heading", event: "wcs-tilt:heading-changed", semantics: "state" },
      { name: "permissionState", event: "wcs-tilt:permission-changed", semantics: "state" },
      // never-throw (§3.6): requestPermission() failures land here instead of
      // rejecting/throwing. Mirrors idle (same batch2) and the accelerometer
      // family (batch5) — see docs/io-node-batch-implementation-plan.md.
      { name: "error", event: "wcs-tilt:error", semantics: "state" },
      // Serializable failure taxonomy (stable code / phase / recoverable), or null.
      // Additive bindable output derived from `error.error` (the wrapped rejection's
      // Error.name); the existing `error` property/event are unchanged. Fires
      // wcs-tilt:error-info-changed. No lane — this is a monitor node.
      { name: "errorInfo", event: "wcs-tilt:error-info-changed", semantics: "state" },
      // This page can use Device Orientation: the API is there and neither a
      // Permissions-Policy nor an insecure context forbids it. Not whether the
      // device has a sensor, and not whether the user will allow it.
      { name: "supported", event: "wcs-tilt:supported-changed", semantics: "state" },
    ],
    commands: [
      { name: "requestPermission", async: true },
      { name: "start" },
      { name: "stop" },
    ],
  };

  private _target: EventTarget;
  private _snapshot: WcsTiltSnapshot = UNSUPPORTED_SNAPSHOT;
  private _heading: number | null = null;
  private _permissionState: TiltPermissionState = "unknown";
  private _error: any = null;
  private _errorInfo: WcsIoErrorInfo | null = null;
  private _subscribed = false;
  // The value the last wcs-tilt:supported-changed carried (none yet: false).
  private _supportedPublished = false;

  // SSR (§3.8): never auto-starts on connect, so there is no probe to await —
  // readiness is always immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  get alpha(): number | null {
    return this._snapshot.alpha;
  }

  get beta(): number | null {
    return this._snapshot.beta;
  }

  get gamma(): number | null {
    return this._snapshot.gamma;
  }

  get absolute(): boolean | null {
    return this._snapshot.absolute;
  }

  /**
   * Degrees clockwise from north of the direction the top of the device points
   * (0 = north, 90 = east), or null until an event says it.
   */
  get heading(): number | null {
    return this._heading;
  }

  get permissionState(): TiltPermissionState {
    return this._permissionState;
  }

  get error(): any {
    return this._error;
  }

  /**
   * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
   * `recoverable`), or null. Additive wc-bindable property (event
   * `wcs-tilt:error-info-changed`), derived from `error`; the existing `error`
   * property/event are unchanged.
   */
  get errorInfo(): WcsIoErrorInfo | null {
    return this._errorInfo;
  }

  /**
   * Whether this page can use Device Orientation: `DeviceOrientationEvent` is
   * there, and neither an insecure context nor a Permissions-Policy that
   * forbids `accelerometer` / `gyroscope` (Chromium sends no
   * `deviceorientation` under one) is in the way. Read at call time, never
   * cached. It cannot say whether the device has a sensor.
   */
  get supported(): boolean {
    return this._deviceOrientationEventCtor() !== undefined &&
      featureUnavailable("accelerometer") === null &&
      featureUnavailable("gyroscope") === null;
  }

  /**
   * Dispatch `wcs-tilt:supported-changed` when `supported` differs from the
   * value last dispatched (false before the first). The Shell calls it on
   * connect (through observe()), so a listener other than a binding — which
   * reads the property when it binds — learns the value too.
   */
  publishSupported(): void {
    const supported = this.supported;
    if (this._supportedPublished === supported) return;
    this._supportedPublished = supported;
    this._target.dispatchEvent(new CustomEvent("wcs-tilt:supported-changed", {
      detail: supported,
      bubbles: true,
    }));
  }

  // Lifecycle (§3.5). observe() subscribes to nothing: like `<wcs-idle>`,
  // this Core deliberately does NOT auto-start on connect (§6) on platforms
  // that gate deviceorientation behind requestPermission(). It only publishes
  // `supported`.
  observe(): Promise<void> {
    this.publishSupported();
    return this._ready;
  }

  dispose(): void {
    this.stop();
  }

  private _deviceOrientationEventCtor(): DeviceOrientationEventCtor | undefined {
    const g = globalThis as any;
    return typeof g.DeviceOrientationEvent === "function" ? g.DeviceOrientationEvent : undefined;
  }

  // Same-value guard (§3.3 MUST).
  private _setHeading(heading: number): void {
    if (this._heading === heading) return;
    this._heading = heading;
    this._target.dispatchEvent(new CustomEvent("wcs-tilt:heading-changed", {
      detail: heading,
      bubbles: true,
    }));
  }

  private _setPermissionState(state: TiltPermissionState): void {
    if (this._permissionState === state) return;
    this._permissionState = state;
    this._target.dispatchEvent(new CustomEvent("wcs-tilt:permission-changed", {
      detail: state,
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    if (this._error === error) return;
    this._error = error;
    // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
    // wrapped rejection (or null on clear). Fires before the `error` event so an
    // observer binding both sees the classification first, mirroring the io-node
    // family.
    this._commitErrorInfo(error === null ? null : deriveTiltErrorInfo(error));
    this._target.dispatchEvent(new CustomEvent("wcs-tilt:error", {
      detail: error,
      bubbles: true,
    }));
  }

  // Called only from _setError (which already reference-guards on the error
  // object), so errorInfo transitions exactly when error does — no separate
  // guard needed here.
  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-tilt:error-info-changed", {
      detail: info,
      bubbles: true,
    }));
  }

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
  async requestPermission(): Promise<TiltPermissionState> {
    const Ctor = this._deviceOrientationEventCtor();
    if (Ctor === undefined) {
      this._setError(UNSUPPORTED_ERROR);
      return this._permissionState;
    }
    if (typeof Ctor.requestPermission !== "function") {
      this._setError(null);
      this._setPermissionState("granted");
      return "granted";
    }
    try {
      const result = await Ctor.requestPermission();
      const state: TiltPermissionState = result === "granted" ? "granted" : "denied";
      this._setError(null);
      this._setPermissionState(state);
      return state;
    } catch (e) {
      // never-throw. The browser refused to ask: the user was not asked, so
      // nothing is known about the permission that was not known before.
      this._setError({ error: e });
      return this._permissionState;
    }
  }

  /**
   * Subscribe to `deviceorientation`, and to `deviceorientationabsolute` where
   * the browser has it (the event Android Chrome carries north in). Idempotent
   * — a second start() while already subscribed is a no-op. Where the browser
   * has no `DeviceOrientationEvent`, no event can come: `error` says so and
   * nothing is subscribed.
   */
  start(): void {
    if (this._subscribed) return;
    if (this._deviceOrientationEventCtor() === undefined) {
      this._setError(UNSUPPORTED_ERROR);
      return;
    }
    this._subscribed = true;
    const win = globalThis.window;
    win?.addEventListener("deviceorientation", this._onOrientation as EventListener);
    if (win && "ondeviceorientationabsolute" in win) {
      win.addEventListener("deviceorientationabsolute", this._onAbsoluteOrientation as EventListener);
    }
  }

  /** Unsubscribe from both events. Safe to call when not started. */
  stop(): void {
    if (!this._subscribed) return;
    this._subscribed = false;
    const win = globalThis.window;
    win?.removeEventListener("deviceorientation", this._onOrientation as EventListener);
    win?.removeEventListener("deviceorientationabsolute", this._onAbsoluteOrientation as EventListener);
  }

  private _onOrientation = (event: DeviceOrientationEvent): void => {
    this._apply({
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      absolute: event.absolute,
    });
    // North. iOS Safari: `alpha` is relative and the compass is the
    // non-standard `webkitCompassHeading`, already clockwise from north.
    // Elsewhere only an event that says it is absolute carries north.
    const compass = (event as { webkitCompassHeading?: unknown }).webkitCompassHeading;
    if (typeof compass === "number" && Number.isFinite(compass)) {
      this._setHeading(compass);
    } else if (event.absolute === true) {
      this._applyAbsoluteAlpha(event.alpha);
    }
  };

  // `deviceorientationabsolute` (Android Chrome, where `deviceorientation` is
  // relative): north only. alpha / beta / gamma / absolute keep coming from
  // `deviceorientation`, so this event writes none of them.
  private _onAbsoluteOrientation = (event: DeviceOrientationEvent): void => {
    this._applyAbsoluteAlpha(event.alpha);
  };

  // An absolute `alpha` grows counter-clockwise from north; a compass heading
  // grows clockwise. An event without a finite `alpha` says nothing about north.
  private _applyAbsoluteAlpha(alpha: number | null): void {
    if (typeof alpha === "number" && Number.isFinite(alpha)) {
      this._setHeading((360 - alpha) % 360);
    }
  }

  // Same-value guard (§3.3 MUST).
  private _apply(next: WcsTiltSnapshot): void {
    const prev = this._snapshot;
    if (
      prev.alpha === next.alpha &&
      prev.beta === next.beta &&
      prev.gamma === next.gamma &&
      prev.absolute === next.absolute
    ) {
      return;
    }
    this._snapshot = next;
    this._target.dispatchEvent(new CustomEvent("wcs-tilt:change", {
      detail: next,
      bubbles: true,
    }));
  }
}
