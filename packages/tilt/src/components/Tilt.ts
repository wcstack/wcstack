import { IWcBindable, TiltPermissionState } from "../types.js";
import { TiltCore } from "../core/TiltCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";

/**
 * `<wcs-tilt>` — declarative Device Orientation API monitor.
 *
 * Named `tilt` (not `orientation`/`device-orientation`) to avoid colliding
 * with `<wcs-screen-orientation>` (docs/device-orientation-tag-design.md §9).
 *
 * Does NOT auto-start on connect, mirroring `<wcs-idle>`: on iOS, subscribing
 * before permission is granted silently receives no events. Callers drive
 * `requestPermission()` → `start()` explicitly.
 */
export class WcsTilt extends HTMLElement {
  static hasConnectedCallbackPromise = true;

  static wcBindable: IWcBindable = {
    ...TiltCore.wcBindable,
    inputs: [],
    // Core の commands をそのまま継承（単一情報源）。
    commands: TiltCore.wcBindable.commands,
  };

  private _core: TiltCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new TiltCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-tilt:error": (d) => ({ error: d != null }),
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

  get alpha(): number | null {
    return this._core.alpha;
  }

  get beta(): number | null {
    return this._core.beta;
  }

  get gamma(): number | null {
    return this._core.gamma;
  }

  get absolute(): boolean | null {
    return this._core.absolute;
  }

  get permissionState(): TiltPermissionState {
    return this._core.permissionState;
  }

  get error(): any {
    return this._core.error;
  }

  get errorInfo(): WcsIoErrorInfo | null {
    return this._core.errorInfo;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Commands (delegated to Core) ---

  requestPermission(): Promise<TiltPermissionState> {
    return this._core.requestPermission();
  }

  start(): void {
    this._core.start();
  }

  stop(): void {
    this._core.stop();
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
