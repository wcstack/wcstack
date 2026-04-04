import { config } from "../config.js";
import { IWcBindable } from "../types.js";
import { AuthCore } from "../core/AuthCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

export class Auth extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...AuthCore.wcBindable,
    properties: [
      ...AuthCore.wcBindable.properties,
      { name: "trigger", event: "wcs-auth:trigger-changed" },
    ],
  };
  static get observedAttributes(): string[] {
    return ["domain", "client-id", "redirect-uri", "audience", "scope"];
  }

  private _core: AuthCore;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new AuthCore(this);
  }

  // --- Input attributes ---

  get domain(): string {
    return this.getAttribute("domain") || "";
  }

  set domain(value: string) {
    this.setAttribute("domain", value);
  }

  get clientId(): string {
    return this.getAttribute("client-id") || "";
  }

  set clientId(value: string) {
    this.setAttribute("client-id", value);
  }

  get redirectUri(): string {
    return this.getAttribute("redirect-uri") || "";
  }

  set redirectUri(value: string) {
    this.setAttribute("redirect-uri", value);
  }

  get audience(): string {
    return this.getAttribute("audience") || "";
  }

  set audience(value: string) {
    this.setAttribute("audience", value);
  }

  get scope(): string {
    return this.getAttribute("scope") || "openid profile email";
  }

  set scope(value: string) {
    this.setAttribute("scope", value);
  }

  get cacheLocation(): "memory" | "localstorage" {
    const value = this.getAttribute("cache-location");
    return value === "localstorage" ? "localstorage" : "memory";
  }

  set cacheLocation(value: "memory" | "localstorage") {
    this.setAttribute("cache-location", value);
  }

  get useRefreshTokens(): boolean {
    return this.hasAttribute("use-refresh-tokens");
  }

  set useRefreshTokens(value: boolean) {
    if (value) {
      this.setAttribute("use-refresh-tokens", "");
    } else {
      this.removeAttribute("use-refresh-tokens");
    }
  }

  get popup(): boolean {
    return this.hasAttribute("popup");
  }

  set popup(value: boolean) {
    if (value) {
      this.setAttribute("popup", "");
    } else {
      this.removeAttribute("popup");
    }
  }

  // --- Output state (delegated to core) ---

  get authenticated(): boolean {
    return this._core.authenticated;
  }

  get user(): any {
    return this._core.user;
  }

  get token(): string | null {
    return this._core.token;
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get error(): any {
    return this._core.error;
  }

  get client(): any {
    return this._core.client;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Trigger (one-way command) ---

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    const v = !!value;
    if (v) {
      this._trigger = true;
      this._connectedCallbackPromise.then(() => this.login()).finally(() => {
        this._trigger = false;
        this.dispatchEvent(new CustomEvent("wcs-auth:trigger-changed", {
          detail: false,
          bubbles: true,
        }));
      });
    }
  }

  // --- Methods ---

  private _buildClientOptions() {
    const authorizationParams: Record<string, any> = {
      scope: this.scope,
    };
    if (this.redirectUri) {
      authorizationParams.redirect_uri = this.redirectUri;
    }
    if (this.audience) {
      authorizationParams.audience = this.audience;
    }

    return {
      domain: this.domain,
      clientId: this.clientId,
      authorizationParams,
      cacheLocation: this.cacheLocation,
      useRefreshTokens: this.useRefreshTokens,
    };
  }

  async initialize(): Promise<void> {
    return this._core.initialize(this._buildClientOptions());
  }

  async login(options?: Record<string, any>): Promise<void> {
    await this._connectedCallbackPromise;
    if (this.popup) {
      return this._core.loginWithPopup(options);
    }
    return this._core.login(options);
  }

  async logout(options?: Record<string, any>): Promise<void> {
    await this._connectedCallbackPromise;
    return this._core.logout(options);
  }

  async getToken(options?: Record<string, any>): Promise<string | null> {
    await this._connectedCallbackPromise;
    return this._core.getToken(options);
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    if (!this._core.client && this.domain && this.clientId) {
      this._connectedCallbackPromise = this.initialize();
    }
  }

  attributeChangedCallback(_name: string, _oldValue: string | null, _newValue: string | null): void {
    // domain/client-id変更時の再初期化はしない（初期化は1回のみ）
  }

  disconnectedCallback(): void {
    // クリーンアップ不要（Auth0クライアントはシングルトン的に使う）
  }
}
