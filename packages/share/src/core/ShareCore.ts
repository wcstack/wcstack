import { IWcBindable, WcsShareData } from "../types.js";

/**
 * Headless Web Share primitive. A thin, framework-agnostic wrapper around
 * `navigator.share(data)` exposed through the wc-bindable protocol.
 *
 * This is a simplified derivative of `FetchCore._doFetch`
 * (docs/web-share-tag-design.md §2): it keeps the single `_gen` generation
 * guard, the same-value-guarded private setters, and the never-throw
 * try/catch wrapper, but drops `AbortController`/`abort()` entirely —
 * `navigator.share()` accepts no `AbortSignal` and there is no platform
 * mechanism for a caller to cancel an in-flight share dialog. A share dialog
 * is also a single system-modal surface (at most one open at a time), so the
 * "a new call supersedes the previous one" plumbing that `FetchCore` needs
 * has no counterpart here either.
 */
export class ShareCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "value", event: "wcs-share:complete", getter: (e: Event) => (e as CustomEvent).detail.value },
      { name: "loading", event: "wcs-share:loading-changed" },
      { name: "error", event: "wcs-share:error" },
      { name: "cancelled", event: "wcs-share:cancelled-changed" },
    ],
    commands: [
      { name: "share", async: true },
    ],
  };

  private _target: EventTarget;
  private _value: WcsShareData | null = null;
  private _loading: boolean = false;
  private _error: any = null;
  private _cancelled: boolean = false;
  // Generation guard (§3.4 of the guidelines): bumped on dispose() (and each
  // share() start). A share() that settles after dispose() has a stale `gen`
  // and MUST NOT write state to a torn-down element. Not bumped on the
  // unsupported early-return — no asynchronous work is started, so there is
  // no generation to protect (docs/web-share-tag-design.md §8).
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

  get value(): WcsShareData | null {
    return this._value;
  }

  get loading(): boolean {
    return this._loading;
  }

  get error(): any {
    return this._error;
  }

  get cancelled(): boolean {
    return this._cancelled;
  }

  // Lifecycle (§3.5). Share is command-driven with no subscription to
  // establish, so observe() is an idempotent no-op that resolves once ready;
  // dispose() only invalidates any in-flight share() (there is nothing to
  // abort or unsubscribe).
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    this._gen++;
  }

  private _setLoading(loading: boolean): void {
    if (this._loading === loading) return;
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-share:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setValue(value: WcsShareData | null): void {
    if (this._value === value) return;
    this._value = value;
    this._target.dispatchEvent(new CustomEvent("wcs-share:complete", {
      detail: { value },
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-share:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setCancelled(cancelled: boolean): void {
    if (this._cancelled === cancelled) return;
    this._cancelled = cancelled;
    this._target.dispatchEvent(new CustomEvent("wcs-share:cancelled-changed", {
      detail: cancelled,
      bubbles: true,
    }));
  }

  // API resolution is call-time, never cached (§3.7): lets tests install/remove
  // navigator.share freely and lets an unsupported environment be detected
  // correctly on every call.
  private _api(): ((data?: WcsShareData) => Promise<void>) | undefined {
    const nav = (globalThis as any).navigator;
    return typeof nav?.share === "function" ? nav.share.bind(nav) : undefined;
  }

  async share(data?: WcsShareData): Promise<WcsShareData | null> {
    // never-throw + unsupported (§8): resolve API at call time and bail out
    // immediately if absent. No _gen bump — no asynchronous work is started,
    // so there is no generation to protect, and navigator.share() itself is
    // never invoked.
    const shareFn = this._api();
    if (!shareFn) {
      this._setError({ message: "Web Share API is not supported in this browser." });
      return null;
    }

    const gen = ++this._gen;

    this._setLoading(true);
    // Reset the previous outcome before starting a new share so a stale
    // cancelled/error does not linger into this call's result
    // (docs/web-share-tag-design.md §3).
    this._setError(null);
    this._setCancelled(false);

    try {
      await shareFn(data);

      // Stale completion (dispose() ran while the share dialog was open).
      // Drop the result without writing state.
      if (gen !== this._gen) {
        return null;
      }

      // navigator.share() resolves `Promise<void>` — there is no payload to
      // read off the API, so `value` is synthesized as an echo of the caller's
      // `data`, signalling "this share completed successfully"
      // (docs/web-share-tag-design.md §4).
      this._setValue(data ?? null);
      this._setLoading(false);
      return data ?? null;
    } catch (e: any) {
      // Stale completion (dispose() ran while the share dialog was open).
      if (gen !== this._gen) {
        return null;
      }
      if (e?.name === "AbortError") {
        // The user dismissed the share sheet — a routine cancellation, not a
        // platform failure. Kept out of `error` (docs/web-share-tag-design.md §3).
        this._setCancelled(true);
      } else {
        this._setError(e);
      }
      this._setLoading(false);
      return null;
    }
  }
}
