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

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

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

export interface WcsWsInputs {
  url: string;
  protocols: string;
  autoReconnect: boolean;
  reconnectInterval: number;
  maxReconnects: number;
  manual: boolean;
  trigger: boolean;
  send: unknown;
}

export interface WcsWsCoreCommands {
  connect(url: string, options?: {
    protocols?: string | string[];
    autoReconnect?: boolean;
    reconnectInterval?: number;
    maxReconnects?: number;
  }): void;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export interface WcsWsCommands {
  connect(): void;
  sendMessage(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}
