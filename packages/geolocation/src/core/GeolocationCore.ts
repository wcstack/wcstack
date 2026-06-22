import {
  IWcBindable, GeoOptions, GeoPermissionState,
  WcsGeoPositionDetail, WcsGeoCoords, WcsGeoErrorDetail,
} from "../types.js";

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
export class GeolocationCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "position", event: "wcs-geo:position" },
      { name: "latitude", event: "wcs-geo:position", getter: (e: Event) => (e as CustomEvent).detail.latitude },
      { name: "longitude", event: "wcs-geo:position", getter: (e: Event) => (e as CustomEvent).detail.longitude },
      { name: "accuracy", event: "wcs-geo:position", getter: (e: Event) => (e as CustomEvent).detail.accuracy },
      { name: "coords", event: "wcs-geo:position", getter: (e: Event) => (e as CustomEvent).detail.coords },
      { name: "timestamp", event: "wcs-geo:position", getter: (e: Event) => (e as CustomEvent).detail.timestamp },
      { name: "watching", event: "wcs-geo:watching-changed" },
      { name: "loading", event: "wcs-geo:loading-changed" },
      { name: "error", event: "wcs-geo:error" },
      { name: "permission", event: "wcs-geo:permission-changed" },
    ],
    commands: [
      { name: "getCurrentPosition", async: true },
      { name: "watch" },
      { name: "clearWatch" },
    ],
  };

  private _target: EventTarget;
  private _watchId: number | null = null;

  private _position: WcsGeoPositionDetail | null = null;
  private _watching: boolean = false;
  private _loading: boolean = false;
  private _error: WcsGeoErrorDetail | null = null;
  private _permission: GeoPermissionState = "prompt";

  // Live PermissionStatus handle (when the Permissions API is available), kept
  // so the `change` listener can be removed on dispose().
  private _permissionStatus: PermissionStatus | null = null;

  // True once a permission subscription has been (or is being) established, and
  // reset by dispose(). Guards reinitPermission() so the first connect after
  // construction does not double-subscribe, while a reconnect after dispose()
  // does re-subscribe.
  private _permissionSubscribed: boolean = false;

  // Monotonic id of the current permission query. Bumped by every _initPermission()
  // and by dispose(). Each in-flight query captures its id and, on resolve, bails
  // unless it is still current — so a query superseded by a rapid (synchronous)
  // disconnect→reconnect, or one that resolves after dispose(), never attaches a
  // listener. A plain boolean cannot cover this: dispose()→reinit() flips it
  // false→true again, reopening the window for the stale query to slip through.
  private _permGen: number = 0;

  // Monotonic id of the current acquisition lifecycle, bumped only by dispose().
  // Each getCurrentPosition() captures it at start; the async success/error
  // callback bails (no setters, no resolve-side effects) if it is stale, so a
  // one-shot fix that resolves after the element was disconnected does not
  // dispatch wcs-geo:* on a torn-down element. Unlike FetchCore, the Geolocation
  // API has no AbortController, so a generation guard is the only way to neutralize
  // an in-flight one-shot. (watch is already stopped by clearWatch on disconnect.)
  private _acqGen: number = 0;

  // Monotonic id of the current watch lifecycle, bumped by watch(), clearWatch(),
  // and dispose(). Each watch() captures it; both watch callbacks bail if it is
  // stale. Unlike a live `_watchId === null` check, this distinguishes the current
  // watch from a superseded one: a clearWatch()→watch() restart installs a new
  // watchId (non-null), so a queued callback from the previous watch would pass a
  // null-check but fails the generation compare. (The README recommends exactly
  // this restart sequence to reconfigure a watch.)
  private _watchGen: number = 0;

  // Resolves once the most recent permission probe settles (or immediately when
  // the Permissions API is unsupported). The Shell exposes this as
  // connectedCallbackPromise so SSR can await the first probe before snapshotting
  // the HTML. Mirrors PermissionCore._ready.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
    // Probe the permission state up front so observers see the real value
    // (granted/denied/prompt) before the first read, then keep it live.
    this._ready = this._initPermission();
  }

  get position(): WcsGeoPositionDetail | null {
    return this._position;
  }

  get latitude(): number | null {
    return this._position ? this._position.latitude : null;
  }

  get longitude(): number | null {
    return this._position ? this._position.longitude : null;
  }

  get accuracy(): number | null {
    return this._position ? this._position.accuracy : null;
  }

  get coords(): WcsGeoCoords | null {
    return this._position ? this._position.coords : null;
  }

  get timestamp(): number | null {
    return this._position ? this._position.timestamp : null;
  }

  get watching(): boolean {
    return this._watching;
  }

  get loading(): boolean {
    return this._loading;
  }

  get error(): WcsGeoErrorDetail | null {
    return this._error;
  }

  get permission(): GeoPermissionState {
    return this._permission;
  }

  /** Resolves once the first (or most recent) permission probe settles (§3.8). */
  get ready(): Promise<void> {
    return this._ready;
  }

  // --- State setters with event dispatch ---

  private _setPosition(position: WcsGeoPositionDetail): void {
    this._position = position;
    this._target.dispatchEvent(new CustomEvent("wcs-geo:position", {
      detail: position,
      bubbles: true,
    }));
  }

  private _setWatching(watching: boolean): void {
    if (this._watching === watching) return;
    this._watching = watching;
    this._target.dispatchEvent(new CustomEvent("wcs-geo:watching-changed", {
      detail: watching,
      bubbles: true,
    }));
  }

  private _setLoading(loading: boolean): void {
    if (this._loading === loading) return;
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-geo:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setError(error: WcsGeoErrorDetail | null): void {
    // Same-value guard, like the other setters. Unlike `position` (which has
    // derived getters and so must re-fire even on an identical reference), `error`
    // has no derived state — so suppressing redundant null→null dispatches (e.g.
    // a successful fix clearing an already-null error) avoids spurious events.
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-geo:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setPermission(permission: GeoPermissionState): void {
    if (this._permission === permission) return;
    this._permission = permission;
    this._target.dispatchEvent(new CustomEvent("wcs-geo:permission-changed", {
      detail: permission,
      bubbles: true,
    }));
  }

  // --- Public API ---

  /**
   * Acquire a single position fix. Resolves once the fix arrives or the request
   * fails — never rejects: failures are surfaced through the `error` property so
   * they flow into the declarative state, symmetrical with FetchCore.
   */
  getCurrentPosition(options: GeoOptions = {}): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this._hasGeolocation()) {
        this._setError(this._unsupportedError());
        resolve();
        return;
      }

      const gen = this._acqGen;
      this._setLoading(true);
      this._setError(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          // Stale: the element was disposed (disconnected) while this fix was in
          // flight. Drop it so a torn-down element never dispatches wcs-geo:*.
          // Still resolve() so any awaiter (e.g. connectedCallbackPromise) settles.
          if (gen !== this._acqGen) {
            resolve();
            return;
          }
          // Guard normalization/dispatch so a throw never escapes this browser
          // callback as an unhandled rejection, leaves the promise pending (which
          // would hang SSR's connectedCallbackPromise), or leaves `loading` stuck
          // true. Loading is cleared first so it holds even if a later step throws.
          try {
            this._setLoading(false);
            this._setPosition(this._normalizePosition(pos));
          } catch {
            // Surface the unexpected failure as an error so observers are not left
            // silently stale, then resolve below.
            this._setError(this._unexpectedError());
          }
          resolve();
        },
        (err) => {
          if (gen !== this._acqGen) {
            resolve();
            return;
          }
          try {
            this._setLoading(false);
            this._setError(this._normalizeError(err));
          } catch {
            this._setError(this._unexpectedError());
          }
          resolve();
        },
        options,
      );
    });
  }

  /**
   * Begin continuously watching the position. Idempotent while already
   * watching: a redundant watch() must not register a second `watchPosition`
   * (which would leak the handle and double the fix rate). Reconfiguring is done
   * via clearWatch() + watch().
   */
  watch(options: GeoOptions = {}): void {
    if (!this._hasGeolocation()) {
      this._setError(this._unsupportedError());
      return;
    }
    if (this._watching) return;

    this._setError(null);
    this._setWatching(true);
    // Open a new watch generation so any queued callback from a prior watch
    // (cleared then restarted) is recognized as stale below.
    const wgen = ++this._watchGen;
    this._watchId = navigator.geolocation.watchPosition(
      (pos) => {
        // Stale: this callback belongs to a watch that was cleared (or the element
        // disposed), possibly already superseded by a restart. A live
        // `_watchId === null` check cannot catch the restart case (the new watch
        // re-populates _watchId), so compare the captured generation instead.
        if (wgen !== this._watchGen) return;
        // Guard normalization/dispatch so an unexpected throw never escapes this
        // browser callback as an unhandled rejection — symmetric with the one-shot
        // path.
        try {
          // A recovered fix clears any prior transient error (e.g. a one-off
          // TIMEOUT) so `error` reflects the current state, not a stale failure.
          // The _setError same-value guard makes this free when error is already
          // null.
          this._setError(null);
          this._setPosition(this._normalizePosition(pos));
        } catch {
          this._setError(this._unexpectedError());
        }
      },
      (err) => {
        if (wgen !== this._watchGen) return;
        // An error does not implicitly release the watch — the watchId stays
        // valid and clearWatch() remains the teardown path — so `watching` is
        // left true to reflect "watch still registered". A terminal error (e.g.
        // PERMISSION_DENIED) is surfaced via the `error` property; callers that
        // want to stop on error can call clearWatch() in response.
        try {
          this._setError(this._normalizeError(err));
        } catch {
          this._setError(this._unexpectedError());
        }
      },
      options,
    );
  }

  clearWatch(): void {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
    // Invalidate the current watch generation so any callback the browser may
    // still deliver after teardown bails.
    this._watchGen++;
    this._setWatching(false);
  }

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
  observe(): Promise<void> {
    if (!this._permissionSubscribed) {
      this._ready = this._initPermission();
    }
    return this._ready;
  }

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
  reinitPermission(): void {
    void this.observe();
  }

  /**
   * Detach the live permission `change` listener. Call from the Shell's
   * `disconnectedCallback` so a removed element does not leak the subscription.
   * A later reconnect can re-subscribe via reinitPermission().
   */
  dispose(): void {
    this._permissionSubscribed = false;
    // Invalidate any in-flight query so its .then() bails instead of attaching a
    // listener after teardown.
    this._permGen++;
    // Invalidate any in-flight one-shot acquisition so its success/error callback
    // bails instead of dispatching on a disconnected element.
    this._acqGen++;
    // Likewise invalidate the watch generation. The Shell already calls
    // clearWatch() before dispose(), but a direct headless dispose() (without a
    // preceding clearWatch) still neutralizes any queued watch callback.
    this._watchGen++;
    // Reset the loading shadow silently (no dispatch on a disposed element). The
    // bailed callback above will not clear it, and leaving it true would let the
    // same-value guard swallow the loading=true edge of the next acquisition after
    // a reconnect.
    this._loading = false;
    if (this._permissionStatus) {
      this._permissionStatus.removeEventListener("change", this._onPermissionChange);
      this._permissionStatus = null;
    }
  }

  // --- Internal ---

  private _hasGeolocation(): boolean {
    return typeof navigator !== "undefined" && !!navigator.geolocation;
  }

  private _initPermission(): Promise<void> {
    // The Permissions API is optional. When absent (or it rejects, e.g. some
    // browsers don't accept the "geolocation" name), report "unsupported" and
    // leave acquisition to fail loudly via the error property if attempted.
    if (typeof navigator === "undefined" || !navigator.permissions || typeof navigator.permissions.query !== "function") {
      // Route through _setPermission (not a bare assignment) so observers stay in
      // sync with the public state. The same-value guard means no redundant
      // dispatch when the state does not actually change; it does mean a
      // previously-observed "granted"/"denied" being reinit'd into an environment
      // that lost the Permissions API now correctly notifies observers of the
      // unsupported transition instead of silently overwriting the shadow value.
      this._setPermission("unsupported");
      // No asynchronous probe to await: readiness is immediate.
      return Promise.resolve();
    }
    this._permissionSubscribed = true;
    const gen = ++this._permGen;
    return navigator.permissions.query({ name: "geolocation" as PermissionName }).then(
      (status) => {
        // Stale resolution: this query was superseded (rapid reconnect) or the
        // element was disposed while it was in flight. Drop it so only the current
        // subscription attaches a listener.
        if (gen !== this._permGen) return;
        this._permissionStatus = status;
        this._setPermission(status.state as GeoPermissionState);
        status.addEventListener("change", this._onPermissionChange);
      },
      () => {
        if (gen !== this._permGen) return;
        this._setPermission("unsupported");
      },
    );
  }

  private _onPermissionChange = (event: Event): void => {
    const status = event.target as PermissionStatus;
    this._setPermission(status.state as GeoPermissionState);
  };

  private _normalizePosition(pos: GeolocationPosition): WcsGeoPositionDetail {
    const c = pos.coords;
    const coords: WcsGeoCoords = {
      latitude: c.latitude,
      longitude: c.longitude,
      accuracy: c.accuracy,
      altitude: c.altitude,
      altitudeAccuracy: c.altitudeAccuracy,
      heading: c.heading,
      speed: c.speed,
    };
    return { ...coords, timestamp: pos.timestamp, coords };
  }

  private _normalizeError(err: GeolocationPositionError): WcsGeoErrorDetail {
    return { code: err.code, message: err.message };
  }

  private _unsupportedError(): WcsGeoErrorDetail {
    // Geolocation API absent: surface it as POSITION_UNAVAILABLE (2) so consumers
    // that switch on the spec error codes treat it like any other unavailable fix.
    return { code: 2, message: "Geolocation API is not available in this environment." };
  }

  private _unexpectedError(): WcsGeoErrorDetail {
    // An unexpected throw while normalizing/dispatching a fix. Surface it as
    // POSITION_UNAVAILABLE (2) so it flows into `error` like any other failure
    // instead of escaping the browser callback as an unhandled rejection.
    return { code: 2, message: "Unexpected error while processing the position fix." };
  }
}
