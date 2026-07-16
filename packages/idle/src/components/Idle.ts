import { IdleScreenState, IdleUserState, IWcBindable } from "../types.js";
import { IdleCore } from "../core/IdleCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";

/**
 * `<wcs-idle>` — declarative Idle Detection API primitive.
 *
 * Does NOT auto-start on connect (docs/idle-detection-tag-design.md §6): the
 * permission gate sits in front of `start()`, so an unconditional
 * connectedCallback start would be guaranteed to fail before permission is
 * granted. Callers drive `requestPermission()` → `start()` explicitly, e.g.
 * from a click handler.
 *
 * Compose with `<wcs-permission name="idle-detection">` for prompt/granted/
 * denied status — this Shell only exposes the actual idle state.
 */
export class WcsIdle extends HTMLElement {
  static hasConnectedCallbackPromise = true;

  static wcBindable: IWcBindable = {
    ...IdleCore.wcBindable,
    inputs: [
      { name: "threshold", attribute: "threshold" },
    ],
    // Core の commands をそのまま継承（単一情報源）。
    commands: IdleCore.wcBindable.commands,
  };

  private _core: IdleCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new IdleCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-idle:change": (d) => ({ active: d.userState === "active" }),
      "wcs-idle:error":  (d) => ({ error: d != null }),
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
    // never-throw (docs/custom-state-reflection-design.md §3.1/§3.4): attachInternals
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

  /**
   * Minimum idle time (ms) before `userState` becomes `"idle"`. This value is
   * read only at `start()` time — there is no `attributeChangedCallback`
   * (deliberately not declared in `observedAttributes`, mirroring
   * `<wcs-gyroscope>`'s `frequency`), so mutating the attribute/property on an
   * already-running session has no effect until the caller `stop()`s and
   * `start()`s again.
   */
  get threshold(): number {
    const attr = this.getAttribute("threshold");
    // An absent, empty, or whitespace-only attribute all mean "no value
    // supplied" and must fall back to the default — without this check,
    // `Number("")`/`Number("  ")` coerce to `0` (finite), which would slip
    // past the `Number.isFinite` fallback below and silently return `0`
    // instead of the documented 60000ms default.
    if (attr === null || attr.trim() === "") return 60000;
    const n = Number(attr);
    return Number.isFinite(n) ? n : 60000;
  }

  set threshold(value: number) {
    this.setAttribute("threshold", String(value));
  }

  // --- Core delegated getters ---

  get userState(): IdleUserState | null {
    return this._core.userState;
  }

  get screenState(): IdleScreenState | null {
    return this._core.screenState;
  }

  get active(): boolean {
    return this._core.active;
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

  requestPermission(): Promise<"granted" | "denied"> {
    return this._core.requestPermission();
  }

  start(threshold?: number): Promise<void> {
    return this._core.start(threshold ?? this.threshold);
  }

  stop(): void {
    this._core.stop();
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    // No auto-start (§6) — observe() is a synchronous no-op, kept only for
    // API uniformity with other IO nodes' lifecycle.
    this._connectedCallbackPromise = this._core.observe();
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }
}
