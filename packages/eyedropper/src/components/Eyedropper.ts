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

  constructor() {
    super();
    this._core = new EyedropperCore(this);
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
