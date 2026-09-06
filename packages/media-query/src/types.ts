export interface ITagNames {
  readonly mediaQuery: string;
}

export interface IWritableTagNames {
  mediaQuery?: string;
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
 * The subset of `MediaQueryList` this node reads and subscribes to. Modern
 * engines expose `addEventListener("change", …)`; old Safari (< 14) only has
 * the deprecated `addListener` / `removeListener` pair, so both are optional
 * here and the Core picks whichever exists (docs/media-query-tag-design.md §5).
 */
export interface WcsMediaQueryList {
  readonly matches: boolean;
  readonly media: string;
  addEventListener?(type: "change", listener: () => void): void;
  removeEventListener?(type: "change", listener: () => void): void;
  addListener?(listener: () => void): void;
  removeListener?(listener: () => void): void;
}

/**
 * Injectable `matchMedia` for MediaQueryCore. The default resolves
 * `globalThis.matchMedia` at call time (§3.7); tests inject a fake whose
 * `matches` and `change` dispatch they drive directly — happy-dom's
 * MediaQueryList change delivery is not reliable enough to test against
 * (the same precedent as `@wcstack/raf`'s reduced-motion gate).
 */
export type WcsMatchMedia = (query: string) => WcsMediaQueryList;

export interface WcsMediaQueryCoreOptions {
  matchMedia?: WcsMatchMedia;
}

/**
 * A single snapshot of the subscribed `MediaQueryList`, or the "nothing to
 * watch" default. `matched` (the list's `matches`) is `false` and `media` is `""` whenever there is
 * no live list — `matchMedia` absent (`supported === false`), an empty query,
 * or a `matchMedia` call that threw. `supported` answers only "is
 * `matchMedia` a function here", resolved on every observe().
 */
export interface WcsMediaQuerySnapshot {
  matched: boolean;
  media: string;
  supported: boolean;
}

/**
 * Value types for MediaQueryCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new MediaQueryCore();
 * bind(core, (name: keyof WcsMediaQueryCoreValues, value) => { ... });
 * ```
 */
export type WcsMediaQueryCoreValues = WcsMediaQuerySnapshot;

/**
 * Value types for the Shell (`<wcs-media-query>`) — the Core's observable
 * surface plus the one attribute-linked input, `query`.
 */
export type WcsMediaQueryValues = WcsMediaQueryCoreValues & {
  query: string;
};
