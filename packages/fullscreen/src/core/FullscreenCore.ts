import { IWcBindable } from "../types.js";

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
      { name: "active", event: "wcs-fullscreen:change", getter: (e: Event) => (e as CustomEvent).detail.active },
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

  // True once observe() has attached the document-level fullscreenchange
  // listener. Guards observe() so a redundant call does not double-subscribe;
  // dispose() resets it so a later observe() resumes cleanly.
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
  // IO nodes.
  observe(): Promise<void> {
    if (!this._subscribed) {
      this._subscribed = true;
      document.addEventListener(this._fullscreenChangeEventName(), this._onFullscreenChange);
    }
    return this._ready;
  }

  dispose(): void {
    this._gen++;
    if (this._subscribed) {
      this._subscribed = false;
      document.removeEventListener(this._fullscreenChangeEventName(), this._onFullscreenChange);
    }
  }

  /**
   * Request fullscreen on `element`. never-throw (§3/§6): a missing API or a
   * rejected promise (e.g. `NotAllowedError` from a call outside a user
   * gesture) is caught and surfaced via `error`, never thrown. The caller
   * (Shell) is responsible for resolving `target` and for ensuring this is
   * invoked from within an actual user gesture — this Core cannot manufacture
   * one (docs/fullscreen-tag-design.md §3).
   */
  async requestFullscreen(element: Element | null): Promise<void> {
    const gen = ++this._gen;
    this._resolvedTarget = element;
    const fn = element ? this._requestFullscreenFn(element) : undefined;
    if (!fn) {
      this._setError({ message: "Fullscreen API is not supported." });
      return;
    }
    try {
      await fn.call(element);
      if (gen !== this._gen) return; // stale: dispose()/superseding call ran
      this._setError(null);
      this._applyActive();
    } catch (e: any) {
      if (gen !== this._gen) return; // stale
      this._setError(e);
    }
  }

  /**
   * Exit fullscreen. Silent no-op (§7) when nothing is currently fullscreen or
   * the API is unsupported — both are treated as "already achieved the exit
   * intent", not as errors, keeping repeated calls safe and never-throw.
   */
  async exitFullscreen(): Promise<void> {
    const gen = ++this._gen;
    if (this._fullscreenElement() === null) return; // already not fullscreen: silent no-op
    const fn = this._exitFullscreenFn();
    if (!fn) return; // unsupported: silent no-op (semantically already "not fullscreen")
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
    const e = el as any;
    return e.requestFullscreen ?? e.webkitRequestFullscreen;
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

  // --- Internal ---

  private _onFullscreenChange = (): void => {
    this._applyActive();
  };

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

  private _setError(error: any): void {
    this._error = error;
  }
}
