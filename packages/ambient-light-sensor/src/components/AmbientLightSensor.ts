import { IWcBindable, WcsAmbientLightSensorErrorDetail } from "../types.js";
import { AmbientLightSensorCore } from "../core/AmbientLightSensorCore.js";

/**
 * `<wcs-ambient-light-sensor>` — declarative Generic Sensor API (`AmbientLightSensor`)
 * monitor + start/stop control.
 *
 * Unlike `<wcs-network>` / `<wcs-permission>` (pure monitors), this Shell is a
 * bidirectional node: `start`/`stop` commands (command-token: state → element)
 * alongside the `illuminance`/`error` observable surface (event-token: element →
 * state). The `frequency` attribute is the sole configuration input, passed
 * straight through to the platform `AmbientLightSensor` constructor's `{ frequency }`
 * option (docs/ambient-light-sensor-tag-design.md §1.2) — no range validation here;
 * an out-of-range value is left to the browser/sensor to reject via `error`.
 *
 * Permission handling is intentionally NOT implemented here. Compose with
 * `<wcs-permission name="ambient-light-sensor">` instead (see README "Composing with
 * wcs-permission" and docs/ambient-light-sensor-tag-design.md).
 */
export class WcsAmbientLightSensor extends HTMLElement {
  static hasConnectedCallbackPromise = true;

  static wcBindable: IWcBindable = {
    ...AmbientLightSensorCore.wcBindable,
    inputs: [{ name: "frequency" }],
    // Core の commands をそのまま継承（単一情報源）。
    commands: AmbientLightSensorCore.wcBindable.commands,
  };

  private _core: AmbientLightSensorCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new AmbientLightSensorCore(this);
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

  get illuminance(): number | null {
    return this._core.illuminance;
  }

  get error(): WcsAmbientLightSensorErrorDetail | null {
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
  // `manual` is set), AmbientLightSensor has no such "connect implies observing"
  // precedent in the design doc (docs/ambient-light-sensor-tag-design.md §1.3):
  // start/stop are the only commands, so connecting the element merely makes
  // it inert until a command-token `start` (or the `start()` method) is
  // invoked. This also keeps behavior predictable when composed with
  // `<wcs-permission name="ambient-light-sensor">`: the caller decides when to start,
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
