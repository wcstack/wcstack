import { config } from "../config.js";
import {
  IWcBindable, ClipboardPermissionState,
  WcsClipboardReadItem, WcsClipboardErrorDetail,
} from "../types.js";
import { ClipboardCore } from "../core/ClipboardCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

// Named WcsClipboard (not `Clipboard`) so the class does not shadow the global
// DOM `Clipboard` interface (the type of `navigator.clipboard`), matching the
// <wcs-geo> WcsGeolocation / <wcs-ws> WcsWebSocket convention.
export class WcsClipboard extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...ClipboardCore.wcBindable,
    // Shell-level settable surface. `monitor` mirrors its boolean attribute
    // (reflects idempotently), following the <wcs-ws> / <wcs-geo> convention.
    // There is no momentary `trigger` property: writes need an argument (the
    // text/items), so element actions are driven via command-token
    // (`command.writeText: $command.copy`) or the DOM autoTrigger, not a
    // false→true boolean pulse.
    inputs: [
      { name: "monitor", attribute: "monitor" },
    ],
    // Commands are identical to the Core's — no rename is needed because the
    // `monitor` boolean attribute accessor does not collide with the
    // `startMonitor` / `stopMonitor` command names (unlike <wcs-geo>, whose
    // `watch` attribute forced the Core's `watch` command to `watchPosition`).
    commands: ClipboardCore.wcBindable.commands,
  };

  private _core: ClipboardCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new ClipboardCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-clipboard:loading-changed":    (d) => ({ loading: d === true }),
      "wcs-clipboard:monitoring-changed": (d) => ({ monitoring: d === true }),
      "wcs-clipboard:error":              (d) => ({ error: d != null }),
    });
  }

  // SSR (§4.4): the state binder awaits this before snapshotting, so the first
  // permission probe has settled. Backed by _core.observe() (see connectedCallback).
  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
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

  get monitor(): boolean {
    return this.hasAttribute("monitor");
  }

  /**
   * Reflects the `monitor` boolean attribute only — it does NOT start or stop
   * monitoring by itself. The attribute is read at connect time (see
   * connectedCallback); toggling `el.monitor` after connect just flips the
   * attribute. To start/stop monitoring imperatively, call `startMonitor()` /
   * `stopMonitor()`.
   */
  set monitor(value: boolean) {
    if (value) {
      this.setAttribute("monitor", "");
    } else {
      this.removeAttribute("monitor");
    }
  }

  // --- Core delegated getters ---

  get text(): string | null {
    return this._core.text;
  }

  get items(): WcsClipboardReadItem[] | null {
    return this._core.items;
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get error(): WcsClipboardErrorDetail | null {
    return this._core.error;
  }

  get readPermission(): ClipboardPermissionState {
    return this._core.readPermission;
  }

  get writePermission(): ClipboardPermissionState {
    return this._core.writePermission;
  }

  get monitoring(): boolean {
    return this._core.monitoring;
  }

  get copied(): string | null {
    return this._core.copied;
  }

  get cut(): string | null {
    return this._core.cut;
  }

  get pasted(): string | null {
    return this._core.pasted;
  }

  // --- Commands ---

  writeText(text: string): Promise<void> {
    return this._core.writeText(text);
  }

  write(items: ClipboardItem[]): Promise<void> {
    return this._core.write(items);
  }

  readText(): Promise<void> {
    return this._core.readText();
  }

  read(): Promise<void> {
    return this._core.read();
  }

  startMonitor(): void {
    this._core.startMonitor();
  }

  stopMonitor(): void {
    this._core.stopMonitor();
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    // observe() revives permission tracking after a reconnect (reparenting) —
    // a no-op on the first connect since the constructor already subscribed — and
    // returns the readiness promise exposed as connectedCallbackPromise (§4.4).
    this._connectedCallbackPromise = this._core.observe();
    // Unlike <wcs-geo>, there is no connect-time acquisition: reads require a
    // user gesture, so the only connect-time action is optional monitoring.
    if (this.monitor) {
      this._core.startMonitor();
    }
  }

  disconnectedCallback(): void {
    this._core.stopMonitor();
    this._core.dispose();
  }
}
