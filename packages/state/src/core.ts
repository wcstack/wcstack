/**
 * `@wcstack/state/core` — the core of the split build (`dist/split/core.js`): a page that installs
 * only the add-ons it uses imports this and `features/<name>` from the same build:
 *
 *   import { bootstrapState, installFeatures } from "@wcstack/state/core";
 *   import temporal from "@wcstack/state/features/temporal";
 *   installFeatures([temporal]);
 *   bootstrapState();
 *
 * The same exports as 3.x's `/core`.
 */
import type { IStateElement } from "./public/types";

export { bootstrapState, getBindingsReady, buildBindings } from "./element";
export { installFeatures } from "./hooks";
export type { IStateFeature } from "./public/types";

export { getConfig } from "./config";
export { getTrustedTypesPolicy, setTrustedTypesPolicy, TRUSTED_TYPES_POLICY_SLOT } from "./trustedTypes";
export type { TrustedTypesPolicy as IWcsTrustedTypesPolicy } from "./trustedTypes";

export { defineState } from "./public/defineState";
export type { WcsStateApi, WcsThis, WcsPaths, WcsPathValue } from "./public/defineState";
export type { IWritableConfig, IWritableTagNames, IBindingErrorInfo } from "./public/types";

export { VERSION } from "./version";

declare global {
  interface HTMLElementTagNameMap {
    "wcs-state": IStateElement;
  }
}
