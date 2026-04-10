import { config } from "../config.js";
import { IWcBindable, StorageType } from "../types.js";
import { StorageCore } from "../core/StorageCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

export class Storage extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...StorageCore.wcBindable,
    properties: [
      ...StorageCore.wcBindable.properties,
      { name: "trigger", event: "wcs-storage:trigger-changed" },
    ],
  };
  static get observedAttributes(): string[] { return ["key", "type"]; }

  private _core: StorageCore;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new StorageCore(this);
  }

  get key(): string {
    return this.getAttribute("key") || "";
  }

  set key(value: string) {
    this.setAttribute("key", value);
  }

  get type(): StorageType {
    return (this.getAttribute("type") as StorageType) || "local";
  }

  set type(value: StorageType) {
    this.setAttribute("type", value);
  }

  get value(): any {
    return this._core.value;
  }

  set value(v: any) {
    if (!this.manual) {
      this._core.key = this.key;
      this._core.type = this.type;
      this._core.save(v);
    }
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get error(): any {
    return this._core.error;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
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

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    const v = !!value;
    if (v) {
      this._trigger = true;
      this.save();
      this._trigger = false;
      this.dispatchEvent(new CustomEvent("wcs-storage:trigger-changed", {
        detail: false,
        bubbles: true,
      }));
    }
  }

  load(): any {
    this._core.key = this.key;
    this._core.type = this.type;
    return this._core.load();
  }

  save(): void {
    this._core.key = this.key;
    this._core.type = this.type;
    this._core.save(this._core.value);
  }

  remove(): void {
    this._core.key = this.key;
    this._core.type = this.type;
    this._core.remove();
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (!this.isConnected) return;
    if (name === "key" && newValue && !this.manual) {
      this.load();
    }
    if (name === "type") {
      this._core.type = (newValue as StorageType) || "local";
    }
  }

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    if (!this.manual && this.key) {
      this.load();
    }
    this._core.startSync();
    this._connectedCallbackPromise = Promise.resolve();
  }

  disconnectedCallback(): void {
    this._core.stopSync();
  }
}
