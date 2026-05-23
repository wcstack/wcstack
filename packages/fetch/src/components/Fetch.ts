import { config } from "../config.js";
import { IWcBindable } from "../types.js";
import { FetchCore } from "../core/FetchCore.js";
import { FetchHeader } from "./FetchHeader.js";
import { FetchBody } from "./FetchBody.js";
import { registerAutoTrigger } from "../autoTrigger.js";

export class Fetch extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...FetchCore.wcBindable,
    properties: [
      ...FetchCore.wcBindable.properties,
      { name: "trigger", event: "wcs-fetch:trigger-changed" },
    ],
    // Shell-level input surface. The Core declares only the portable `url` / `method`;
    // the Shell adds the DOM-driven settable surface. No `attribute` hints are given:
    // these setters already reflect to their attributes themselves, so a binding system
    // that mirrors inputs[].attribute would set the attribute twice. `commands`
    // (fetch / abort) are inherited unchanged from the Core via the spread above.
    inputs: [
      { name: "url" },
      { name: "method" },
      { name: "target" },
      { name: "manual" },
      { name: "body" },
      { name: "trigger" },
    ],
  };
  static get observedAttributes(): string[] { return ["url"]; }

  private _core: FetchCore;
  private _body: any = null;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

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

  get promise(): Promise<any> {
    return this._core.promise;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
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
      // Skip when url is empty. fetch() is fire-and-forget here (its returned
      // promise is intentionally only chained with .finally() to reset the flag,
      // never .catch()'d), and FetchCore.fetch() rejects on an empty url. Without
      // this guard that rejection — re-thrown by .finally() — surfaces as an
      // unhandled promise rejection. Mirrors the url-less guard in autoTrigger.
      //
      // Leave `_trigger` false (do not set it) and emit no event: nothing ran, so
      // surfacing a `wcs-fetch:trigger-changed` "completion" would lie to observers.
      // Keeping the flag false also avoids stalling — once url is provided, writing
      // `true` again is a real false→true transition that triggers the fetch.
      if (!this.url) return;
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

  private _collectBody(bodySnapshot: any): { body: BodyInit | null; contentType: string | null } {
    // JS API経由のbodyが優先
    if (bodySnapshot !== null) {
      return {
        body: typeof bodySnapshot === "string" ? bodySnapshot : JSON.stringify(bodySnapshot),
        contentType: typeof bodySnapshot === "string" ? null : "application/json",
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

    // Snapshot and reset `body` synchronously, before any await. The body is a
    // one-shot input; resetting it after the await (when another caller may have
    // already set a new body for the next request) would silently drop that value.
    const bodySnapshot = this._body;
    this._body = null;
    const { body, contentType } = this._collectBody(bodySnapshot);

    const result = await this._core.fetch(this.url, {
      method: this.method,
      headers,
      body,
      contentType,
      forceText: !!this.target,
    });

    // HTML置換モード
    // Security: the response is injected as raw innerHTML without sanitization.
    // This is an opt-in convenience for trusted fragments only; the primary,
    // recommended path is state-driven binding via @wcstack/state. Do not point
    // `target` at an untrusted endpoint (XSS risk). See README "HTML Replace Mode".
    if (this.target && result !== null) {
      const targetElement = document.getElementById(this.target);
      if (targetElement) {
        targetElement.innerHTML = result;
      }
    }

    return result;
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    // Re-fetch on url changes, but intentionally do NOT update
    // `_connectedCallbackPromise`. Per the wc-bindable connectedCallbackPromise
    // protocol that promise represents the one-shot "connect-time initialization
    // is done" signal; it resolves once and is not re-armed for later url-driven
    // requests. Await `promise` if you need to track a specific re-fetch.
    if (name === "url" && this.isConnected && !this.manual && newValue) {
      this.fetch();
    }
  }

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    // Only the initial connect-time fetch is tracked by connectedCallbackPromise.
    if (!this.manual && this.url) {
      this._connectedCallbackPromise = this.fetch().then(() => {});
    }
  }

  disconnectedCallback(): void {
    this.abort();
  }
}
