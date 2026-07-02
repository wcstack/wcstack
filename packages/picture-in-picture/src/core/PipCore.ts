import { IWcBindable } from "../types.js";

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
    ],
    commands: [
      { name: "requestPictureInPicture", async: true },
      { name: "exitPictureInPicture", async: true },
    ],
  };

  private _target: EventTarget;
  private _active: boolean = false;
  private _error: any = null;

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
      this._setError({ message: "target must be a <video> element." });
      return;
    }
    const fn = this._requestPictureInPictureFn(element);
    if (!fn) {
      this._setError({ message: "Picture-in-Picture API is not supported." });
      return;
    }
    try {
      await fn.call(element);
      if (gen !== this._gen) return; // stale
      this._setError(null);
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
    const gen = ++this._gen;
    if (this._pictureInPictureElement() === null) return; // already not in PiP: silent no-op
    const fn = this._exitPictureInPictureFn();
    if (!fn) return; // unsupported: silent no-op (semantically already "not in PiP")
    try {
      await fn();
      if (gen !== this._gen) return;
      this._setError(null);
    } catch (e: any) {
      if (gen !== this._gen) return;
      this._setError(e);
    }
  }

  // --- Internal: API resolution (call-time, never cached — §3.7) ---

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

  private _setError(error: any): void {
    this._error = error;
  }
}
