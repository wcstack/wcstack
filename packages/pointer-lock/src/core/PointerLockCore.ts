import { IWcBindable } from "../types.js";
import { WcsIoErrorInfo } from "./platformCapability.js";
import { derivePointerLockErrorInfo, PointerLockErrorKind } from "./pointerLockCapabilities.js";

// A request this instance made whose answer may come as an event on the
// document. Whether it does is known only once the platform call has returned:
// a call that returns a promise is answered by that promise alone, and one that
// returns nothing (Firefox, the prefixed API) is answered by pointerlockchange /
// pointerlockerror.
interface PendingRequest {
  // true once the call has returned without a promise: the events answer it.
  waiting: boolean;
  // a pointerlockerror fired before the call returned (decided when it returns).
  refused: boolean;
}

// What a refusal that arrives as an event is reported as. The event carries no
// reason, so the message says no more than that; `NotAllowedError` puts it in
// the `not-allowed` class (recoverable: a request from a user gesture may pass).
function refusedByEvent(): DOMException {
  return new DOMException("The browser refused the pointer lock request.", "NotAllowedError");
}

/**
 * Headless Pointer Lock primitive. A thin, framework-agnostic wrapper around
 * the Pointer Lock API (`Element.requestPointerLock()` /
 * `document.exitPointerLock()` / `document.pointerLockElement` / the
 * `document`-scoped `pointerlockchange` event) exposed through the
 * wc-bindable protocol.
 *
 * This Core follows the same basic pattern as `FullscreenCore`
 * (docs/fullscreen-tag-design.md, referenced by docs/pointer-lock-tag-design.md
 * §1): target resolution happens in the Shell, `pointerlockchange` is
 * subscribed on `document` (not on the target element) and each instance
 * self-filters by comparing `document.pointerLockElement` against its own
 * resolved target, API resolution is call-time (never cached) and probes the
 * standard name before the legacy (`webkit`-prefixed) name, and a single
 * Core-level `_gen` generation guard protects the asynchronous
 * `requestPointerLock()` call from stale resolution after dispose().
 *
 * Key difference from Fullscreen (docs/pointer-lock-tag-design.md §2):
 * `exitPointerLock()` is a *synchronous* platform API (it returns `void`, not
 * a `Promise`), so the Core's `exitPointerLock()` command is synchronous too
 * and carries no `_gen` guard of its own — it is wrapped in `try/catch` only
 * as a defensive measure (never-throw), not because it can go stale.
 *
 * Scope note (docs/pointer-lock-tag-design.md §3): `movementX`/`movementY`
 * are intentionally NOT exposed by this Core (v1 scope). They are
 * high-frequency `mousemove` data unsuited to the same-value-guarded
 * declarative `properties` surface; see the design doc for the rationale and
 * the planned `debounce`/`throttle`-based opt-in for a future version.
 */
