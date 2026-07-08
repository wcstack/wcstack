import { config } from "../config.js";
import { IWcBindable } from "../types.js";
import { WebSocketCore } from "../core/WebSocketCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

export class WcsWebSocket extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...WebSocketCore.wcBindable,
    properties: [
      ...WebSocketCore.wcBindable.properties,
      { name: "trigger", event: "wcs-ws:trigger-changed" },
      { name: "send", event: "wcs-ws:send-changed" },
    ],
    inputs: [
      { name: "url", attribute: "url" },
      { name: "protocols", attribute: "protocols" },
      { name: "autoReconnect", attribute: "auto-reconnect" },
      { name: "reconnectInterval", attribute: "reconnect-interval" },
      { name: "maxReconnects", attribute: "max-reconnects" },
      { name: "binaryType", attribute: "binary-type" },
      { name: "manual", attribute: "manual" },
      { name: "trigger" },
      { name: "send" },
    ],
    commands: [
      { name: "connect" },
      { name: "sendMessage" },
      { name: "close" },
    ],
  };
  static get observedAttributes(): string[] { return ["url"]; }

  private _core: WebSocketCore;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new WebSocketCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-ws:connected-changed": (d) => ({ connected: d === true }),
      "wcs-ws:loading-changed":   (d) => ({ loading: d === true }),
      "wcs-ws:error":             (d) => ({ error: d != null }),
    });
  }

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

  get url(): string {
    return this.getAttribute("url") || "";
  }

  set url(value: string) {
    this.setAttribute("url", value);
  }

  get protocols(): string {
    return this.getAttribute("protocols") || "";
  }

  set protocols(value: string) {
    this.setAttribute("protocols", value);
  }

  get autoReconnect(): boolean {
    return this.hasAttribute("auto-reconnect");
  }

  set autoReconnect(value: boolean) {
    if (value) {
      this.setAttribute("auto-reconnect", "");
    } else {
      this.removeAttribute("auto-reconnect");
    }
  }

  get reconnectInterval(): number {
    const attr = this.getAttribute("reconnect-interval");
    const parsed = attr ? parseInt(attr, 10) : 3000;
    return Number.isNaN(parsed) ? 3000 : parsed;
  }

  set reconnectInterval(value: number) {
    this.setAttribute("reconnect-interval", String(value));
  }

  get maxReconnects(): number {
    const attr = this.getAttribute("max-reconnects");
    const parsed = attr ? parseInt(attr, 10) : Infinity;
    return Number.isNaN(parsed) ? Infinity : parsed;
  }

  set maxReconnects(value: number) {
    this.setAttribute("max-reconnects", String(value));
  }

  // Incoming binary frame representation. Backed by the `binary-type` attribute;
  // any value other than "arraybuffer" normalizes to the platform default "blob".
  get binaryType(): BinaryType {
    return this.getAttribute("binary-type") === "arraybuffer" ? "arraybuffer" : "blob";
  }

  set binaryType(value: string | null) {
    if (value == null) {
      this.removeAttribute("binary-type");
    } else {
      this.setAttribute("binary-type", value);
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

  get message(): any {
    return this._core.message;
  }

  get connected(): boolean {
    return this._core.connected;
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get error(): any {
    return this._core.error;
  }

  get readyState(): number {
    return this._core.readyState;
  }

  // --- Command properties ---

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    const v = !!value;
    if (v) {
      this._trigger = true;
      this.connect();
      this._trigger = false;
      this.dispatchEvent(new CustomEvent("wcs-ws:trigger-changed", {
        detail: false,
        bubbles: true,
      }));
    }
  }

  // `send` is a write-only command surface: assigning transmits immediately.
  // Reading always returns null (no payload is retained) — consistent with the
  // null carried by wcs-ws:send-changed and the documented "resets to null".
  get send(): any {
    return null;
  }

  set send(data: any) {
    if (data === null || data === undefined) return;
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    this._core.send(payload);
    this.dispatchEvent(new CustomEvent("wcs-ws:send-changed", {
      detail: null,
      bubbles: true,
    }));
  }

  // --- Public methods ---

  connect(): void {
    const protocols = this.protocols
      ? this.protocols.split(",").map(p => p.trim()).filter(Boolean)
      : undefined;

    this._core.connect(this.url, {
      protocols: protocols && protocols.length === 1 ? protocols[0] : protocols,
      autoReconnect: this.autoReconnect,
      reconnectInterval: this.reconnectInterval,
      maxReconnects: this.maxReconnects,
      binaryType: this.binaryType,
    });
  }

  sendMessage(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this._core.send(data);
  }

  close(code?: number, reason?: string): void {
    this._core.close(code, reason);
  }

  // --- Lifecycle ---

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (name === "url" && this.isConnected && !this.manual && newValue) {
      this.connect();
    }
  }

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    // observe() は command-driven node では ready を返す no-op（§3.5）。SSR は
    // connectedCallbackPromise を await して初期スナップショットを取れる。
    this._connectedCallbackPromise = this._core.observe();
    if (!this.manual && this.url) {
      this.connect();
    }
  }

  disconnectedCallback(): void {
    // dispose() が _gen を bump して進行中のソケット/再接続を無効化し、close() する。
    this._core.dispose();
  }
}
