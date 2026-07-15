import type { WcsIoErrorInfo } from "./core/platformCapability.js";

export interface ITagNames {
  readonly eyedropper: string;
}

export interface IWritableTagNames {
  eyedropper?: string;
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
 * The result of a successful `new EyeDropper().open()` call — the platform's
 * own return shape, used verbatim (no synthesis needed, unlike
 * `@wcstack/share`'s `value`; see docs/eyedropper-tag-design.md §3).
 */
export interface WcsEyedropperData {
  sRGBHex: string;
}

/**
 * Value types for EyedropperCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new EyedropperCore();
 * bind(core, (name: keyof WcsEyedropperCoreValues, value) => { ... });
 * ```
 */
export interface WcsEyedropperCoreValues {
  // The platform's own result object ({ sRGBHex }), used as-is. `null` before
  // any successful open() (docs/eyedropper-tag-design.md §3).
  value: WcsEyedropperData | null;
  loading: boolean;
  // A true platform failure (anything other than the user/caller cancelling
  // the picker). `null` when there has been no failure yet or after a reset.
  error: any;
  // `true` when the picker was dismissed via Escape (user) or abort() (caller)
  // — both surface as the same `AbortError` and are not distinguished
  // (docs/eyedropper-tag-design.md §2). Kept separate from `error` so
  // `hidden@error`-style bindings do not react to a routine cancellation.
  cancelled: boolean;
  // Last failure's serializable taxonomy (stable code/phase/recoverable), or null.
  errorInfo: WcsIoErrorInfo | null;
}

/**
 * Value types for the Shell (`<wcs-eyedropper>`) — identical observable
 * surface to the Core. The Shell adds no inputs: `open()` takes no per-call
 * argument (docs/eyedropper-tag-design.md §5).
 */
export type WcsEyedropperValues = WcsEyedropperCoreValues;