export class PointerLockCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    // `active`'s CustomEvent detail is the bare boolean value itself — no
    // getter needed (docs/pointer-lock-tag-design.md §2). This differs from
    // FullscreenCore's `{ active }`-shaped detail + getter.
    properties: [
      { name: "active", event: "wcs-pointer-lock:change", semantics: "state" },
      // `error` / `errorInfo` are observable failure outputs. Historically `error`
      // was an imperative getter with no event; both are now bindable (event-backed)
      // so `data-wcs` / bind() can observe a request/exit failure. `errorInfo` is the
      // additive serializable taxonomy (stable code / phase / recoverable) derived
      // from `error`; the `error` value shape is unchanged. No lane — pointer-lock
      // drives a referenced element, not a competing operation.
      { name: "error", event: "wcs-pointer-lock:error", semantics: "state" },
      { name: "errorInfo", event: "wcs-pointer-lock:error-info-changed", semantics: "state" },
      // Whether this page has the Pointer Lock API (an element has
      // requestPointerLock() or the prefixed name). Computed at call time; the
      // event carries the boolean and fires from observe() when it differs from
      // the last value dispatched.
      { name: "supported", event: "wcs-pointer-lock:supported-changed", semantics: "state" },
    ],
    commands: [
      { name: "requestPointerLock", async: true },
      // Synchronous platform API (document.exitPointerLock() returns void) —
      // no `async` flag (docs/pointer-lock-tag-design.md §2).
      { name: "exitPointerLock" },
    ],
  };

  private _target: EventTarget;
  private _active = false;
  private _error: any = null;
  private _errorInfo: WcsIoErrorInfo | null = null;

  // The element this instance last resolved requestPointerLock()/observe()
  // against, kept so the document-scoped `pointerlockchange` handler can
  // self-filter under multiple concurrent instances (docs/fullscreen-tag-design.md
  // §2.1, inherited verbatim by pointer-lock per docs/pointer-lock-tag-design.md §1).
  private _resolvedTarget: Element | null = null;

  // True once observe() has attached the live `document` listener. Guards
  // observe() so a redundant call does not re-subscribe; dispose() resets it
  // so a later observe() resumes cleanly.
  private _subscribed = false;

  // Core-level generation guard (§3.4 of the guidelines / §6 of
  // fullscreen-tag-design.md): only requestPointerLock() is asynchronous and
  // needs it. exitPointerLock() is synchronous and has no stale-resolution
  // race to guard against.
  private _gen = 0;

  // The request this instance made that an event may still answer, or null.
  // Chromium and WebKit answer with the call's promise; Firefox (and the prefixed
  // API) return nothing and answer with pointerlockchange / pointerlockerror on
  // the document. A pointerlockerror is this instance's only while this is set
  // and waiting — the event does not say whose request failed.
  private _request: PendingRequest | null = null;

  // `supported` as last dispatched (never the value itself — the getter probes at
  // call time). Starts at false, so observe() announces a page that has the API.
  private _supportedPublished = false;

  // SSR (§3.8): no asynchronous probe to await — observe() completes
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
   * `wcs-pointer-lock:error-info-changed`), derived from `error`; the existing
   * `error` value shape is unchanged.
   */
  get errorInfo(): WcsIoErrorInfo | null {
    return this._errorInfo;
  }

  /**
   * Whether this page has the Pointer Lock API right now: an element has
   * `requestPointerLock()` (or the prefixed `webkitRequestPointerLock()`). Probed
   * at call time, never cached. No Permissions-Policy feature governs pointer
   * lock, so there is no policy to ask. It does not say that a request will
   * succeed (that needs a user gesture, and a sandboxed `<iframe>` needs
   * `allow-pointer-lock`). A wc-bindable output (event
   * `wcs-pointer-lock:supported-changed`).
   */
  get supported(): boolean {
    const proto = Element.prototype as any;
    return typeof proto.requestPointerLock === "function" || typeof proto.webkitRequestPointerLock === "function";
  }

  // Lifecycle (§3.5). Idempotent: a second observe() while already subscribed
  // updates the tracked resolved target without re-subscribing to `document`.
  // Also publishes `supported` when it differs from the last value dispatched.
  observe(target: Element | null): Promise<void> {
    this._publishSupported();
    this._resolvedTarget = target;
    if (!this._subscribed) {
      this._subscribed = true;
      document.addEventListener(this._pointerLockChangeEventName(), this._onChange);
      document.addEventListener(this._pointerLockErrorEventName(), this._onLockError);
    }
    this._applyActive();
    return this._ready;
  }

  dispose(): void {
    this._gen++; // invalidate any in-flight requestPointerLock() resolution
    this._request = null;
    if (this._subscribed) {
      this._subscribed = false;
      document.removeEventListener(this._pointerLockChangeEventName(), this._onChange);
      document.removeEventListener(this._pointerLockErrorEventName(), this._onLockError);
    }
    this._resolvedTarget = null;
    // A disposed Core hears no pointerlockchange, so it can no longer vouch for
    // `active`: publish false through the normal setter (timing contract §22 — a
    // disconnect publishes what it changes). The lock itself is not released
    // here; observe() re-reads the truth — publishing true again — on the next
    // connect.
    this._setActive(false);
  }

  /**
   * Request pointer lock on `element`. Never-throw: a missing API or a
   * rejected promise (e.g. called outside a user-gesture context —
   * `NotAllowedError`, docs/fullscreen-tag-design.md §3) is captured into
   * `error` rather than propagated. `element` may be `null` when the Shell's
   * `target` selector did not resolve (docs/pointer-lock-tag-design.md §1
   * defers error representation to FullscreenCore verbatim — this null-target
   * case mirrors `FullscreenCore.requestFullscreen(null)`,
   * docs/fullscreen-tag-design.md §6): distinct from "API is not supported"
   * below, so a typo'd selector doesn't masquerade as an unsupported platform.
   */
  async requestPointerLock(element: Element | null): Promise<void> {
    const gen = ++this._gen;
    this._resolvedTarget = element;
    this._request = null; // this call supersedes the request before it
    if (!element) {
      this._setError({ message: "Pointer Lock target could not be resolved." }, "invalid-argument");
      return;
    }
    const fn = this._requestPointerLockFn(element);
    if (!fn) {
      // Resolved synchronously in the same tick as the call — dispose()
      // cannot have run yet, so no staleness check is needed here (matches
      // the reference `requestFullscreen()` implementation,
      // docs/fullscreen-tag-design.md §6).
      this._setError({ message: "Pointer Lock API is not supported." }, "capability-missing");
      return;
    }
    const request: PendingRequest = { waiting: false, refused: false };
    this._request = request;
    try {
      // fn is already bound to `element` by _requestPointerLockFn().
      const result: unknown = fn();
      if (typeof (result as { then?: unknown } | null | undefined)?.then === "function") {
        // Chromium and WebKit: the call's promise answers this request, and it
        // alone. They fire pointerlockerror for the same refusal as well — WebKit
        // before it rejects the promise — and the rejection carries the reason,
        // so the event is not this request's answer.
        this._request = null;
        await result;
        if (gen !== this._gen) return; // stale
        this._setError(null);
        this._applyActive();
        return;
      }
      // Firefox (and the prefixed API) return nothing: the answer is a
      // pointerlockchange or a pointerlockerror on the document.
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
   * Exit pointer lock. Synchronous platform API (docs/pointer-lock-tag-design.md
   * §2) — returns `void`, not a `Promise`. Silent no-op when nothing is
   * currently locked or the API is unsupported (mirrors
   * `FullscreenCore.exitFullscreen()`'s no-op contract,
   * docs/fullscreen-tag-design.md §7). Wrapped in try/catch defensively: even
   * though the platform API is synchronous and documented as not throwing in
   * this case, a synchronous throw from a non-conformant/fake implementation
   * must never escape (never-throw).
   */
  exitPointerLock(): void {
    try {
      if (this._pointerLockElement() === null) return; // already unlocked: silent no-op
      const fn = this._exitPointerLockFn();
      if (!fn) return; // unsupported: silent no-op (semantically already "not locked")
      fn();
      this._setError(null);
      this._applyActive();
    } catch (e: any) {
      this._setError(e);
    }
  }

  // --- API resolution (call-time, never cached — §3.7) ---

  // Resolved from `Element.prototype` rather than `el.requestPointerLock`
  // directly: when `target="self"`, `el` is the `<wcs-pointer-lock>` Shell
  // itself, whose own class declares an instance method also named
  // `requestPointerLock()` (the wcBindable command). Reading the property off
  // the instance would pick up that Shell method instead of the native
  // platform API and recurse infinitely (Shell.requestPointerLock() ->
  // Core.requestPointerLock() -> resolves "el.requestPointerLock" -> the same
  // Shell method again). Going through `Element.prototype` sidesteps the name
  // collision — note this does NOT pick up an override on a subclass's own
  // prototype (e.g. `WcsPointerLock.prototype`); it deliberately jumps
  // straight to the platform-defined layer. Both the standard and legacy name
  // are resolved the same way, for symmetry — matching FullscreenCore's
  // `_elementFullscreenFn` (docs/fullscreen-tag-design.md §4) ONLY in that one
  // respect. Unlike that Core, this one does not check `el`'s own properties
  // first: there is no test-stub/per-element monkey-patch path to accommodate
  // here (mocks.ts installs the fakes directly on `Element.prototype`), so it
  // goes straight there for both names.
  private _requestPointerLockFn(el: Element): (() => Promise<void>) | undefined {
    const proto = Element.prototype as any;
    const standard = proto.requestPointerLock;
    if (typeof standard === "function") return standard.bind(el);
    const legacy = proto.webkitRequestPointerLock;
    return typeof legacy === "function" ? legacy.bind(el) : undefined;
  }

  private _exitPointerLockFn(): (() => void) | undefined {
    const d = document as any;
    return d.exitPointerLock?.bind(document) ?? d.webkitExitPointerLock?.bind(document);
  }

  private _pointerLockElement(): Element | null {
    const d = document as any;
    return d.pointerLockElement ?? d.webkitPointerLockElement ?? null;
  }

  // NOTE (test-environment caveat, not a production concern): happy-dom
  // always implements `document.onpointerlockchange` (as `null`) regardless
  // of which fake API surface a test installs, so `"onpointerlockchange" in
  // document` can never observably be `false` under this test runner and the
  // `webkitpointerlockchange` branch below cannot be driven through
  // `observe()` in a unit test. The branch is still correct and required for
  // real legacy WebKit builds that lack `onpointerlockchange` entirely — kept
  // as documented, deliberate, untestable-in-this-harness code per
  // docs/pointer-lock-tag-design.md.
  /* v8 ignore next 3 */
  private _pointerLockChangeEventName(): string {
    return "onpointerlockchange" in document ? "pointerlockchange" : "webkitpointerlockchange";
  }

  // Picked the same way as the change event's name above. Unlike that one, this
  // branch is driven in the tests (mocks.ts removes `onpointerlockerror` from
  // the prototype that owns it).
  private _pointerLockErrorEventName(): string {
    return "onpointerlockerror" in document ? "pointerlockerror" : "webkitpointerlockerror";
  }

  private _onChange = (): void => {
    this._applyActive();
    // The target is locked: a request that was waiting for its answer has it.
    if (this._active) this._request = null;
  };

  // A refusal that arrives as an event. Firefox reports a refused
  // requestPointerLock() (no user gesture, say) only here — the call returns no
  // promise to reject. A request whose call returned a promise is not waiting
  // for this event (`_request` is null from the moment the call returned), so a
  // refusal the promise reports is never reported a second time. The event fires
  // on the document without saying whose request failed: with no request waiting
  // here, it is another instance's (or the page's own call) and is ignored.
  private _onLockError = (): void => {
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
    this._target.dispatchEvent(new CustomEvent("wcs-pointer-lock:supported-changed", {
      detail: supported,
      bubbles: true,
    }));
  }

  // Self-filter (docs/fullscreen-tag-design.md §2.1): compares against this
  // instance's own resolved target, not merely "is *something* locked" — so
  // multiple concurrent instances each report the correct `active` value.
  private _applyActive(): void {
    const next = this._resolvedTarget !== null && this._pointerLockElement() === this._resolvedTarget;
    this._setActive(next);
  }

  // Same-value guard (MUST, §3.3 of the guidelines). detail itself is the
  // bare boolean value (no getter needed) per docs/pointer-lock-tag-design.md
  // §2 — unlike FullscreenCore's `{ active }`-shaped detail + getter.
  private _setActive(v: boolean): void {
    if (this._active === v) return;
    this._active = v;
    this._target.dispatchEvent(new CustomEvent("wcs-pointer-lock:change", {
      detail: v,
      bubbles: true,
    }));
  }

  // `kind` is an explicit taxonomy discriminator passed only from the synthetic
  // error sites (unsupported / unresolved target); caught exceptions pass no kind
  // and are classified by their `.name`. Both `error` and the additive `errorInfo`
  // are now event-backed so a request/exit failure is observable via bind().
  private _setError(error: any, kind?: PointerLockErrorKind): void {
    // Same-value guard on reference: each failure builds a fresh object and the
    // clear path passes the literal null, so this only suppresses redundant
    // null→null (a successful request/exit clearing an already-null error).
    if (this._error === error) return;
    this._error = error;
    // Keep the additive errorInfo taxonomy in sync; fire it before the `error`
    // event so an observer of both sees the classification first (io-node family).
    this._commitErrorInfo(error === null ? null : derivePointerLockErrorInfo(error, kind));
    this._target.dispatchEvent(new CustomEvent("wcs-pointer-lock:error", {
      detail: error,
      bubbles: true,
    }));
  }

  // Called only from _setError (already reference-guarded), so errorInfo
  // transitions exactly when error does — no separate guard needed here.
  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-pointer-lock:error-info-changed", {
      detail: info,
      bubbles: true,
    }));
  }
}
