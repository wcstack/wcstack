import { IWcBindable, WcsShareData } from "../types.js";
import { ShareCore } from "../core/ShareCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";

/**
 * `<wcs-share>` — declarative Web Share API primitive.
 *
 * The smallest command-only Shell in the batch (docs/web-share-tag-design.md
 * §10): no attributes at all. `share(data)`'s `data` is a per-call argument,
 * not a declarative setting to park on the element ahead of time.
 */
export class WcsShare extends HTMLElement {
  // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
  // connectedCallbackPromise so the state binder can await it uniformly across
  // all IO nodes before snapshotting.
  static hasConnectedCallbackPromise = true;

  static wcBindable: IWcBindable = {
    ...ShareCore.wcBindable,
    inputs: [],
    // Core の commands をそのまま継承（単一情報源）。
    commands: ShareCore.wcBindable.commands,
  };

  private _core: ShareCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new ShareCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-share:loading-changed":   (d) => ({ loading: d === true }),
      "wcs-share:cancelled-changed": (d) => ({ cancelled: d === true }),
      "wcs-share:error":             (d) => ({ error: d != null }),
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

  get value(): WcsShareData | null {
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

  get errorInfo(): WcsIoErrorInfo | null {
    return this._core.errorInfo;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Commands ---

  share(data?: WcsShareData): Promise<WcsShareData | null> {
    return this._core.share(data);
  }

  /**
   * Synchronous, side-effect-free delegation to `navigator.canShare(data)`
   * (docs/web-share-tag-design.md §6). Deliberately outside `wcBindable`
   * (not a `properties`/`commands` entry): the platform method takes an
   * argument that varies per call, which does not fit the "observe with no
   * arguments" shape of a bindable property, and is synchronous, which does
   * not fit the fire-and-observe-via-event shape of a command.
   *
   * No never-throw wrapping: the platform method itself is synchronous and
   * side-effect-free, so a throw here would indicate a browser bug rather
   * than a condition this Shell should paper over. `navigator.canShare` is
   * still resolved defensively (some environments lack it even when `share`
   * exists), returning `false` rather than throwing in that case.
   */
  canShare(data?: WcsShareData): boolean {
    const nav = (globalThis as any).navigator;
    return typeof nav?.canShare === "function" ? nav.canShare(data) : false;
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
