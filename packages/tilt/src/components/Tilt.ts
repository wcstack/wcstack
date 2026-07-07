import { IWcBindable, TiltPermissionState } from "../types.js";
import { TiltCore } from "../core/TiltCore.js";

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

  constructor() {
    super();
    this._core = new TiltCore(this);
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
