export interface ITagNames {
  readonly upload: string;
}

export interface IWritableTagNames {
  upload?: string;
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
 * Upload error object.
 */
export interface WcsUploadError {
  status?: number;
  statusText?: string;
  body?: string;
  message?: string;
}

/**
 * Value types for UploadCore (headless) — the async state properties.
 */
export interface WcsUploadCoreValues<T = unknown> {
  value: T;
  loading: boolean;
  progress: number;
  error: WcsUploadError | Error | null;
  status: number;
}

/**
 * Value types for the Shell (`<wcs-upload>`) — extends Core with `trigger` and `files`.
 *
 * `trigger` is a write-only command surface declared as an observable property mapped to
 * `wcs-upload:trigger-changed`. Only the `false` reset (after an upload settles) is
 * observable — the `true` transition (upload start) is intentionally NOT notified. This is
 * the same pub/sub trade-off as `@wcstack/fetch`'s `trigger`: a binding system writes `true`
 * to start and observes the single `false` edge to know the command has completed.
 */
export interface WcsUploadValues<T = unknown> extends WcsUploadCoreValues<T> {
  trigger: boolean;
  files: FileList | File[] | null;
}
