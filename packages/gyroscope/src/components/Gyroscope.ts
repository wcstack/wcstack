import { IWcBindable, WcsGyroscopeErrorDetail } from "../types.js";
import { GyroscopeCore } from "../core/GyroscopeCore.js";

/**
 * `<wcs-gyroscope>` — declarative Generic Sensor API (`Gyroscope`)
 * monitor + start/stop control.
 *
 * Unlike `<wcs-network>` / `<wcs-permission>` (pure monitors), this Shell is a
 * bidirectional node: `start`/`stop` commands (command-token: state → element)
 * alongside the `x`/`y`/`z`/`error` observable surface (event-token: element →
 * state). The `frequency` attribute is the sole configuration input, passed
 * straight through to the platform `Gyroscope` constructor's `{ frequency }`
 * option (docs/gyroscope-tag-design.md §1.2) — no range validation here;
 * an out-of-range value is left to the browser/sensor to reject via `error`.
 *
 * Permission handling is intentionally NOT implemented here. Compose with
 * `<wcs-permission name="gyroscope">` instead (see README "Composing with
 * wcs-permission" and docs/gyroscope-tag-design.md).
 */
export class WcsGyroscope extends HTMLElement {
  static hasConnectedCallbackPromise = true;

  static wcBindable: IWcBindable = {
    ...GyroscopeCore.wcBindable,
    inputs: [{ name: "frequency" }],
    // Core の commands をそのまま継承（単一情報源）。
    commands: GyroscopeCore.wcBindable.commands,
  };

  private _core: GyroscopeCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new GyroscopeCore(this);
  }

  // --- Attribute accessors ---

  /** Sampling frequency in Hz. `null` when unset (platform default applies). */
  get frequency(): number | null {
    const attr = this.getAttribute("frequency");
    if (attr === null || attr.trim() === "") return null;
    const parsed = Number(attr);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  set frequency(value: number | null | undefined) {
    if (value === null || value === undefined) {
      this.removeAttribute("frequency");
    } else {
      this.setAttribute("frequency", String(value));
    }
  }

  // --- Core delegated getters ---

  get x(): number | null {
    return this._core.x;
  }

  get y(): number | null {
    return this._core.y;
  }

  get z(): number | null {
    return this._core.z;
  }

  get error(): WcsGyroscopeErrorDetail | null {
    return this._core.error;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Commands ---

  start(): void {
    this._core.start(this.frequency ?? undefined);
  }

  stop(): void {
    this._core.stop();
  }

  // --- Lifecycle ---

  // Deliberately does NOT auto-start the sensor on connect. Unlike
  // Geolocation (whose default phase acquires a fix immediately unless
  // `manual` is set), Gyroscope has no such "connect implies observing"
  // precedent in the design doc (docs/gyroscope-tag-design.md §1.3):
  // start/stop are the only commands, so connecting the element merely makes
  // it inert until a command-token `start` (or the `start()` method) is
  // invoked. This also keeps behavior predictable when composed with
  // `<wcs-permission name="gyroscope">`: the caller decides when to start,
  // typically gated on `granted`.
  connectedCallback(): void {
    this.style.display = "none";
    // No asynchronous probe to await (§3.8); kept for SSR uniformity with
    // other IO nodes.
    this._connectedCallbackPromise = this._core.ready;
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }
}
