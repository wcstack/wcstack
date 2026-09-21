/**
 * entries/core.ts — `@wcstack/state/core`（設計案 §4）。
 *
 * core だけの公開面。機能（watch / scan / streams・スコープ・再帰・SSR・devtools）は 1 つも
 * import しない — ページが `installFeatures([...])` で入れる。full（`@wcstack/state`）は
 * この面に機能と `Ssr` などを足したもので、公開 API は従来どおり。
 */
export { bootstrapCore as bootstrapState } from "../core/bootstrapCore.js";
export { installFeatures } from "../core/features.js";
export type { IStateFeature } from "../core/features.js";

export { getConfig } from "../config.js";
export { getBindingsReady } from "../stateElementByName.js";
export { buildBindings } from "../buildBindings.js";
export { getTrustedTypesPolicy, setTrustedTypesPolicy, TRUSTED_TYPES_POLICY_SLOT } from "../trustedTypes.js";
export type { IWcsTrustedTypesPolicy } from "../trustedTypes.js";

export { defineState } from "../defineState.js";
export type {
  WcsStateApi, WcsThis,
  WcsPaths, WcsPathValue,
} from "../defineState.js";
export type {
  IWritableConfig, IWritableTagNames, IBindingErrorInfo
} from "../types.js";

export { VERSION } from "../version.js";

import type { State } from "../components/State.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-state": State;
  }
}
