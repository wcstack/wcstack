export interface ITagNames {
  readonly intersect: string;
}

export interface IWritableTagNames {
  intersect?: string;
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
 * Plain snapshot of a `DOMRectReadOnly` (e.g. `boundingClientRect`,
 * `intersectionRect`, `rootBounds`). Unlike the live DOM rect, every field is a
 * plain number so it can flow through data binding and be serialized.
 */
export interface WcsIntersectRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Payload carried by the `wcs-intersect:change` event — a structured-clone-friendly
 * snapshot of `IntersectionObserverEntry`, plus the live `target` Element for
 * consumers that need the actual node.
 *
 * `boundingClientRect` / `intersectionRect` are always present; `rootBounds` is
 * `null` when the root is a cross-origin document (mirroring the native API).
 */
export interface WcsIntersectEntry {
  isIntersecting: boolean;
  intersectionRatio: number;
  time: number;
  boundingClientRect: WcsIntersectRect;
  intersectionRect: WcsIntersectRect;
  rootBounds: WcsIntersectRect | null;
  /** The observed element. Not serializable — kept for consumers needing the node. */
  target: Element;
}

/**
 * Options accepted by `IntersectionCore.observe`, mirroring
 * `IntersectionObserverInit`. `root` is an already-resolved Element (the Shell
 * resolves a selector to a node before calling), or `null` for the viewport.
 */
export interface IntersectOptions {
  root?: Element | null;
  rootMargin?: string;
  threshold?: number | number[];
}

/**
 * Value types for IntersectionCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new IntersectionCore();
 * bind(core, (name: keyof WcsIntersectCoreValues, value) => { ... });
 * core.observe(document.querySelector("#hero")!);
 * ```
 */
export interface WcsIntersectCoreValues {
  entry: WcsIntersectEntry | null;
  intersecting: boolean;
  ratio: number;
  visible: boolean;
  observing: boolean;
}

/**
 * Value types for the Shell (`<wcs-intersect>`) — identical observable surface to
 * the Core, plus the DOM-driven `trigger` command-property.
 */
export interface WcsIntersectValues extends WcsIntersectCoreValues {
  trigger: boolean;
}

export interface WcsIntersectInputs {
  /**
   * What to observe. Omitted → the first element child (the element itself
   * renders as `display:contents`). A selector (`"#hero"`, `".section"`) → the
   * matched element (`display:none`). The literal `"self"` → the element itself
   * as a zero-height marker (`display:block`).
   */
  target: string;
  /** Selector for the scroll root. Omitted → the viewport. */
  root: string;
  rootMargin: string;
  /** A single ratio or a comma list (`"0,0.5,1"`) of 0..1 thresholds. */
  threshold: string;
  /** Disconnect after the first time the target becomes intersecting. */
  once: boolean;
  /** Do not auto-observe on connect; observe is driven manually instead. */
  manual: boolean;
  /**
   * Momentary command-property (no mirrored attribute): a `false`→`true` write
   * re-runs `observe()`, then the flag immediately resets to `false`. Unlike the
   * other inputs it does not reflect to an HTML attribute.
   */
  trigger: boolean;
}

export interface WcsIntersectCoreCommands {
  observe(element: Element, options?: IntersectOptions): Promise<void>;
  /** Force a fresh observation even when target+options are unchanged (rebuilds the observer). */
  reobserve(element: Element, options?: IntersectOptions): void;
  unobserve(element: Element): void;
  disconnect(): void;
  /** Clear the `visible` latch so it can be set again by a later intersection. */
  reset(): void;
}

export interface WcsIntersectCommands {
  /** Re-resolve the target/root from the DOM and (re)start observing. */
  observe(): void;
  /** Re-resolve the target/root and force a fresh observation (rebuilds the observer). */
  reobserve(): void;
  unobserve(): void;
  disconnect(): void;
  reset(): void;
}
