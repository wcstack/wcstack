import { IWcBindable } from "../types.js";
import { OperationLane, OperationTicket } from "./operationLane.js";

export type FetchResponseType = "auto" | "json" | "text" | "blob" | "arrayBuffer";

export interface FetchRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  contentType?: string | null;
  forceText?: boolean;
  // How to read the response body. "auto" (default) sniffs Content-Type (JSON or
  // text). "blob"/"arrayBuffer" enable binary downloads; "blob" additionally
  // publishes a managed `objectURL`. `forceText` (HTML-replace mode) takes
  // priority over this.
  responseType?: FetchResponseType;
  // Request timeout in ms. When elapsed, the request lane claims a `timeout`
  // terminal, commits a `{ name: "TimeoutError" }` error envelope (guarded), then
  // aborts the native request (async-execution-model.md §7 / 09 §5.1). Absent or
  // <= 0 → no timeout (unchanged behaviour, the default).
  timeout?: number;
}

export class FetchCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "value", event: "wcs-fetch:response", getter: (e: Event) => (e as CustomEvent).detail.value },
      { name: "loading", event: "wcs-fetch:loading-changed" },
      { name: "error", event: "wcs-fetch:error" },
      { name: "status", event: "wcs-fetch:response", getter: (e: Event) => (e as CustomEvent).detail.status },
      // Managed object URL for a `responseType: "blob"` response (null otherwise).
      // The Core revokes the previous URL on each new response and on dispose, so
      // a consumer can bind it straight into <img src> without lifecycle glue.
      { name: "objectURL", event: "wcs-fetch:response", getter: (e: Event) => (e as CustomEvent).detail.objectURL },
    ],
    inputs: [
      { name: "url" },
      { name: "method" },
    ],
    commands: [
      { name: "fetch", async: true },
      { name: "abort" },
    ],
  };

  private _target: EventTarget;
  private _value: any = null;
  private _loading: boolean = false;
  private _error: any = null;
  private _status: number = 0;
  private _objectURL: string | null = null;
  private _promise: Promise<any> = Promise.resolve(null);
  // Phase 4 (09-remediation-design.md §5): the request lane. `latest` policy —
  // a new fetch supersedes the in-flight one (switchMap). The lane owns the
  // per-operation AbortController, the owner generation (dispose lifecycle) and
  // the terminal CAS / CommitGuard that decide which completion may write state.
  // This replaces the ad-hoc `_gen` counter + single `_abortController`: a
  // superseded operation now fails the CommitGuard's epoch check instead of
  // relying on a coarse generation recheck, closing the "completion racing an
  // abort commits stale state" gap during body reads.
  private _lane = new OperationLane("fetch", "latest", { withSignal: true });
  // SSR (§3.8): no asynchronous probe to await, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  // Lifecycle (§3.5). Fetch is command-driven with no subscription to
  // establish, so observe() is an idempotent no-op that resolves once ready;
  // dispose() invalidates any in-flight request and aborts it.
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    // world generation bump (§4.1): invalidates + aborts every in-flight request.
    this._lane.disposeOwner();
    // Release any outstanding blob object URL on teardown (the other revoke point
    // is _setResponse, which drops the previous URL when a new response arrives).
    if (this._objectURL !== null) {
      this._revokeObjectURL(this._objectURL);
      this._objectURL = null;
    }
  }

  get value(): any {
    return this._value;
  }

  get loading(): boolean {
    return this._loading;
  }

  get error(): any {
    return this._error;
  }

  get status(): number {
    return this._status;
  }

  get objectURL(): string | null {
    return this._objectURL;
  }

  get promise(): Promise<any> {
    return this._promise;
  }

  private _setLoading(loading: boolean): void {
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    // Same-value guard (async-io-node-guidelines.md §3.3). `error` is state-ish,
    // so suppressing redundant null→null dispatches (every fetch start clears a
    // usually-already-null error) avoids a spurious wcs-fetch:error per successful
    // request. Reference identity is sufficient: each failure builds a fresh
    // object, and the clear path always passes null.
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-fetch:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setResponse(value: any, status: number, objectURL: string | null = null): void {
    // Revoke the previous blob object URL before replacing it. Any new response
    // (success, HTTP error, or network error all funnel through here) supersedes
    // the prior one, so the old URL is no longer needed; this plus dispose()
    // revocation keeps blob downloads leak-free.
    if (this._objectURL !== null) {
      this._revokeObjectURL(this._objectURL);
    }
    this._objectURL = objectURL;
    this._value = value;
    this._status = status;
    this._target.dispatchEvent(new CustomEvent("wcs-fetch:response", {
      detail: { value, status, objectURL },
      bubbles: true,
    }));
  }

  // Object URL lifecycle for responseType: "blob". The Core owns the blob's
  // object URL (mirrors RecorderCore) so a consumer can bind `objectURL` straight
  // into <img src>/<a href> without managing createObjectURL/revokeObjectURL. Both
  // helpers tolerate environments without URL.createObjectURL (SSR / headless).
  private _createObjectURL(blob: Blob): string | null {
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      return URL.createObjectURL(blob);
    }
    return null;
  }

  private _revokeObjectURL(url: string): void {
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(url);
    }
  }

  abort(): void {
    // Explicit user cancel: abort the active operation WITHOUT advancing the lane
    // epoch, so the aborted operation stays eligible and its AbortError branch may
    // commit loading=false (leaving the in-flight value/status). A superseding
    // fetch() instead advances the epoch (via the lane's begin()), which makes the
    // predecessor ineligible so its abort commits nothing (loading does not flicker).
    this._lane.abortActive();
  }

  // Run one guarded commit step (§5.1). The CommitGuard is re-checked before every
  // setter because a setter that synchronously dispatches an event can supersede
  // the same lane; an invalidation between setters stops the remaining commits
  // without rolling back what already fired.
  private _commitStep(ticket: OperationTicket, step: () => void): void {
    if (this._lane.canCommit(ticket)) {
      step();
    }
  }

  async fetch(url: string, options: FetchRequestOptions = {}): Promise<any> {
    // never-throw (§3.6): 引数バリデーション失敗は例外ではなく error プロパティに
    // 流し、サニタイズ値(null)を返す。command-token 経路からの呼び出しが unhandled
    // rejection にならず、「fetch() は全終了ケースで resolve」契約とも整合する。
    if (!url) {
      this._setError({ message: "url attribute is required." });
      return null;
    }

    const p = this._doFetch(url, options);
    this._promise = p;
    return p;
  }

  private async _doFetch(url: string, options: FetchRequestOptions): Promise<any> {
    // Issue a lane ticket. For the `latest` policy this advances the epoch and
    // aborts the previous in-flight request (supersede), returning a ticket +
    // attempt whose `signal` is the lane-owned AbortController for this operation.
    const started = this._lane.begin();
    // `latest` begin never returns null (exhaust is the only rejecting policy).
    const { ticket, attempt } = started!;
    const signal = attempt.signal!;

    this._commitStep(ticket, () => this._setLoading(true));
    this._commitStep(ticket, () => this._setError(null));

    const {
      method = "GET",
      body = null,
      contentType = null,
      forceText = false,
      responseType = "auto",
      timeout = 0,
    } = options;

    // Timeout terminal (§5.1 / §7): a timer claims the `timeout` outcome via the
    // same terminal CAS as success/error, commits a guarded TimeoutError, THEN
    // aborts the native request and releases the lane — never "invalidate first".
    // A completion that arrives after the timer loses the CAS and writes nothing.
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    if (timeout > 0) {
      timeoutTimer = setTimeout(() => {
        if (!this._lane.claimTerminal(ticket, "timeout")) return;
        this._commitStep(ticket, () => this._setError({ name: "TimeoutError", message: `Request timed out after ${timeout}ms.` }));
        this._commitStep(ticket, () => this._setResponse(null, 0));
        this._commitStep(ticket, () => this._setLoading(false));
        this._lane.abort(ticket);
        this._lane.finalize(ticket);
      }, timeout);
    }

    // Copy the caller's headers so the contentType injection below never mutates
    // the object passed in by a headless consumer (the Shell already builds a
    // fresh object, but direct FetchCore users may reuse theirs).
    const headers: Record<string, string> = { ...(options.headers ?? {}) };

    try {
      if (contentType && !headers["Content-Type"]) {
        headers["Content-Type"] = contentType;
      }

      const requestInit: RequestInit = {
        method,
        headers,
        signal,
      };

      if (method !== "GET" && method !== "HEAD" && body !== null) {
        requestInit.body = body;
      }

      const response = await globalThis.fetch(url, requestInit);

      // Read the body first, then atomically claim the terminal at the commit
      // point. Claiming AFTER the body read closes the stale-write race: a fetch
      // that was superseded (or timed out) during the body read fails the
      // CommitGuard's epoch/CAS check and writes nothing, even if the body still
      // resolved. HEAD carries no body by spec.
      let value: any = null;
      if (method === "HEAD") {
        // HEAD responses carry no body — reading it would throw a parse error.
      } else if (!response.ok) {
        // HTTP error: read the body text for the error envelope. Handled below.
      } else if (forceText) {
        // HTML-replace mode (the Shell sets forceText when `target` is present)
        // always reads text and takes priority over responseType.
        value = await response.text();
      } else if (responseType === "blob") {
        // Only buffer the Blob here; the managed object URL is created AFTER the
        // terminal claim wins (below). Creating it before the claim would leak a
        // blob: URL when this operation loses the claim (supersede / timeout /
        // dispose during the body read) — it would never reach _setResponse and
        // never be revoked.
        value = await response.blob();
      } else if (responseType === "arrayBuffer") {
        value = await response.arrayBuffer();
      } else if (responseType === "text") {
        value = await response.text();
      } else if (responseType === "json") {
        value = await response.json();
      } else {
        // "auto" (default): sniff Content-Type — JSON when it says so, else text.
        const responseContentType = response.headers.get("Content-Type") || "";
        if (responseContentType.includes("application/json")) {
          value = await response.json();
        } else {
          value = await response.text();
        }
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        const error = { status: response.status, statusText: response.statusText, body: errorBody };
        if (!this._lane.claimTerminal(ticket, "error")) {
          return null;
        }
        this._commitStep(ticket, () => this._setError(error));
        // Notify `status` observers on HTTP errors too. The `status` property is
        // surfaced via the `wcs-fetch:response` event (getter reads detail.status),
        // so without dispatching it here a bind() subscriber would never see the
        // error status (404, 500, ...). `value` is reset to null on error.
        this._commitStep(ticket, () => this._setResponse(null, response.status));
        this._commitStep(ticket, () => this._setLoading(false));
        return null;
      }

      if (!this._lane.claimTerminal(ticket, "success")) {
        return null;
      }
      // Create the blob object URL only now that this operation owns the terminal,
      // so a dropped operation never allocates one (leak-free). HEAD/non-blob keep
      // value non-Blob → objectURL stays null.
      const objectURL = value instanceof Blob ? this._createObjectURL(value) : null;
      this._commitStep(ticket, () => this._setResponse(value, response.status, objectURL));
      this._commitStep(ticket, () => this._setLoading(false));
      return this._value;
    } catch (e: any) {
      if (e && e.name === "AbortError") {
        // AbortError with a still-eligible ticket is an explicit user abort() of
        // the current request: claim the `aborted` terminal and clear loading,
        // leaving the in-flight value/status untouched. A superseding fetch or
        // dispose() advanced the epoch / owner generation, so their predecessors
        // fail the claim (return without writing = stale-drop). A timeout already
        // claimed the terminal in its timer, so this branch also no-ops there.
        if (this._lane.claimTerminal(ticket, "aborted")) {
          this._commitStep(ticket, () => this._setLoading(false));
        }
        return null;
      }
      // Network error. A superseded/disposed request fails the claim and drops.
      if (!this._lane.claimTerminal(ticket, "error")) {
        return null;
      }
      this._commitStep(ticket, () => this._setError(e));
      // Reset value/status on network errors too, mirroring the HTTP-error path.
      // Without this, a prior successful request's value/status would linger while
      // `error` is non-null. status=0 is the web-platform convention for "no HTTP
      // response" (matches XMLHttpRequest.status on network failure).
      this._commitStep(ticket, () => this._setResponse(null, 0));
      this._commitStep(ticket, () => this._setLoading(false));
      return null;
    } finally {
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
      }
      // Release the operation (identity-safe: keyed by operationId, so a
      // late-settling superseded request never disarms the successor). Idempotent
      // with the timeout timer's own finalize().
      this._lane.finalize(ticket);
    }
  }
}
