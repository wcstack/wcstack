const _config = {
    autoTrigger: true,
    triggerAttribute: "data-authtarget",
    tagNames: {
        auth: "wcs-auth",
        authLogout: "wcs-auth-logout",
    },
};
function deepFreeze(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
        deepFreeze(obj[key]);
    }
    return obj;
}
function deepClone(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    const clone = {};
    for (const key of Object.keys(obj)) {
        clone[key] = deepClone(obj[key]);
    }
    return clone;
}
let frozenConfig = null;
const config = _config;
function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(deepClone(_config));
    }
    return frozenConfig;
}
function setConfig(partialConfig) {
    if (typeof partialConfig.autoTrigger === "boolean") {
        _config.autoTrigger = partialConfig.autoTrigger;
    }
    if (typeof partialConfig.triggerAttribute === "string") {
        _config.triggerAttribute = partialConfig.triggerAttribute;
    }
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    frozenConfig = null;
}

function raiseError(message) {
    throw new Error(`[@wcstack/auth0] ${message}`);
}

/**
 * Headless authentication core based on Auth0 SPA SDK.
 * Requires browser globals (location, history) for redirect callback handling.
 */
class AuthCore extends EventTarget {
    static wcBindable = {
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
    _target;
    _client = null;
    _authenticated = false;
    _user = null;
    _token = null;
    _loading = false;
    _error = null;
    _initPromise = null;
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get authenticated() {
        return this._authenticated;
    }
    get user() {
        return this._user;
    }
    get token() {
        return this._token;
    }
    get loading() {
        return this._loading;
    }
    get error() {
        return this._error;
    }
    get client() {
        return this._client;
    }
    get initPromise() {
        return this._initPromise;
    }
    _setLoading(loading) {
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-auth:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setError(error) {
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-auth:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setAuthenticated(value) {
        this._authenticated = value;
        this._target.dispatchEvent(new CustomEvent("wcs-auth:authenticated-changed", {
            detail: value,
            bubbles: true,
        }));
    }
    _setUser(user) {
        this._user = user;
        this._target.dispatchEvent(new CustomEvent("wcs-auth:user-changed", {
            detail: user,
            bubbles: true,
        }));
    }
    _setToken(token) {
        this._token = token;
        this._target.dispatchEvent(new CustomEvent("wcs-auth:token-changed", {
            detail: token,
            bubbles: true,
        }));
    }
    /**
     * Initialize the Auth0 client and handle redirect callback if needed.
     */
    initialize(options) {
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
    async _doInitialize(options) {
        this._setLoading(true);
        this._setError(null);
        try {
            const { createAuth0Client } = await import('@auth0/auth0-spa-js');
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
        }
        catch (e) {
            this._setError(e);
            this._setLoading(false);
        }
    }
    /**
     * Sync authentication state from the Auth0 client.
     */
    async _syncState() {
        if (!this._client)
            return;
        const isAuthenticated = await this._client.isAuthenticated();
        this._setAuthenticated(isAuthenticated);
        if (isAuthenticated) {
            const user = await this._client.getUser();
            this._setUser(user ?? null);
            try {
                const token = await this._client.getTokenSilently();
                this._setToken(token ?? null);
            }
            catch (_e) {
                // トークン取得失敗は致命的ではない
                this._setToken(null);
            }
        }
        else {
            this._setUser(null);
            this._setToken(null);
        }
    }
    /**
     * Redirect to Auth0 login page.
     */
    async login(options) {
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
        }
        catch (e) {
            this._setError(e);
            this._setLoading(false);
        }
    }
    /**
     * Login via popup window.
     */
    async loginWithPopup(options) {
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
        }
        catch (e) {
            this._setError(e);
            this._setLoading(false);
        }
    }
    /**
     * Logout from Auth0.
     */
    async logout(options) {
        if (!this._client) {
            raiseError("Auth0 client is not initialized. Call initialize() first.");
        }
        this._setError(null);
        try {
            await this._client.logout(options);
            this._setAuthenticated(false);
            this._setUser(null);
            this._setToken(null);
        }
        catch (e) {
            this._setError(e);
        }
    }
    /**
     * Get access token silently (from cache or via refresh).
     */
    async getToken(options) {
        if (!this._client) {
            raiseError("Auth0 client is not initialized. Call initialize() first.");
        }
        this._setError(null);
        try {
            const token = await this._client.getTokenSilently(options);
            this._setToken(token ?? null);
            return this._token;
        }
        catch (e) {
            this._setError(e);
            return null;
        }
    }
}

let registered = false;
function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element))
        return;
    const triggerElement = target.closest(`[${config.triggerAttribute}]`);
    if (!triggerElement)
        return;
    const authId = triggerElement.getAttribute(config.triggerAttribute);
    if (!authId)
        return;
    const authElement = document.getElementById(authId);
    if (!authElement || authElement.tagName.toLowerCase() !== config.tagNames.auth)
        return;
    event.preventDefault();
    authElement.login();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

