import { IWcBindable } from "../types.js";
import { NetworkCore } from "../core/NetworkCore.js";

/**
 * `<wcs-network>` — declarative Network Information API monitor.
 *
 * The smallest Shell in the batch (docs/network-tag-design.md §9): no
 * attributes at all. `navigator.connection` is a single global with nothing to
 * configure, unlike target-based nodes (`intersection`/`resize`) or
 * descriptor-based ones (`permission`).
 */
export class WcsNetwork extends HTMLElement {
  // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
  // connectedCallbackPromise so SSR (@wcstack/server render.ts) can await it
  // uniformly across all IO nodes before snapshotting the HTML. Mirrors
  // WcsPermission.connectedCallbackPromise.
  static hasConnectedCallbackPromise = true;

  static wcBindable: IWcBindable = {
    ...NetworkCore.wcBindable,
    inputs: [],
    // Core の commands をそのまま継承（単一情報源）。permission と同型。
    commands: NetworkCore.wcBindable.commands,
  };

  private _core: NetworkCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new NetworkCore(this);
  }

  // --- Core delegated getters ---

  get effectiveType(): string | null {
    return this._core.effectiveType;
  }

  get downlink(): number | null {
    return this._core.downlink;
  }

  get rtt(): number | null {
    return this._core.rtt;
  }

  get saveData(): boolean | null {
    return this._core.saveData;
  }

  get supported(): boolean {
    return this._core.supported;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
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
