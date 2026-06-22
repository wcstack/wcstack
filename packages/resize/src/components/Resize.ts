import { IWcBindable, ResizeOptions, ResizeBoxOption, WcsResizeEntry } from "../types.js";
import { ResizeCore } from "../core/ResizeCore.js";

const BOX_VALUES: ReadonlyArray<ResizeBoxOption> = ["content-box", "border-box", "device-pixel-content-box"];

/**
 * `<wcs-resize>` — declarative ResizeObserver.
 *
 * The `target` attribute is the single knob that decides both *what* is observed
 * and how the element renders (it never injects a layout box unless asked):
 *
 * | `target`        | observes              | display     | use case             |
 * |-----------------|-----------------------|-------------|----------------------|
 * | omitted         | first element child   | `contents`  | size a wrapped child |
 * | `"#panel"` / sel| the matched element   | `none`      | size an existing node|
 * | `"self"`        | the element itself    | `block`     | container-width probe|
 *
 * `display:contents` means wrapping a child injects no box of its own (so a
 * `<wcs-resize><div></wcs-resize>` does not disturb a flex/grid parent); the
 * `target="self"` form takes a `display:block` box that, as a zero-height element,
 * stretches to the parent's available inline size — a container-width probe.
 *
 * Note: a `display:contents` / `display:none` element generates no box, so the
 * observed node must be the child / selector target (which do have boxes), never
 * the `<wcs-resize>` host itself except in the `self` form.
 */
