import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { IWcBindable } from "../types.js";
import { FetchHeader } from "./FetchHeader.js";
import { FetchBody } from "./FetchBody.js";

export class Fetch extends HTMLElement {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "value", event: "wcs-fetch:response" },
      { name: "loading", event: "wcs-fetch:loading-changed" },
      { name: "error", event: "wcs-fetch:error" },
      { name: "status", event: "wcs-fetch:response", getter: (e: Event) => (e as CustomEvent).detail.status },
    ],
  };

  private _value: any = null;
  private _loading: boolean = false;
  private _error: any = null;
  private _status: number = 0;
  private _body: any = null;
  private _abortController: AbortController | null = null;

  get url(): string {
    return this.getAttribute("url") || "";
  }

  set url(value: string) {
    this.setAttribute("url", value);
  }

  get method(): string {
    return (this.getAttribute("method") || "GET").toUpperCase();
  }

  set method(value: string) {
    this.setAttribute("method", value);
  }

  get target(): string | null {
    return this.getAttribute("target");
  }

  set target(value: string | null) {
    if (value === null) {
      this.removeAttribute("target");
    } else {
      this.setAttribute("target", value);
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

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean) {
    if (value) {
      this.setAttribute("manual", "");
    } else {
      this.removeAttribute("manual");
    }
  }

  get body(): any {
    return this._body;
  }

  set body(value: any) {
    this._body = value;
  }

  private _collectHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const headerElements = this.querySelectorAll<FetchHeader>(config.tagNames.fetchHeader);
    for (const el of headerElements) {
      const name = el.headerName;
      const value = el.headerValue;
      if (name) {
        headers[name] = value;
      }
    }
    return headers;
  }

  private _collectBody(): { body: BodyInit | null; contentType: string | null } {
    // JS API経由のbodyが優先
    if (this._body !== null) {
      return {
        body: typeof this._body === "string" ? this._body : JSON.stringify(this._body),
        contentType: typeof this._body === "string" ? null : "application/json",
      };
    }

    // サブタグからbodyを取得
    const bodyElement = this.querySelector<FetchBody>(config.tagNames.fetchBody);
    if (bodyElement) {
      return {
        body: bodyElement.bodyContent || null,
        contentType: bodyElement.contentType,
      };
    }

    return { body: null, contentType: null };
  }

  private _setLoading(loading: boolean): void {
    this._loading = loading;
    this.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    this._error = error;
    this.dispatchEvent(new CustomEvent("wcs-fetch:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setResponse(value: any, status: number): void {
    this._value = value;
    this._status = status;
    this.dispatchEvent(new CustomEvent("wcs-fetch:response", {
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

  async fetch(): Promise<any> {
    const url = this.url;
    if (!url) {
      raiseError("url attribute is required.");
    }

    // 進行中のリクエストをキャンセル
    this.abort();

    this._abortController = new AbortController();
    const { signal } = this._abortController;

    this._setLoading(true);
    this._error = null;

    try {
      const headers = this._collectHeaders();
      const { body, contentType } = this._collectBody();

      if (contentType && !headers["Content-Type"]) {
        headers["Content-Type"] = contentType;
      }

      const requestInit: RequestInit = {
        method: this.method,
        headers,
        signal,
      };

      if (this.method !== "GET" && this.method !== "HEAD" && body !== null) {
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

      const target = this.target;
      if (target) {
        // HTMLリプレースモード
        const html = await response.text();
        const targetElement = document.getElementById(target);
        if (targetElement) {
          targetElement.innerHTML = html;
        }
        this._value = html;
        this._setResponse(html, response.status);
      } else {
        // JSONモード
        const contentType = response.headers.get("Content-Type") || "";
        if (contentType.includes("application/json")) {
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
      // bodyをリセット（一回限りの使用）
      this._body = null;
    }
  }

  connectedCallback(): void {
    if (!this.manual && this.url) {
      this.fetch();
    }
  }

  disconnectedCallback(): void {
    this.abort();
  }
}
