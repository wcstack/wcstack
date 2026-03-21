import { config } from "../config.js";
import { IWcBindable } from "../types.js";
import { FetchCore } from "../core/FetchCore.js";
import { FetchHeader } from "./FetchHeader.js";
import { FetchBody } from "./FetchBody.js";

export class Fetch extends HTMLElement {
  static wcBindable: IWcBindable = {
    ...FetchCore.wcBindable,
    properties: [
      ...FetchCore.wcBindable.properties,
      { name: "trigger", event: "wcs-fetch:trigger-changed" },
    ],
  };
  static get observedAttributes(): string[] { return ["url"]; }

  private _core: FetchCore;
  private _body: any = null;
  private _trigger: boolean = false;

  constructor() {
    super();
    this._core = new FetchCore(this);
  }

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
    return this._core.value;
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get error(): any {
    return this._core.error;
  }

  get status(): number {
    return this._core.status;
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

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    const v = !!value;
    if (v) {
      this._trigger = true;
      this.fetch().finally(() => {
        this._trigger = false;
        this.dispatchEvent(new CustomEvent("wcs-fetch:trigger-changed", {
          detail: false,
          bubbles: true,
        }));
      });
    }
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

  abort(): void {
    this._core.abort();
  }

  async fetch(): Promise<any> {
    const headers = this._collectHeaders();
    const { body, contentType } = this._collectBody();

    const result = await this._core.fetch(this.url, {
      method: this.method,
      headers,
      body,
      contentType,
      forceText: !!this.target,
    });

    // HTML置換モード
    if (this.target && result !== null) {
      const targetElement = document.getElementById(this.target);
      if (targetElement) {
        targetElement.innerHTML = result;
      }
    }

    // bodyをリセット（一回限りの使用）
    this._body = null;

    return result;
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (name === "url" && this.isConnected && !this.manual && newValue) {
      this.fetch();
    }
  }

  connectedCallback(): void {
    this.style.display = "none";
    if (!this.manual && this.url) {
      this.fetch();
    }
  }

  disconnectedCallback(): void {
    this.abort();
  }
}
