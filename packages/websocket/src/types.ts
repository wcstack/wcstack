export interface ITagNames {
  readonly ws: string;
}

export interface IWritableTagNames {
  ws?: string;
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
 * WebSocket error object.
 */
export interface WcsWsError {
  code?: number;
  reason?: string;
  message?: string;
}

/**
 * Value types for WebSocketCore (headless) — the async state properties.
 */
export interface WcsWsCoreValues<T = unknown> {
  message: T;
  connected: boolean;
  loading: boolean;
  error: WcsWsError | Event | null;
  readyState: number;
}

/**
 * Value types for the Shell (`<wcs-ws>`) — extends Core with `trigger` and `send`.
 */
export interface WcsWsValues<T = unknown> extends WcsWsCoreValues<T> {
  trigger: boolean;
  send: unknown;
}
