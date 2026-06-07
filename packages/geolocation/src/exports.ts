export { bootstrapGeolocation } from "./bootstrapGeolocation.js";
export { getConfig } from "./config.js";
export { GeolocationCore } from "./core/GeolocationCore.js";
export { WcsGeolocation } from "./components/Geolocation.js";

export type {
  IWritableConfig, IWritableTagNames, GeoPermissionState, GeoOptions,
  WcsGeoPositionDetail, WcsGeoCoords, WcsGeoErrorDetail,
  WcsGeoCoreValues, WcsGeoValues, WcsGeoInputs, WcsGeoCoreCommands, WcsGeoCommands
} from "./types.js";
