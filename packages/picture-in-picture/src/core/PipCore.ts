import { IWcBindable } from "../types.js";
import { WcsIoErrorInfo } from "./platformCapability.js";
import { derivePictureInPictureErrorInfo, PictureInPictureErrorKind } from "./pictureInPictureCapabilities.js";

/**
 * Headless Picture-in-Picture primitive. A thin, framework-agnostic wrapper
 * around the classic Picture-in-Picture API
 * (`HTMLVideoElement.requestPictureInPicture()` / `document.exitPictureInPicture()` /
 * `document.pictureInPictureElement`) exposed through the wc-bindable protocol.
 *
 * This Core follows the same basic pattern as `@wcstack/fullscreen`'s
 * `FullscreenCore` (docs/fullscreen-tag-design.md): target resolution is done
 * by the Shell (this Core receives the resolved element at call time), API
 * resolution is call-time/non-cached, `_gen` is a single Core-level generation
 * guard, and `error` is a simple single field (no permission-style 4-value
 * state). See docs/picture-in-picture-tag-design.md for the differences from
 * Fullscreen:
 *
 * - **§2 target constraint**: the resolved target MUST be a `<video>` element.
 *   Picture-in-Picture is only defined as an instance method of
 *   `HTMLVideoElement` — unlike Fullscreen, which any `Element` supports. A
 *   non-`<video>` target is a never-throw failure: it is treated the same as
 *   an unresolved target and reported via `error`.
 * - **§3 event subscription target**: `enterpictureinpicture` /
 *   `leavepictureinpicture` fire on the `<video>` element itself, not on
 *   `document` (the reverse of Fullscreen's `document`-level
 *   `fullscreenchange`). The Core attaches/detaches these listeners directly
 *   on the resolved `<video>` element, re-wiring them whenever the target is
 *   re-resolved (e.g. the Shell's `target` attribute changes).
 */
