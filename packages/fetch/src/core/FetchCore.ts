import { raiseError } from "../raiseError.js";
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
  };

  private _target: EventTarget;
  private _value: any = null;
  private _loading: boolean = false;
  private _error: any = null;
  private _status: number = 0;
  private _abortController: AbortController | null = null;
  private _promise: Promise<any> = Promise.resolve(null);

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
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
    if (!url) {
      raiseError("url attribute is required.");
    }

    const p = this._doFetch(url, options);
    this._promise = p;
    return p;
  }

  private async _doFetch(url: string, options: FetchRequestOptions): Promise<any> {
    // 進行中のリクエストをキャンセル
    this.abort();

    this._abortController = new AbortController();
    const { signal } = this._abortController;

    this._setLoading(true);
    this._error = null;

    const {
      method = "GET",
      headers = {},
      body = null,
      contentType = null,
      forceText = false,
    } = options;

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
      this._status = response.status;

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        const error = { status: response.status, statusText: response.statusText, body: errorBody };
        this._setError(error);
        this._setLoading(false);
        return null;
      }

      if (forceText) {
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
      if (e.name === "AbortError") {
        this._setLoading(false);
        return null;
      }
      this._setError(e);
      this._setLoading(false);
      return null;
    } finally {
      this._abortController = null;
    }
  }
}
