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

// wc-bindable protocol (@wc-bindable/core, protocol version 1) for custom element binding.
// properties: observable outputs — the element dispatches events on change, observers subscribe via bind()
// inputs:     settable surface — declarative metadata; optional `attribute` hints the mirrored HTML attribute
// commands:   invocable methods — declarative metadata; binding systems call the method by name
// Per SPEC.md, core interprets only `properties`; `inputs` / `commands` and the `attribute` / `async`
// hints are descriptive (tooling, codegen, remote proxying). See SPEC-extensions.md § Extension 1.
export interface IWcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => any;
}

export interface IWcBindableInput {
  readonly name: string;
  readonly attribute?: string;
}

export interface IWcBindableCommand {
  readonly name: string;
  readonly async?: boolean;
}

export interface IWcBindable {
  readonly protocol: "wc-bindable";
  readonly version: 1;
  readonly properties: IWcBindableProperty[];
  readonly inputs?: readonly IWcBindableInput[];
  readonly commands?: readonly IWcBindableCommand[];
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
