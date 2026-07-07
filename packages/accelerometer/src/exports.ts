export { bootstrapAccelerometer } from "./bootstrapAccelerometer.js";
export { getConfig } from "./config.js";
export { AccelerometerCore } from "./core/AccelerometerCore.js";
export { WcsAccelerometer } from "./components/Accelerometer.js";

export type {
  IWritableConfig, IWritableTagNames, WcsAccelerometerReading, WcsAccelerometerErrorDetail,
  WcsAccelerometerCoreValues, WcsAccelerometerValues,
} from "./types.js";
