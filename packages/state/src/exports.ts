
export { bootstrapState } from "./bootstrapState.js";

export { Ssr } from "./components/Ssr.js";
export type { ISsrElement } from "./components/Ssr.js";

export { buildBindings } from "./buildBindings.js";

export { getFragmentInfoByUUID, getAllFragmentUUIDs } from "./structural/fragmentInfoByUUID.js";

export { getAllSsrPropertyNodes, getSsrProperties, clearSsrPropertyStore } from "./apply/ssrPropertyStore.js";
export type { ISsrPropertyEntry } from "./apply/ssrPropertyStore.js";

export { defineState } from "./defineState.js";

export type {
  WcsStateApi, WcsThis,
  WcsPaths, WcsPathValue,
} from "./defineState.js";

export type {
  IWritableConfig, IWritableTagNames
} from "./types.js";
