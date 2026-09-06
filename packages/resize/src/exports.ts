export { bootstrapResize } from "./bootstrapResize.js";
export { getConfig } from "./config.js";
export { ResizeCore } from "./core/ResizeCore.js";
export { WcsResize } from "./components/Resize.js";

export type {
  IWritableConfig, IWritableTagNames, ResizeOptions, ResizeBoxOption,
  WcsResizeRect, WcsResizeBoxSize, WcsResizeEntry,
  WcsResizeCoreValues, WcsResizeValues, WcsResizeInputs,
  WcsResizeCoreCommands, WcsResizeCommands
} from "./types.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-resize")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/resize"` or a tsconfig `types` entry).
import type { WcsResize } from "./components/Resize.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-resize": WcsResize;
  }
}
