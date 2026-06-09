export { bootstrapWakeLock } from "./bootstrapWakeLock.js";
export { getConfig } from "./config.js";
export { WakeLockCore } from "./core/WakeLockCore.js";
export { WcsWakeLock } from "./components/WakeLock.js";

export type {
  IWritableConfig, IWritableTagNames, WakeLockKind,
  WcsWakeLockCoreValues, WcsWakeLockValues, WcsWakeLockInputs,
  WcsWakeLockCoreCommands, WcsWakeLockCommands
} from "./types.js";
