export interface ITagNames {
  readonly wakelock: string;
}

export interface IWritableTagNames {
  wakelock?: string;
}

export interface IConfig {
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
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
 * Wake lock type. The spec currently standardizes only `"screen"`; the field
 * exists for forward compatibility with future lock types.
 */
export type WakeLockKind = "screen";

/**
 * Value types for WakeLockCore (headless) — the observable state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 *
 * Unlike the @wcstack sensor tags (geolocation / intersection), the wake lock is
 * a pure *sink*: a bound state drives whether the lock is held (`active`, an
 * input), and the only outputs are `held` — whether a sentinel is actually held
 * right now — and `error`. `active` (the desired intent) is deliberately not an
 * observable output: it does not change when the OS auto-releases the lock, only
 * `held` does.
 *
 * @example
 * ```typescript
 * const core = new WakeLockCore();
 * bind(core, (name: keyof WcsWakeLockCoreValues, value) => { ... });
 * await core.request();
 * ```
 */
export interface WcsWakeLockCoreValues {
  /** Whether a wake lock sentinel is currently held (actual state). */
  held: boolean;
  /** The last request failure, or `null` while none. */
  error: Error | null;
}

/**
 * Value types for the Shell (`<wcs-wakelock>`) — identical observable surface to
 * the Core (`held` / `error`).
 */
export type WcsWakeLockValues = WcsWakeLockCoreValues;

export interface WcsWakeLockInputs {
  /**
   * Desired intent: hold the screen awake while `true`. The headline declarative
   * binding (`active@isPlaying`). Mirrored to the `active` boolean attribute.
   * Setting it `false` releases the lock. It stays `true` across an OS auto-release
   * (tab hidden) so the lock is re-acquired when the page becomes visible again —
   * read `held` for the actual current state.
   */
  active: boolean;
  /** Lock type. Only `"screen"` is standardized; defaults to `"screen"`. */
  type: WakeLockKind;
  /** Do not auto-acquire on connect even if `active` is present; drive via commands. */
  manual: boolean;
}

export interface WcsWakeLockCoreCommands {
  /**
   * Mark the lock as desired and acquire it (if the page is visible and the API
   * is supported). Never rejects — a failure surfaces via the `error` property.
   */
  request(): Promise<void>;
  /** Mark the lock as no longer desired and release any held sentinel. */
  release(): void;
}

export interface WcsWakeLockCommands {
  request(): Promise<void>;
  release(): void;
}
