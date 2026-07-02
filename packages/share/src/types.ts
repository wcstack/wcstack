export interface ITagNames {
  readonly share: string;
}

export interface IWritableTagNames {
  share?: string;
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
 * The data object passed to `navigator.share(data)` / `navigator.canShare(data)`.
 * All fields are optional per the Web Share API; a caller typically supplies a
 * subset (e.g. just `url`, or `title` + `text` + `url`, or `files`).
 */
export interface WcsShareData {
  title?: string;
  text?: string;
  url?: string;
  files?: File[];
}

/**
 * Value types for ShareCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new ShareCore();
 * bind(core, (name: keyof WcsShareCoreValues, value) => { ... });
 * ```
 */
export interface WcsShareCoreValues {
  // The success signal: an echo of the `data` object passed to the `share()`
  // call that just completed successfully (navigator.share() itself resolves
  // `Promise<void>`, so `value` is synthesized rather than read off the API —
  // see docs/web-share-tag-design.md §4). `null` before any successful share.
  value: WcsShareData | null;
  loading: boolean;
  // A true platform failure (anything other than the user cancelling the
  // share sheet). `null` when there has been no failure yet or after a reset.
  error: any;
  // `true` when the user dismissed the share sheet (AbortError). Kept
  // separate from `error` so `hidden@error`-style bindings do not react to a
  // routine cancellation (docs/web-share-tag-design.md §3).
  cancelled: boolean;
}

/**
 * Value types for the Shell (`<wcs-share>`) — identical observable surface to
 * the Core. The Shell adds no inputs: `share(data)`'s `data` is a per-call
 * argument, not a declarative attribute (docs/web-share-tag-design.md §10).
 */
export type WcsShareValues = WcsShareCoreValues;
