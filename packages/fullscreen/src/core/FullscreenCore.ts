import { IWcBindable } from "../types.js";
import { WcsIoErrorInfo, featureUnavailable } from "./platformCapability.js";
import { deriveFullscreenErrorInfo, FullscreenErrorKind } from "./fullscreenCapabilities.js";

// A request this instance made whose answer may come as an event on the
// document. Whether it does is known only once the platform call has returned:
// a call that returns a promise (the standard API) is answered by that promise
// alone, and one that returns nothing (the prefixed API) is answered by
// fullscreenchange / fullscreenerror.
interface PendingRequest {
  // true once the call has returned without a promise: the events answer it.
  waiting: boolean;
  // a fullscreenerror fired before the call returned (decided when it returns).
  refused: boolean;
}

// What a refusal that arrives as an event is reported as. The event carries no
// reason, so the message says no more than that; `NotAllowedError` puts it in
// the `not-allowed` class (recoverable: a request from a user gesture may pass).
function refusedByEvent(): DOMException {
  return new DOMException("The browser refused the fullscreen request.", "NotAllowedError");
}

/**
 * Headless Fullscreen API primitive. Unlike most wcstack IO nodes, this Core
 * does not operate on itself: it drives `requestFullscreen()` /
 * `exitFullscreen()` on a *referenced* Element that the Shell resolves via its
 * `target` attribute (docs/fullscreen-tag-design.md §0). The Core only ever
 * receives already-resolved `Element`s from its callers — it has no opinion on
 * how `target` selectors are parsed.
 *
 * `document.fullscreenElement` is a single document-wide value, so this Core
 * always compares against the *last element it resolved* (via
 * `requestFullscreen()`/`setTarget()`), never against "is the document
 * fullscreen at all" — that comparison is what keeps multiple concurrent
 * `<wcs-fullscreen>` instances from all reporting the same `active` value
 * (docs/fullscreen-tag-design.md §2.1, MUST).
 */
