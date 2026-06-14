import {
  IWcBindable, NotifyBackend, NotifyOptions, NotificationPermissionRaw,
  PermissionStateOrUnsupported, WcsNotifyClickDetail, WcsNotifyErrorDetail,
} from "../types.js";

// Wrapper stored in a notification's `data` so the Service Worker side (a
// separate global scope with no access to this instance) can recover the
// identity and the caller's payload. The constructor backend uses the same
// wrapper for uniformity, and both paths unwrap it before emitting.
interface WcsNotifyData {
  __wcsId: string;
  payload: unknown;
}

// Message shape posted by `wireNotificationClicks()` (src/sw.ts) over both
// BroadcastChannel and clients.postMessage. `id` is unique per click
// (`tag#seq`), so the two transports delivering the *same* click de-dup, while
// two genuine clicks on the same `tag` do not.
interface WcsNotifyInbound {
  __wcsNotify: true;
  id: string;
  tag: string;
  data: unknown;
  action: string;
}

/**
 * Headless desktop-notification primitive. A thin, framework-agnostic wrapper
 * around the Notifications API exposed through the wc-bindable protocol.
 *
 * Unlike `@wcstack/permission` (a read-only monitor — the Permissions API has no
 * `request()`), the Notifications API *does* expose `Notification.requestPermission()`,
 * so this node is self-contained: it both **requests/monitors** the permission and
 * **shows** notifications. It is the first @wcstack node where the command-token
 * (show: `notify`) and event-token (`click` / `close` / `show`) directions both
 * live in one tag.
 *
 * - **request()** asks for the `notifications` permission (`Notification.requestPermission`).
 * - **notify(title, options)** shows a notification and returns its identifying tag
 *   (a caller `options.tag`, or a generated `wcs-<n>`). It picks a backend per
 *   `mode`: the `Notification` constructor (desktop) or
 *   `ServiceWorkerRegistration.showNotification()` (mobile). `"auto"` prefers the
 *   constructor and falls back to the SW on a `TypeError`.
 * - **close(tag) / closeAll()** dismiss notifications by tag / all.
 * - Clicks flow back as the `wcs-notify:click` event: directly via the
 *   Notification's `onclick` (constructor), or via the SW helper's
 *   BroadcastChannel/postMessage relay (SW). `permission` mirrors the live grant.
 *
 * Failures never throw: they surface through `error` (and the `unsupported`
 * permission state) so they flow into the declarative state.
 */
