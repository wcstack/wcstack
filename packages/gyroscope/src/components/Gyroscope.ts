import { IWcBindable, WcsGyroscopeErrorDetail } from "../types.js";
import { GyroscopeCore } from "../core/GyroscopeCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";

/**
 * `<wcs-gyroscope>` — declarative Generic Sensor API (`Gyroscope`)
 * monitor + start/stop control.
 *
 * Unlike `<wcs-network>` / `<wcs-permission>` (pure monitors), this Shell is a
 * bidirectional node: `start`/`stop` commands (command-token: state → element)
 * alongside the `x`/`y`/`z`/`error` observable surface (event-token: element →
 * state). The `frequency` attribute is the sole configuration input, forwarded
 * to the platform `Gyroscope` constructor's `{ frequency }` option
 * (docs/sensor-tag-design.md §1.2). The getter normalizes it: a non-finite or
 * non-positive value (NaN, 0, negative) reads back as `null` — meaning "no
 * frequency specified" — so start() falls back to the platform default rather
 * than forwarding a value the sensor would reject. Any positive finite value is
 * passed through verbatim (no upper-bound clamping — an out-of-range-but-positive
 * rate is still left to the browser/sensor to reject via `error`).
 *
 * Permission handling is intentionally NOT implemented here. Compose with
 * `<wcs-permission name="gyroscope">` instead (see the README's permission
 * example, "Gate on permission, then start", and docs/sensor-tag-design.md).
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
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new GyroscopeCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-gyroscope:error": (d) => ({ error: d != null }),
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

  // --- Attribute accessors ---

  /**
   * Sampling frequency in Hz. Reads back `null` when unset, blank, or when the
   * attribute does not parse to a positive finite number (NaN, `"0"`, negative)
   * — in every such "no usable value" case the platform default applies.
   *
   * Note the deliberate set/get asymmetry: `set frequency(0)` (or any
   * non-positive/non-finite value) still writes the attribute verbatim for
   * transparency/inspectability, but the getter normalizes it back to `null`.
   * A round-trip through a non-positive value therefore does NOT preserve it —
   * that value carries no valid sampling meaning, so it is treated as "unset"
   * on read. Only positive finite frequencies survive a set→get round-trip.
   *
   * This value is read only at `start()` time. There is no
   * `attributeChangedCallback`, and `GyroscopeCore.start()` is idempotent
   * while already started (a redundant call is a no-op), so setting
   * `frequency` (attribute or property) on an already-running sensor has no
   * effect until the caller `stop()`s and `start()`s again (see the README's
   * "Notes & limitations").
   */
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

  get errorInfo(): WcsIoErrorInfo | null {
    return this._core.errorInfo;
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
  // precedent in the design doc (docs/sensor-tag-design.md §1.3):
  // start/stop are the only commands, so connecting the element merely makes
  // it inert until a command-token `start` (or the `start()` method) is
  // invoked. This also keeps behavior predictable when composed with
  // `<wcs-permission name="gyroscope">`: the caller decides when to start,
  // typically gated on `granted`.
  connectedCallback(): void {
    this.style.display = "none";
    // No asynchronous probe to await (docs/async-io-node-guidelines.md §3.8);
    // kept for SSR uniformity with other IO nodes.
    this._connectedCallbackPromise = this._core.ready;
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }
}
