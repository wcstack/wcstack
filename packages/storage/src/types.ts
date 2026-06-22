export interface ITagNames {
  readonly storage: string;
}

export interface IWritableTagNames {
  storage?: string;
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

export type StorageType = "local" | "session";

/**
 * Error returned when a storage operation fails.
 */
export interface WcsStorageError {
  operation: "load" | "save" | "remove";
  message: string;
}

/**
 * Value types for StorageCore (headless) — the async state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 */
export interface WcsStorageCoreValues<T = unknown> {
  value: T;
  loading: boolean;
  error: WcsStorageError | Error | null;
}

/**
 * Value types for the Shell (`<wcs-storage>`) — extends Core with `trigger`.
 * Use with framework adapters for compile-time type checking.
 */
export interface WcsStorageValues<T = unknown> extends WcsStorageCoreValues<T> {
  trigger: boolean;
}