export class NotificationCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "permission", event: "wcs-notify:permission-change" },
      { name: "granted", event: "wcs-notify:permission-change", getter: (e: Event) => (e as CustomEvent).detail === "granted" },
      { name: "denied", event: "wcs-notify:permission-change", getter: (e: Event) => (e as CustomEvent).detail === "denied" },
      { name: "prompt", event: "wcs-notify:permission-change", getter: (e: Event) => (e as CustomEvent).detail === "prompt" },
      { name: "unsupported", event: "wcs-notify:permission-change", getter: (e: Event) => (e as CustomEvent).detail === "unsupported" },
      { name: "error", event: "wcs-notify:error" },
      { name: "clicked", event: "wcs-notify:click", getter: (e: Event) => (e as CustomEvent).detail },
      { name: "closed", event: "wcs-notify:close", getter: (e: Event) => (e as CustomEvent).detail },
      { name: "shown", event: "wcs-notify:show", getter: (e: Event) => (e as CustomEvent).detail },
    ],
    commands: [
      { name: "request", async: true },
      { name: "notify" },
      { name: "close" },
      { name: "closeAll" },
    ],
  };

  private _target: EventTarget;
  private _mode: NotifyBackend = "auto";

  private _permission: PermissionStateOrUnsupported = "prompt";
  private _error: WcsNotifyErrorDetail | null = null;
  private _lastClick: WcsNotifyClickDetail | null = null;
  private _lastClose: WcsNotifyClickDetail | null = null;
  private _lastShow: WcsNotifyClickDetail | null = null;

  // Live PermissionStatus (when the Permissions API can query `notifications`),
  // kept so its `change` listener can be removed on dispose().
  private _permissionStatus: PermissionStatus | null = null;
  // True once a permission subscription has been (or is being) established; reset
  // by dispose(). Guards observe() so a reconnect re-queries while a redundant
  // observe() on a live subscription does not.
  private _permissionSubscribed: boolean = false;

  // Monotonic id of the current lifecycle. Bumped by every observe() and by
  // dispose(). In-flight async work (permission query, SW show, inbound click)
  // captures it and bails if stale, so a query/click that resolves after a
  // disconnect — or after a rapid disconnect→reconnect — never mutates state or
  // dispatches on a torn-down element.
  private _gen: number = 0;

  // Resolves once the connect-time permission probe settles. The Shell exposes
  // this as connectedCallbackPromise so SSR can await it before snapshotting.
  private _ready: Promise<void> = Promise.resolve();

  // Counter for auto-assigned tags when the caller omits one.
  private _idSeq: number = 0;

  // Notifications created via the constructor backend, by tag, so close()/closeAll()
  // can dismiss them. The SW backend has no handle (showNotification returns void),
  // so its tags are tracked separately and closed via registration.getNotifications().
  private _constructed: Map<string, Notification> = new Map();
  private _swTags: Set<string> = new Set();

  // Click subscription handles (SW relay).
  private _channel: BroadcastChannel | null = null;
  private _serviceWorker: ServiceWorkerContainer | null = null;
  private _clicksSubscribed: boolean = false;
  // Per-click ids already handled, to de-dup the two relay transports. FIFO-capped
  // so a long session does not leak; the two transports always arrive in the same
  // tick, so a small cap is ample.
  private _seenIds: string[] = [];

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get permission(): PermissionStateOrUnsupported {
    return this._permission;
  }

  get granted(): boolean {
    return this._permission === "granted";
  }

  get denied(): boolean {
    return this._permission === "denied";
  }

  get prompt(): boolean {
    return this._permission === "prompt";
  }

  get unsupported(): boolean {
    return this._permission === "unsupported";
  }

  get error(): WcsNotifyErrorDetail | null {
    return this._error;
  }

  get clicked(): WcsNotifyClickDetail | null {
    return this._lastClick;
  }

  get closed(): WcsNotifyClickDetail | null {
    return this._lastClose;
  }

  get shown(): WcsNotifyClickDetail | null {
    return this._lastShow;
  }

  /** Resolves once the current (or initial) permission probe settles. */
  get ready(): Promise<void> {
    return this._ready;
  }

  // --- State setters with event dispatch ---

  private _setPermission(state: PermissionStateOrUnsupported): void {
    if (this._permission === state) return;
    this._permission = state;
    this._target.dispatchEvent(new CustomEvent("wcs-notify:permission-change", {
      detail: state,
      bubbles: true,
    }));
  }

  private _setError(error: WcsNotifyErrorDetail | null): void {
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-notify:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _emit(kind: "click" | "close" | "show", detail: WcsNotifyClickDetail): void {
    if (kind === "click") this._lastClick = detail;
    else if (kind === "close") this._lastClose = detail;
    else this._lastShow = detail;
    this._target.dispatchEvent(new CustomEvent(`wcs-notify:${kind}`, {
      detail,
      bubbles: true,
    }));
  }

  // --- Public API ---

  /**
   * Start observing the `notifications` permission and subscribing to Service
   * Worker click relays. `mode` selects the show backend (default `"auto"`).
   * Idempotent while already subscribed: it only updates the stored mode; to
   * restart, dispose() first. Returns a promise that resolves once the first
   * permission probe settles, for SSR.
   *
   * Headless callers must call observe() to begin; the Shell calls it from
   * connectedCallback once the element's attributes resolve.
   */
  observe(mode: NotifyBackend = "auto"): Promise<void> {
    this._mode = mode;
    if (!this._permissionSubscribed) {
      this._ready = this._initPermission();
      this._subscribeClicks();
    }
    return this._ready;
  }

  /**
   * Ask the user for the `notifications` permission. Resolves to the resulting
   * (normalized) permission state. Never throws: an unavailable API resolves to
   * `"unsupported"`.
   */
  async request(): Promise<PermissionStateOrUnsupported> {
    const api = this._api();
    if (!api || typeof api.requestPermission !== "function") {
      this._setPermission("unsupported");
      return this._permission;
    }
    try {
      const result = await api.requestPermission();
      this._setPermission(this._normalize(result));
    } catch {
      // Some legacy engines may reject; keep the current state rather than throw.
    }
    return this._permission;
  }

  /**
   * Show a notification. Returns the identifying tag (the caller's `options.tag`,
   * or a generated `wcs-<n>` when omitted). Never throws: when the API is
   * unavailable or the permission is not granted it surfaces an `error` and
   * returns an empty string.
   */
  notify(title: string, options: NotifyOptions = {}): string {
    if (!this._api()) {
      this._setError(this._err("unsupported", "Notifications API is not available in this environment."));
      return "";
    }
    if (this._permission !== "granted") {
      this._setError(this._err("not-granted", "Notification permission is not granted; call request() first."));
      return "";
    }
    if (typeof title !== "string") {
      this._setError(this._err("invalid-title", "notify() requires a string title."));
      return "";
    }

    const tag = (typeof options.tag === "string" && options.tag !== "") ? options.tag : this._nextId();
    const payload = options.data;
    const data: WcsNotifyData = { __wcsId: tag, payload };
    const backendOptions: NotifyOptions = { ...options, tag, data };

    this._setError(null);
    this._show(title, backendOptions, tag, payload);
    return tag;
  }

  /** Dismiss the notification(s) with `tag` across both backends. */
  close(tag?: string): void {
    if (typeof tag !== "string" || tag === "") return;
    const n = this._constructed.get(tag);
    if (n) {
      n.close();
      this._constructed.delete(tag);
    }
    if (this._swTags.has(tag)) {
      this._closeSw(tag);
      this._swTags.delete(tag);
    }
  }

  /**
   * Dismiss every notification this instance has shown. Scoped to this instance's
   * own tags on both backends — the SW path closes each tracked tag individually
   * rather than enumerating the whole origin, so it never dismisses notifications
   * shown by another `<wcs-notify>` or by an unrelated code path.
   */
  closeAll(): void {
    for (const n of this._constructed.values()) {
      n.close();
    }
    this._constructed.clear();
    for (const tag of this._swTags) {
      this._closeSw(tag);
    }
    this._swTags.clear();
  }

  /**
   * Detach permission and click subscriptions. Open notifications are intentionally
   * **left on screen** (a notification outlives the page that posted it — that is
   * the point); use close()/closeAll() to dismiss. Call from the Shell's
   * disconnectedCallback. A later observe() resumes.
   */
  dispose(): void {
    this._permissionSubscribed = false;
    this._clicksSubscribed = false;
    this._gen++;
    if (this._permissionStatus) {
      this._permissionStatus.removeEventListener("change", this._onPermissionChange);
      this._permissionStatus = null;
    }
    if (this._channel) {
      this._channel.removeEventListener("message", this._onInbound);
      this._channel.close();
      this._channel = null;
    }
    if (this._serviceWorker) {
      this._serviceWorker.removeEventListener("message", this._onInbound);
      this._serviceWorker = null;
    }
  }

  // --- Internal: permission ---

  private _initPermission(): Promise<void> {
    const api = this._api();
    if (!api) {
      this._setPermission("unsupported");
      // Intentionally does NOT set _permissionSubscribed: there is no permission
      // listener to tear down, so a reconnect simply re-probes (idempotent — the
      // same-value guard suppresses any redundant dispatch and no listener is ever
      // attached). _subscribeClicks() is re-entered too, but its own
      // _clicksSubscribed guard short-circuits the second pass, so no transport is
      // double-subscribed. Mirrors @wcstack/permission's unsupported path.
      return Promise.resolve();
    }
    this._permissionSubscribed = true;
    // Prefer the Permissions API: it provides a live `change` event. Fall back to
    // the static `Notification.permission` when it is absent or rejects the
    // `notifications` descriptor.
    if (typeof navigator !== "undefined" && navigator.permissions && typeof navigator.permissions.query === "function") {
      const gen = ++this._gen;
      return navigator.permissions.query({ name: "notifications" }).then(
        (status) => {
          if (gen !== this._gen) return;
          this._permissionStatus = status;
          this._setPermission(this._normalize(status.state as NotificationPermissionRaw));
          status.addEventListener("change", this._onPermissionChange);
        },
        () => {
          if (gen !== this._gen) return;
          // Permissions API rejected the `notifications` descriptor — fall back to
          // the static `Notification.permission` (api is in scope and non-null here).
          this._setPermission(this._normalize(api.permission));
        },
      );
    }
    // No Permissions API: read the static permission once (no live change events).
    this._setPermission(this._normalize(api.permission));
    return Promise.resolve();
  }

  private _onPermissionChange = (event: Event): void => {
    const status = event.target as PermissionStatus;
    this._setPermission(this._normalize(status.state as NotificationPermissionRaw));
  };

  // Normalize the Notifications API's `"default"` to `"prompt"` so this node shares
  // the four-value surface of @wcstack/permission. The Permissions API already
  // reports `"prompt"`, so it passes through unchanged.
  private _normalize(raw: NotificationPermissionRaw | string): PermissionStateOrUnsupported {
    if (raw === "default") return "prompt";
    if (raw === "granted" || raw === "denied" || raw === "prompt") return raw;
    return "prompt";
  }

  // --- Internal: showing ---

  private _show(title: string, options: NotifyOptions, tag: string, payload: unknown): void {
    if (this._mode === "sw") {
      this._showViaSw(title, options, tag, payload);
      return;
    }
    const handled = this._showViaConstructor(title, options, tag, payload);
    if (handled) return;
    // Constructor threw TypeError (e.g. mobile, where `new Notification` is illegal).
    if (this._mode === "auto") {
      this._showViaSw(title, options, tag, payload);
    } else {
      this._setError(this._err("show-failed", "new Notification() is not usable here and mode=\"constructor\" disallows the Service Worker fallback."));
    }
  }

  // Returns false only when the constructor threw a TypeError (the signal to fall
  // back to the SW backend); true when it showed or surfaced a non-TypeError error.
  private _showViaConstructor(title: string, options: NotifyOptions, tag: string, payload: unknown): boolean {
    const api = this._api()!;
    const gen = this._gen;
    let n: Notification;
    try {
      n = new api(title, options as NotificationOptions);
    } catch (e) {
      if (e instanceof TypeError) return false;
      this._setError(this._err("show-failed", "Failed to create the notification."));
      return true;
    }
    this._constructed.set(tag, n);
    n.onshow = (): void => {
      if (gen !== this._gen) return;
      this._emit("show", { tag, data: payload, action: "" });
    };
    n.onclick = (): void => {
      if (gen !== this._gen) return;
      this._emit("click", { tag, data: payload, action: "" });
    };
    n.onclose = (): void => {
      this._constructed.delete(tag);
      if (gen !== this._gen) return;
      this._emit("close", { tag, data: payload, action: "" });
    };
    n.onerror = (): void => {
      if (gen !== this._gen) return;
      this._setError(this._err("show-failed", "The notification failed to display."));
    };
    return true;
  }

  private _showViaSw(title: string, options: NotifyOptions, tag: string, payload: unknown): void {
    const sw = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (!sw) {
      this._setError(this._err("no-service-worker", "Service Worker is required to show this notification but is unavailable."));
      return;
    }
    const gen = this._gen;
    this._swTags.add(tag);
    // A notification deliberately outlives the page (see § dispose), so we do NOT
    // bail before showNotification on a stale gen — a notify() issued while
    // connected still shows. The stale-gen guards only suppress dispatching the
    // observable `show` / `error` back onto a torn-down element.
    sw.ready
      .then((registration) => registration.showNotification(title, options as NotificationOptions))
      .then(() => {
        if (gen !== this._gen) return;
        this._emit("show", { tag, data: payload, action: "" });
      })
      .catch(() => {
        if (gen !== this._gen) return;
        this._setError(this._err("show-failed", "ServiceWorkerRegistration.showNotification() failed."));
      });
  }

  // Close the SW notification(s) carrying `tag`. Always scoped to a single tag —
  // both callers (close / closeAll) iterate their own tracked tags, so the whole
  // origin is never enumerated.
  private _closeSw(tag: string): void {
    const sw = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (!sw) return;
    sw.ready.then((registration) => {
      return registration.getNotifications({ tag }).then((list) => {
        for (const n of list) n.close();
      });
    }).catch(() => {
      // Closing is best-effort; a failure to enumerate is not surfaced.
    });
  }

  // --- Internal: click relay (SW) ---

  private _subscribeClicks(): void {
    if (this._clicksSubscribed) return;
    this._clicksSubscribed = true;
    if (typeof BroadcastChannel === "function") {
      this._channel = new BroadcastChannel("wcs-notify");
      this._channel.addEventListener("message", this._onInbound);
    }
    const sw = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (sw) {
      this._serviceWorker = sw;
      sw.addEventListener("message", this._onInbound);
    }
  }

  private _onInbound = (event: Event): void => {
    const msg = (event as MessageEvent).data as WcsNotifyInbound | undefined;
    if (!msg || msg.__wcsNotify !== true) return;
    if (this._isDuplicate(msg.id)) return;
    this._emit("click", { tag: msg.tag, data: this._unwrap(msg.data), action: msg.action });
  };

  private _isDuplicate(id: string): boolean {
    if (this._seenIds.includes(id)) return true;
    this._seenIds.push(id);
    if (this._seenIds.length > 50) this._seenIds.shift();
    return false;
  }

  private _unwrap(raw: unknown): unknown {
    if (raw !== null && typeof raw === "object" && "__wcsId" in raw) {
      return (raw as WcsNotifyData).payload;
    }
    return raw;
  }

  // --- Internal: misc ---

  // Resolve the global `Notification` constructor at call time (not cached) so
  // tests can install/remove it and so unsupported environments report correctly.
  private _api(): (typeof Notification) | undefined {
    const g = globalThis as unknown as { Notification?: typeof Notification };
    return typeof g.Notification === "function" ? g.Notification : undefined;
  }

  private _nextId(): string {
    return `wcs-${++this._idSeq}`;
  }

  private _err(error: string, message: string): WcsNotifyErrorDetail {
    return { error, message };
  }
}
