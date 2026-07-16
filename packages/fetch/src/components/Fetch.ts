import { config } from "../config.js";
import { IWcBindable } from "../types.js";
import { FetchCore, FetchResponseType } from "../core/FetchCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";
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
      { name: "responseType" },
      { name: "trigger" },
    ],
  };
  static get observedAttributes(): string[] { return ["url"]; }

  private _core: FetchCore;
  private _body: any = null;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  // Auto-fetch coalescing state (see _scheduleAutoFetch).
  private _autoPending: boolean = false;
  private _connectResolve: (() => void) | null = null;
  private _lastFetchedUrl: string | null = null;
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    // State reflection is wired BEFORE the Core is constructed (canonical
    // order): a Core that dispatches synchronously from its constructor
    // (e.g. speech's unsupported-changed) would otherwise fire before the
    // listeners exist. FetchCore doesn't do that, so this is equivalent here,
    // but every Shell keeps the same order.
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-fetch:loading-changed": (d) => ({ loading: d === true }),
      "wcs-fetch:error":           (d) => ({ error: d != null }),
    });
    this._core = new FetchCore(this);
  }

  // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
  // wc-bindable (not a bind target); see README "CSS styling with :state()".
  // MUST NOT return the live CustomStateSet (that would let callers write
  // states from outside, defeating the point of :state() being read-only).
  get debugStates(): string[] {
    return this._internals ? [...this._internals.states] : [];
  }

  private _initInternals(): ElementInternals | null {
    // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
    // in happy-dom / older environments, and pre-125 Chromium rejects
    // non-dashed state names from states.add() (probed and discarded here).
    // Either case silently disables reflection — the component still works,
    // it just doesn't expose :state() selectors.
    try {
      if (typeof this.attachInternals !== "function") return null;
      const internals = this.attachInternals();
      internals.states.add("wcs-probe");
      internals.states.delete("wcs-probe");
      return internals;
    } catch {
      return null;
    }
  }

  private _wireStates(map: Record<string, (detail: any) => Record<string, boolean>>): void {
    if (this._internals === null) return;
    const states = this._internals.states;
    for (const [event, toStates] of Object.entries(map)) {
      this.addEventListener(event, (e) => {
        const debug = this.hasAttribute("debug-states");
        for (const [name, on] of Object.entries(toStates((e as CustomEvent).detail))) {
          try {
            if (on) { states.add(name); } else { states.delete(name); }
          } catch { /* never-throw */ }
          if (debug) this.toggleAttribute(`data-wcs-state-${name}`, on);
        }
      });
    }
  }

  // Input setters normalize null/undefined to attribute removal instead of
  // letting setAttribute stringify them ("undefined" url would auto-fetch
  // /undefined, "undefined" method is an invalid HTTP method). The binder
  // already skips undefined writes; this guards direct JS assignment too.
  get url(): string {
    return this.getAttribute("url") || "";
  }

  set url(value: string | null) {
    if (value == null) {
      this.removeAttribute("url");
    } else {
      this.setAttribute("url", value);
    }
  }

  get method(): string {
    return (this.getAttribute("method") || "GET").toUpperCase();
  }

  set method(value: string | null) {
    if (value == null) {
      this.removeAttribute("method");
    } else {
      this.setAttribute("method", value);
    }
  }

  get target(): string | null {
    return this.getAttribute("target");
  }

  set target(value: string | null) {
    if (value == null) {
      this.removeAttribute("target");
    } else {
      this.setAttribute("target", value);
    }
  }

  // Response body interpretation. Backed by the `response-type` attribute so it is
  // settable from HTML, JS, or a binding. An unknown value falls through to the
  // Core's "auto" branch. `target` (HTML-replace mode) overrides this.
  get responseType(): FetchResponseType {
    return (this.getAttribute("response-type") as FetchResponseType) || "auto";
  }

  set responseType(value: string | null) {
    if (value == null) {
      this.removeAttribute("response-type");
    } else {
      this.setAttribute("response-type", value);
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

  get objectURL(): string | null {
    return this._core.objectURL;
  }

  get errorInfo(): WcsIoErrorInfo | null {
    return this._core.errorInfo;
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
    // Normalize undefined to null: _collectBody treats "!== null" as "body was
    // provided", so a raw undefined would serialize as a JSON request body.
    this._body = value ?? null;
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

  // fetch がネイティブに扱える BodyInit か判定する。これらは JSON.stringify せず
  // 素通しし、Content-Type をブラウザに委ねる (FormData の multipart boundary、
  // Blob の type、URLSearchParams の application/x-www-form-urlencoded を自動付与
  // させるため、_collectBody は contentType に null を返す)。ReadableStream は
  // RequestInit.duplex: 'half' を要するため初版では対象外とし、従来どおり扱う。
  private _isNativeBodyInit(value: unknown): value is BodyInit {
    return value instanceof Blob          // File は Blob のサブクラス
      || value instanceof FormData
      || value instanceof URLSearchParams
      || value instanceof ArrayBuffer
      || ArrayBuffer.isView(value);       // TypedArray / DataView
  }

  private _collectBody(bodySnapshot: any): { body: BodyInit | null; contentType: string | null } {
    // JS API経由のbodyが優先
    if (bodySnapshot !== null) {
      // 文字列はそのまま。Content-Type はユーザーのヘッダ指定に委ねる。
      if (typeof bodySnapshot === "string") {
        return { body: bodySnapshot, contentType: null };
      }
      // ネイティブ BodyInit (Blob/File/FormData/URLSearchParams/ArrayBuffer/TypedArray)
      // は素通し。Content-Type はブラウザに委ねるため null を返す。
      if (this._isNativeBodyInit(bodySnapshot)) {
        return { body: bodySnapshot, contentType: null };
      }
      // それ以外のオブジェクトは JSON 化する。
      return { body: JSON.stringify(bodySnapshot), contentType: "application/json" };
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

  /**
   * Coalesce auto-fetch requests in the current task into a single microtask.
   *
   * Multiple synchronous input writes in the same tick — e.g. a `...` spread
   * writing `url` before `manual` — collapse into one decision made against the
   * FINAL element state, so the spread application order can no longer trigger a
   * stray fetch. The microtask re-reads `isConnected` / `manual` / `url` at fire
   * time; whatever was written last wins.
   *
   * Only the implicit auto-fetch (url attribute change, connect-time) is routed
   * here. Explicit triggers — the `trigger` setter, the `fetch` command, and
   * autoTrigger (data-fetchtarget clicks) — must fire immediately and stay on
   * their own synchronous paths.
   *
   * The connect-time promise (connectedCallbackPromise) is resolved here in
   * EVERY exit path, including the no-fetch branch, so awaiting it never hangs
   * when the final state turns out to be manual / url-less / disconnected.
   */
  private _scheduleAutoFetch(): void {
    if (this._autoPending) {
      return;
    }
    this._autoPending = true;
    queueMicrotask(() => {
      this._autoPending = false;
      const resolveConnect = this._connectResolve;
      this._connectResolve = null;
      const url = this.url;
      // Same-value guard (Phase 4): skip a redundant auto-fetch for the url we
      // last fetched. A spread re-evaluation rewrites every input each cycle, so
      // the `url` setter calls setAttribute with an unchanged value and fires
      // attributeChangedCallback again; without this guard an unrelated state
      // change would refetch. Auto-path only — explicit fetch()/trigger/command
      // stay unconditional (a manual refresh of the same url must work), and
      // `_lastFetchedUrl` is reset on disconnect so a remount refetches.
      if (this.isConnected && !this.manual && url && url !== this._lastFetchedUrl) {
        // fetch() cannot reject here: FetchCore swallows network/HTTP errors and
        // only rejects on an empty url, which the `url` guard above rules out.
        this.fetch().finally(() => resolveConnect?.());
      } else {
        resolveConnect?.();
      }
    });
  }

  async fetch(): Promise<any> {
    // Record the url for the auto-fetch same-value guard. Every fetch (explicit
    // included) updates it so a later auto-write of the same url is treated as a
    // no-op rather than a duplicate request.
    this._lastFetchedUrl = this.url;
    const headers = this._collectHeaders();

    // Snapshot and reset `body` synchronously, before any await. The body is a
    // one-shot input; resetting it after the await (when another caller may have
    // already set a new body for the next request) would silently drop that value.
    const bodySnapshot = this._body;
    this._body = null;
    const { body, contentType } = this._collectBody(bodySnapshot);

    // FormData に手動で Content-Type を付けると、ブラウザが付与するはずの multipart
    // boundary が失われてサーバー側でパースできなくなる。ヘッダはユーザー指定を
    // 尊重して素通しするが、この典型的な誤設定は警告する。
    if (body instanceof FormData &&
        Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
      console.warn(
        "[@wcstack/fetch] A manual Content-Type header was set alongside a FormData body. " +
        "This drops the multipart boundary the browser adds automatically; remove the " +
        "Content-Type header (e.g. the <wcs-fetch-header>) to fix multipart uploads.",
      );
    }

    const result = await this._core.fetch(this.url, {
      method: this.method,
      headers,
      body,
      contentType,
      forceText: !!this.target,
      responseType: this.responseType,
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

  attributeChangedCallback(name: string, _oldValue: string | null, _newValue: string | null): void {
    // Re-fetch on url changes, but intentionally do NOT update
    // `_connectedCallbackPromise`. Per the wc-bindable connectedCallbackPromise
    // protocol that promise represents the one-shot "connect-time initialization
    // is done" signal; it resolves once and is not re-armed for later url-driven
    // requests. Await `promise` if you need to track a specific re-fetch.
    //
    // Defer the decision to a microtask (see _scheduleAutoFetch) instead of
    // fetching synchronously here: a `...` spread writes `url` before `manual`,
    // so a synchronous fetch would fire before `manual` is applied. The final
    // state (isConnected / manual / url) is re-read at microtask time.
    if (name === "url") {
      this._scheduleAutoFetch();
    }
  }

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    // Only the initial connect-time fetch is tracked by connectedCallbackPromise.
    // Arm a deferred here when an auto-fetch looks likely; the scheduled
    // microtask resolves it (in every exit path, so awaiting never hangs). The
    // actual fetch decision is re-evaluated at microtask time against the final
    // state, so a spread that sets `manual` after `url` still suppresses it.
    if (!this.manual && this.url) {
      this._connectedCallbackPromise = new Promise<void>((resolve) => {
        this._connectResolve = resolve;
      });
    }
    this._scheduleAutoFetch();
  }

  disconnectedCallback(): void {
    this.abort();
    // Reset the same-value guard so a remount (reconnect with the same url)
    // refetches rather than being skipped as a duplicate.
    this._lastFetchedUrl = null;
    // Resolve any armed connect-time deferred before detaching. A synchronous
    // remove()→append() before the scheduled microtask fires would otherwise let
    // the second connectedCallback overwrite _connectResolve, orphaning the first
    // deferred and hanging any caller that already awaited connectedCallbackPromise.
    // Disconnection makes connect-time init moot, so resolving (never hanging) is
    // correct; the pending microtask then sees _connectResolve === null and no-ops.
    this._connectResolve?.();
    this._connectResolve = null;
  }
}
