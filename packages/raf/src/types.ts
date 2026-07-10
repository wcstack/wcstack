export interface ITagNames {
  readonly raf: string;
}

export interface IWritableTagNames {
  raf?: string;
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
 * Payload carried by the `wcs-raf:tick` event.
 * `count` is the number of frames fired since the last reset; `elapsed` is the
 * accumulated ACTIVE milliseconds (Σdt — interruptions contribute nothing);
 * `dt` is the delta to the previous frame within a continuous run, `0` on the
 * first frame after start / resume / a visibility interruption; `timestamp` is
 * the frame's `DOMHighResTimeStamp` (`0` for the reset() notification, which
 * is not a frame).
 */
export interface WcsRafTickDetail {
  count: number;
  elapsed: number;
  dt: number;
  timestamp: number;
}

/**
 * Value types for RafCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 */
export interface WcsRafCoreValues {
  tick: number;
  elapsed: number;
  dt: number;
  running: boolean;
  suspended: boolean;
}

/**
 * Value types for the Shell (`<wcs-raf>`) — identical observable surface to
 * the Core, plus the DOM-driven `trigger` command-property.
 */
export interface WcsRafValues extends WcsRafCoreValues {
  trigger: boolean;
}

export interface WcsRafInputs {
  once: boolean;
  repeat: number;
  manual: boolean;
  trigger: boolean;
}

export interface WcsRafCoreCommands {
  start(options?: {
    repeat?: number;
  }): void;
  stop(): void;
  reset(): void;
  pause(): void;
  resume(): void;
}

export interface WcsRafCommands {
  start(): void;
  stop(): void;
  reset(): void;
  pause(): void;
  resume(): void;
}
