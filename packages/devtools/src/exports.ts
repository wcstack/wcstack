export { bootstrapDevtools } from "./bootstrapDevtools.js";
export { WcsDevtools } from "./shell/WcsDevtools.js";
export {
  DevtoolsCore,
} from "./core/DevtoolsCore.js";
export type {
  ITimelineEntry, IRosterEntry, IWiringEntry,
  TimelineKind, CoreChangeKind, CoreChangeListener, IDevtoolsCoreOptions,
} from "./core/DevtoolsCore.js";
export { formatValue, formatArgs } from "./core/formatValue.js";
export { scanDeclaredBindings } from "./core/declaredScan.js";
export type { IDeclaredBinding } from "./core/declaredScan.js";
export { getOrCreateHookRegistry } from "./protocol/registry.js";
export {
  DEVTOOLS_HOOK_GLOBAL, DEVTOOLS_PROTOCOL_VERSION,
} from "./protocol/types.js";
export type {
  DevtoolsEventLike, DevtoolsSinkLike,
  IDevtoolsSourceLike, IDevtoolsListenerLike, IDevtoolsHookRegistryLike,
  IStateElementSummaryLike, IBindingLike, IAbsoluteAddressLike,
  IAbsolutePathInfoLike, IListIndexLike, IPathInfoLike,
} from "./protocol/types.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-devtools")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/devtools"` or a tsconfig `types` entry).
import type { WcsDevtools } from "./shell/WcsDevtools.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-devtools": WcsDevtools;
  }
}
