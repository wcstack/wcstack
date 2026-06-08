export interface ITagNames {
  readonly worker: string;
}

export interface IWritableTagNames {
  worker?: string;
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
 * Normalized Worker failure. `name` mirrors the underlying `DOMException.name`
 * or `Error.name`: `DataCloneError` when a posted value (or a value the worker
 * posted back) is not structured-cloneable, `InvalidStateError` when `post()` is
 * called with no running worker, and a script `Error` for an uncaught error
 * inside the worker. For a script error the optional `filename` / `lineno` /
 * `colno` carry the `ErrorEvent` location; they are absent for the other kinds.
 */
export interface WcsWorkerErrorDetail {
  name: string;
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

/**
 * Options for `WorkerCore.start()`.
 */
export interface WcsWorkerStartOptions {
  /** Module ("module", default) or classic ("classic") worker. */
  type?: WorkerType;
  /** Optional worker name, passed to the `Worker` constructor `name` option. */
  name?: string;
  /** Re-spawn the worker after an uncaught error fires (default `false`). */
  restartOnError?: boolean;
  /** Maximum number of automatic restarts (default `Infinity`). */
  maxRestarts?: number;
  /** Delay in ms before an automatic restart (default `0`). */
  restartInterval?: number;
}

/**
 * Value types for WorkerCore (headless) — the observable state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 */
export interface WcsWorkerCoreValues {
  /**
   * The most recent message posted back by the worker, reconstructed via
   * structured clone (no JSON round-trip). Re-fires on every incoming message,
   * even when the value is identical to the previous one.
   */
  message: any;
  /** The last failure (post / spawn / script error / messageerror), or `null`. */
  error: WcsWorkerErrorDetail | null;
  /** `true` while a worker is spawned and not yet terminated. */
  running: boolean;
}

/**
 * Value types for the Shell (`<wcs-worker>`) — identical observable surface to
 * the Core.
 */
export type WcsWorkerValues = WcsWorkerCoreValues;

export interface WcsWorkerInputs {
  /** The worker script URL. Changing it re-spawns on the new script. */
  src: string;
  /** Module ("module", default) or classic ("classic") worker. */
  type: WorkerType;
  /** Optional worker name (passed to the `Worker` constructor `name` option). */
  name: string;
  /**
   * When present, do NOT spawn the worker automatically on connect (or when the
   * `src` attribute changes). Spawn imperatively via `start()` instead.
   */
  manual: boolean;
  /**
   * When present, the worker is NOT terminated on disconnect — it outlives the
   * element. Ownership transfers to the caller, who must call `terminate()`.
   */
  keepAlive: boolean;
  /** When present, re-spawn the worker after an uncaught error. */
  restartOnError: boolean;
  /** Maximum number of automatic restarts (default `Infinity`). */
  maxRestarts: number;
  /** Delay in ms before an automatic restart (default `0`). */
  restartInterval: number;
}

export interface WcsWorkerCoreCommands {
  start(src: string, options?: WcsWorkerStartOptions): void;
  post(data: any, transfer?: Transferable[]): void;
  terminate(): void;
}

/** Commands exposed on the Shell — `start()` reads the `src` / `type` attributes. */
export interface WcsWorkerCommands {
  start(): void;
  post(data: any, transfer?: Transferable[]): void;
  terminate(): void;
}
