export { bootstrapDebounce } from "./bootstrapDebounce.js";
export { getConfig } from "./config.js";
export { DebounceCore } from "./core/DebounceCore.js";
export { makeDebounceProperties } from "./wcBindableFactory.js";
export { Debounce as WcsDebounce } from "./components/Debounce.js";
export { Throttle as WcsThrottle } from "./components/Throttle.js";

export type {
  IWritableConfig, IWritableTagNames, DebounceOptions,
  WcsDebounceSettledDetail, WcsDebounceFiredDetail,
  WcsDebounceCoreValues, WcsDebounceValues, WcsDebounceInputs,
  WcsDebounceCoreCommands, WcsDebounceCommands
} from "./types.js";
