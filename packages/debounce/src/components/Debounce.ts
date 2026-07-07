import { config } from "../config.js";
import { IWcBindable, DebounceOptions } from "../types.js";
import { DebounceCore } from "../core/DebounceCore.js";
import { makeDebounceProperties } from "../wcBindableFactory.js";
import { registerAutoTrigger } from "../autoTrigger.js";

const DEFAULT_WAIT = 250;

/**
 * `<wcs-debounce>` — declarative debounce. See {@link DebounceCore} for the
 * engine. The `eventPrefix` defaults to `"wcs-debounce"`; `<wcs-throttle>`
 * subclasses this with `"wcs-throttle"` and throttle defaults.
 */
export class Debounce extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  protected static eventPrefix = "wcs-debounce";
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: makeDebounceProperties("wcs-debounce"),
    // `source` is the value-surface input (its debounced echo comes back on the
    // `value` property). `trigger` / `cancel` / `flush` are commands from the
    // Core. No momentary boolean `trigger` property exists — the signal surface
    // is driven by the `trigger` command (command-token) or a DOM click
    // (autoTrigger), which sidesteps the attribute/method name clash that forced
    // <wcs-geo>'s watch → watchPosition rename.
    inputs: [
      { name: "source" },
      { name: "wait", attribute: "wait" },
      // No `attribute` hint on leading / trailing: their setters already reflect
      // to the backing attribute themselves (the fetch-Shell idiom), and — more
      // importantly — the backing attribute is NOT the input name. `trailing`
      // reflects to the inverted `no-trailing` (default true; a bare `trailing`
      // attribute can't express false), and the `<wcs-throttle>` subclass reads
      // `leading` from the inverted `no-leading` (default on). A single
      // input-name→attribute hint can't be correct for both polarities/subclasses,
      // so binders drive these through the property setter instead.
      { name: "leading" },
      { name: "trailing" },
      { name: "maxWait", attribute: "max-wait" },
    ],
    commands: [
      { name: "trigger" },
      { name: "cancel" },
      { name: "flush" },
    ],
  };

  protected _core: DebounceCore;
  private _source: any = undefined;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new DebounceCore((this.constructor as typeof Debounce).eventPrefix, this);
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Attribute accessors ---

  get wait(): number {
    const attr = this.getAttribute("wait");
    if (attr === null || attr.trim() === "") return this._defaultWait();
    // Strict parse via Number() ("100px" -> NaN, not 100). Fall back to the
    // default for any non-finite or negative value.
    const parsed = Number(attr);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : this._defaultWait();
  }

  set wait(value: number) {
    this.setAttribute("wait", String(value));
  }

  get leading(): boolean {
    return this.hasAttribute("leading");
  }

  set leading(value: boolean) {
    if (value) {
      this.setAttribute("leading", "");
    } else {
      this.removeAttribute("leading");
    }
  }

  // `trailing` defaults to true; the boolean `no-trailing` attribute opts out (a
  // bare `trailing` attribute can't express "false", so the negative flag carries
  // the override).
  get trailing(): boolean {
    return !this.hasAttribute("no-trailing");
  }

  set trailing(value: boolean) {
    if (value) {
      this.removeAttribute("no-trailing");
    } else {
      this.setAttribute("no-trailing", "");
    }
  }

  get maxWait(): number | undefined {
    const attr = this.getAttribute("max-wait");
    if (attr === null || attr.trim() === "") return this._defaultMaxWait();
    const parsed = Number(attr);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : this._defaultMaxWait();
  }

  set maxWait(value: number) {
    this.setAttribute("max-wait", String(value));
  }

  // --- Value-surface input ---

  get source(): any {
    return this._source;
  }

  set source(value: any) {
    this._source = value;
    this._core.configure(this._options());
    this._core.setSource(value);
  }

  // --- Core delegated getters ---

  get value(): any {
    return this._core.value;
  }

  get fired(): any[] {
    return this._core.fired;
  }

  get pending(): boolean {
    return this._core.pending;
  }

  // --- Commands ---

  trigger(...args: any[]): void {
    this._core.configure(this._options());
    this._core.trigger(...args);
  }

  cancel(): void {
    this._core.cancel();
  }

  flush(): void {
    this._core.flush();
  }

  // --- Internal ---

  // Overridden by <wcs-throttle> to bias the defaults toward throttle (leading
  // on, maxWait pinned to wait).
  protected _defaultWait(): number {
    return DEFAULT_WAIT;
  }

  // Resolves the effective `leading` value (not a static default). It is a method
  // rather than reading `this.leading` directly because <wcs-throttle> inverts the
  // default (on, opt out via `no-leading`) while sharing the inherited `leading`
  // attribute setter — overriding the getter alone would desync getter and setter.
  protected _resolveLeading(): boolean {
    return this.leading;
  }

  protected _defaultMaxWait(): number | undefined {
    return undefined;
  }

  protected _options(): DebounceOptions {
    return {
      wait: this.wait,
      leading: this._resolveLeading(),
      trailing: this.trailing,
      maxWait: this.maxWait,
    };
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    // §4.1/§4.4 Shell SSR: expose connectedCallbackPromise backed by observe().
    // observe() is a no-op resolving once ready (the engine is command-driven).
    this._connectedCallbackPromise = this._core.observe();
  }

  disconnectedCallback(): void {
    // Drop any in-flight timer so a detached element leaks nothing, and bump the
    // Core generation so a surviving timer callback cannot settle (§3.5).
    this._core.dispose();
  }
}
