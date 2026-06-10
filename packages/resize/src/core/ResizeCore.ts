import { IWcBindable, ResizeOptions, ResizeBoxOption, WcsResizeEntry, WcsResizeRect, WcsResizeBoxSize } from "../types.js";

/**
 * Headless element-size primitive. A thin, framework-agnostic wrapper around the
 * ResizeObserver API exposed through the wc-bindable protocol.
 *
 * Like IntersectionCore, the thing being observed is a *DOM element* — so
 * `observe()` takes the target node. The Core stays DOM-resolution-agnostic: it
 * observes whatever element it is handed (the Shell resolves the `target` selector
 * before calling). It is a read-only producer — element/layout → state only.
 *
 * Every observer callback is published via the single `wcs-resize:change` event;
 * `width` / `height` are read from it through getters (mirroring how
 * IntersectionCore derives `intersecting` / `ratio` from one event), so an observer
 * binding any of them is notified on every change.
 *
 * `width` / `height` follow the observed `box` (border-box / device-pixel /
 * content-box) and are rounded to integers when `round` is set — `round` absorbs
 * the sub-pixel jitter that would otherwise let a size→layout→size loop oscillate.
 *
 * Single-target by design: the Shell observes exactly one element, so the state
 * reflects that element. Multi-target observation is intentionally out of scope.
 */
