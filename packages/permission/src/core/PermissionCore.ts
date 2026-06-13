import {
  IWcBindable, PermissionStateOrUnsupported, WcsPermissionDescriptor,
} from "../types.js";

/**
 * Headless permission-state primitive. A thin, framework-agnostic wrapper around
 * the Permissions API exposed through the wc-bindable protocol.
 *
 * Unlike the other @wcstack IO nodes (geolocation / clipboard / sse / …), the
 * Permissions API is **read-only**: it has `query()` but no standard `request()`.
 * Asking the user for a grant is the job of the feature node (`<wcs-geo>` etc.);
 * this node only *observes*. It is therefore a pure element → state monitor with
 * **no commands** — command-token does not apply, only event-token.
 *
 * The single observable is `state` (`navigator.permissions.query(descriptor)`'s
 * `PermissionState`, or `"unsupported"`), published via the `wcs-permission:change`
 * event. `granted` / `denied` / `prompt` / `unsupported` are convenience booleans
 * derived from that one event (mirroring how GeolocationCore exposes latitude/…
 * from one `wcs-geo:position` event), so a binding like `hidden@granted` works
 * directly. The live `change` event of the PermissionStatus is tracked so a grant
 * flipping in browser settings flows into the declarative state.
 */
export class PermissionCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "state", event: "wcs-permission:change" },
      { name: "granted", event: "wcs-permission:change", getter: (e: Event) => (e as CustomEvent).detail === "granted" },
      { name: "denied", event: "wcs-permission:change", getter: (e: Event) => (e as CustomEvent).detail === "denied" },
      { name: "prompt", event: "wcs-permission:change", getter: (e: Event) => (e as CustomEvent).detail === "prompt" },
      { name: "unsupported", event: "wcs-permission:change", getter: (e: Event) => (e as CustomEvent).detail === "unsupported" },
    ],
    // No commands: the Permissions API is read-only (query-only). See class docs.
    commands: [],
  };

  private _target: EventTarget;
  private _descriptor: WcsPermissionDescriptor | null = null;

  private _state: PermissionStateOrUnsupported = "prompt";

  // Live PermissionStatus handle (when the Permissions API is available), kept so
  // the `change` listener can be removed on dispose().
  private _permissionStatus: PermissionStatus | null = null;

  // True once a permission subscription has been (or is being) established, and
  // reset by dispose(). Guards observe() so a reconnect after dispose() re-queries
  // while a redundant observe() on an already-live subscription does not.
  private _permissionSubscribed: boolean = false;

  // Monotonic id of the current permission query. Bumped by every _initPermission()
  // and by dispose(). Each in-flight query captures its id and, on resolve, bails
  // unless it is still current — so a query superseded by a rapid (synchronous)
  // disconnect→reconnect, or one that resolves after dispose(), never attaches a
  // listener. A plain boolean cannot cover this: dispose()→observe() flips it
  // false→true again, reopening the window for the stale query to slip through.
  private _permGen: number = 0;

  // Resolves once the most recent query settles (or immediately when the API is
  // unsupported). The Shell exposes this as connectedCallbackPromise so SSR can
  // await the first probe before snapshotting the HTML.
  private _ready: Promise<void> = Promise.resolve();

  constructor(descriptor?: WcsPermissionDescriptor | null, target?: EventTarget) {
    super();
    this._target = target ?? this;
    // Headless ergonomics: when a descriptor is supplied up front, probe the
    // permission state immediately so observers see the real value before the
    // first read. The Shell passes nothing and drives the first query from
    // connectedCallback via observe(), once the element's attributes resolve.
    if (descriptor) {
      this._descriptor = descriptor;
      this._ready = this._initPermission();
    }
  }

  get state(): PermissionStateOrUnsupported {
    return this._state;
  }

  get granted(): boolean {
    return this._state === "granted";
  }

  get denied(): boolean {
    return this._state === "denied";
  }

  get prompt(): boolean {
    return this._state === "prompt";
  }

  get unsupported(): boolean {
    return this._state === "unsupported";
  }

  /** Resolves once the current (or initial) query settles. */
  get ready(): Promise<void> {
    return this._ready;
  }

  // --- State setter with event dispatch ---

  private _setState(state: PermissionStateOrUnsupported): void {
    // Same-value guard: `state` is the only stored value and the derived booleans
    // change in lockstep with it, so suppressing identical re-dispatches is safe.
    if (this._state === state) return;
    this._state = state;
    this._target.dispatchEvent(new CustomEvent("wcs-permission:change", {
      detail: state,
      bubbles: true,
    }));
  }

  // --- Public API ---

  /**
   * Start observing `descriptor` (e.g. `{ name: "geolocation" }`). Idempotent
   * while already subscribed — calling it again only updates the stored descriptor
   * for a *future* re-subscription; it does **not** re-query, even when called with
   * a different descriptor (the Shell binds at a fixed connect-time descriptor and
   * does not re-query on a `name` change in v1). To switch permission mid-life,
   * dispose() first, then observe() the new descriptor. On the first call, or after
   * a dispose(), it issues the query and subscribes to the live `change` event.
   * Returns a promise that resolves once that query settles, for SSR.
   */
  observe(descriptor: WcsPermissionDescriptor): Promise<void> {
    this._descriptor = descriptor;
    if (!this._permissionSubscribed) {
      this._ready = this._initPermission();
    }
    return this._ready;
  }

  /**
   * Detach the live permission `change` listener. Call from the Shell's
   * `disconnectedCallback` so a removed element does not leak the subscription.
   * A later reconnect can re-subscribe via observe().
   *
   * Headless callers (using PermissionCore directly, without the Shell) own this
   * lifecycle themselves: call dispose() when the observer is no longer needed,
   * otherwise the live PermissionStatus `change` listener keeps this instance
   * reachable for as long as the status is alive. dispose() is safe to call when
   * never subscribed and may be paired with a later observe() to resume.
   */
  dispose(): void {
    this._permissionSubscribed = false;
    // Invalidate any in-flight query so its .then() bails instead of attaching a
    // listener after teardown.
    this._permGen++;
    if (this._permissionStatus) {
      this._permissionStatus.removeEventListener("change", this._onPermissionChange);
      this._permissionStatus = null;
    }
  }

  // --- Internal ---

  private _initPermission(): Promise<void> {
    // Guard a missing/empty permission name (e.g. a `<wcs-permission>` with no
    // `name` attribute). Such a descriptor would only ever reject at query() and
    // silently fall back to "unsupported", which is hard to diagnose. Short-circuit
    // to "unsupported" without issuing a doomed query so the misconfiguration
    // surfaces deterministically and no listener is attached.
    if (!this._descriptor || !this._descriptor.name) {
      this._setState("unsupported");
      return Promise.resolve();
    }
    // The Permissions API is optional. When absent (or it rejects, e.g. the
    // browser does not accept the requested permission name), report "unsupported"
    // and leave it at that — there is nothing to retry.
    if (typeof navigator === "undefined" || !navigator.permissions || typeof navigator.permissions.query !== "function") {
      // Route through _setState (not a bare assignment) so observers stay in sync
      // with the public state. The same-value guard means no redundant dispatch
      // when the state does not actually change.
      this._setState("unsupported");
      // Intentionally does NOT set _permissionSubscribed: there is no listener to
      // tear down, so a reconnect simply re-probes (idempotent — the same-value
      // guard suppresses any dispatch and no listener is ever attached). Mirrors
      // GeolocationCore's reinitPermission behavior in unsupported environments.
      return Promise.resolve();
    }
    this._permissionSubscribed = true;
    const gen = ++this._permGen;
    // Cast: WcsPermissionDescriptor widens `name` to string (and allows extra
    // descriptor members like userVisibleOnly / sysex) where the lib DOM type
    // expects the PermissionName union.
    return navigator.permissions.query(this._descriptor as unknown as PermissionDescriptor).then(
      (status) => {
        // Stale resolution: this query was superseded (rapid reconnect) or the
        // element was disposed while it was in flight. Drop it so only the current
        // subscription attaches a listener.
        if (gen !== this._permGen) return;
        this._permissionStatus = status;
        this._setState(status.state as PermissionStateOrUnsupported);
        status.addEventListener("change", this._onPermissionChange);
      },
      () => {
        if (gen !== this._permGen) return;
        this._setState("unsupported");
      },
    );
  }

  private _onPermissionChange = (event: Event): void => {
    const status = event.target as PermissionStatus;
    this._setState(status.state as PermissionStateOrUnsupported);
  };
}
