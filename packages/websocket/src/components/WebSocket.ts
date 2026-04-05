import { config } from "../config.js";
import { IWcBindable } from "../types.js";
import { WebSocketCore } from "../core/WebSocketCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

export class WcsWebSocket extends HTMLElement {
  static hasConnectedCallbackPromise = false;
  static wcBindable: IWcBindable = {
    ...WebSocketCore.wcBindable,
    properties: [
      ...WebSocketCore.wcBindable.properties,
      { name: "trigger", event: "wcs-ws:trigger-changed" },
      { name: "send", event: "wcs-ws:send-changed" },
    ],
  };
  static get observedAttributes(): string[] { return ["url"]; }

  private _core: WebSocketCore;
  private _trigger: boolean = false;

  constructor() {
    super();
    this._core = new WebSocketCore(this);
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
    return attr ? parseInt(attr, 10) : 3000;
  }

  set reconnectInterval(value: number) {
    this.setAttribute("reconnect-interval", String(value));
  }

  get maxReconnects(): number {
    const attr = this.getAttribute("max-reconnects");
    return attr ? parseInt(attr, 10) : Infinity;
  }

  set maxReconnects(value: number) {
    this.setAttribute("max-reconnects", String(value));
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
    if (!this.manual && this.url) {
      this.connect();
    }
  }

  disconnectedCallback(): void {
    this._core.close();
  }
}
