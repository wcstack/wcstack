import {
  IWcBindable, ClipboardPermissionState,
  WcsClipboardReadItem, WcsClipboardReadDetail, WcsClipboardErrorDetail,
} from "../types.js";

/**
 * Headless clipboard primitive. A thin, framework-agnostic wrapper around the
 * Clipboard API exposed through the wc-bindable protocol.
 *
 * It has two surfaces, mirroring the two distinct shapes of clipboard access:
 * - **commands** — `writeText()` / `write()` push to the clipboard;
 *   `readText()` / `read()` pull from it. These are the `state → element`
 *   (command-token) and `element → state` (read result) paths. All four are
 *   async and never reject: failures surface through the `error` property so
 *   they flow into the declarative state, symmetrical with FetchCore /
 *   GeolocationCore.
 * - **monitor** — `startMonitor()` / `stopMonitor()` subscribe to the document's
 *   `copy` / `cut` / `paste` events and republish them as the `copied` / `cut` /
 *   `pasted` properties (like TimerCore's continuous `start()` / `stop()`),
 *   toggling the `monitoring` flag. This is the event-token showcase: a user
 *   paste flows element → state declaratively.
 *
 * Clipboard also has permission gates, like GeolocationCore but doubled: read
 * and write are separate permissions (`clipboard-read` / `clipboard-write`).
 * `readPermission` / `writePermission` reflect `navigator.permissions.query`
 * (`prompt` / `granted` / `denied`, or `unsupported`) and track their live
 * `change` events.
 */
