/**
 * The core entry of the split build (`dist/core.js`): a page that installs only the add-ons it
 * uses imports this and `features/<name>.js` from the same build, then calls bootstrapState():
 *
 *   import { bootstrapState, installFeatures } from "@wcstack/state/core";
 *   import temporal from "@wcstack/state/features/temporal";
 *   installFeatures([temporal]);
 *   bootstrapState();
 */
export { bootstrapState, define, getBindingsReady, WcsState } from "./element";
export { installFeatures, type Feature } from "./hooks";
export { config, setConfig } from "./config";
export { getTrustedTypesPolicy, setTrustedTypesPolicy } from "./trustedTypes";
