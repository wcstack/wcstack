export interface ITagNames {
  readonly broadcast: string;
}

export interface IWritableTagNames {
  broadcast?: string;
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
 * Normalized BroadcastChannel failure. `name` mirrors the `DOMException.name`
 * (e.g. `DataCloneError` when a posted value is not structured-cloneable,
 * `DataError` for a `messageerror` deserialization failure); `unsupported` is
 * surfaced as `NotSupportedError` when the `BroadcastChannel` constructor is
 * absent (older browsers, or a non-window environment).
 */
export interface WcsBroadcastErrorDetail {
  name: string;
  message: string;
}

/**
 * Value types for BroadcastCore (headless) — the observable state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new BroadcastCore();
 * bind(core, (name: keyof WcsBroadcastCoreValues, value) => { ... });
 * ```
 */
export interface WcsBroadcastCoreValues {
  /**
   * The most recent message received from *another* same-origin context on the
   * channel. A context never receives its own posts (BroadcastChannel
   * self-exclusion), so within a single tab `message` only updates from another
   * `<wcs-broadcast>` on the same channel name. The value is whatever was
   * posted, reconstructed via structured clone (no JSON round-trip).
   */
  message: any;
  /** The last error (post failure / deserialization failure / unsupported), or `null`. */
  error: WcsBroadcastErrorDetail | null;
}

/**
 * Value types for the Shell (`<wcs-broadcast>`) — identical observable surface
 * to the Core.
 */
export type WcsBroadcastValues = WcsBroadcastCoreValues;

export interface WcsBroadcastInputs {
  /** The channel name to join. Changing it re-opens on the new channel. */
  name: string;
  /**
   * When present, do NOT open the channel automatically on connect (or when the
   * `name` attribute changes). Open imperatively via `open()` instead.
   */
  manual: boolean;
}

export interface WcsBroadcastCoreCommands {
  open(name: string): void;
  post(data: any): void;
  close(): void;
}

/** Commands exposed on the Shell — `open()` reads the `name` attribute. */
export interface WcsBroadcastCommands {
  open(): void;
  post(data: any): void;
  close(): void;
}
