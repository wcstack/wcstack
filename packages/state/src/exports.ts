/**
 * `@wcstack/state` — the full engine: `bootstrapState()` installs every add-on, then registers
 * `<wcs-state>`. The same exports as 3.x; `@wcstack/state/core` + `features/*` is the composable
 * form, and `/define`, `/manifest`, `/parser` the authoring and tooling entries.
 */
import { installFeatures } from "./hooks";
import { define } from "./element";
import { setConfig } from "./config";
import { ALL_FEATURES } from "./features/all";
import { defineOnce } from "./twice";
import type { IStateElement, IWritableConfig } from "./public/types";
import type { Ssr } from "./ssr/element";

/**
 * Installs every add-on, applies `config` and registers `<wcs-state>` (in `registry`, the global one
 * by default). When another copy of @wcstack/state, of another version, defined `<wcs-state>` first,
 * this copy does nothing and warns `[wcs/package-twice]` once (`/core`'s bootstrapState does not check).
 */
export function bootstrapState(config?: IWritableConfig, registry?: CustomElementRegistry): void {
  installFeatures(ALL_FEATURES);
  // before the tags are read: a config may rename them
  if (config) setConfig(config);
  defineOnce(() => define(registry), registry);
}

export { getConfig } from "./config";
export { getTrustedTypesPolicy, setTrustedTypesPolicy, TRUSTED_TYPES_POLICY_SLOT } from "./trustedTypes";
export type { TrustedTypesPolicy as IWcsTrustedTypesPolicy } from "./trustedTypes";
export { getBindingsReady, buildBindings } from "./element";

export { Ssr } from "./ssr/element";
export type { ISsrElement } from "./ssr/element";

export { defineState } from "./public/defineState";
export type { WcsStateApi, WcsThis, WcsPaths, WcsPathValue } from "./public/defineState";
export type { IWritableConfig, IWritableTagNames, IBindingErrorInfo, IStateElement } from "./public/types";

export { VERSION } from "./version";

export { getWcsManifest, WCS_MANIFEST_VERSION, builtinFilterMeta, builtinFilterAliases } from "./public/manifest";
export type { IWcsManifest, IFilterMeta, FilterResultType, FilterArgType } from "./public/manifest";

export { analyzeContract } from "./public/contract";
export type { IContractManifest, ContractEvent } from "./public/contract";

// typed element lookups: `document.querySelector("wcs-state")` (default tag names only)
declare global {
  interface HTMLElementTagNameMap {
    "wcs-state": IStateElement;
    "wcs-ssr": Ssr;
  }
}
