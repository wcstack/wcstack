export { bootstrapTimer } from "./bootstrapTimer.js";
export { getConfig } from "./config.js";
export { TimerCore } from "./core/TimerCore.js";
export { Timer as WcsTimer } from "./components/Timer.js";

export type {
  IWritableConfig, IWritableTagNames, WcsTimerTickDetail, WcsTimerCoreValues, WcsTimerValues,
  WcsTimerInputs, WcsTimerCoreCommands, WcsTimerCommands
} from "./types.js";

export type {
  TimerStartOptions
} from "./core/TimerCore.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-timer")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/timer"` or a tsconfig `types` entry).
import type { Timer } from "./components/Timer.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-timer": Timer;
  }
}
