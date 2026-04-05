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
 */
export interface WcsUploadValues<T = unknown> extends WcsUploadCoreValues<T> {
  trigger: boolean;
  files: FileList | File[] | null;
}
