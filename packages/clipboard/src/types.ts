export interface ITagNames {
  readonly clipboard: string;
}

export interface IWritableTagNames {
  clipboard?: string;
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
  readonly version: number;
  readonly properties: IWcBindableProperty[];
  readonly inputs?: IWcBindableInput[];
  readonly commands?: IWcBindableCommand[];
}

/**
 * Permission state for the Clipboard API, mirroring the Permissions API
 * `PermissionState` plus `"unsupported"` for environments without
 * `navigator.permissions` (or where the `clipboard-read` / `clipboard-write`
 * permissions cannot be queried — e.g. Firefox, which does not expose them).
 */
export type ClipboardPermissionState = "prompt" | "granted" | "denied" | "unsupported";

/**
 * Normalized snapshot of a single `ClipboardItem` read via `read()`. Unlike the
 * live `ClipboardItem` (whose `getType()` returns a fresh promise each call),
 * every representation is eagerly resolved to a `Blob` so the data can flow
 * through declarative binding without further async work.
 */
export interface WcsClipboardReadItem {
  /** MIME types present in this item (e.g. `["text/plain", "text/html"]`). */
  types: string[];
  /** Resolved blobs keyed by MIME type. */
  data: Record<string, Blob>;
}

/**
 * Payload carried by the `wcs-clipboard:read` event — the result of a
 * `readText()` or `read()` call.
 *
 * - `text` is the `text/plain` content when available (always set by
 *   `readText()`, and extracted from a `text/plain` representation by `read()`),
 *   otherwise `null`.
 * - `items` is the structured snapshot from a rich `read()`, or `null` for a
 *   plain `readText()`.
 */
export interface WcsClipboardReadDetail {
  text: string | null;
  items: WcsClipboardReadItem[] | null;
}

/**
 * Normalized Clipboard API failure. `name` mirrors the `DOMException.name`
 * (e.g. `NotAllowedError`, `NotFoundError`); `unsupported` is surfaced as
 * `NotSupportedError` when `navigator.clipboard` is absent (non-secure context
 * or unsupported browser).
 */
export interface WcsClipboardErrorDetail {
  name: string;
  message: string;
}

/**
 * Value types for ClipboardCore (headless) — the observable state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new ClipboardCore();
 * bind(core, (name: keyof WcsClipboardCoreValues, value) => { ... });
 * ```
 */
export interface WcsClipboardCoreValues {
  text: string | null;
  items: WcsClipboardReadItem[] | null;
  loading: boolean;
  error: WcsClipboardErrorDetail | null;
  readPermission: ClipboardPermissionState;
  writePermission: ClipboardPermissionState;
  monitoring: boolean;
  copied: string | null;
  cut: string | null;
  pasted: string | null;
}

/**
 * Value types for the Shell (`<wcs-clipboard>`) — identical observable surface
 * to the Core.
 */
export type WcsClipboardValues = WcsClipboardCoreValues;

export interface WcsClipboardInputs {
  /**
   * When present, start monitoring document `copy` / `cut` / `paste` events on
   * connect, publishing them as the `copied` / `cut` / `pasted` properties.
   */
  monitor: boolean;
}

export interface WcsClipboardCoreCommands {
  writeText(text: string): Promise<void>;
  write(items: ClipboardItem[]): Promise<void>;
  readText(): Promise<void>;
  read(): Promise<void>;
  startMonitor(): void;
  stopMonitor(): void;
}

/** Commands exposed on the Shell — identical surface to the Core. */
export type WcsClipboardCommands = WcsClipboardCoreCommands;
