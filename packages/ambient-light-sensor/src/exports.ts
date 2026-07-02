export { bootstrapAmbientLightSensor } from "./bootstrapAmbientLightSensor.js";
export { getConfig } from "./config.js";
export { AmbientLightSensorCore } from "./core/AmbientLightSensorCore.js";
export { WcsAmbientLightSensor } from "./components/AmbientLightSensor.js";

export type {
  IWritableConfig, IWritableTagNames, WcsAmbientLightSensorReading, WcsAmbientLightSensorErrorDetail,
  WcsAmbientLightSensorCoreValues, WcsAmbientLightSensorValues,
} from "./types.js";
