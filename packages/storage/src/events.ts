// Single source of truth for the custom event names dispatched by StorageCore /
// Storage. These names appear in two places that must stay in lock-step:
//   1. the `wcBindable.properties[].event` declarations (consumed by bind())
//   2. the `dispatchEvent(new CustomEvent(...))` calls that emit them
// Hard-coding the same string literal in both places risks a silent typo that
// makes bind() listen for an event no one ever fires. Referencing these
// constants from both sites keeps them in sync.
export const STORAGE_EVENTS = {
  valueChanged: "wcs-storage:value-changed",
  loadingChanged: "wcs-storage:loading-changed",
  error: "wcs-storage:error",
  triggerChanged: "wcs-storage:trigger-changed",
} as const;
