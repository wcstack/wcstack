import { config } from "../config.js";
import { IWcBindable, AiMessage } from "../types.js";
import { AiCore } from "../core/AiCore.js";
import { AiMessage as AiMessageElement } from "./AiMessage.js";
import { registerAutoTrigger } from "../autoTrigger.js";

export class Ai extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...AiCore.wcBindable,
    properties: [
      ...AiCore.wcBindable.properties,
      { name: "trigger", event: "wcs-ai:trigger-changed" },
    ],
  };
  static get observedAttributes(): string[] {
    return ["provider"];
  }

  private _core: AiCore;
  private _trigger: boolean = false;
  private _prompt: string = "";

  constructor() {
    super();
    this._core = new AiCore(this);
  }

  // --- Input attributes ---

  get provider(): string {
    return this.getAttribute("provider") || "";
  }

  set provider(value: string) {
    this.setAttribute("provider", value);
  }

  get model(): string {
    return this.getAttribute("model") || "";
  }

  set model(value: string) {
    this.setAttribute("model", value);
  }

  get baseUrl(): string {
    return this.getAttribute("base-url") || "";
  }

  set baseUrl(value: string) {
    this.setAttribute("base-url", value);
  }

  get apiKey(): string {
    return this.getAttribute("api-key") || "";
  }

  set apiKey(value: string) {
    this.setAttribute("api-key", value);
  }

  get system(): string {
    return this.getAttribute("system") || "";
  }

  set system(value: string) {
    this.setAttribute("system", value);
  }

  get stream(): boolean {
    return !this.hasAttribute("no-stream");
  }

  set stream(value: boolean) {
    if (value) {
      this.removeAttribute("no-stream");
    } else {
      this.setAttribute("no-stream", "");
    }
  }

  get apiVersion(): string {
    return this.getAttribute("api-version") || "";
  }

  set apiVersion(value: string) {
    this.setAttribute("api-version", value);
  }

  // --- JS-only properties ---

  get prompt(): string { return this._prompt; }
  set prompt(value: string) { this._prompt = value; }

  get temperature(): number | undefined {
    const v = this.getAttribute("temperature");
    return v !== null ? Number(v) : undefined;
  }

  set temperature(value: number | undefined) {
    if (value !== undefined) {
      this.setAttribute("temperature", String(value));
    } else {
      this.removeAttribute("temperature");
    }
  }

  get maxTokens(): number | undefined {
    const v = this.getAttribute("max-tokens");
    return v !== null ? Number(v) : undefined;
  }

  set maxTokens(value: number | undefined) {
    if (value !== undefined) {
      this.setAttribute("max-tokens", String(value));
    } else {
      this.removeAttribute("max-tokens");
    }
  }

  // --- Output state (delegated to core) ---

  get content(): string { return this._core.content; }
  get loading(): boolean { return this._core.loading; }
  get streaming(): boolean { return this._core.streaming; }
  get error(): any { return this._core.error; }
  get usage(): any { return this._core.usage; }

  get messages(): AiMessage[] { return this._core.messages; }
  set messages(value: AiMessage[]) { this._core.messages = value; }

  // --- Trigger ---

  get trigger(): boolean { return this._trigger; }

  set trigger(value: boolean) {
    const v = !!value;
    if (v) {
      this._trigger = true;
      this.send().finally(() => {
        this._trigger = false;
        this.dispatchEvent(new CustomEvent("wcs-ai:trigger-changed", {
          detail: false,
          bubbles: true,
        }));
      });
    }
  }

  // --- Methods ---

  private _collectSystem(): string {
    // system属性が優先
    if (this.system) return this.system;
    // 子要素から収集
    const msgEl = this.querySelector<AiMessageElement>(config.tagNames.aiMessage);
    if (msgEl && msgEl.role === "system") {
      return msgEl.messageContent;
    }
    return "";
  }

  async send(): Promise<string | null> {
    return this._core.send(this._prompt, {
      model: this.model,
      stream: this.stream,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      system: this._collectSystem(),
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      apiVersion: this.apiVersion,
    });
  }

  abort(): void {
    this._core.abort();
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (name === "provider" && newValue) {
      this._core.provider = newValue;
    }
  }

  disconnectedCallback(): void {
    this._core.abort();
  }
}
