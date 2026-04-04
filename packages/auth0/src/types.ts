export interface ITagNames {
  readonly auth: string;
  readonly authLogout: string;
}

export interface IWritableTagNames {
  auth?: string;
  authLogout?: string;
}

export interface IConfig {
  readonly autoTrigger: boolean;
  readonly triggerAttribute: string;
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  autoTrigger?: boolean;
  triggerAttribute?: string;
  tagNames?: IWritableTagNames;
}

export interface IWcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => any;
}

export interface IWcBindable {
  readonly protocol: "wc-bindable";
  readonly version: number;
  readonly properties: IWcBindableProperty[];
}

/**
 * Auth0 user profile returned after authentication.
 */
export interface WcsAuthUser {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
  [key: string]: any;
}

/**
 * Auth0 authentication error.
 */
export interface WcsAuthError {
  error: string;
  error_description?: string;
  [key: string]: any;
}

/**
 * Value types for AuthCore (headless) — the async state properties.
 */
export interface WcsAuthCoreValues {
  authenticated: boolean;
  user: WcsAuthUser | null;
  token: string | null;
  loading: boolean;
  error: WcsAuthError | Error | null;
}

/**
 * Value types for the Shell (`<wcs-auth>`) — extends Core with `trigger`.
 */
export interface WcsAuthValues extends WcsAuthCoreValues {
  trigger: boolean;
}

/**
 * Auth0 client configuration options passed to createAuth0Client.
 */
export interface Auth0ClientOptions {
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
