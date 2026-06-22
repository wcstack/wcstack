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

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

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
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
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
