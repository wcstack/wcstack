export { bootstrapFetch } from "./bootstrapFetch.js";
export { getConfig } from "./config.js";
export { FetchCore } from "./core/FetchCore.js";
export { Fetch as WcsFetch } from "./components/Fetch.js";
export { InfiniteScroll as WcsInfiniteScroll } from "./components/InfiniteScroll.js";

export type {
  IWritableConfig, IWritableTagNames, WcsFetchHttpError, WcsFetchCoreValues, WcsFetchValues
} from "./types.js";

export type {
  FetchRequestOptions
} from "./core/FetchCore.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public. The generic `WcsIoErrorInfo`
// type comes from the shared io-core layer; the fetch-specific codes are local.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_FETCH_ERROR_CODE } from "./core/fetchCapabilities.js";