export class WcsResize extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  // Only attributes that change *what or how* we observe trigger a re-observe.
  // `once` is intentionally excluded: it is evaluated at change fire time (in
  // `_onChange`), so toggling it takes effect without re-observing — and a
  // re-observe on its change would be a pure no-op (same target, same options).
  // `manual` is also excluded: it is a connect-time policy ("don't auto-observe on
  // connect"), not a live switch that should start/stop an active observation.
  // `box` and `round` ARE observed: changing them rebuilds the observer, and the
  // rebuild re-delivers the initial size — which is exactly how a `round` toggle
  // re-emits width/height with the new rounding.
  static observedAttributes = ["target", "box", "round"];

  static wcBindable: IWcBindable = {
    ...ResizeCore.wcBindable,
    properties: [
      ...ResizeCore.wcBindable.properties,
      { name: "trigger", event: "wcs-resize:trigger-changed" },
    ],
    // Shell-level settable surface. Each input carries its mirrored `attribute`
    // hint; `trigger` has none — it is a momentary command-property, not a
    // declarative attribute. The observe / unobserve / disconnect commands are
    // inherited from the Core via the spread above.
    inputs: [
      { name: "target", attribute: "target" },
      { name: "box", attribute: "box" },
      { name: "round", attribute: "round" },
      { name: "once", attribute: "once" },
      { name: "manual", attribute: "manual" },
      { name: "trigger" },
    ],
    // Core の commands をそのまま継承（単一情報源）。<wcs-intersect>/<wcs-sse> と同型。
    // spread でも継承されるが、Core に command 追加時の追従漏れを防ぐため明示参照する。
    commands: ResizeCore.wcBindable.commands,
  };

  private _core: ResizeCore;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new ResizeCore(this);
  }

  // SSR: the state binder awaits this before snapshotting. Backed by the Core's
  // synchronous `ready` (resize delivers the initial size synchronously, so it is
  // already resolved); exposed for uniformity with the other @wcstack IO nodes.
  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Attribute accessors ---

  get target(): string {
    return this.getAttribute("target") ?? "";
  }

  set target(value: string) {
    this.setAttribute("target", value);
  }

  get box(): string {
    return this.getAttribute("box") ?? "";
  }

  set box(value: string) {
    this.setAttribute("box", value);
  }

  get round(): boolean {
    return this.hasAttribute("round");
  }

  set round(value: boolean) {
    if (value) {
      this.setAttribute("round", "");
    } else {
      this.removeAttribute("round");
    }
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

  get entry(): WcsResizeEntry | null {
    return this._core.entry;
  }

  get width(): number {
    return this._core.width;
  }

  get height(): number {
    return this._core.height;
  }

  get observing(): boolean {
    return this._core.observing;
  }

  // --- Command property ---

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    // Momentary command-property: a false→true write re-runs observe(). Mirrors the
    // trigger flag on <wcs-intersect> / <wcs-geo>. Prefer the command-token protocol
    // (`command.observe: $command.start`) for state-driven observation; this exists
    // mainly for simple boolean bindings.
    const v = !!value; // normalize truthy state-bindings, like <wcs-intersect>'s setter
    if (v) {
      this._trigger = true;
      // try/finally mirrors <wcs-intersect>'s set trigger: observe() is never-throw
      // today, but should a synchronous throw path ever appear, the finally still
      // auto-resets _trigger (no stuck-true latch) and emits the completion notice.
      try {
        this.observe();
      } finally {
        this._trigger = false;
        // Always auto-reset to false after the observe() attempt — this is the
        // *momentary acknowledgement* that the trigger was consumed, NOT a signal
        // that observation succeeded (whether the target resolved is reflected by
        // `observing`, not by this event). Read `observing` if you need the outcome.
        this.dispatchEvent(new CustomEvent("wcs-resize:trigger-changed", {
          detail: false,
          bubbles: true,
        }));
      }
    }
  }

  // --- Commands ---

  /** Re-resolve the target from the DOM and (re)start observing. */
  observe(): void {
    const { element, display } = this._resolveTarget();
    // `display` is derived from the `target` *mode* (self/selector/child), not from
    // whether the selector currently matches — so it is applied unconditionally,
    // before the resolution check. A `target="#x"` whose node is momentarily absent
    // still renders `display:none` (it is a selector pointer, never a box).
    this.style.display = display;
    if (!element) {
      // The target is no longer resolvable (e.g. a `target` selector whose node was
      // removed from the DOM). Tear down any stale observation so `observing` does
      // not keep reporting true against a node that is gone.
      this._core.disconnect();
      return;
    }
    this._core.observe(element, this._options());
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

  // --- Internal ---

  private _resolveTarget(): { element: Element | null; display: string } {
    const target = this.target;
    if (target === "self") {
      // Explicit sentinel: observe the element itself. As a display:block zero-height
      // box it stretches to the parent's available inline size — a container probe.
      return { element: this, display: "block" };
    }
    if (target !== "") {
      // Selector pointer: observe a referenced element in place, staying invisible.
      const scope = this.getRootNode() as Document | ShadowRoot;
      // A user-authored selector can be syntactically invalid (e.g. `#`, `:::`,
      // `[data-*`), which makes querySelector throw a SyntaxError. Swallow it and
      // treat the target as unresolvable — the same "nothing to observe" path as a
      // selector matching no element — so a bad attribute never lets the throw escape
      // observe() → connectedCallback / attributeChangedCallback (never-throw).
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

  // Wrap querySelector so a syntactically invalid user-authored selector resolves to
  // null (unresolvable) instead of letting the SyntaxError escape — keeping the
  // sensor never-throw, mirroring intersection's _safeQuery guard.
  private _safeQuery(scope: Document | ShadowRoot, selector: string): Element | null {
    try {
      return scope.querySelector(selector);
    } catch {
      return null;
    }
  }

  private _parseBox(): ResizeBoxOption {
    const raw = this.box.trim();
    // Decision: an unrecognized box value falls back to content-box at parse time
    // (rather than letting the Core's observe() reject it), mirroring threshold's
    // range filter in <wcs-intersect>. The Core still has its own runtime fallback
    // for a *valid-but-unsupported* box (e.g. device-pixel-content-box on Safari).
    return (BOX_VALUES as ReadonlyArray<string>).includes(raw) ? (raw as ResizeBoxOption) : "content-box";
  }

  private _options(): ResizeOptions {
    return {
      box: this._parseBox(),
      round: this.round,
    };
  }

  private _onChange = (event: Event): void => {
    // `wcs-resize:change` bubbles, so a nested `<wcs-resize>` descendant's change
    // would otherwise reach this (ancestor) listener and let a *child's* resize tear
    // down *our* observer. Only act on our own Core's event. (This also avoids
    // reading `.detail` off a foreign event shape.)
    if (event.target !== this) return;
    // `once`: tear down after the first size observation. ResizeObserver always
    // delivers the initial size on observe(), so once = measure-once. Gated at fire
    // time so toggling the `once` attribute takes effect live.
    if (this.once) {
      this._core.disconnect();
    }
  };

  // --- Lifecycle ---

  connectedCallback(): void {
    this.addEventListener("wcs-resize:change", this._onChange);
    if (!this.manual) {
      this.observe();
    }
    // SSR: back connectedCallbackPromise with the Core's readiness probe. The
    // observation itself is started above via the element-observe command; this
    // captures the (synchronously resolved) ready promise for the state binder.
    this._connectedCallbackPromise = this._core.observe();
  }

  disconnectedCallback(): void {
    this.removeEventListener("wcs-resize:change", this._onChange);
    this._core.dispose();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    // Defensive same-value guard. Per the HTML spec, an attribute change reaction is
    // enqueued whenever setAttribute() runs — including with an unchanged value — so
    // attributeChangedCallback CAN fire on a same-value write. Re-observing on an
    // unchanged attribute would be a wasted observer rebuild, so bail early when the
    // value did not actually change. Kept intentionally; do not remove.
    if (oldValue === newValue) return;
    // Only react once connected and in automatic mode. The Core's idempotency guard
    // absorbs the autoloader upgrade case (attributeChangedCallback +
    // connectedCallback both calling observe() with identical options).
    if (!this.isConnected || this.manual) return;
    this.observe();
  }
}
