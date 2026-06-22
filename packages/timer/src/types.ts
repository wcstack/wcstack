export interface ITagNames {
  readonly timer: string;
}

export interface IWritableTagNames {
  timer?: string;
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
 * Payload carried by the `wcs-timer:tick` event.
 * `count` is the number of ticks fired since the last reset; `elapsed` is the
 * milliseconds the timer has been running since the last reset.
 */
export interface WcsTimerTickDetail {
  count: number;
  elapsed: number;
}

/**
 * Value types for TimerCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new TimerCore();
 * bind(core, (name: keyof WcsTimerCoreValues, value) => { ... });
 * ```
 */
export interface WcsTimerCoreValues {
  tick: number;
  elapsed: number;
  running: boolean;
}

/**
 * Value types for the Shell (`<wcs-timer>`) — identical observable surface to
 * the Core, plus the DOM-driven `trigger` command-property.
 */
export interface WcsTimerValues extends WcsTimerCoreValues {
  trigger: boolean;
}

export interface WcsTimerInputs {
  interval: number;
  once: boolean;
  repeat: number;
  immediate: boolean;
  manual: boolean;
  trigger: boolean;
}

export interface WcsTimerCoreCommands {
  start(options?: {
    interval?: number;
    repeat?: number;
    immediate?: boolean;
  }): void;
  stop(): void;
  reset(): void;
  pause(): void;
  resume(): void;
}

export interface WcsTimerCommands {
  start(): void;
  stop(): void;
  reset(): void;
  pause(): void;
  resume(): void;
}
