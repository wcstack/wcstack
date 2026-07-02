import { IWcBindable } from "../types.js";
import { FullscreenCore } from "../core/FullscreenCore.js";

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
 * (typically via the command-token protocol, e.g.
 * `<button command.click:$command.requestFullscreen>`).
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

  constructor() {
    super();
    this._core = new FullscreenCore(this);
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
    this.style.display = "none";
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
