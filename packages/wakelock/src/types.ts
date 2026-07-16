import type { WcsIoErrorInfo } from "./core/platformCapability.js";

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

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

/**
 * Wake lock type. The spec currently standardizes only `"screen"`; the field
 * exists for forward compatibility with future lock types.
 */
export type WakeLockKind = "screen";

/**
 * Value types for WakeLockCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
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
  /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
  errorInfo: WcsIoErrorInfo | null;
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
