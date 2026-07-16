import { IWcBindable } from "../types.js";
import { PointerLockCore } from "../core/PointerLockCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";

/**
 * `<wcs-pointer-lock target="...">` — declarative Pointer Lock API control.
 *
 * Like `<wcs-fullscreen>` (docs/fullscreen-tag-design.md §0), this Shell does
 * not lock itself — it operates on a *referenced* element via the `target`
 * attribute, using the same 3-mode resolution rule as `intersection`
 * (`_resolveTarget()`/`_safeQuery()`, copied verbatim per
 * docs/pointer-lock-tag-design.md §1 / docs/fullscreen-tag-design.md §1):
 *
 * | `target`        | operates on            | display     |
 * |-----------------|-------------------------|-------------|
 * | omitted         | first element child     | `contents`  |
 * | `"#selector"`    | the matched element      | `none`      |
 * | `"self"`         | the element itself       | `block`     |
 *
 * `requestPointerLock()` requires a user-gesture context (docs/fullscreen-tag-design.md
 * §3) — the primary activation path is the command-token protocol
 * (`command.requestPointerLock: $command.<token>` on `<wcs-pointer-lock>`,
 * emitted by a button's `onclick: $command.<token>`), not an
 * autoTrigger attribute (none is provided in v1,
 * docs/pointer-lock-tag-design.md §4).
 *
 * `movementX`/`movementY` are intentionally out of scope for v1
 * (docs/pointer-lock-tag-design.md §3) — do not add them without revisiting
 * the design doc.
 */
export class WcsPointerLock extends HTMLElement {
  // SSR (§4.4): the Core subscribes synchronously on connect, but the Shell
  // still exposes connectedCallbackPromise so the state binder can await it
  // uniformly across all IO nodes before snapshotting.
  static hasConnectedCallbackPromise = true;

  static observedAttributes = ["target"];

  static wcBindable: IWcBindable = {
    ...PointerLockCore.wcBindable,
    inputs: [{ name: "target", attribute: "target" }],
    // Core の commands をそのまま継承（単一情報源）。network/intersection と同型。
    commands: PointerLockCore.wcBindable.commands,
  };

  private _core: PointerLockCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new PointerLockCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-pointer-lock:change": (d) => ({ active: d === true }),
    });
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
  // wc-bindable (not a bind target); see README "CSS styling with :state()".
  // MUST NOT return the live CustomStateSet (that would let callers write
  // states from outside, defeating the point of :state() being read-only).
  get debugStates(): string[] {
    return this._internals ? [...this._internals.states] : [];
  }

  private _initInternals(): ElementInternals | null {
    // never-throw (docs/custom-state-reflection-design.md §3.6): attachInternals
    // is absent in happy-dom / older environments, and pre-125 Chromium rejects
    // non-dashed state names from states.add() (probed and discarded here).
    // Either case silently disables reflection — the component still works,
    // it just doesn't expose :state() selectors.
    try {
      if (typeof this.attachInternals !== "function") return null;
      const internals = this.attachInternals();
      internals.states.add("wcs-probe");
      internals.states.delete("wcs-probe");
      return internals;
    } catch {
      return null;
    }
  }

  private _wireStates(map: Record<string, (detail: any) => Record<string, boolean>>): void {
    if (this._internals === null) return;
    const states = this._internals.states;
    for (const [event, toStates] of Object.entries(map)) {
      this.addEventListener(event, (e) => {
        const debug = this.hasAttribute("debug-states");
        for (const [name, on] of Object.entries(toStates((e as CustomEvent).detail))) {
          try {
            if (on) { states.add(name); } else { states.delete(name); }
          } catch { /* never-throw */ }
          if (debug) this.toggleAttribute(`data-wcs-state-${name}`, on);
        }
      });
    }
  }

  // --- Attribute accessors ---

  get target(): string {
    return this.getAttribute("target") ?? "";
  }

  set target(value: string) {
    this.setAttribute("target", value);
  }

  // --- Core delegated getters ---

  get active(): boolean {
    return this._core.active;
  }

  get error(): any {
    return this._core.error;
  }

  get errorInfo(): WcsIoErrorInfo | null {
    return this._core.errorInfo;
  }

  // --- Commands ---

  /**
   * Resolve `target` and request pointer lock on it. Requires a user-gesture
   * context. never-throw: an unresolvable target or an unsupported/rejected
   * API call are both surfaced via `error`, never thrown (mirrors
   * `<wcs-fullscreen>`'s `requestFullscreen()`, docs/fullscreen-tag-design.md
   * §3/§6 — the Shell passes the (possibly `null`) resolved element straight
   * through and lets the Core set `error`, rather than silently no-op'ing
   * here).
   */
  async requestPointerLock(): Promise<void> {
    const { element } = this._resolveTarget();
    await this._core.requestPointerLock(element);
  }

  /** Exit pointer lock. Synchronous command — silent no-op if nothing is locked. */
  exitPointerLock(): void {
    this._core.exitPointerLock();
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this._applyDisplayAndObserve();
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }

  attributeChangedCallback(name: string): void {
    if (name === "target" && this.isConnected) {
      this._applyDisplayAndObserve();
    }
  }

  // --- Internal ---

  private _applyDisplayAndObserve(): void {
    const { element, display } = this._resolveTarget();
    this.style.display = display;
    this._connectedCallbackPromise = this._core.observe(element);
  }

  // Copied verbatim from packages/intersection/src/components/Intersect.ts
  // (§1 of docs/pointer-lock-tag-design.md / docs/fullscreen-tag-design.md).
  private _resolveTarget(): { element: Element | null; display: string } {
    const target = this.target;
    if (target === "self") {
      return { element: this, display: "block" };
    }
    if (target !== "") {
      const scope = this.getRootNode() as Document | ShadowRoot;
      return { element: this._safeQuery(scope, target), display: "none" };
    }
    const child = this.firstElementChild;
    if (child) {
      return { element: child, display: "contents" };
    }
    return { element: this, display: "block" };
  }

  // Copied verbatim from packages/intersection/src/components/Intersect.ts.
  private _safeQuery(scope: Document | ShadowRoot, selector: string): Element | null {
    try {
      return scope.querySelector(selector);
    } catch {
      return null;
    }
  }
}
