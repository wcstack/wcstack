export interface ITagNames {
  readonly resize: string;
}

export interface IWritableTagNames {
  resize?: string;
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
 * Which box-size CSS-side ResizeObserver reports. Mirrors `ResizeObserverBoxOptions`.
 * `device-pixel-content-box` is Chromium-only; the Core falls back to `content-box`
 * if the runtime rejects it (never-throw).
 */
export type ResizeBoxOption = "content-box" | "border-box" | "device-pixel-content-box";

/**
 * Plain snapshot of a `DOMRectReadOnly` (`contentRect`). Unlike the live DOM rect,
 * every field is a plain number so it can flow through data binding and serialize.
 */
export interface WcsResizeRect {
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
 * Plain snapshot of a `ResizeObserverSize` (one fragment of `contentBoxSize` /
 * `borderBoxSize` / `devicePixelContentBoxSize`). Logical sizes (inline/block),
 * correct under vertical writing modes.
 */
export interface WcsResizeBoxSize {
  inlineSize: number;
  blockSize: number;
}

/**
 * Payload carried by the `wcs-resize:change` event — a structured-clone-friendly
 * snapshot of `ResizeObserverEntry`, plus the live `target` Element.
 *
 * `width` / `height` are the headline values derived from the box that the `box`
 * option selected (border-box / device-pixel / content-box), falling back to
 * `contentRect` when the matching boxSize fragment is absent. They are rounded to
 * integers when the `round` option is set.
 *
 * `contentBoxSize` / `borderBoxSize` / `devicePixelContentBoxSize` keep the first
 * fragment only (single-element observers never produce multiple fragments here);
 * `null` when the runtime did not report that box.
 */
export interface WcsResizeEntry {
  width: number;
  height: number;
  contentRect: WcsResizeRect;
  contentBoxSize: WcsResizeBoxSize | null;
  borderBoxSize: WcsResizeBoxSize | null;
  devicePixelContentBoxSize: WcsResizeBoxSize | null;
  /** The observed element. Not serializable — kept for consumers needing the node. */
  target: Element;
}

/**
 * Options accepted by `ResizeCore.observe`. `box` mirrors `ResizeObserverOptions`;
 * `round` rounds the headline `width` / `height` to integers to absorb sub-pixel
 * jitter (the nested boxSize fragments stay raw).
 */
export interface ResizeOptions {
  box?: ResizeBoxOption;
  round?: boolean;
}

/**
 * Value types for ResizeCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new ResizeCore();
 * bind(core, (name: keyof WcsResizeCoreValues, value) => { ... });
 * core.observe(document.querySelector("#panel")!);
 * ```
 */
export interface WcsResizeCoreValues {
  entry: WcsResizeEntry | null;
  width: number;
  height: number;
  observing: boolean;
}

/**
 * Value types for the Shell (`<wcs-resize>`) — identical observable surface to the
 * Core, plus the DOM-driven `trigger` command-property.
 */
export interface WcsResizeValues extends WcsResizeCoreValues {
  trigger: boolean;
}

export interface WcsResizeInputs {
  /**
   * What to observe. Omitted → the first element child (the element itself renders
   * as `display:contents`). A selector (`"#panel"`, `".card"`) → the matched
   * element (`display:none`). The literal `"self"` → the element itself, which as a
   * `display:block` zero-height box stretches to the parent's available inline size
   * — a container-width probe.
   */
  target: string;
  /**
   * Which box to report: `content-box` (default), `border-box`,
   * `device-pixel-content-box`. Typed as `string` because the Shell's `box`
   * accessor returns the raw attribute (`""` when unset, and any unrecognized
   * value verbatim); `_parseBox()` falls back to `content-box` at observe time.
   */
  box: string;
  /** Round the headline `width` / `height` to integers (absorbs sub-pixel jitter). */
  round: boolean;
  /** Disconnect after the first size observation (ResizeObserver always fires once on observe). */
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

export interface WcsResizeCoreCommands {
  observe(element: Element, options?: ResizeOptions): void;
  unobserve(element: Element): void;
  disconnect(): void;
}

export interface WcsResizeCommands {
  /** Re-resolve the target from the DOM and (re)start observing. */
  observe(): void;
  unobserve(): void;
  disconnect(): void;
}
