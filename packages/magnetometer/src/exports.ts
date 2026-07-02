export { bootstrapMagnetometer } from "./bootstrapMagnetometer.js";
export { getConfig } from "./config.js";
export { MagnetometerCore } from "./core/MagnetometerCore.js";
export { WcsMagnetometer } from "./components/Magnetometer.js";

export type {
  IWritableConfig, IWritableTagNames, WcsMagnetometerReading, WcsMagnetometerErrorDetail,
  WcsMagnetometerCoreValues, WcsMagnetometerValues,
} from "./types.js";
