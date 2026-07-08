import { IWcBindable, OrientationLockType, WcsScreenOrientationSnapshot } from "../types.js";
import { ScreenOrientationCore } from "../core/ScreenOrientationCore.js";

/**
 * `<wcs-screen-orientation>` — declarative Screen Orientation API monitor +
 * command node.
 *
 * The Shell is as small as `<wcs-network>` (docs/screen-orientation-tag-design.md
 * §3, §10): no attributes at all. `screen.orientation` is a single global with
 * nothing to configure, unlike target-based nodes (`intersection`/`resize`) or
 * descriptor-based ones (`permission`). Unlike `network`, though, this Shell is
 * bidirectional: it also delegates the `lock()`/`unlock()` commands.
 */
export class WcsScreenOrientation extends HTMLElement {
  // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
  // connectedCallbackPromise so the state binder can await it uniformly across
  // all IO nodes before snapshotting.
  static hasConnectedCallbackPromise = true;

  static wcBindable: IWcBindable = {
    ...ScreenOrientationCore.wcBindable,
    inputs: [],
    // Core の commands をそのまま継承（単一情報源）。network/permission と同型。
    commands: ScreenOrientationCore.wcBindable.commands,
  };

  private _core: ScreenOrientationCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new ScreenOrientationCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-orientation:change": (d) => ({
        portrait: d.type?.startsWith("portrait") ?? false,
        landscape: d.type?.startsWith("landscape") ?? false,
      }),
      "wcs-orientation:error": (d) => ({ error: d != null }),
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
    // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
    // in happy-dom / older environments, and pre-125 Chromium rejects
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

  // --- Core delegated getters ---

  get type(): WcsScreenOrientationSnapshot["type"] {
    return this._core.type;
  }

  get angle(): number | null {
    return this._core.angle;
  }

  get portrait(): boolean {
    return this._core.portrait;
  }

  get landscape(): boolean {
    return this._core.landscape;
  }

  get error(): any {
    return this._core.error;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Commands (delegated to Core) ---

  lock(orientation: OrientationLockType): Promise<void> {
    return this._core.lock(orientation);
  }

  unlock(): void {
    this._core.unlock();
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    this._connectedCallbackPromise = this._core.observe();
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }
}
