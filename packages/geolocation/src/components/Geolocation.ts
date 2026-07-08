import { config } from "../config.js";
import { IWcBindable, GeoOptions, GeoPermissionState, WcsGeoPositionDetail, WcsGeoCoords, WcsGeoErrorDetail } from "../types.js";
import { GeolocationCore } from "../core/GeolocationCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

// Named WcsGeolocation (not `Geolocation`) so the class does not shadow the
// global DOM `Geolocation` interface (the type of `navigator.geolocation`), and
// to match the <wcs-ws> convention (WcsWebSocket). The public export keeps the
// `WcsGeolocation` name unchanged, so this rename is non-breaking.
export class WcsGeolocation extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...GeolocationCore.wcBindable,
    properties: [
      ...GeolocationCore.wcBindable.properties,
      { name: "trigger", event: "wcs-geo:trigger-changed" },
    ],
    // Shell-level settable surface. Each input carries its mirrored `attribute`
    // hint (boolean flags reflect idempotently, so a binding system that writes
    // through inputs[].attribute is safe), following the <wcs-ws> convention.
    // `trigger` has no attribute — it is a momentary command-property, not a
    // declarative attribute. The `getCurrentPosition` / `watchPosition` /
    // `clearWatch` commands are declared below.
    inputs: [
      { name: "highAccuracy", attribute: "high-accuracy" },
      { name: "timeout", attribute: "timeout" },
      { name: "maximumAge", attribute: "maximum-age" },
      { name: "watch", attribute: "watch" },
      { name: "manual", attribute: "manual" },
      { name: "trigger" },
    ],
    // The Core's `watch` command is renamed to `watchPosition` on the Shell so it
    // does not collide with the `watch` boolean attribute accessor (same pattern
    // as <wcs-ws>, where the `send` command becomes `sendMessage` to free the
    // `send` setter). `getCurrentPosition` / `clearWatch` are unchanged.
    commands: [
      { name: "getCurrentPosition", async: true },
      { name: "watchPosition" },
      { name: "clearWatch" },
    ],
  };

  private _core: GeolocationCore;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new GeolocationCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-geo:watching-changed": (d) => ({ watching: d === true }),
      "wcs-geo:loading-changed": (d) => ({ loading: d === true }),
      "wcs-geo:error": (d) => ({ error: d != null }),
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
    // never-throw (docs/custom-state-reflection-design.md §3.4): attachInternals
    // is absent in happy-dom / older environments, and pre-125 Chromium rejects
    // non-dashed state names from states.add() (probed and discarded here).
    // Either case silently disables reflection — the component still works, it
    // just doesn't expose :state() selectors.
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

  get highAccuracy(): boolean {
    return this.hasAttribute("high-accuracy");
  }

  set highAccuracy(value: boolean) {
    if (value) {
      this.setAttribute("high-accuracy", "");
    } else {
      this.removeAttribute("high-accuracy");
    }
  }

  get timeout(): number {
    const attr = this.getAttribute("timeout");
    if (attr === null || attr.trim() === "") return Infinity;
    // Strict parse via Number() (unlike parseInt, "10px" -> NaN, not 10). Fall
    // back to the API default (Infinity = no timeout) for any non-finite or
    // negative value, matching the README "invalid values fall back to default".
    const parsed = Number(attr);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : Infinity;
  }

  set timeout(value: number) {
    this.setAttribute("timeout", String(value));
  }

  get maximumAge(): number {
    const attr = this.getAttribute("maximum-age");
    if (attr === null || attr.trim() === "") return 0;
    // Strict parse via Number() (unlike parseInt, "10px" -> NaN, not 10). Fall
    // back to the API default (0 = never use a cached fix) for any non-finite or
    // negative value, matching the README "invalid values fall back to default".
    const parsed = Number(attr);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  set maximumAge(value: number) {
    this.setAttribute("maximum-age", String(value));
  }

  get watch(): boolean {
    return this.hasAttribute("watch");
  }

  set watch(value: boolean) {
    if (value) {
      this.setAttribute("watch", "");
    } else {
      this.removeAttribute("watch");
    }
  }

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean) {
    if (value) {
      this.setAttribute("manual", "");
    } else {
      this.removeAttribute("manual");
    }
  }

  // --- Core delegated getters ---

  get position(): WcsGeoPositionDetail | null {
    return this._core.position;
  }

  get latitude(): number | null {
    return this._core.latitude;
  }

  get longitude(): number | null {
    return this._core.longitude;
  }

  get accuracy(): number | null {
    return this._core.accuracy;
  }

  get coords(): WcsGeoCoords | null {
    return this._core.coords;
  }

  get timestamp(): number | null {
    return this._core.timestamp;
  }

  get watching(): boolean {
    return this._core.watching;
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get error(): WcsGeoErrorDetail | null {
    return this._core.error;
  }

  get permission(): GeoPermissionState {
    return this._core.permission;
  }

  // wc-bindable connectedCallbackPromise protocol: resolves once the connect-time
  // acquisition settles, so SSR (@wcstack/server render.ts) waits for the first
  // fix before snapshotting the HTML. Mirrors Fetch.connectedCallbackPromise. In
  // `watch` / `manual` modes there is no one-shot connect-time fix to await, so it
  // stays the default resolved promise.
  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Command property ---

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    // Momentary command-property: a false→true write requests a single fix.
    // Mirrors the trigger flag on <wcs-timer> / <wcs-ws>. Prefer the
    // command-token protocol (`command.getCurrentPosition: $command.locate`) for
    // state-driven acquisition; this exists mainly for the DOM click trigger and
    // simple boolean bindings.
    const v = !!value;
    if (v) {
      this._trigger = true;
      // Fire-and-forget: getCurrentPosition() never rejects (failures surface via
      // the `error` property), so the returned promise is intentionally dropped.
      void this.getCurrentPosition();
      this._trigger = false;
      this.dispatchEvent(new CustomEvent("wcs-geo:trigger-changed", {
        detail: false,
        bubbles: true,
      }));
    }
  }

  // --- Commands ---

  getCurrentPosition(): Promise<void> {
    return this._core.getCurrentPosition(this._options());
  }

  watchPosition(): void {
    this._core.watch(this._options());
  }

  clearWatch(): void {
    this._core.clearWatch();
  }

  // --- Internal ---

  private _options(): GeoOptions {
    return {
      enableHighAccuracy: this.highAccuracy,
      timeout: this.timeout,
      maximumAge: this.maximumAge,
    };
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    // Revive permission tracking after a reconnect (reparenting). No-op on the
    // first connect since the constructor already subscribed; only re-subscribes
    // when disconnectedCallback's dispose() tore the subscription down.
    this._core.reinitPermission();
    if (!this.manual) {
      // `watch` attribute selects the default phase: continuous monitoring vs a
      // single fix on connect.
      if (this.watch) {
        this.watchPosition();
      } else {
        // Track only the one-shot connect-time fix so SSR can await it. watch /
        // manual leave the promise at its resolved default. getCurrentPosition()
        // never rejects (failures surface via `error`), so no .catch() is needed.
        this._connectedCallbackPromise = this.getCurrentPosition();
      }
    }
  }

  disconnectedCallback(): void {
    this._core.clearWatch();
    this._core.dispose();
  }
}
