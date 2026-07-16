import { IWcBindable } from "../types.js";
import { FullscreenCore } from "../core/FullscreenCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";

/**
 * `<wcs-fullscreen target="...">` — declarative Fullscreen API control.
 *
 * Like `intersection`/`resize`, this Shell operates on a *referenced* element,
 * not itself (docs/fullscreen-tag-design.md §0): `target` resolves which
 * element `requestFullscreen()`/`exitFullscreen()` are invoked on, using the
 * exact same 3-mode resolution as `<wcs-intersect>`
 * (docs/fullscreen-tag-design.md §1):
 *
 * | `target`        | operates on            | display     | use case                |
 * |-----------------|-------------------------|-------------|--------------------------|
 * | omitted         | first element child     | `contents`  | wrap a gallery image/video |
 * | `"#hero"` / sel | the matched element      | `none`      | point at a distant node  |
 * | `"self"`        | the element itself       | `block`     | fullscreen the wrapper   |
 *
 * `requestFullscreen()` requires an active user gesture — this element cannot
 * manufacture one. Invoke the command from within a real click handler
 * (typically via the command-token protocol: this element subscribes with
 * `command.requestFullscreen: $command.<token>`, and a button emits the
 * token from its own click handler, e.g. `onclick: $command.<token>`).
 */
export class WcsFullscreen extends HTMLElement {
  // SSR (§10): the fullscreenchange subscription is established synchronously
  // on connect, but the Shell still exposes connectedCallbackPromise so the
  // state binder can await it uniformly across all IO nodes before
  // snapshotting.
  static hasConnectedCallbackPromise = true;

  static observedAttributes = ["target"];

  static wcBindable: IWcBindable = {
    ...FullscreenCore.wcBindable,
    inputs: [{ name: "target", attribute: "target" }],
    // Core の commands をそのまま継承（単一情報源）。network/intersection と同型。
    commands: FullscreenCore.wcBindable.commands,
  };

  private _core: FullscreenCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new FullscreenCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-fullscreen:change": (d) => ({ active: d?.active === true }),
    });
  }

  // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
  // wc-bindable (not a bind target); see README "CSS styling with :state()".
  // MUST NOT return the live CustomStateSet (that would let callers write
  // states from outside, defeating the point of :state() being read-only).
  get debugStates(): string[] {
    return this._internals ? [...this._internals.states] : [];
  }

  private _initInternals(): ElementInternals | null {
    // never-throw (docs/custom-state-reflection-design.md §3.1): attachInternals
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
   * Resolve `target` and request fullscreen on it. never-throw: an
   * unresolvable target or an unsupported/rejected API call are both
   * surfaced via `error`, never thrown (docs/fullscreen-tag-design.md §3/§6).
   */
  async requestFullscreen(): Promise<void> {
    const { element } = this._resolveTarget();
    await this._core.requestFullscreen(element);
  }

  async exitFullscreen(): Promise<void> {
    await this._core.exitFullscreen();
  }

  // --- Internal ---

  // Copied verbatim from <wcs-intersect> (Intersect.ts _resolveTarget/_safeQuery,
  // docs/fullscreen-tag-design.md §1): identical 3-mode resolution, only the
  // "what to do with the resolved element" step differs.
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

  private _safeQuery(scope: Document | ShadowRoot, selector: string): Element | null {
    try {
      return scope.querySelector(selector);
    } catch {
      return null;
    }
  }

  private _reresolve(): void {
    const { element, display } = this._resolveTarget();
    this.style.display = display;
    this._core.setTarget(element);
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this._reresolve();
    this._connectedCallbackPromise = this._core.observe();
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    if (!this.isConnected) return;
    this._reresolve();
  }
}
