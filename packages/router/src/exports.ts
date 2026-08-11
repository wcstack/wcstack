
export { bootstrapRouter } from "./bootstrapRouter.js";
export { getConfig } from "./config.js";
export { getTrustedTypesPolicy, setTrustedTypesPolicy, TRUSTED_TYPES_POLICY_SLOT } from "./trustedTypes.js";
export type { IWcsTrustedTypesPolicy } from "./trustedTypes.js";
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
