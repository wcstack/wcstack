import { IWcBindable } from "../types.js";
import { PipCore } from "../core/PipCore.js";

/**
 * `<wcs-pip target="...">` — declarative Picture-in-Picture control.
 *
 * Like `<wcs-fullscreen>` (docs/fullscreen-tag-design.md §0/§1), this Shell
 * does not operate on itself: it is a non-visible control tag that resolves a
 * `target` element and invokes Picture-in-Picture commands against it. The
 * `target` attribute resolves in the same 3 modes as `intersection`/`fullscreen`
 * (`self` / a selector / the first element child), reused verbatim from
 * `@wcstack/intersection`'s `_resolveTarget()`/`_safeQuery()`
 * (packages/intersection/src/components/Intersect.ts).
 *
 * Picture-in-Picture-specific difference (docs/picture-in-picture-tag-design.md
 * §2): the resolved target must be a `<video>` element. This Shell resolves the
 * DOM element and hands it to the Core; the Core performs the `tagName ===
 * "VIDEO"` validation (never-throw — a mismatch is treated as an unresolved
 * target and reported via `error`, not thrown).
 */
export class WcsPip extends HTMLElement {
  // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
  // connectedCallbackPromise so the state binder can await it uniformly across
  // all IO nodes before snapshotting.
  static hasConnectedCallbackPromise = true;

  static observedAttributes = ["target"];

  static wcBindable: IWcBindable = {
    ...PipCore.wcBindable,
    inputs: [{ name: "target", attribute: "target" }],
    // Core の commands をそのまま継承（単一情報源）。fullscreen/intersection と同型。
    commands: PipCore.wcBindable.commands,
  };

  private _core: PipCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new PipCore(this);
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

  async requestPictureInPicture(): Promise<void> {
    const { element } = this._resolveVideoTarget();
    return this._core.requestPictureInPicture(element);
  }

  async exitPictureInPicture(): Promise<void> {
    return this._core.exitPictureInPicture();
  }

  // --- Internal ---

  /**
   * `_resolveTarget()`/`_safeQuery()` copied verbatim from `@wcstack/intersection`
   * (packages/intersection/src/components/Intersect.ts:243-267, 281-287) per the
   * fullscreen/picture-in-picture batch's shared target-resolution archetype
   * (docs/fullscreen-tag-design.md §1).
   */
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

  /**
   * Layers the Picture-in-Picture-specific `tagName === "VIDEO"` check on top
   * of `_resolveTarget()` (docs/picture-in-picture-tag-design.md §2). A
   * resolved-but-wrong-tag element is treated as unresolved (`element: null`)
   * so it flows into the same "target not found" failure path as Fullscreen's
   * missing-target case — never-throw, no exception escapes.
   */
  private _resolveVideoTarget(): { element: HTMLVideoElement | null; display: string } {
    const { element, display } = this._resolveTarget();
    if (element !== null && element.tagName !== "VIDEO") {
      return { element: null, display };
    }
    return { element: element as HTMLVideoElement | null, display };
  }

  private _observe(): void {
    const { element, display } = this._resolveVideoTarget();
    this.style.display = display;
    this._connectedCallbackPromise = this._core.observe(element);
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this._observe();
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    if (!this.isConnected) return;
    this._observe();
  }
}
