
export { bootstrapState } from "./bootstrapState.js";
export { getConfig } from "./config.js";
export { getBindingsReady } from "./stateElementByName.js";

export { Ssr } from "./components/Ssr.js";
export type { ISsrElement } from "./components/Ssr.js";

export { buildBindings } from "./buildBindings.js";

export { defineState } from "./defineState.js";

export type {
  WcsStateApi, WcsThis,
  WcsPaths, WcsPathValue,
} from "./defineState.js";

export type {
  IWritableConfig, IWritableTagNames
} from "./types.js";

export { VERSION } from "./version.js";
