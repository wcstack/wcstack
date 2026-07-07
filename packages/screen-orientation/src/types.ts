export interface ITagNames {
  readonly screenOrientation: string;
}

export interface IWritableTagNames {
  screenOrientation?: string;
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
 * `OrientationLockType` — the string union `ScreenOrientation.lock()` accepts.
 * Not defined in `lib.dom.d.ts` (the method itself is missing there because the
 * API is still experimental); defined here from the W3C Screen Orientation API
 * spec so `lock()` gets compile-time completion/typo detection. This is a DX
 * aid only — `lock()` does not validate the value at runtime (see
 * docs/screen-orientation-tag-design.md §4); an unrecognized string is passed
 * through verbatim and the browser rejects it, which never-throw absorbs into
 * `error`.
 */
export type OrientationLockType =
  | "any"
  | "natural"
  | "landscape"
  | "portrait"
  | "portrait-primary"
  | "portrait-secondary"
  | "landscape-primary"
  | "landscape-secondary";

/**
 * A single snapshot of `screen.orientation` (Screen Orientation API), or the
 * unsupported default. `type`/`angle` are `null` when the API is absent (see
 * docs/screen-orientation-tag-design.md §7). Unlike `@wcstack/network`, there
 * is no explicit `supported` boolean — `type === null` is the unsupported
 * signal (§7).
 */
export interface WcsScreenOrientationSnapshot {
  type: OrientationType | null;
  angle: number | null;
}

/**
 * Value types for ScreenOrientationCore (headless) — the observable state
 * properties (`type`/`angle`) plus the derived `portrait`/`landscape`
 * booleans and the `error` surface (the last `lock()`/`unlock()` failure, or
 * `null`). Use with `bind()` from a wc-bindable binding core for
 * compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new ScreenOrientationCore();
 * bind(core, (name: keyof WcsScreenOrientationCoreValues, value) => { ... });
 * ```
 */
export type WcsScreenOrientationCoreValues = WcsScreenOrientationSnapshot & {
  portrait: boolean;
  landscape: boolean;
  error: any;
};

/**
 * Value types for the Shell (`<wcs-screen-orientation>`) — identical
 * observable surface to the Core. The Shell adds no inputs: `screen.orientation`
 * is a single global with nothing to configure. It adds no commands beyond the
 * Core's `lock`/`unlock` (delegated, not duplicated).
 */
export type WcsScreenOrientationValues = WcsScreenOrientationCoreValues;
