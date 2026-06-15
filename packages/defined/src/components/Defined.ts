import { DefinedMode, IWcBindable } from "../types.js";
import { DefinedCore } from "../core/DefinedCore.js";

// Named WcsDefined (not `Defined`) to match the <wcs-permission> / <wcs-geo>
// convention (WcsPermission / WcsGeolocation) and avoid shadowing any global.
export class WcsDefined extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...DefinedCore.wcBindable,
    // Shell-level settable surface: what to watch and how. All three reflect
    // idempotently as plain attributes, so a binding system writing through
    // inputs[].attribute is safe.
    inputs: [
      { name: "tags", attribute: "tags" },
      { name: "mode", attribute: "mode" },
      { name: "timeout", attribute: "timeout" },
    ],
    // No commands: read-only monitor (see DefinedCore). whenDefined cannot be
    // triggered imperatively — it only observes.
    commands: [],
  };

  // Created with no tags so the delegated getters work before connect (returning
  // the defaults: defined=false, empty arrays, count/total 0). The actual watch is
  // driven from connectedCallback once the element's attributes resolve
  // (programmatically-created elements have no attributes at construction time).
  private _core: DefinedCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new DefinedCore(undefined, "all", 0, this);
  }

  // --- Attribute accessors ---

  get tags(): string {
    return this.getAttribute("tags") ?? "";
  }

  // `tags` / `mode` setters pass the value straight to setAttribute: their value
  // type is already `string` / `DefinedMode`, and the matching getter normalizes on
  // read (mode: anything but "any" → "all"; tags: parsed/trimmed in _parseTags).
  // Only `timeout` setter coerces (String(value)) because its value type is number,
  // which setAttribute would otherwise stringify implicitly anyway — the explicit
  // String() just makes the number→attribute boundary obvious.
  set tags(value: string) {
    this.setAttribute("tags", value);
  }

  get mode(): DefinedMode {
    return this.getAttribute("mode") === "any" ? "any" : "all";
  }

  set mode(value: DefinedMode) {
    this.setAttribute("mode", value);
  }

  get timeout(): number {
    // Normalize to a non-negative finite count of ms. `Number("abc")` → NaN and a
    // negative value both collapse to 0 (= "wait forever"), so a malformed or
    // negative `timeout` attribute can never silently become an infinite wait via
    // an unexpected path; 0 is the documented no-limit sentinel.
    const ms = Number(this.getAttribute("timeout"));
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  set timeout(value: number) {
    this.setAttribute("timeout", String(value));
  }

  // --- Core delegated getters ---

  get defined(): boolean {
    return this._core.defined;
  }

  get pending(): string[] {
    return this._core.pending;
  }

  get missing(): string[] {
    return this._core.missing;
  }

  get count(): number {
    return this._core.count;
  }

  get total(): number {
    return this._core.total;
  }

  get error(): string | null {
    return this._core.error;
  }

  // wc-bindable connectedCallbackPromise protocol: resolves once the connect-time
  // watch settles, so SSR (@wcstack/server render.ts) waits for readiness before
  // snapshotting the HTML. Mirrors WcsPermission.connectedCallbackPromise.
  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Internal ---

  // Parse the comma-separated `tags` attribute into trimmed, non-empty tag names.
  private _parseTags(): string[] {
    return this.tags.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    // Begin the watch (or revive it after a reconnect). The returned promise is
    // held as connectedCallbackPromise for SSR. whenDefined failures surface as
    // `missing` / `error` state — never as a throw — so no .catch() is needed.
    this._connectedCallbackPromise = this._core.observe(this._parseTags(), this.mode, this.timeout);
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }
}