export class PipCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "active", event: "wcs-pip:change", getter: (e: Event) => (e as CustomEvent).detail.active },
      // `error` / `errorInfo` are observable failure outputs. Historically `error`
      // was an imperative getter with no event; both are now bindable (event-backed)
      // so `data-wcs` / bind() can observe a request/exit failure. `errorInfo` is the
      // additive serializable taxonomy (stable code / phase / recoverable) derived
      // from `error`; the `error` value shape is unchanged. No lane — Picture-in-Picture
      // drives a referenced `<video>`, not a competing operation (fullscreen と同型)。
      { name: "error", event: "wcs-pip:error" },
      { name: "errorInfo", event: "wcs-pip:error-info-changed" },
    ],
    commands: [
      { name: "requestPictureInPicture", async: true },
      { name: "exitPictureInPicture", async: true },
    ],
  };

  private _target: EventTarget;
  private _active: boolean = false;
  private _error: any = null;
  private _errorInfo: WcsIoErrorInfo | null = null;

  // The <video> element the Core currently subscribes to for
  // enterpictureinpicture/leavepictureinpicture (null when unresolved/torn down).
  private _video: HTMLVideoElement | null = null;

  // Generation guard (§3.4 / fullscreen-tag-design.md §6): bumped on dispose()
  // and each async command start. A completion that lands after dispose() (or
  // after a superseding call) is stale and MUST NOT write state.
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

  get active(): boolean {
    return this._active;
  }

  get error(): any {
    return this._error;
  }

  /**
   * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
   * `recoverable`), or null. Additive wc-bindable property (event
   * `wcs-pip:error-info-changed`), derived from `error`; the existing `error`
   * value shape is unchanged.
   */
  get errorInfo(): WcsIoErrorInfo | null {
    return this._errorInfo;
  }

  // --- Lifecycle (§3.5) ---

  /**
   * (Re-)subscribe to `enterpictureinpicture`/`leavepictureinpicture` on
   * `element` (the Shell's resolved `<video>` target). Idempotent when called
   * again with the same element; re-wires the listeners when the element
   * changes (e.g. the `target` attribute was changed), detaching from the
   * previous element first so no stale listener lingers.
   */
  observe(element: HTMLVideoElement | null): Promise<void> {
    if (this._video === element) {
      return this._ready;
    }
    this._detach();
    this._video = element;
    if (element) {
      element.addEventListener("enterpictureinpicture", this._onEnter);
      element.addEventListener("leavepictureinpicture", this._onLeave);
    }
    this._syncActive();
    return this._ready;
  }

  dispose(): void {
    this._gen++;
    this._detach();
    this._video = null;
  }

  // --- Commands (§3.6 never-throw) ---

  /**
   * Request Picture-in-Picture for `element`. `element` must be a `<video>`
   * (checked before the gesture-context failure path, since a type mismatch is
   * an environment-independent, permanent error — docs/picture-in-picture-tag-design.md §2).
   * Never throws: all failures (wrong tag, unsupported API, gesture-context
   * rejection) are funneled into `error` and the returned promise resolves.
   */
  async requestPictureInPicture(element: HTMLVideoElement | null): Promise<void> {
    const gen = ++this._gen;
    if (!element || element.tagName !== "VIDEO") {
      // Distinct from "API is not supported" (below): the resolved target did
      // not satisfy the `<video>`-only constraint (wrong tag / unresolved).
      this._setError({ message: "target must be a <video> element." }, "invalid-argument");
      return;
    }
    // Re-wire to `element` before issuing the platform call: a caller may
    // request a <video> different from the one last passed to observe() (e.g.
    // the Shell's target attribute pointed at nothing at connect time and the
    // matching <video> was only inserted later, so no attributeChangedCallback
    // ever re-resolved it). Without this, `_video` stays stale and
    // `_syncActive()` below (and future enter/leave events) would never
    // recognize `element` as this Core's target, leaving `active` permanently
    // wrong even though the request succeeded (mirrors
    // FullscreenCore.requestFullscreen()'s unconditional `this._resolvedTarget
    // = element` assignment — docs/fullscreen-tag-design.md §6).
    this.observe(element);
    const fn = this._requestPictureInPictureFn(element);
    if (!fn) {
      this._setError({ message: "Picture-in-Picture API is not supported." }, "capability-missing");
      return;
    }
    try {
      await fn.call(element);
      if (gen !== this._gen) return; // stale
      this._setError(null);
      this._syncActive(); // belt-and-suspenders (mirrors FullscreenCore's _applyActive() on success)
    } catch (e: any) {
      if (gen !== this._gen) return; // stale
      this._setError(e); // e.g. NotAllowedError (gesture-context rejection)
    }
  }

  /**
   * Exit Picture-in-Picture. Mirrors FullscreenCore.exitFullscreen(): a
   * silent no-op (resolve, no error) when nothing is currently in
   * Picture-in-Picture — see fullscreen-tag-design.md §7.
   */
  async exitPictureInPicture(): Promise<void> {
    // no-op checks come BEFORE the generation bump: a call that does nothing
    // must not supersede an in-flight requestPictureInPicture() — bumping
    // first would make the pending request's settle handling stale and
    // silently swallow its error update (mirrors
    // FullscreenCore.exitFullscreen()).
    if (this._pictureInPictureElement() === null) return; // already not in PiP: silent no-op
    const fn = this._exitPictureInPictureFn();
    if (!fn) return; // unsupported: silent no-op (semantically already "not in PiP")
    const gen = ++this._gen;
    try {
      await fn();
      if (gen !== this._gen) return;
      this._setError(null);
      this._syncActive(); // belt-and-suspenders (mirrors FullscreenCore.exitFullscreen()'s success-path _applyActive()); covers a delayed/dropped leavepictureinpicture
    } catch (e: any) {
      if (gen !== this._gen) return;
      this._setError(e);
    }
  }

  // --- Internal: API resolution (call-time, never cached — §3.7) ---

  // Unlike FullscreenCore's _elementFullscreenFn(), a naive direct property
  // lookup (`e.requestPictureInPicture`, walking the prototype chain) here is
  // safe: it cannot recurse into the Shell's own command method,
  // because the resolved target is validated to be a <video> element (§2)
  // before this is called, and <wcs-pip> (the Shell) is never itself a
  // <video>. Fullscreen's own→Element.prototype two-step resolution guards
  // against `target="self"`/no-target resolving to the Shell element, which
  // cannot happen here.
  private _requestPictureInPictureFn(el: HTMLVideoElement): (() => Promise<PictureInPictureWindow>) | undefined {
    const e = el as any;
    return typeof e.requestPictureInPicture === "function" ? e.requestPictureInPicture : undefined;
  }

  private _exitPictureInPictureFn(): (() => Promise<void>) | undefined {
    const d = document as any;
    return typeof d.exitPictureInPicture === "function" ? d.exitPictureInPicture.bind(document) : undefined;
  }

  private _pictureInPictureElement(): Element | null {
    const d = document as any;
    return d.pictureInPictureElement ?? null;
  }

  // --- Internal: event wiring ---

  private _onEnter = (): void => {
    this._syncActive();
  };

  private _onLeave = (): void => {
    this._syncActive();
  };

  private _syncActive(): void {
    const isActive = this._video !== null && this._pictureInPictureElement() === this._video;
    this._setActive(isActive);
  }

  private _detach(): void {
    if (this._video) {
      this._video.removeEventListener("enterpictureinpicture", this._onEnter);
      this._video.removeEventListener("leavepictureinpicture", this._onLeave);
    }
  }

  // --- State setters with event dispatch (§3.3 same-value guard) ---

  private _setActive(active: boolean): void {
    if (this._active === active) return;
    this._active = active;
    this._target.dispatchEvent(new CustomEvent("wcs-pip:change", {
      detail: { active },
      bubbles: true,
    }));
  }

  // `kind` is an explicit taxonomy discriminator passed only from the synthetic
  // error sites (unsupported / non-<video> target); caught exceptions pass no kind
  // and are classified by their `.name`. Both `error` and the additive `errorInfo`
  // are now event-backed so a request/exit failure is observable via bind().
  private _setError(error: any, kind?: PictureInPictureErrorKind): void {
    // Same-value guard on reference: each failure builds a fresh object and the
    // clear path passes the literal null, so this only suppresses redundant
    // null→null (a successful request/exit clearing an already-null error).
    if (this._error === error) return;
    this._error = error;
    // Keep the additive errorInfo taxonomy in sync; fire it before the `error`
    // event so an observer of both sees the classification first (io-node family).
    this._commitErrorInfo(error === null ? null : derivePictureInPictureErrorInfo(error, kind));
    this._target.dispatchEvent(new CustomEvent("wcs-pip:error", {
      detail: error,
      bubbles: true,
    }));
  }

  // Called only from _setError (already reference-guarded), so errorInfo
  // transitions exactly when error does — no separate guard needed here.
  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-pip:error-info-changed", {
      detail: info,
      bubbles: true,
    }));
  }
}