export class ResizeCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "entry", event: "wcs-resize:change" },
      { name: "width", event: "wcs-resize:change", getter: (e: Event) => (e as CustomEvent).detail.width },
      { name: "height", event: "wcs-resize:change", getter: (e: Event) => (e as CustomEvent).detail.height },
      { name: "observing", event: "wcs-resize:observing-changed" },
    ],
    commands: [
      { name: "observe" },
      { name: "unobserve" },
      { name: "disconnect" },
    ],
  };

  private _target: EventTarget;

  // The live observer and the single element it observes. The *requested* options
  // are kept so a repeated observe() with identical options is a no-op (avoids the
  // create→observe→disconnect churn an autoloader upgrade can otherwise cause). It
  // is the requested box — not the effective one — so a re-observe of an unsupported
  // box (which falls back to content-box) still hits the idempotency guard instead
  // of rebuilding+falling-back every time. `_effectiveBox` separately tracks the box
  // actually in effect, which is what normalization reads.
  private _observer: ResizeObserver | null = null;
  private _observed: Element | null = null;
  private _options: ResizeOptions = {};
  private _effectiveBox: ResizeBoxOption = "content-box";

  private _entry: WcsResizeEntry | null = null;
  private _observing: boolean = false;

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get entry(): WcsResizeEntry | null {
    return this._entry;
  }

  get width(): number {
    return this._entry ? this._entry.width : 0;
  }

  get height(): number {
    return this._entry ? this._entry.height : 0;
  }

  get observing(): boolean {
    return this._observing;
  }

  // --- State setters with event dispatch ---

  private _setEntry(entry: WcsResizeEntry): void {
    // No same-value guard: `change` carries event semantics (every callback is a
    // distinct observation) and `width` / `height` are derived getters that must
    // re-fire on each entry, mirroring IntersectionCore's `change`.
    this._entry = entry;
    this._target.dispatchEvent(new CustomEvent("wcs-resize:change", {
      detail: entry,
      bubbles: true,
    }));
  }

  private _setObserving(observing: boolean): void {
    if (this._observing === observing) return;
    this._observing = observing;
    this._target.dispatchEvent(new CustomEvent("wcs-resize:observing-changed", {
      detail: observing,
      bubbles: true,
    }));
  }

  // --- Public API ---

  /**
   * Start observing `element`. Idempotent while already observing the same element
   * with the same options. Changing the element or options tears down the current
   * observer and builds a new one (re-observing also re-delivers the initial size,
   * which is how a `round` toggle re-fires with the new rounding).
   *
   * If ResizeObserver is unavailable (SSR) this is a silent no-op — `observing`
   * stays false. If the requested `box` is unsupported, it retries once with
   * `content-box` before giving up; both giving-up paths leave `observing` false,
   * consistent with the never-throw design of the other @wcstack sensors.
   */
  observe(element: Element, options: ResizeOptions = {}): void {
    if (this._observer && this._observed === element && this._optionsEqual(this._options, options)) {
      return;
    }
    this._teardownObserver();
    const observer = this._createObserver();
    if (!observer) {
      // Unsupported environment (no ResizeObserver). If we were already observing,
      // that observation is now gone — reflect it rather than reporting a stale true.
      this._setObserving(false);
      return;
    }
    const effectiveBox = this._beginObserve(observer, element, options.box);
    if (effectiveBox === null) {
      // observe() threw even after the content-box fallback — no live observation.
      observer.disconnect();
      this._setObserving(false);
      return;
    }
    this._observer = observer;
    this._observed = element;
    // Store the *requested* options (raw) for the idempotency guard; `_effectiveBox`
    // holds the box that actually took effect (content-box after a fallback) for
    // normalization to read.
    this._options = { box: options.box, round: options.round };
    this._effectiveBox = effectiveBox;
    this._setObserving(true);
  }

  /**
   * Stop observing `element`. A no-op if it is not the currently observed element.
   * The observer instance is torn down (single-target Core), so a later observe()
   * rebuilds it.
   */
  unobserve(element: Element): void {
    if (this._observed !== element) return;
    this._teardownObserver();
    this._setObserving(false);
  }

  /** Stop all observation and release the observer. */
  disconnect(): void {
    this._teardownObserver();
    this._setObserving(false);
  }

  // --- Internal ---

  private _teardownObserver(): void {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._observed = null;
  }

  private _createObserver(): ResizeObserver | null {
    // No constructor try/catch: unlike IntersectionObserver (which validates
    // rootMargin at construction), the ResizeObserver constructor takes only a
    // callback and has no throwing precondition. The throw path is on observe()
    // (an unsupported `box`), handled in _beginObserve.
    if (typeof ResizeObserver === "undefined") return null;
    return new ResizeObserver(this._onResize);
  }

  /**
   * Start observing with the requested `box`, retrying once with `content-box` if
   * the runtime rejects the box (e.g. `device-pixel-content-box` on engines that do
   * not support it). Returns the box actually in effect, or `null` if observation
   * could not start at all.
   */
  private _beginObserve(observer: ResizeObserver, element: Element, box?: ResizeBoxOption): ResizeBoxOption | null {
    const requested = box ?? "content-box";
    try {
      observer.observe(element, { box: requested });
      return requested;
    } catch {
      // Already content-box and it still threw — nothing safer to fall back to.
      if (requested === "content-box") return null;
      try {
        observer.observe(element, { box: "content-box" });
        return "content-box";
      } catch {
        return null;
      }
    }
  }

  private _onResize = (entries: ResizeObserverEntry[]): void => {
    for (const entry of entries) {
      this._setEntry(this._normalizeEntry(entry));
    }
  };

  private _normalizeEntry(entry: ResizeObserverEntry): WcsResizeEntry {
    const contentRect = this._normalizeRect(entry.contentRect);
    const contentBoxSize = this._firstBoxSize(entry.contentBoxSize);
    const borderBoxSize = this._firstBoxSize(entry.borderBoxSize);
    // devicePixelContentBoxSize is Chromium-only; absent on other engines.
    const devicePixelContentBoxSize = this._firstBoxSize((entry as { devicePixelContentBoxSize?: ReadonlyArray<ResizeObserverSize> }).devicePixelContentBoxSize);
    const { width, height } = this._headlineSize(contentBoxSize, borderBoxSize, devicePixelContentBoxSize, contentRect);
    return {
      width,
      height,
      contentRect,
      contentBoxSize,
      borderBoxSize,
      devicePixelContentBoxSize,
      target: entry.target,
    };
  }

  /**
   * Pick the headline width/height from the boxSize matching the observed `box`,
   * falling back to `contentRect` when that fragment is absent (older engines only
   * fill contentRect). `inlineSize`/`blockSize` map to width/height (correct for
   * horizontal writing modes). Rounds to integers when `round` is set.
   */
  private _headlineSize(
    contentBoxSize: WcsResizeBoxSize | null,
    borderBoxSize: WcsResizeBoxSize | null,
    devicePixelContentBoxSize: WcsResizeBoxSize | null,
    contentRect: WcsResizeRect,
  ): { width: number; height: number } {
    const box = this._effectiveBox;
    let size: WcsResizeBoxSize | null;
    if (box === "border-box") {
      size = borderBoxSize;
    } else if (box === "device-pixel-content-box") {
      size = devicePixelContentBoxSize;
    } else {
      size = contentBoxSize;
    }
    let width: number;
    let height: number;
    if (size) {
      width = size.inlineSize;
      height = size.blockSize;
    } else {
      width = contentRect.width;
      height = contentRect.height;
    }
    if (this._options.round) {
      width = Math.round(width);
      height = Math.round(height);
    }
    return { width, height };
  }

  private _firstBoxSize(list: ReadonlyArray<ResizeObserverSize> | undefined): WcsResizeBoxSize | null {
    if (!list || list.length === 0) return null;
    const first = list[0];
    return { inlineSize: first.inlineSize, blockSize: first.blockSize };
  }

  private _normalizeRect(rect: DOMRectReadOnly): WcsResizeRect {
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    };
  }

  private _optionsEqual(a: ResizeOptions, b: ResizeOptions): boolean {
    if ((a.box ?? "content-box") !== (b.box ?? "content-box")) return false;
    return (a.round ?? false) === (b.round ?? false);
  }
}
