export { bootstrapPermission } from "./bootstrapPermission.js";
export { getConfig } from "./config.js";
export { PermissionCore } from "./core/PermissionCore.js";
export { WcsPermission } from "./components/Permission.js";

export type {
  IWritableConfig, IWritableTagNames, PermissionStateOrUnsupported,
  WcsPermissionDescriptor, WcsPermissionCoreValues, WcsPermissionValues,
  WcsPermissionInputs
} from "./types.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-permission")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/permission"` or a tsconfig `types` entry).
import type { WcsPermission } from "./components/Permission.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-permission": WcsPermission;
  }
}