export class FullscreenCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "active", event: "wcs-fullscreen:change", semantics: "state", getter: (e: Event) => (e as CustomEvent).detail.active },
      // `error` / `errorInfo` are observable failure outputs. Historically `error`
      // was an imperative getter with no event; both are now bindable (event-backed)
      // so `data-wcs` / bind() can observe a request/exit failure. `errorInfo` is the
      // additive serializable taxonomy (stable code / phase / recoverable) derived
      // from `error`; the `error` value shape is unchanged. No lane — fullscreen
      // drives a referenced element, not a competing operation.
      { name: "error", event: "wcs-fullscreen:error", semantics: "state" },
      { name: "errorInfo", event: "wcs-fullscreen:error-info-changed", semantics: "state" },
      // Whether this page can use element fullscreen (the API is there and no
      // Permissions-Policy forbids it). Computed at call time; the event carries
      // the boolean and fires from observe() when it differs from the last value
      // dispatched.
      { name: "supported", event: "wcs-fullscreen:supported-changed", semantics: "state" },
    ],
    commands: [
      { name: "requestFullscreen", async: true },
      { name: "exitFullscreen", async: true },
    ],
  };

  private _target: EventTarget;
  private _active: boolean = false;
  // Single error slot (§8): null means "no recent failure". Fullscreen's
  // gesture-rejection failure is a one-shot event, not a persistent state
  // machine like permission's 4-value surface — active/error are two
  // orthogonal, independently-observable axes.
  private _error: any = null;
  private _errorInfo: WcsIoErrorInfo | null = null;

  // The last Element this Core resolved via requestFullscreen()/setTarget().
  // Compared against document.fullscreenElement on every fullscreenchange so
  // each instance judges only its own target (§2.1). null means "no target
  // resolved yet" — active must stay false in that case.
  private _resolvedTarget: Element | null = null;

  // Generation guard (§6): Core-scoped (one per Core, not per-target),
  // mirroring fetch/upload. document.fullscreenElement is a single
  // document-wide slot, so at most one in-flight request/exit is meaningful
  // per Core at a time.
  private _gen = 0;

  // The request this instance made that an event may still answer, or null. The
  // standard API answers with its promise; the prefixed one returns nothing and
  // answers with fullscreenchange / fullscreenerror on the document. A
  // fullscreenerror is this instance's only while this is set and waiting — the
  // event does not say whose request failed.
  private _request: PendingRequest | null = null;

  // `supported` as last dispatched (never the value itself — the getter probes at
  // call time). Starts at false, so observe() announces a page that can use it.
  private _supportedPublished = false;

  // True once observe() has attached the document-level fullscreenchange /
  // fullscreenerror listeners. Guards observe() so a redundant call does not
  // double-subscribe; dispose() resets it so a later observe() resumes cleanly.
  private _subscribed = false;

  // SSR (§10): no asynchronous probe to await — observe() completes
  // synchronously, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  get active(): boolean {
    return this._active;
  }

  get error(): any {
    return this._error;
  }

  /**
   * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
   * `recoverable`), or null. Additive wc-bindable property (event
   * `wcs-fullscreen:error-info-changed`), derived from `error`; the existing
   * `error` value shape is unchanged.
   */
  get errorInfo(): WcsIoErrorInfo | null {
    return this._errorInfo;
  }

  /**
   * Whether this page can use element fullscreen right now: the document says
   * fullscreen is enabled, an element has `requestFullscreen()` (or the prefixed
   * `webkitRequestFullscreen()`), and no Permissions-Policy (`fullscreen`: the
   * server's header, an `<iframe>` without `allow="fullscreen"`) forbids it.
   * Probed at call time, never cached. It does not say that a request will
   * succeed (that still needs a user gesture). An iPhone has no element
   * fullscreen, so this is `false` there. A wc-bindable output (event
   * `wcs-fullscreen:supported-changed`).
   */
  get supported(): boolean {
    // The policy is asked first, and `fullscreenEnabled` is read only when it did
    // not forbid: a browser may report reading it in a forbidding frame as an
    // error. Only "policy-blocked" decides here: fullscreen does not need a
    // secure context (a plain http: page can use it), so "insecure-context" is
    // not a reason, and `fullscreenEnabled` — which follows the policy itself —
    // gives the answer there and where the policy cannot be asked (WebKit and
    // Firefox expose no policy object).
    if (featureUnavailable("fullscreen") === "policy-blocked") return false;
    const d = document as any;
    if ((d.fullscreenEnabled ?? d.webkitFullscreenEnabled ?? false) !== true) return false;
    const proto = Element.prototype as any;
    return typeof proto.requestFullscreen === "function" || typeof proto.webkitRequestFullscreen === "function";
  }

  /**
   * Update the resolved target without issuing a fullscreen request (e.g. the
   * Shell re-resolves `target` on attribute change / connect). Re-evaluates
   * `active` against the current `document.fullscreenElement` so the state
   * stays correct even if the target changed while already fullscreen.
   */
  setTarget(element: Element | null): void {
    this._resolvedTarget = element;
    this._applyActive();
  }

  // Lifecycle (§10/§3.5). Idempotent: a second observe() while already
  // subscribed is a no-op (no double listener). Synchronous overall (no probe
  // to await), so the returned promise is only for API uniformity with other
  // IO nodes. Also publishes `supported` when it differs from the last value
  // dispatched.
  observe(): Promise<void> {
    this._publishSupported();
    if (!this._subscribed) {
      this._subscribed = true;
      document.addEventListener(this._fullscreenChangeEventName(), this._onFullscreenChange);
      document.addEventListener(this._fullscreenErrorEventName(), this._onFullscreenError);
    }
    return this._ready;
  }

  dispose(): void {
    this._gen++;
    this._request = null;
    if (this._subscribed) {
      this._subscribed = false;
      document.removeEventListener(this._fullscreenChangeEventName(), this._onFullscreenChange);
      document.removeEventListener(this._fullscreenErrorEventName(), this._onFullscreenError);
    }
    // A disposed Core hears no fullscreenchange, so it can no longer vouch for
    // `active`: publish false through the normal setter (timing contract §22 — a
    // disconnect publishes what it changes). Nothing is exited: the target stays
    // fullscreen for as long as the browser keeps it, and setTarget() re-reads the
    // truth — publishing true again — on the next connect.
    this._setActive(false);
  }

  /**
   * Request fullscreen on `element`. never-throw (§3/§6): a missing API or a
   * rejected promise (e.g. a `TypeError` from a call outside a user
   * gesture, per the WHATWG Fullscreen spec's transient-activation check) is
   * caught and surfaced via `error`, never thrown. The caller
   * (Shell) is responsible for resolving `target` and for ensuring this is
   * invoked from within an actual user gesture — this Core cannot manufacture
   * one (docs/fullscreen-tag-design.md §3).
   */
  async requestFullscreen(element: Element | null): Promise<void> {
    const gen = ++this._gen;
    this._resolvedTarget = element;
    this._request = null; // this call supersedes the request before it
    if (!element) {
      // Distinct from "API is not supported" (below): the Shell's `target`
      // selector did not resolve to any element (missing/typo'd selector).
      // Conflating the two previously misled users into thinking Fullscreen
      // itself was unsupported when only their selector was wrong.
      this._setError({ message: "Fullscreen target could not be resolved." }, "invalid-argument");
      return;
    }
    const fn = this._requestFullscreenFn(element);
    if (!fn) {
      this._setError({ message: "Fullscreen API is not supported." }, "capability-missing");
      return;
    }
    const request: PendingRequest = { waiting: false, refused: false };
    this._request = request;
    try {
      const result: unknown = fn.call(element);
      if (typeof (result as { then?: unknown } | null | undefined)?.then === "function") {
        // The standard API: the call's promise answers this request, and it
        // alone. The browser fires fullscreenerror for the same refusal as well,
        // and the rejection carries the reason, so the event is not this
        // request's answer.
        this._request = null;
        await result;
        if (gen !== this._gen) return; // stale: dispose()/superseding call ran
        this._setError(null);
        this._applyActive();
        return;
      }
      // The prefixed API returns nothing: the answer is a fullscreenchange or a
      // fullscreenerror on the document.
      if (request.refused) {
        // The event fired inside the call itself.
        this._request = null;
        this._setError(refusedByEvent());
        return;
      }
      // The request is made: the failure before it is no longer the latest
      // attempt's. From here the events answer.
      this._setError(null);
      this._applyActive();
      request.waiting = true;
    } catch (e: any) {
      if (gen !== this._gen) return; // stale
      this._request = null;
      this._setError(e);
    }
  }

  /**
   * Exit fullscreen. Silent no-op (§7) when nothing is currently fullscreen or
   * the API is unsupported — both are treated as "already achieved the exit
   * intent", not as errors, keeping repeated calls safe and never-throw.
   */
  async exitFullscreen(): Promise<void> {
    // no-op checks come BEFORE the generation bump: a call that does nothing
    // must not supersede an in-flight requestFullscreen() — bumping first
    // would make the pending request's settle handling stale and silently
    // swallow its error/active updates.
    if (this._fullscreenElement() === null) return; // already not fullscreen: silent no-op
    const fn = this._exitFullscreenFn();
    if (!fn) return; // unsupported: silent no-op (semantically already "not fullscreen")
    const gen = ++this._gen;
    this._request = null; // an exit that runs supersedes a request still waiting for its answer
    try {
      await fn();
      if (gen !== this._gen) return; // stale
      this._setError(null);
      this._applyActive();
    } catch (e: any) {
      if (gen !== this._gen) return; // stale
      this._setError(e);
    }
  }

  // --- API resolution layer (§4): call-time, never cached. Lets tests
  // install/remove the standard/legacy APIs freely and lets an unsupported
  // environment be detected correctly on every call. ---

  private _requestFullscreenFn(el: Element): (() => Promise<void>) | undefined {
    return this._elementFullscreenFn(el, "requestFullscreen")
      ?? this._elementFullscreenFn(el, "webkitRequestFullscreen");
  }

  // Resolve a fullscreen method for `el` WITHOUT a naive `el[name]` lookup.
  // A plain lookup walks the whole prototype chain — and <wcs-fullscreen>
  // itself declares a `requestFullscreen()` *command* method, so when the
  // resolved target is the Shell element (target="self", or target omitted
  // with no children), the naive lookup would find the Shell's own command
  // instead of the platform API and recurse infinitely (stack overflow).
  // Instead: check the element's own properties (how tests install stubs —
  // happy-dom has no Fullscreen API — and how a deliberate per-element
  // monkey-patch would appear), then jump straight to Element.prototype,
  // where the platform defines the real methods. Both the standard and the
  // legacy webkit name go through this same resolution for symmetry.
  private _elementFullscreenFn(el: Element, name: string): (() => Promise<void>) | undefined {
    if (Object.prototype.hasOwnProperty.call(el, name)) {
      return (el as any)[name];
    }
    return (Element.prototype as any)[name];
  }

  private _exitFullscreenFn(): (() => Promise<void>) | undefined {
    const d = document as any;
    return d.exitFullscreen?.bind(document) ?? d.webkitExitFullscreen?.bind(document);
  }

  private _fullscreenElement(): Element | null {
    const d = document as any;
    return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
  }

  private _fullscreenChangeEventName(): string {
    return "onfullscreenchange" in document ? "fullscreenchange" : "webkitfullscreenchange";
  }

  private _fullscreenErrorEventName(): string {
    return "onfullscreenerror" in document ? "fullscreenerror" : "webkitfullscreenerror";
  }

  // --- Internal ---

  private _onFullscreenChange = (): void => {
    this._applyActive();
    // The target is fullscreen: a request that was waiting for its answer has it.
    if (this._active) this._request = null;
  };

  // A refusal that arrives as an event. The prefixed API returns no promise, so
  // this is the only place its refusal shows. A request whose call returned a
  // promise is not waiting for this event (`_request` is null from the moment
  // the call returned), so a refusal the promise reports is never reported a
  // second time. The event reaches the document without saying whose request
  // failed: with no request waiting here, it is another instance's (or the
  // page's own call) and is ignored.
  private _onFullscreenError = (): void => {
    const request = this._request;
    if (request === null) return;
    if (!request.waiting) {
      // Inside the platform call: whether a promise answers is not known yet.
      request.refused = true;
      return;
    }
    this._request = null;
    this._setError(refusedByEvent());
  };

  // `supported` is probed at call time, so there is no stored value to set: this
  // dispatches the current one when it differs from the last one dispatched
  // (same-value guard). A state binding reads the property when it attaches; the
  // event is for every other listener.
  private _publishSupported(): void {
    const supported = this.supported;
    if (this._supportedPublished === supported) return;
    this._supportedPublished = supported;
    this._target.dispatchEvent(new CustomEvent("wcs-fullscreen:supported-changed", {
      detail: supported,
      bubbles: true,
    }));
  }

  // Re-derive `active` by comparing document.fullscreenElement (incl. legacy
  // fallback) against *this instance's* resolved target (§2/§2.1/§5). A null
  // resolved target always yields active=false — there is nothing for this
  // instance to claim as "mine".
  private _applyActive(): void {
    const next = this._resolvedTarget !== null && this._fullscreenElement() === this._resolvedTarget;
    this._setActive(next);
  }

  private _setActive(v: boolean): void {
    if (this._active === v) return; // same-value guard (§3.3 MUST)
    this._active = v;
    this._target.dispatchEvent(new CustomEvent("wcs-fullscreen:change", {
      detail: { active: v },
      bubbles: true,
    }));
  }

  // `kind` is an explicit taxonomy discriminator passed only from the synthetic
  // error sites (unsupported / unresolved target); caught exceptions pass no kind
  // and are classified by their `.name`. Both `error` and the additive `errorInfo`
  // are now event-backed so a request/exit failure is observable via bind().
  private _setError(error: any, kind?: FullscreenErrorKind): void {
    // Same-value guard on reference: each failure builds a fresh object and the
    // clear path passes the literal null, so this only suppresses redundant
    // null→null (a successful request/exit clearing an already-null error).
    if (this._error === error) return;
    this._error = error;
    // Keep the additive errorInfo taxonomy in sync; fire it before the `error`
    // event so an observer of both sees the classification first (io-node family).
    this._commitErrorInfo(error === null ? null : deriveFullscreenErrorInfo(error, kind));
    this._target.dispatchEvent(new CustomEvent("wcs-fullscreen:error", {
      detail: error,
      bubbles: true,
    }));
  }

  // Called only from _setError (already reference-guarded), so errorInfo
  // transitions exactly when error does — no separate guard needed here.
  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-fullscreen:error-info-changed", {
      detail: info,
      bubbles: true,
    }));
  }
}
