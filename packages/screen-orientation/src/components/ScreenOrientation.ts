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

  constructor() {
    super();
    this._core = new ScreenOrientationCore(this);
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
