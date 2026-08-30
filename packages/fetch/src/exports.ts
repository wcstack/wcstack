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

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-fetch")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/fetch"` or a tsconfig `types` entry).
import type { Fetch } from "./components/Fetch.js";
import type { FetchHeader } from "./components/FetchHeader.js";
import type { FetchBody } from "./components/FetchBody.js";
import type { InfiniteScroll } from "./components/InfiniteScroll.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-fetch": Fetch;
    "wcs-fetch-header": FetchHeader;
    "wcs-fetch-body": FetchBody;
    "wcs-infinite-scroll": InfiniteScroll;
  }
}
