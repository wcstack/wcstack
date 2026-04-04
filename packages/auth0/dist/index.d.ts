interface ITagNames {
    readonly auth: string;
    readonly authLogout: string;
}
interface IWritableTagNames {
    auth?: string;
    authLogout?: string;
}
interface IConfig {
    readonly autoTrigger: boolean;
    readonly triggerAttribute: string;
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    autoTrigger?: boolean;
    triggerAttribute?: string;
    tagNames?: IWritableTagNames;
}
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
}
interface IWcBindable {
    readonly protocol: "wc-bindable";
    readonly version: number;
    readonly properties: IWcBindableProperty[];
}
/**
 * Auth0 user profile returned after authentication.
 */
interface WcsAuthUser {
    sub: string;
    name?: string;
    email?: string;
    picture?: string;
    [key: string]: any;
}
/**
 * Auth0 authentication error.
 */
interface WcsAuthError {
    error: string;
    error_description?: string;
    [key: string]: any;
}
/**
 * Value types for AuthCore (headless) — the async state properties.
 */
interface WcsAuthCoreValues {
    authenticated: boolean;
    user: WcsAuthUser | null;
    token: string | null;
    loading: boolean;
    error: WcsAuthError | Error | null;
}
/**
 * Value types for the Shell (`<wcs-auth>`) — extends Core with `trigger`.
 */
interface WcsAuthValues extends WcsAuthCoreValues {
    trigger: boolean;
}
/**
 * Auth0 client configuration options passed to createAuth0Client.
 */
interface Auth0ClientOptions {
    domain: string;
    clientId: string;
    authorizationParams?: {
        redirect_uri?: string;
        audience?: string;
        scope?: string;
        [key: string]: any;
    };
    cacheLocation?: "memory" | "localstorage";
    useRefreshTokens?: boolean;
    [key: string]: any;
}

declare function bootstrapAuth(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless authentication core based on Auth0 SPA SDK.
 * Requires browser globals (location, history) for redirect callback handling.
 */
declare class AuthCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _client;
    private _authenticated;
    private _user;
    private _token;
    private _loading;
    private _error;
    private _initPromise;
    constructor(target?: EventTarget);
    get authenticated(): boolean;
    get user(): WcsAuthUser | null;
    get token(): string | null;
    get loading(): boolean;
    get error(): any;
    get client(): any;
    get initPromise(): Promise<void> | null;
    private _setLoading;
    private _setError;
    private _setAuthenticated;
    private _setUser;
    private _setToken;
    /**
     * Initialize the Auth0 client and handle redirect callback if needed.
     */
    initialize(options: Auth0ClientOptions): Promise<void>;
    private _doInitialize;
    /**
     * Sync authentication state from the Auth0 client.
     */
    private _syncState;
    /**
     * Redirect to Auth0 login page.
     */
    login(options?: Record<string, any>): Promise<void>;
    /**
     * Login via popup window.
     */
    loginWithPopup(options?: Record<string, any>): Promise<void>;
    /**
     * Logout from Auth0.
     */
    logout(options?: Record<string, any>): Promise<void>;
    /**
     * Get access token silently (from cache or via refresh).
     */
    getToken(options?: Record<string, any>): Promise<string | null>;
}

export { AuthCore, bootstrapAuth, getConfig };
export type { Auth0ClientOptions, IWritableConfig, IWritableTagNames, WcsAuthCoreValues, WcsAuthError, WcsAuthUser, WcsAuthValues };