class Auth extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...AuthCore.wcBindable,
        properties: [
            ...AuthCore.wcBindable.properties,
            { name: "trigger", event: "wcs-auth:trigger-changed" },
        ],
    };
    static get observedAttributes() {
        return ["domain", "client-id", "redirect-uri", "audience", "scope"];
    }
    _core;
    _trigger = false;
    _connectedCallbackPromise = Promise.resolve();
    constructor() {
        super();
        this._core = new AuthCore(this);
    }
    // --- Input attributes ---
    get domain() {
        return this.getAttribute("domain") || "";
    }
    set domain(value) {
        this.setAttribute("domain", value);
    }
    get clientId() {
        return this.getAttribute("client-id") || "";
    }
    set clientId(value) {
        this.setAttribute("client-id", value);
    }
    get redirectUri() {
        return this.getAttribute("redirect-uri") || "";
    }
    set redirectUri(value) {
        this.setAttribute("redirect-uri", value);
    }
    get audience() {
        return this.getAttribute("audience") || "";
    }
    set audience(value) {
        this.setAttribute("audience", value);
    }
    get scope() {
        return this.getAttribute("scope") || "openid profile email";
    }
    set scope(value) {
        this.setAttribute("scope", value);
    }
    get cacheLocation() {
        const value = this.getAttribute("cache-location");
        return value === "localstorage" ? "localstorage" : "memory";
    }
    set cacheLocation(value) {
        this.setAttribute("cache-location", value);
    }
    get useRefreshTokens() {
        return this.hasAttribute("use-refresh-tokens");
    }
    set useRefreshTokens(value) {
        if (value) {
            this.setAttribute("use-refresh-tokens", "");
        }
        else {
            this.removeAttribute("use-refresh-tokens");
        }
    }
    get popup() {
        return this.hasAttribute("popup");
    }
    set popup(value) {
        if (value) {
            this.setAttribute("popup", "");
        }
        else {
            this.removeAttribute("popup");
        }
    }
    // --- Output state (delegated to core) ---
    get authenticated() {
        return this._core.authenticated;
    }
    get user() {
        return this._core.user;
    }
    get token() {
        return this._core.token;
    }
    get loading() {
        return this._core.loading;
    }
    get error() {
        return this._core.error;
    }
    get client() {
        return this._core.client;
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Trigger (one-way command) ---
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
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
    _buildClientOptions() {
        const authorizationParams = {
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
    async initialize() {
        return this._core.initialize(this._buildClientOptions());
    }
    async login(options) {
        await this._connectedCallbackPromise;
        if (this.popup) {
            return this._core.loginWithPopup(options);
        }
        return this._core.login(options);
    }
    async logout(options) {
        await this._connectedCallbackPromise;
        return this._core.logout(options);
    }
    async getToken(options) {
        await this._connectedCallbackPromise;
        return this._core.getToken(options);
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        if (!this._core.client && this.domain && this.clientId) {
            this._connectedCallbackPromise = this.initialize();
        }
    }
    attributeChangedCallback(_name, _oldValue, _newValue) {
        // domain/client-id変更時の再初期化はしない（初期化は1回のみ）
    }
    disconnectedCallback() {
        // クリーンアップ不要（Auth0クライアントはシングルトン的に使う）
    }
}

/**
 * <wcs-auth-logout> — declarative logout button.
 * Finds the parent or referenced <wcs-auth> element and calls logout().
 *
 * Usage:
 *   <wcs-auth-logout target="auth-id">ログアウト</wcs-auth-logout>
 *   <wcs-auth-logout return-to="/">ログアウト</wcs-auth-logout>
 */
class AuthLogout extends HTMLElement {
    connectedCallback() {
        this.addEventListener("click", this._handleClick);
        this.style.cursor = "pointer";
    }
    disconnectedCallback() {
        this.removeEventListener("click", this._handleClick);
    }
    get target() {
        return this.getAttribute("target") || "";
    }
    set target(value) {
        this.setAttribute("target", value);
    }
    get returnTo() {
        return this.getAttribute("return-to") || "";
    }
    set returnTo(value) {
        this.setAttribute("return-to", value);
    }
    _handleClick = (event) => {
        event.preventDefault();
        const authElement = this._findAuth();
        if (!authElement)
            return;
        const options = {};
        if (this.returnTo) {
            options.logoutParams = { returnTo: this.returnTo };
        }
        authElement.logout(options);
    };
    _findAuth() {
        // target属性でIDを指定している場合
        if (this.target) {
            const el = document.getElementById(this.target);
            if (el && el.tagName.toLowerCase() === config.tagNames.auth) {
                return el;
            }
            return null;
        }
        // 最寄りの<wcs-auth>を探す
        const closest = this.closest(config.tagNames.auth);
        if (closest) {
            return closest;
        }
        // ドキュメント内の最初の<wcs-auth>を探す
        const first = document.querySelector(config.tagNames.auth);
        return first;
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.auth)) {
        customElements.define(config.tagNames.auth, Auth);
    }
    if (!customElements.get(config.tagNames.authLogout)) {
        customElements.define(config.tagNames.authLogout, AuthLogout);
    }
}

function bootstrapAuth(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { AuthCore, bootstrapAuth, getConfig };
//# sourceMappingURL=index.esm.js.map
