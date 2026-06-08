export interface ITagNames {
  readonly debounce: string;
  readonly throttle: string;
}

export interface IWritableTagNames {
  debounce?: string;
  throttle?: string;
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
 * Tuning options for {@link DebounceCore}. Mirrors lodash's `debounce` knobs.
 * - `wait`: quiet period (ms) the signal must be idle before a trailing fire.
 * - `leading`: fire on the first signal of a burst.
 * - `trailing`: fire after the quiet period at the end of a burst.
 * - `maxWait`: cap the total time a fire can be deferred under continuous input.
 *   (Throttle is expressed as `maxWait === wait`.)
 */
export interface DebounceOptions {
  wait?: number;
  leading?: boolean;
  trailing?: boolean;
  maxWait?: number;
}

/**
 * Payload carried by the `<prefix>:settled` event (the value surface).
 * `value` is the debounced value of the most recent `source` write.
 */
export interface WcsDebounceSettledDetail {
  value: any;
}

/**
 * Payload carried by the `<prefix>:fired` event (the signal surface).
 * `args` are the coalesced arguments of the most recent `trigger(...args)` pulse.
 */
export interface WcsDebounceFiredDetail {
  args: any[];
}

/**
 * Value types for DebounceCore (headless) — the observable state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 */
export interface WcsDebounceCoreValues {
  value: any;
  fired: any[];
  pending: boolean;
}

/**
 * Value types for the Shell (`<wcs-debounce>` / `<wcs-throttle>`) — identical
 * observable surface to the Core.
 */
export type WcsDebounceValues = WcsDebounceCoreValues;

export interface WcsDebounceInputs {
  source: any;
  wait: number;
  leading: boolean;
  trailing: boolean;
  // Optional: the `max-wait` attribute is absent by default on <wcs-debounce>, so
  // the accessor returns `undefined` there (configure() treats that as "no cap").
  maxWait?: number;
}

export interface WcsDebounceCoreCommands {
  trigger(...args: any[]): void;
  cancel(): void;
  flush(): void;
}

export type WcsDebounceCommands = WcsDebounceCoreCommands;