export class ClipboardCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "text", event: "wcs-clipboard:read", getter: (e: Event) => (e as CustomEvent).detail.text },
      { name: "items", event: "wcs-clipboard:read", getter: (e: Event) => (e as CustomEvent).detail.items },
      { name: "loading", event: "wcs-clipboard:loading-changed" },
      { name: "error", event: "wcs-clipboard:error" },
      { name: "readPermission", event: "wcs-clipboard:read-permission-changed" },
      { name: "writePermission", event: "wcs-clipboard:write-permission-changed" },
      { name: "monitoring", event: "wcs-clipboard:monitoring-changed" },
      { name: "copied", event: "wcs-clipboard:copied", getter: (e: Event) => (e as CustomEvent).detail },
      { name: "cut", event: "wcs-clipboard:cut", getter: (e: Event) => (e as CustomEvent).detail },
      { name: "pasted", event: "wcs-clipboard:pasted", getter: (e: Event) => (e as CustomEvent).detail },
    ],
    commands: [
      { name: "writeText", async: true },
      { name: "write", async: true },
      { name: "readText", async: true },
      { name: "read", async: true },
      { name: "startMonitor" },
      { name: "stopMonitor" },
    ],
  };

  private _target: EventTarget;

  private _text: string | null = null;
  private _items: WcsClipboardReadItem[] | null = null;
  private _loading: boolean = false;
  private _error: WcsClipboardErrorDetail | null = null;
  private _readPermission: ClipboardPermissionState = "prompt";
  private _writePermission: ClipboardPermissionState = "prompt";

  private _monitoring: boolean = false;
  private _copied: string | null = null;
  private _cut: string | null = null;
  private _pasted: string | null = null;

  // Live PermissionStatus handles (when the Permissions API is available), kept
  // so the `change` listeners can be removed on dispose(). Read and write are
  // separate permissions, hence two handles.
  private _readStatus: PermissionStatus | null = null;
  private _writeStatus: PermissionStatus | null = null;

  // True once a permission subscription has been (or is being) established, and
  // reset by dispose(). Guards reinitPermission() so the first connect after
  // construction does not double-subscribe, while a reconnect after dispose()
  // does re-subscribe. (Mirrors GeolocationCore.)
  private _permissionSubscribed: boolean = false;

  // Monotonic id of the current permission query round. Bumped by every
  // _initPermissions() and by dispose(). Each in-flight query captures it and,
  // on resolve, bails unless it is still current — so a query superseded by a
  // rapid (synchronous) disconnect→reconnect, or one that resolves after
  // dispose(), never attaches a listener.
  private _permGen: number = 0;

  // Monotonic id of the current async acquisition lifecycle (read/write),
  // bumped only by dispose(). Each command captures it at start; the resolution
  // bails (no setters) if it is stale, so an op that settles after the element
  // was disconnected does not dispatch wcs-clipboard:* on a torn-down element.
  // The Clipboard API has no AbortController, so a generation guard is the only
  // way to neutralize an in-flight op.
  private _acqGen: number = 0;

  // SSR (§3.8): resolves once the first permission probe settles, so the state
  // binder can await a real snapshot before reading. Set by _initPermissions();
  // Promise.resolve() when the Permissions API is unsupported (no async probe).
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
    // Probe the permission states up front so observers see the real values
    // before the first read, then keep them live.
    this._initPermissions();
  }

  // SSR (§3.8): the first permission probe's settle promise.
  get ready(): Promise<void> {
    return this._ready;
  }

  // Lifecycle (§3.5). Clipboard reads/writes are command-driven (they need a
  // user gesture), so observe() establishes no acquisition; it only (re)subscribes
  // to permission `change` events — idempotent while a subscription is live, and
  // reviving it after a dispose() (reconnect/reparent). Returns ready so the Shell
  // can expose it as connectedCallbackPromise.
  observe(): Promise<void> {
    this.reinitPermission();
    return this._ready;
  }

  get text(): string | null {
    return this._text;
  }

  get items(): WcsClipboardReadItem[] | null {
    return this._items;
  }

  get loading(): boolean {
    return this._loading;
  }

  get error(): WcsClipboardErrorDetail | null {
    return this._error;
  }

  get readPermission(): ClipboardPermissionState {
    return this._readPermission;
  }

  get writePermission(): ClipboardPermissionState {
    return this._writePermission;
  }

  get monitoring(): boolean {
    return this._monitoring;
  }

  get copied(): string | null {
    return this._copied;
  }

  get cut(): string | null {
    return this._cut;
  }

  get pasted(): string | null {
    return this._pasted;
  }

  // --- State setters with event dispatch ---

  // Deliberately NO same-value guard (unlike error/loading/permission/monitoring).
  // A read is a result event, not idempotent state: reading the same text twice is
  // two distinct user/command actions and must re-fire wcs-clipboard:read each time
  // so a `text:`/`items:` binding and command-result consumers see every read.
  private _setRead(detail: WcsClipboardReadDetail): void {
    this._text = detail.text;
    this._items = detail.items;
    this._target.dispatchEvent(new CustomEvent("wcs-clipboard:read", {
      detail,
      bubbles: true,
    }));
  }

  private _setLoading(loading: boolean): void {
    if (this._loading === loading) return;
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-clipboard:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setError(error: WcsClipboardErrorDetail | null): void {
    // Same-value guard. `error` has no derived state, so suppressing redundant
    // null→null dispatches (e.g. a successful op clearing an already-null error)
    // avoids spurious events. Reference identity is sufficient: each failure
    // builds a fresh object, and the clear path always passes the literal null.
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-clipboard:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setReadPermission(permission: ClipboardPermissionState): void {
    if (this._readPermission === permission) return;
    this._readPermission = permission;
    this._target.dispatchEvent(new CustomEvent("wcs-clipboard:read-permission-changed", {
      detail: permission,
      bubbles: true,
    }));
  }

  private _setWritePermission(permission: ClipboardPermissionState): void {
    if (this._writePermission === permission) return;
    this._writePermission = permission;
    this._target.dispatchEvent(new CustomEvent("wcs-clipboard:write-permission-changed", {
      detail: permission,
      bubbles: true,
    }));
  }

  private _setMonitoring(monitoring: boolean): void {
    if (this._monitoring === monitoring) return;
    this._monitoring = monitoring;
    this._target.dispatchEvent(new CustomEvent("wcs-clipboard:monitoring-changed", {
      detail: monitoring,
      bubbles: true,
    }));
  }

  // Deliberately NO same-value guard on the copied/cut/pasted setters (unlike
  // error/loading/permission/monitoring above). These are events, not state:
  // copying the same text twice is two distinct user actions and must re-fire
  // both times so an event-token subscriber (`eventToken.pasted: ...`) sees each
  // occurrence. Do not add a `===` guard here.
  private _setCopied(text: string): void {
    this._copied = text;
    this._target.dispatchEvent(new CustomEvent("wcs-clipboard:copied", {
      detail: text,
      bubbles: true,
    }));
  }

  private _setCut(text: string): void {
    this._cut = text;
    this._target.dispatchEvent(new CustomEvent("wcs-clipboard:cut", {
      detail: text,
      bubbles: true,
    }));
  }

  private _setPasted(text: string): void {
    this._pasted = text;
    this._target.dispatchEvent(new CustomEvent("wcs-clipboard:pasted", {
      detail: text,
      bubbles: true,
    }));
  }

  // --- Public API: write ---

  /**
   * Write plain text to the clipboard. Resolves once the write settles or fails
   * — never rejects: failures surface through `error`. Requires transient
   * activation (a user gesture), so call from a click handler / command-token.
   */
  writeText(text: string): Promise<void> {
    return this._runWrite(() => navigator.clipboard.writeText(text));
  }

  /**
   * Write rich `ClipboardItem`s (images, HTML, multiple MIME types) to the
   * clipboard. Resolves once the write settles or fails — never rejects.
   */
  write(items: ClipboardItem[]): Promise<void> {
    return this._runWrite(() => navigator.clipboard.write(items));
  }

  // --- Public API: read ---

  /**
   * Read plain text from the clipboard, publishing it via `text` and the
   * `wcs-clipboard:read` event. Resolves once the read settles or fails — never
   * rejects. Requires focus + read permission.
   */
  readText(): Promise<void> {
    return this._runRead(async () => {
      const text = await navigator.clipboard.readText();
      return { text, items: null };
    });
  }

  /**
   * Read rich `ClipboardItem`s from the clipboard, eagerly resolving every
   * representation to a `Blob`. A `text/plain` representation is also surfaced
   * via `text`. Resolves once the read settles or fails — never rejects.
   */
  read(): Promise<void> {
    return this._runRead(async () => {
      const items = await navigator.clipboard.read();
      return this._normalizeItems(items);
    });
  }

  // --- Public API: monitor ---

  /**
   * Begin monitoring document `copy` / `cut` / `paste` events, republishing
   * them as the `copied` / `cut` / `pasted` properties. Idempotent while already
   * monitoring (mirrors GeolocationCore.watch()).
   */
  startMonitor(): void {
    if (this._monitoring) return;
    this._setMonitoring(true);
    // §4 deviation: document-scoped Web API; no element-free alternative.
    // copy/cut/paste fire on `document`, so monitoring necessarily listens there
    // rather than on a Core-owned element. Registered as an allowed deviation.
    document.addEventListener("copy", this._onCopy);
    document.addEventListener("cut", this._onCut);
    document.addEventListener("paste", this._onPaste);
  }

  stopMonitor(): void {
    this._removeMonitorListeners();
    this._setMonitoring(false);
  }

  // --- Permission lifecycle ---

  /**
   * Re-establish the permission `change` subscriptions after a dispose() — e.g.
   * the Shell element was disconnected and then reconnected (reparented). No-op
   * while a subscription is already live, so the first connect after
   * construction does not double-subscribe.
   */
  reinitPermission(): void {
    if (!this._permissionSubscribed) {
      this._initPermissions();
    }
  }

  /**
   * Detach the live permission `change` listeners and any monitor listeners, and
   * neutralize in-flight async ops. Call from the Shell's `disconnectedCallback`
   * so a removed element does not leak subscriptions or dispatch on a torn-down
   * element. A later reconnect can re-subscribe via reinitPermission().
   */
  dispose(): void {
    this._permissionSubscribed = false;
    // Invalidate any in-flight permission query so its .then() bails instead of
    // attaching a listener after teardown.
    this._permGen++;
    // Invalidate any in-flight read/write so its resolution bails instead of
    // dispatching on a disconnected element.
    this._acqGen++;
    // Reset the loading shadow silently (no dispatch on a disposed element). The
    // bailed resolution will not clear it, and leaving it true would let the
    // same-value guard swallow the loading=true edge of the next op after a
    // reconnect.
    this._loading = false;
    if (this._readStatus) {
      this._readStatus.removeEventListener("change", this._onReadChange);
      this._readStatus = null;
    }
    if (this._writeStatus) {
      this._writeStatus.removeEventListener("change", this._onWriteChange);
      this._writeStatus = null;
    }
    // Remove monitor listeners silently. The Shell calls stopMonitor() before
    // dispose(), but a direct headless dispose() still tears them down.
    this._removeMonitorListeners();
    this._monitoring = false;
  }

  // --- Internal: write/read runners ---

  private _runWrite(op: () => Promise<void>): Promise<void> {
    return this._runOp(async () => {
      await op();
      return null;
    });
  }

  private _runRead(op: () => Promise<WcsClipboardReadDetail>): Promise<void> {
    return this._runOp(op);
  }

  /**
   * Shared async-op lifecycle for read/write: capability check, loading toggle,
   * generation guard, never-reject error handling. When `op` returns a read
   * detail it is published; when it returns null (a write) nothing is published.
   */
  private async _runOp(op: () => Promise<WcsClipboardReadDetail | null>): Promise<void> {
    if (!this._hasClipboard()) {
      this._setError(this._unsupportedError());
      return;
    }
    const gen = this._acqGen;
    this._setLoading(true);
    this._setError(null);
    try {
      const detail = await op();
      // Stale: the element was disposed (disconnected) while this op was in
      // flight. Drop it so a torn-down element never dispatches wcs-clipboard:*.
      if (gen !== this._acqGen) return;
      this._setLoading(false);
      if (detail) this._setRead(detail);
    } catch (err) {
      if (gen !== this._acqGen) return;
      this._setLoading(false);
      this._setError(this._normalizeError(err));
    }
  }

  // --- Internal: monitor handlers ---

  // During a `copy` / `cut` event the clipboard payload is not yet readable —
  // the browser returns an empty string for security reasons — so we report the
  // user's selected text (`document.getSelection().toString()`) instead. A page
  // that overrides the payload with a custom handler via clipboardData.setData()
  // is therefore NOT reflected here. (See README "copy / cut text comes from the
  // selection".) `paste` differs: clipboardData is readable, so _onPaste reads it.
  private _onCopy = (): void => {
    this._setCopied(this._selectionText());
  };

  private _onCut = (): void => {
    this._setCut(this._selectionText());
  };

  private _onPaste = (event: Event): void => {
    const data = (event as ClipboardEvent).clipboardData;
    const text = data ? data.getData("text/plain") : "";
    this._setPasted(text);
  };

  private _removeMonitorListeners(): void {
    // §4 deviation: document-scoped Web API; no element-free alternative.
    document.removeEventListener("copy", this._onCopy);
    document.removeEventListener("cut", this._onCut);
    document.removeEventListener("paste", this._onPaste);
  }

  private _selectionText(): string {
    // §4 deviation: document-scoped Web API; no element-free alternative.
    const selection = document.getSelection();
    return selection ? selection.toString() : "";
  }

  // --- Internal: permission ---

  private _initPermissions(): void {
    // The Permissions API is optional. When absent (or it rejects, e.g. Firefox
    // does not expose the clipboard permission names), report "unsupported" and
    // leave reads/writes to fail loudly via the error property if attempted.
    // Note: we deliberately do NOT set _permissionSubscribed here — there is no
    // live subscription to tear down, so reinitPermission() re-runs this branch
    // on every reconnect. That is harmless: the same-value guard in
    // _setReadPermission/_setWritePermission swallows the redundant
    // unsupported→unsupported dispatch. (Mirrors GeolocationCore.)
    if (typeof navigator === "undefined" || !navigator.permissions || typeof navigator.permissions.query !== "function") {
      this._setReadPermission("unsupported");
      this._setWritePermission("unsupported");
      // No async probe: readiness is immediate (§3.8).
      this._ready = Promise.resolve();
      return;
    }
    this._permissionSubscribed = true;
    const gen = ++this._permGen;
    const readProbe = this._queryPermission(
      "clipboard-read", gen,
      (s) => { this._readStatus = s; },
      (state) => this._setReadPermission(state),
      this._onReadChange,
    );
    const writeProbe = this._queryPermission(
      "clipboard-write", gen,
      (s) => { this._writeStatus = s; },
      (state) => this._setWritePermission(state),
      this._onWriteChange,
    );
    // SSR (§3.8): ready resolves once both initial permission probes settle.
    this._ready = Promise.all([readProbe, writeProbe]).then(() => undefined);
  }

  private _queryPermission(
    name: string,
    gen: number,
    assignStatus: (status: PermissionStatus) => void,
    setState: (state: ClipboardPermissionState) => void,
    onChange: (event: Event) => void,
  ): Promise<void> {
    return navigator.permissions.query({ name: name as PermissionName }).then(
      (status) => {
        // Stale resolution: this query was superseded (rapid reconnect) or the
        // element was disposed while it was in flight. Drop it so only the
        // current subscription attaches a listener.
        if (gen !== this._permGen) return;
        assignStatus(status);
        setState(status.state as ClipboardPermissionState);
        status.addEventListener("change", onChange);
      },
      () => {
        if (gen !== this._permGen) return;
        setState("unsupported");
      },
    );
  }

  private _onReadChange = (event: Event): void => {
    const status = event.target as PermissionStatus;
    this._setReadPermission(status.state as ClipboardPermissionState);
  };

  private _onWriteChange = (event: Event): void => {
    const status = event.target as PermissionStatus;
    this._setWritePermission(status.state as ClipboardPermissionState);
  };

  // --- Internal: normalization ---

  private _hasClipboard(): boolean {
    return typeof navigator !== "undefined" && !!navigator.clipboard;
  }

  private async _normalizeItems(items: ClipboardItem[]): Promise<WcsClipboardReadDetail> {
    // Resolve every representation of every item in parallel. getType() calls are
    // independent, so awaiting them serially only adds latency. The trade-off is
    // intentional and unchanged from the serial version: if any getType() rejects
    // the whole read errors (no partial success), consistent with the never-reject
    // design where a failed op surfaces a single `error` rather than a half-filled
    // snapshot. Order is preserved so the `text` pick below stays deterministic.
    const resolved = await Promise.all(
      items.map((item) =>
        Promise.all(item.types.map((type) => item.getType(type))).then((blobs) => ({ item, blobs })),
      ),
    );

    const normalized: WcsClipboardReadItem[] = [];
    let text: string | null = null;
    for (const { item, blobs } of resolved) {
      const data: Record<string, Blob> = {};
      item.types.forEach((type, i) => {
        data[type] = blobs[i];
      });
      // Surface the first text/plain representation through `text` for the
      // common "read whatever text is there" case (first item, first match).
      if (text === null) {
        const i = item.types.indexOf("text/plain");
        if (i !== -1) {
          text = await blobs[i].text();
        }
      }
      normalized.push({ types: [...item.types], data });
    }
    return { text, items: normalized };
  }

  private _normalizeError(err: unknown): WcsClipboardErrorDetail {
    if (err instanceof Error) {
      // DOMException is an Error subclass; its `name` (NotAllowedError, etc.) is
      // the meaningful discriminator for consumers switching on failure kind.
      return { name: err.name, message: err.message };
    }
    return { name: "Error", message: String(err) };
  }

  private _unsupportedError(): WcsClipboardErrorDetail {
    return {
      name: "NotSupportedError",
      message: "Clipboard API is not available in this environment.",
    };
  }
}
