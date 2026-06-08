import { IWcBindable, IntersectOptions, WcsIntersectEntry, WcsIntersectRect } from "../types.js";

/**
 * Headless visibility primitive. A thin, framework-agnostic wrapper around the
 * IntersectionObserver API exposed through the wc-bindable protocol.
 *
 * Unlike the other @wcstack sensors (geolocation / timer / websocket), the thing
 * being observed is a *DOM element* — so `observe()` takes the target node. The
 * Core stays DOM-resolution-agnostic: it observes whatever element it is handed
 * (the Shell resolves `target` / `root` selectors before calling). It is a
 * read-only producer — element/layout → state only, with no element-bound path.
 *
 * Every observer callback is published via the single `wcs-intersect:change`
 * event; `intersecting` / `ratio` are read from it through getters (mirroring how
 * GeolocationCore exposes latitude/longitude from one `wcs-geo:position` event),
 * so an observer that binds any of them is notified on every change.
 *
 * `visible` is a latch: it flips to `true` the first time the target intersects
 * and stays `true` until `reset()` — ideal for one-way lazy-load bindings
 * (`src@visible`). `observing` reflects whether an observation is currently
 * active (like TimerCore's `running`).
 *
 * Single-target by design: the Shell observes exactly one element, so the state
 * reflects that element. Multi-target observation is intentionally out of scope.
 */
export class IntersectionCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "entry", event: "wcs-intersect:change" },
      { name: "intersecting", event: "wcs-intersect:change", getter: (e: Event) => (e as CustomEvent).detail.isIntersecting },
      { name: "ratio", event: "wcs-intersect:change", getter: (e: Event) => (e as CustomEvent).detail.intersectionRatio },
      { name: "visible", event: "wcs-intersect:visible-changed" },
      { name: "observing", event: "wcs-intersect:observing-changed" },
    ],
    commands: [
      { name: "observe" },
      { name: "unobserve" },
      { name: "disconnect" },
      { name: "reset" },
    ],
  };

  private _target: EventTarget;

  // The live observer and the single element it observes. Options are kept so a
  // repeated observe() with identical options is a no-op (avoids the create→
  // observe→disconnect churn an autoloader upgrade can otherwise cause).
  private _observer: IntersectionObserver | null = null;
  private _observed: Element | null = null;
  private _options: IntersectOptions = {};

  private _entry: WcsIntersectEntry | null = null;
  private _visible: boolean = false;
  private _observing: boolean = false;

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get entry(): WcsIntersectEntry | null {
    return this._entry;
  }

  get intersecting(): boolean {
    return this._entry ? this._entry.isIntersecting : false;
  }

  get ratio(): number {
    return this._entry ? this._entry.intersectionRatio : 0;
  }

  get visible(): boolean {
    return this._visible;
  }

  get observing(): boolean {
    return this._observing;
  }

  // --- State setters with event dispatch ---

  private _setEntry(entry: WcsIntersectEntry): void {
    // No same-value guard: `change` carries event semantics (every callback is a
    // distinct observation) and `intersecting` / `ratio` are derived getters that
    // must re-fire on each entry, mirroring GeolocationCore's `position`.
    this._entry = entry;
    this._target.dispatchEvent(new CustomEvent("wcs-intersect:change", {
      detail: entry,
      bubbles: true,
    }));
  }

  private _setVisible(visible: boolean): void {
    if (this._visible === visible) return;
    this._visible = visible;
    this._target.dispatchEvent(new CustomEvent("wcs-intersect:visible-changed", {
      detail: visible,
      bubbles: true,
    }));
  }

  private _setObserving(observing: boolean): void {
    if (this._observing === observing) return;
    this._observing = observing;
    this._target.dispatchEvent(new CustomEvent("wcs-intersect:observing-changed", {
      detail: observing,
      bubbles: true,
    }));
  }

  // --- Public API ---

  /**
   * Start observing `element`. Idempotent while already observing the same
   * element with the same options. Changing the element or options tears down the
   * current observer and builds a new one (IntersectionObserver options are fixed
   * at construction, so reconfiguring requires a fresh observer).
   *
   * If IntersectionObserver is unavailable (SSR) or the options are invalid (e.g.
   * a malformed `rootMargin`, which the constructor rejects), this is a silent
   * no-op — `observing` stays false, consistent with the never-throw design of
   * the other @wcstack sensors.
   */
  observe(element: Element, options: IntersectOptions = {}): void {
    if (this._observer && this._observed === element && this._optionsEqual(this._options, options)) {
      return;
    }
    this._teardownObserver();
    const observer = this._createObserver(options);
    if (!observer) {
      // Creation failed (unsupported environment or invalid options) *after* we
      // tore down any previous observer. If we were already observing, the
      // observation is now gone, so reflect that — otherwise `observing` would
      // keep reporting true with no live observer behind it (e.g. re-observing an
      // active target with a newly-invalid rootMargin).
      this._setObserving(false);
      return;
    }
    this._observer = observer;
    this._observed = element;
    this._options = options;
    observer.observe(element);
    this._setObserving(true);
  }

  /**
   * Stop observing `element`. A no-op if it is not the currently observed
   * element. The observer instance is torn down (single-target Core), so a later
   * observe() rebuilds it.
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

  /** Clear the `visible` latch so a later intersection can set it again. */
  reset(): void {
    this._setVisible(false);
  }

  // --- Internal ---

  private _teardownObserver(): void {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._observed = null;
  }

  private _createObserver(options: IntersectOptions): IntersectionObserver | null {
    if (typeof IntersectionObserver === "undefined") return null;
    try {
      return new IntersectionObserver(this._onIntersect, {
        root: options.root ?? null,
        rootMargin: options.rootMargin ?? "0px",
        threshold: options.threshold ?? 0,
      });
    } catch {
      // Invalid options (e.g. a malformed rootMargin) — surface nothing and leave
      // observing false, rather than letting the constructor throw escape.
      return null;
    }
  }

  private _onIntersect = (entries: IntersectionObserverEntry[]): void => {
    for (const entry of entries) {
      const normalized = this._normalizeEntry(entry);
      this._setEntry(normalized);
      // Latch on the first (and any) intersecting observation; never auto-clears.
      if (normalized.isIntersecting) {
        this._setVisible(true);
      }
    }
  };

  private _normalizeEntry(entry: IntersectionObserverEntry): WcsIntersectEntry {
    return {
      isIntersecting: entry.isIntersecting,
      intersectionRatio: entry.intersectionRatio,
      time: entry.time,
      boundingClientRect: this._normalizeRect(entry.boundingClientRect),
      intersectionRect: this._normalizeRect(entry.intersectionRect),
      rootBounds: entry.rootBounds ? this._normalizeRect(entry.rootBounds) : null,
      target: entry.target,
    };
  }

  private _normalizeRect(rect: DOMRectReadOnly): WcsIntersectRect {
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

  private _optionsEqual(a: IntersectOptions, b: IntersectOptions): boolean {
    if ((a.root ?? null) !== (b.root ?? null)) return false;
    if ((a.rootMargin ?? "0px") !== (b.rootMargin ?? "0px")) return false;
    return this._thresholdKey(a.threshold) === this._thresholdKey(b.threshold);
  }

  private _thresholdKey(threshold: number | number[] | undefined): string {
    if (threshold === undefined) return "0";
    return Array.isArray(threshold) ? threshold.join(",") : String(threshold);
  }
}
