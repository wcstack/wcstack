export interface ITagNames {
  readonly sse: string;
}

export interface IWritableTagNames {
  sse?: string;
}

export interface IConfig {
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  tagNames?: IWritableTagNames;
}

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

import type { WcsIoErrorInfo } from "./core/platformCapability.js";

/**
 * Options for `SseCore.connect()` / the headless `connect` command.
 * Single source of truth — referenced by both `SseCore.connect` and
 * `WcsSseCoreCommands.connect`.
 */
export interface SseConnectOptions {
  withCredentials?: boolean;
  /** Named SSE events (`event:` field) to subscribe to, besides the unnamed `message`. */
  events?: string[];
  /** When true, skip JSON auto-parsing and keep `data` as the raw string. */
  raw?: boolean;
}

/**
 * Detail payload of the `message` property.
 *
 * SSE streams can carry named events (`event: foo\ndata: ...`). All subscribed
 * events — the unnamed `message` plus any names listed in the `events` input —
 * are funneled into the single `message` property; the `event` field tells which
 * one fired. State-side code branches on `event`.
 */
export interface WcsSseMessage<T = unknown> {
  /** The event type that fired (`"message"` for unnamed events). */
  event: string;
  /** The parsed (or raw, when `raw` is set) payload. */
  data: T;
  /** The `id:` field of the SSE event, if any. */
  lastEventId: string;
}

/**
 * Value types for SseCore (headless) — the async state properties.
 *
 * `error` is the raw failure: the `error` Event dispatched by EventSource on
 * connection loss, or the Error thrown by the `EventSource` constructor (e.g. an
 * invalid URL). SSE error events carry no structured fields (unlike WebSocket's
 * CloseEvent), so there is nothing to normalize — the raw value is surfaced.
 */
export interface WcsSseCoreValues<T = unknown> {
  message: WcsSseMessage<T> | null;
  connected: boolean;
  loading: boolean;
  error: Event | Error | null;
  /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
  errorInfo: WcsIoErrorInfo | null;
  readyState: number;
}

/**
 * Value types for the Shell (`<wcs-sse>`) — extends Core with `trigger`.
 */
export interface WcsSseValues<T = unknown> extends WcsSseCoreValues<T> {
  trigger: boolean;
}

export interface WcsSseInputs {
  url: string;
  withCredentials: boolean;
  events: string;
  raw: boolean;
  manual: boolean;
  trigger: boolean;
}

export interface WcsSseCoreCommands {
  connect(url: string, options?: SseConnectOptions): void;
  close(): void;
}

export interface WcsSseCommands {
  connect(): void;
  close(): void;
}
