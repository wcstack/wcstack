import { IWcBindable, WcsEyedropperData } from "../types.js";
import { EyedropperCore } from "../core/EyedropperCore.js";

/**
 * `<wcs-eyedropper>` — declarative EyeDropper API primitive.
 *
 * The smallest command-only Shell in the batch (docs/eyedropper-tag-design.md
 * §5), mirroring `<wcs-share>`: no attributes at all. `open()` takes no
 * per-call argument — the `{signal}` option is supplied internally by the
 * Core's own AbortController, never via the command-token surface.
 */
export class WcsEyedropper extends HTMLElement {
  // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
  // connectedCallbackPromise so the state binder can await it uniformly across
  // all IO nodes before snapshotting.
  static hasConnectedCallbackPromise = true;

  static wcBindable: IWcBindable = {
    ...EyedropperCore.wcBindable,
    inputs: [],
    // Core の commands をそのまま継承（単一情報源）。
    commands: EyedropperCore.wcBindable.commands,
  };

  private _core: EyedropperCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new EyedropperCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-eyedropper:loading-changed":   (d) => ({ loading: d === true }),
      "wcs-eyedropper:cancelled-changed": (d) => ({ cancelled: d === true }),
      "wcs-eyedropper:error":             (d) => ({ error: d != null }),
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

  get value(): WcsEyedropperData | null {
    return this._core.value;
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get error(): any {
    return this._core.error;
  }

  get cancelled(): boolean {
    return this._core.cancelled;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Commands ---

  open(): Promise<WcsEyedropperData | null> {
    return this._core.open();
  }

  abort(): void {
    this._core.abort();
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
