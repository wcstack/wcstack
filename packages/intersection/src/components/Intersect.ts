import { IWcBindable, IntersectOptions, WcsIntersectEntry } from "../types.js";
import { IntersectionCore } from "../core/IntersectionCore.js";

/**
 * `<wcs-intersect>` — declarative IntersectionObserver.
 *
 * The `target` attribute is the single knob that decides both *what* is observed
 * and how the element renders (it never injects a layout box unless asked):
 *
 * | `target`        | observes              | display     | use case          |
 * |-----------------|-----------------------|-------------|-------------------|
 * | omitted         | first element child   | `contents`  | lazy-load wrapper |
 * | `"#hero"` / sel | the matched element   | `none`      | scrollspy (single)|
 * | `"self"`        | the element itself    | `block`     | infinite-scroll   |
 *
 * `display:contents` means wrapping a child injects no box of its own (so a
 * `<wcs-intersect><img></wcs-intersect>` does not disturb a flex/grid parent);
 * only the explicit `target="self"` sentinel takes a box.
 */
export class WcsIntersect extends HTMLElement {
  static hasConnectedCallbackPromise = false;
  // Only attributes that change *what or how* we observe trigger a re-observe.
  // `once` is intentionally excluded: it is evaluated at intersection fire time
  // (in `_onChange`), so toggling it takes effect without re-observing — and a
  // re-observe on its change would be a pure no-op (same target, same options).
  // `manual` is also excluded: it is a connect-time policy ("don't auto-observe
  // on connect"), not a live switch that should start/stop an active observation.
  static observedAttributes = ["target", "root", "root-margin", "threshold"];

  static wcBindable: IWcBindable = {
    ...IntersectionCore.wcBindable,
    properties: [
      ...IntersectionCore.wcBindable.properties,
      { name: "trigger", event: "wcs-intersect:trigger-changed" },
    ],
    // Shell-level settable surface. Each input carries its mirrored `attribute`
    // hint; `trigger` has none — it is a momentary command-property, not a
    // declarative attribute. The observe / reobserve / unobserve / disconnect /
    // reset commands are inherited from the Core via the spread above.
    inputs: [
      { name: "target", attribute: "target" },
      { name: "root", attribute: "root" },
      { name: "rootMargin", attribute: "root-margin" },
      { name: "threshold", attribute: "threshold" },
      { name: "once", attribute: "once" },
      { name: "manual", attribute: "manual" },
      { name: "trigger" },
    ],
    // Core の commands をそのまま継承（単一情報源）。<wcs-sse>/<wcs-broadcast> と同型。
    // spread でも継承されるが、Core に command 追加時の追従漏れを防ぐため明示参照する。
    commands: IntersectionCore.wcBindable.commands,
  };

  private _core: IntersectionCore;
  private _trigger: boolean = false;

  constructor() {
    super();
    this._core = new IntersectionCore(this);
  }

  // --- Attribute accessors ---

  get target(): string {
    return this.getAttribute("target") ?? "";
  }

  set target(value: string) {
    this.setAttribute("target", value);
  }

  get root(): string {
    return this.getAttribute("root") ?? "";
  }

  set root(value: string) {
    this.setAttribute("root", value);
  }

  get rootMargin(): string {
    const attr = this.getAttribute("root-margin");
    return attr === null || attr.trim() === "" ? "0px" : attr;
  }

  set rootMargin(value: string) {
    this.setAttribute("root-margin", value);
  }

  get threshold(): string {
    return this.getAttribute("threshold") ?? "";
  }

  set threshold(value: string) {
    this.setAttribute("threshold", value);
  }

  get once(): boolean {
    return this.hasAttribute("once");
  }

  set once(value: boolean) {
    if (value) {
      this.setAttribute("once", "");
    } else {
      this.removeAttribute("once");
    }
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

  // --- Core delegated getters ---

  get entry(): WcsIntersectEntry | null {
    return this._core.entry;
  }

  get intersecting(): boolean {
    return this._core.intersecting;
  }

  get ratio(): number {
    return this._core.ratio;
  }

  get visible(): boolean {
    return this._core.visible;
  }

  get observing(): boolean {
    return this._core.observing;
  }

  // --- Command property ---

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    // Momentary command-property: a false→true write re-runs observe(). Mirrors
    // the trigger flag on <wcs-geo> / <wcs-ws> / <wcs-sse>. Prefer the command-token
    // protocol (`command.observe: $command.start`) for state-driven observation;
    // this exists mainly for simple boolean bindings.
    const v = !!value; // normalize truthy state-bindings, like <wcs-sse>'s setter
    if (v) {
      this._trigger = true;
      // try/finally mirrors <wcs-sse>'s set trigger: observe() is never-throw
      // today, but should a synchronous throw path ever appear, the finally still
      // auto-resets _trigger (no stuck-true latch) and emits the completion notice.
      try {
        this.observe();
      } finally {
        this._trigger = false;
        // Always auto-reset to false after the observe() attempt — this is the
        // *momentary acknowledgement* that the trigger was consumed, NOT a signal
        // that observation succeeded (whether the target resolved is reflected by
        // `observing`, not by this event). Firing unconditionally keeps the bound
        // state's trigger flag from sticking at true regardless of resolution.
        // Read `observing` if you need the actual outcome.
        this.dispatchEvent(new CustomEvent("wcs-intersect:trigger-changed", {
          detail: false,
          bubbles: true,
        }));
      }
    }
  }

  // --- Commands ---

