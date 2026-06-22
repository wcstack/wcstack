import { config } from "../config.js";
import { IWcBindable, WcsBroadcastErrorDetail } from "../types.js";
import { BroadcastCore } from "../core/BroadcastCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

// Named WcsBroadcast (not `Broadcast`) to match the <wcs-clipboard> WcsClipboard
// / <wcs-ws> WcsWebSocket convention and avoid shadowing any global.
export class WcsBroadcast extends HTMLElement {
  // SSR (§4.4): the channel opens synchronously in connectedCallback, so the
  // Core's observe() resolves immediately; we still expose connectedCallbackPromise
  // so a state binder can uniformly await readiness before snapshotting.
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...BroadcastCore.wcBindable,
    // Shell-level settable surface. `name` selects the channel; `manual`
    // suppresses auto-open on connect. There is no momentary `post` property:
    // posting needs an argument (the payload), so element actions run via
    // command-token (`command.post: $command.ping`) or the DOM autoTrigger, not
    // a value-derived setter — keeping `post` a plain command keeps the
    // command-token wiring (`command.post:`) readable.
    inputs: [
      { name: "name", attribute: "name" },
      { name: "manual", attribute: "manual" },
    ],
    // Commands are identical to the Core's — no rename needed since the `name` /
    // `manual` attribute accessors do not collide with open/post/close.
    commands: BroadcastCore.wcBindable.commands,
  };
  static get observedAttributes(): string[] { return ["name"]; }

  private _core: BroadcastCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new BroadcastCore(this);
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Attribute accessors ---

  get name(): string {
    return this.getAttribute("name") || "";
  }

  set name(value: string) {
    this.setAttribute("name", value);
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

  get message(): any {
    return this._core.message;
  }

  get error(): WcsBroadcastErrorDetail | null {
    return this._core.error;
  }

  // --- Commands ---

  open(): void {
    if (this.name) {
      this._core.open(this.name);
    }
  }

  post(data: any): void {
    this._core.post(data);
  }

  close(): void {
    this._core.close();
  }

  // --- Lifecycle ---

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (name === "name" && this.isConnected && !this.manual && newValue) {
      this._core.open(newValue);
    }
  }

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    if (!this.manual && this.name) {
      this._core.open(this.name);
    }
    // SSR (§4.4): expose the Core's readiness as connectedCallbackPromise. The
    // channel opens synchronously above, so observe() resolves immediately.
    this._connectedCallbackPromise = this._core.observe();
  }

  disconnectedCallback(): void {
    // Deliberately does NOT call unregisterAutoTrigger(). The autoTrigger click
    // listener is a single process-wide document listener (registerAutoTrigger
    // is idempotent), shared by every <wcs-broadcast> on the page — not owned by
    // this element. Tearing it down when the last element disconnects would
    // break a later-inserted trigger, so it is intentionally left installed for
    // the document's lifetime (one passive listener, negligible cost). This
    // mirrors <wcs-clipboard>, which registers but never unregisters either.
    // unregisterAutoTrigger stays exported purely as a symmetric teardown hook
    // for tests / advanced manual control; the production lifecycle never calls
    // it.
    this._core.dispose();
  }
}
