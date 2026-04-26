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
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
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
