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

  constructor() {
    super();
    this._core = new ClipboardCore(this);
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
    // Revive permission tracking after a reconnect (reparenting). No-op on the
    // first connect since the constructor already subscribed; only re-subscribes
    // when disconnectedCallback's dispose() tore the subscription down.
    this._core.reinitPermission();
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
