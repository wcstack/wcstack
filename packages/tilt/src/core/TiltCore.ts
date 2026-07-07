import { IWcBindable, TiltPermissionState } from "../types.js";

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
      { name: "alpha", event: "wcs-tilt:change", getter: (e: Event) => (e as CustomEvent).detail.alpha },
      { name: "beta", event: "wcs-tilt:change", getter: (e: Event) => (e as CustomEvent).detail.beta },
      { name: "gamma", event: "wcs-tilt:change", getter: (e: Event) => (e as CustomEvent).detail.gamma },
      { name: "absolute", event: "wcs-tilt:change", getter: (e: Event) => (e as CustomEvent).detail.absolute },
      { name: "permissionState", event: "wcs-tilt:permission-changed" },
      // never-throw (§3.6): requestPermission() failures land here instead of
      // rejecting/throwing. Mirrors idle (same batch2) and the accelerometer
      // family (batch5) — see docs/io-node-batch-implementation-plan.md.
      { name: "error", event: "wcs-tilt:error" },
    ],
    commands: [
      { name: "requestPermission", async: true },
      { name: "start" },
      { name: "stop" },
    ],
  };

  private _target: EventTarget;
  private _snapshot: WcsTiltSnapshot = UNSUPPORTED_SNAPSHOT;
  private _permissionState: TiltPermissionState = "unknown";
  private _error: any = null;
  private _subscribed = false;

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

  get permissionState(): TiltPermissionState {
    return this._permissionState;
  }

  get error(): any {
    return this._error;
  }

  // Lifecycle (§3.5). observe() is a synchronous no-op: like `<wcs-idle>`,
  // this Core deliberately does NOT auto-start on connect (§6) on platforms
  // that gate deviceorientation behind requestPermission().
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    this.stop();
  }

  private _deviceOrientationEventCtor(): DeviceOrientationEventCtor | undefined {
    const g = globalThis as any;
    return typeof g.DeviceOrientationEvent !== "undefined" ? g.DeviceOrientationEvent : undefined;
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
    this._target.dispatchEvent(new CustomEvent("wcs-tilt:error", {
      detail: error,
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
   * never-throw (§3.6): a gesture-context rejection resolves to `"denied"`
   * and the raw error lands in `error` instead of propagating. Mirrors
   * `<wcs-idle>`'s `requestPermission()` (docs/idle-detection-tag-design.md
   * §4.1) — any settled (non-throwing) outcome supersedes a stale `error`
   * from an earlier attempt.
   */
  async requestPermission(): Promise<TiltPermissionState> {
    const Ctor = this._deviceOrientationEventCtor();
    if (typeof Ctor?.requestPermission !== "function") {
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
      // never-throw: a gesture-context rejection resolves to "denied".
      this._setError({ error: e });
      this._setPermissionState("denied");
      return "denied";
    }
  }

  /** Subscribe to `deviceorientation`. Idempotent — a second start() while already subscribed is a no-op. */
  start(): void {
    if (this._subscribed) return;
    this._subscribed = true;
    globalThis.window?.addEventListener("deviceorientation", this._onOrientation as EventListener);
  }

  /** Unsubscribe from `deviceorientation`. Safe to call when not started. */
  stop(): void {
    if (!this._subscribed) return;
    this._subscribed = false;
    globalThis.window?.removeEventListener("deviceorientation", this._onOrientation as EventListener);
  }

  private _onOrientation = (event: DeviceOrientationEvent): void => {
    this._apply({
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      absolute: event.absolute,
    });
  };

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
