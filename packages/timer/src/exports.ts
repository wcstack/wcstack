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
