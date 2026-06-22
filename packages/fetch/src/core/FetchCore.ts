import { IWcBindable } from "../types.js";

export interface FetchRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  contentType?: string | null;
  forceText?: boolean;
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
  private _abortController: AbortController | null = null;
  private _promise: Promise<any> = Promise.resolve(null);
  // Generation guard (§3.4): bumped on dispose() (and each fetch start). An
  // in-flight request that settles after dispose / a superseding start has a
  // stale `gen` and MUST NOT write state to a torn-down element. A boolean flag
  // is insufficient (dispose→observe would let stale work slip through).
  private _gen = 0;
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
    this._gen++;
    this.abort();
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
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-fetch:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setResponse(value: any, status: number): void {
    this._value = value;
    this._status = status;
    this._target.dispatchEvent(new CustomEvent("wcs-fetch:response", {
      detail: { value, status },
      bubbles: true,
    }));
  }

  abort(): void {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
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
    // 進行中のリクエストをキャンセル
    this.abort();

    // Hold the controller in a local so the finally block (which can run after a
    // subsequent fetch has already replaced this._abortController) only clears the
    // field when it still owns it. Without the identity check, an aborted earlier
    // request's finally would null out the controller of the request that superseded
    // it, leaving the later request un-abortable.
    const ac = new AbortController();
    this._abortController = ac;
    const { signal } = ac;

    // Capture the generation at async start (§3.4). A completion that runs after
    // dispose() (which bumps _gen) is stale and must not write state.
    const gen = ++this._gen;

    this._setLoading(true);
    this._setError(null);

    const {
      method = "GET",
      body = null,
      contentType = null,
      forceText = false,
    } = options;

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

      // A stale generation means dispose() (or a superseding fetch) ran while the
      // request was in flight. Drop the result without touching torn-down state.
      if (gen !== this._gen) {
        return null;
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        const error = { status: response.status, statusText: response.statusText, body: errorBody };
        this._setError(error);
        // Notify `status` observers on HTTP errors too. The `status` property is
        // surfaced via the `wcs-fetch:response` event (getter reads detail.status),
        // so without dispatching it here a bind() subscriber would never see the
        // error status (404, 500, ...). `value` is reset to null on error.
        this._setResponse(null, response.status);
        this._setLoading(false);
        return null;
      }

      if (method === "HEAD") {
        // HEAD responses carry no body by spec. Reading it as JSON would throw a
        // parse error on the empty body (and end up as a spurious `error`), so skip
        // body reading entirely and surface only the status with a null value.
        this._setResponse(null, response.status);
      } else if (forceText) {
        const text = await response.text();
        this._setResponse(text, response.status);
      } else {
        const responseContentType = response.headers.get("Content-Type") || "";
        if (responseContentType.includes("application/json")) {
          const data = await response.json();
          this._setResponse(data, response.status);
        } else {
          const text = await response.text();
          this._setResponse(text, response.status);
        }
      }

      this._setLoading(false);
      return this._value;
    } catch (e: any) {
      // Stale completion (dispose / superseding fetch ran during a later await
      // such as response.json()). Drop the result without writing state.
      if (gen !== this._gen) {
        return null;
      }
      if (e.name === "AbortError") {
        // A matching generation means this is an explicit abort() of the current
        // request (a superseding fetch bumps _gen and is caught by the stale guard
        // above; dispose() likewise bumps _gen). Explicit abort clears loading so
        // observers leave the in-flight state.
        this._setLoading(false);
        return null;
      }
      this._setError(e);
      // Reset value/status on network errors too, mirroring the HTTP-error path
      // (`_setResponse(null, response.status)`). Without this, a prior successful
      // request's value/status would linger while `error` is non-null, showing
      // observers an inconsistent state (e.g. status=200 alongside a network
      // error). status=0 is the web-platform convention for "no HTTP response"
      // (matches XMLHttpRequest.status on network failure) and the initial value.
      this._setResponse(null, 0);
      this._setLoading(false);
      return null;
    } finally {
      if (this._abortController === ac) {
        this._abortController = null;
      }
    }
  }
}
