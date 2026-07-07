import { IdleScreenState, IdleUserState, IWcBindable } from "../types.js";
import { IdleCore } from "../core/IdleCore.js";

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

  constructor() {
    super();
    this._core = new IdleCore(this);
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