  /** Re-resolve the target/root from the DOM and (re)start observing. */
  observe(): void {
    const { element, display } = this._resolveTarget();
    // `display` is derived from the `target` *mode* (self/selector/child), not from
    // whether the selector currently matches — so it is applied unconditionally,
    // before the resolution check. A `target="#x"` whose node is momentarily absent
    // still renders `display:none` (it is a selector pointer, never a box).
    this.style.display = display;
    if (!element) {
      // The target is no longer resolvable (e.g. a `target` selector whose node
      // was removed from the DOM). Tear down any stale observation so `observing`
      // does not keep reporting true against a node that is gone.
      this._core.disconnect();
      return;
    }
    this._core.observe(element, this._options());
  }

  /**
   * Force a fresh observation: re-resolve target/root from the DOM and re-observe
   * even when nothing changed. Unlike observe() (idempotent for an unchanged
   * target+options), this rebuilds the observer so a new initial callback fires for
   * the current visibility — the way to re-arm an edge-driven consumer after the
   * layout shifted without a visibility transition (e.g. infinite scroll appended a
   * short page that left this sentinel in view). Resolution/teardown rules match
   * observe(): an unresolvable target tears down any stale observation.
   */
  reobserve(): void {
    const { element, display } = this._resolveTarget();
    this.style.display = display;
    if (!element) {
      this._core.disconnect();
      return;
    }
    this._core.reobserve(element, this._options());
  }

  unobserve(): void {
    // Single-target Shell: "stop observing my target" is exactly the Core's
    // teardown. Delegate to the Core's tracked state rather than re-resolving the
    // selector, so a target that has since left the DOM can still be stopped
    // (re-resolving would yield null and silently leave the observer running).
    this._core.disconnect();
  }

  disconnect(): void {
    this._core.disconnect();
  }

  reset(): void {
    this._core.reset();
  }

  // --- Internal ---

  private _resolveTarget(): { element: Element | null; display: string } {
    const target = this.target;
    if (target === "self") {
      // Explicit sentinel: observe the element itself as a (typically zero-height)
      // marker, which requires a layout box.
      return { element: this, display: "block" };
    }
    if (target !== "") {
      // Selector pointer: observe a referenced element in place, staying invisible.
      const scope = this.getRootNode() as Document | ShadowRoot;
      // A user-authored selector can be syntactically invalid (e.g. `#`, `:::`,
      // `[data-*`), which makes querySelector throw a SyntaxError. Swallow it and
      // treat the target as unresolvable — the same "nothing to observe" path as a
      // selector matching no element — so a bad attribute never lets the throw
      // escape observe() → connectedCallback / attributeChangedCallback (never-throw).
      return { element: this._safeQuery(scope, target), display: "none" };
    }
    // Omitted: observe the first element child without injecting a box of our own.
    const child = this.firstElementChild;
    if (child) {
      return { element: child, display: "contents" };
    }
    // No child to wrap (e.g. used as an empty marker) — fall back to self.
    return { element: this, display: "block" };
  }

  private _resolveRoot(): Element | null {
    const root = this.root;
    if (root === "") return null;
    const scope = this.getRootNode() as Document | ShadowRoot;
    // Same never-throw guard as the target selector: an invalid `root` selector
    // falls back to a null root (the viewport) rather than throwing out of observe().
    return this._safeQuery(scope, root);
  }

  // Wrap querySelector so a syntactically invalid user-authored selector resolves
  // to null (unresolvable) instead of letting the SyntaxError escape — keeping the
  // sensor never-throw, mirroring worker/src/autoTrigger.ts's resolveText guard.
  private _safeQuery(scope: Document | ShadowRoot, selector: string): Element | null {
    try {
      return scope.querySelector(selector);
    } catch {
      return null;
    }
  }

  private _parseThreshold(): number | number[] {
    const raw = this.threshold.trim();
    if (raw === "") return 0;
    // Strict parse via Number() (unlike parseFloat, "0.5px" -> NaN, not 0.5); drop
    // any non-finite or out-of-range [0,1] value, matching the README note.
    // Drop empty slots first ("0,,1" / "1,") — Number("") is 0, which would
    // otherwise smuggle a spurious 0 threshold past the finite/range filter.
    const nums = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 1);
    if (nums.length === 0) return 0;
    return nums.length === 1 ? nums[0] : nums;
  }

  private _options(): IntersectOptions {
    return {
      root: this._resolveRoot(),
      rootMargin: this.rootMargin,
      threshold: this._parseThreshold(),
    };
  }

  private _onChange = (event: Event): void => {
    // `wcs-intersect:change` bubbles, so a nested `<wcs-intersect>` descendant's
    // change would otherwise reach this (ancestor) listener and let a *child's*
    // intersection tear down *our* observer. Only act on our own Core's event.
    // (This also avoids reading `.detail` off a foreign event shape.)
    if (event.target !== this) return;
    // `once`: tear down after the first intersecting observation (lazy-load idiom).
    // Gated at fire time so toggling the `once` attribute takes effect live.
    if (this.once && (event as CustomEvent).detail.isIntersecting) {
      this._core.disconnect();
    }
  };

  // --- Lifecycle ---

  connectedCallback(): void {
    this.addEventListener("wcs-intersect:change", this._onChange);
    if (!this.manual) {
      this.observe();
    }
  }

  disconnectedCallback(): void {
    this.removeEventListener("wcs-intersect:change", this._onChange);
    this._core.disconnect();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    // Defensive same-value guard. Per spec attributeChangedCallback only fires on
    // an actual value change, so this is effectively a dead branch today — but
    // setAttribute() with an unchanged value (and some test/tooling paths) can
    // still invoke it, and re-observing on an unchanged attribute would be a
    // wasted observer rebuild. Kept intentionally; do not remove.
    if (oldValue === newValue) return;
    // Only react once connected and in automatic mode. The Core's idempotency
    // guard absorbs the autoloader upgrade case (attributeChangedCallback +
    // connectedCallback both calling observe() with identical options).
    if (!this.isConnected || this.manual) return;
    this.observe();
  }
}
