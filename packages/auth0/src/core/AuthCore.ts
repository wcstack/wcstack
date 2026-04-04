import { raiseError } from "../raiseError.js";
import { IWcBindable, Auth0ClientOptions, WcsAuthUser } from "../types.js";

/**
 * Headless authentication core based on Auth0 SPA SDK.
 * Requires browser globals (location, history) for redirect callback handling.
 */
export class AuthCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "authenticated", event: "wcs-auth:authenticated-changed" },
      { name: "user", event: "wcs-auth:user-changed" },
      { name: "token", event: "wcs-auth:token-changed" },
      { name: "loading", event: "wcs-auth:loading-changed" },
      { name: "error", event: "wcs-auth:error" },
    ],
  };

  private _target: EventTarget;
  private _client: any = null;
  private _authenticated: boolean = false;
  private _user: WcsAuthUser | null = null;
  private _token: string | null = null;
  private _loading: boolean = false;
  private _error: any = null;
  private _initPromise: Promise<void> | null = null;

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get authenticated(): boolean {
    return this._authenticated;
  }

  get user(): WcsAuthUser | null {
    return this._user;
  }

  get token(): string | null {
    return this._token;
  }

  get loading(): boolean {
    return this._loading;
  }

  get error(): any {
    return this._error;
  }

  get client(): any {
    return this._client;
  }

  get initPromise(): Promise<void> | null {
    return this._initPromise;
  }

  private _setLoading(loading: boolean): void {
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-auth:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-auth:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setAuthenticated(value: boolean): void {
    this._authenticated = value;
    this._target.dispatchEvent(new CustomEvent("wcs-auth:authenticated-changed", {
      detail: value,
      bubbles: true,
    }));
  }

  private _setUser(user: WcsAuthUser | null): void {
    this._user = user;
    this._target.dispatchEvent(new CustomEvent("wcs-auth:user-changed", {
      detail: user,
      bubbles: true,
    }));
  }

  private _setToken(token: string | null): void {
    this._token = token;
    this._target.dispatchEvent(new CustomEvent("wcs-auth:token-changed", {
      detail: token,
      bubbles: true,
    }));
  }

  /**
   * Initialize the Auth0 client and handle redirect callback if needed.
   */
  initialize(options: Auth0ClientOptions): Promise<void> {
    if (!options.domain) {
      raiseError("domain attribute is required.");
    }
    if (!options.clientId) {
      raiseError("client-id attribute is required.");
    }

    const p = this._doInitialize(options);
    this._initPromise = p;
    return p;
  }

  private async _doInitialize(options: Auth0ClientOptions): Promise<void> {
    this._setLoading(true);
    this._setError(null);

    try {
      const { createAuth0Client } = await import("@auth0/auth0-spa-js");
      this._client = await createAuth0Client({
        domain: options.domain,
        clientId: options.clientId,
        authorizationParams: options.authorizationParams,
        cacheLocation: options.cacheLocation,
        useRefreshTokens: options.useRefreshTokens,
      });

      // リダイレクトコールバックの処理
      const query = globalThis.location?.search || "";
      if (query.includes("code=") && query.includes("state=")) {
        await this._client.handleRedirectCallback();
        // URLからcode/stateパラメータのみ除去（他のパラメータは保持）
        const url = new URL(globalThis.location.href);
        url.searchParams.delete("code");
        url.searchParams.delete("state");
        globalThis.history.replaceState({}, document.title, url.toString());
      }

      await this._syncState();
      this._setLoading(false);
    } catch (e: any) {
      this._setError(e);
      this._setLoading(false);
    }
  }

  /**
   * Sync authentication state from the Auth0 client.
   */
  private async _syncState(): Promise<void> {
    const isAuthenticated = await this._client.isAuthenticated();
    this._setAuthenticated(isAuthenticated);

    if (isAuthenticated) {
      const user = await this._client.getUser();
      this._setUser(user ?? null);

      try {
        const token = await this._client.getTokenSilently();
        this._setToken(token ?? null);
      } catch (_e) {
        // トークン取得失敗は致命的ではない
        this._setToken(null);
      }
    } else {
      this._setUser(null);
      this._setToken(null);
    }
  }

  /**
   * Redirect to Auth0 login page.
   */
  async login(options?: Record<string, any>): Promise<void> {
    if (!this._client) {
      raiseError("Auth0 client is not initialized. Call initialize() first.");
    }

    this._setLoading(true);
    this._setError(null);

    try {
      await this._client.loginWithRedirect({
        authorizationParams: options,
      });
      // リダイレクト後はこの行に到達しない
    } catch (e: any) {
      this._setError(e);
      this._setLoading(false);
    }
  }

  /**
   * Login via popup window.
   */
  async loginWithPopup(options?: Record<string, any>): Promise<void> {
    if (!this._client) {
      raiseError("Auth0 client is not initialized. Call initialize() first.");
    }

    this._setLoading(true);
    this._setError(null);

    try {
      await this._client.loginWithPopup({
        authorizationParams: options,
      });
      await this._syncState();
      this._setLoading(false);
    } catch (e: any) {
      this._setError(e);
      this._setLoading(false);
    }
  }

  /**
   * Logout from Auth0.
   */
  async logout(options?: Record<string, any>): Promise<void> {
    if (!this._client) {
      raiseError("Auth0 client is not initialized. Call initialize() first.");
    }

    this._setError(null);

    try {
      await this._client.logout(options);
      this._setAuthenticated(false);
      this._setUser(null);
      this._setToken(null);
    } catch (e: any) {
      this._setError(e);
    }
  }

  /**
   * Get access token silently (from cache or via refresh).
   */
  async getToken(options?: Record<string, any>): Promise<string | null> {
    if (!this._client) {
      raiseError("Auth0 client is not initialized. Call initialize() first.");
    }

    this._setError(null);

    try {
      const token = await this._client.getTokenSilently(options);
      this._setToken(token ?? null);
      return this._token;
    } catch (e: any) {
      this._setError(e);
      return null;
    }
  }
}
