
export { bootstrapRouter } from "./bootstrapRouter.js";
export { getConfig } from "./config.js";
export { Router } from "./components/Router.js";
export { Route } from "./components/Route.js";
export { RouteCore } from "./core/RouteCore.js";

export type {
  IWritableConfig, IWritableTagNames
} from "./types.js";

export type {
  RouteParseOptions
} from "./core/RouteCore.js";

export { VERSION } from "./version.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-router")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/router"` or a tsconfig `types` entry).
import type { Router } from "./components/Router.js";
import type { Route } from "./components/Route.js";
import type { Outlet } from "./components/Outlet.js";
import type { Layout } from "./components/Layout.js";
import type { LayoutOutlet } from "./components/LayoutOutlet.js";
import type { Link } from "./components/Link.js";
import type { Head } from "./components/Head.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-router": Router;
    "wcs-route": Route;
    "wcs-outlet": Outlet;
    "wcs-layout": Layout;
    "wcs-layout-outlet": LayoutOutlet;
    "wcs-link": Link;
    "wcs-head": Head;
  }
}
