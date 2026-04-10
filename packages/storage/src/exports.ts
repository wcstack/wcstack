export { bootstrapStorage } from "./bootstrapStorage.js";
export { getConfig } from "./config.js";
export { StorageCore } from "./core/StorageCore.js";
export { Storage as WcsStorage } from "./components/Storage.js";

export type {
  IWritableConfig, IWritableTagNames, WcsStorageError, WcsStorageCoreValues, WcsStorageValues, StorageType
} from "./types.js";
