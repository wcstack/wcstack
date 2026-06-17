export { bootstrapCamera } from "./bootstrapCamera.js";
export { getConfig } from "./config.js";
export { CameraCore } from "./core/CameraCore.js";
export { WcsCamera } from "./components/Camera.js";
export { RecorderCore } from "./core/RecorderCore.js";
export { WcsRecorder } from "./components/Recorder.js";

export type {
  IWritableConfig, IWritableTagNames,
  MediaPermissionState, FacingMode, WcsMediaErrorDetail,
  CameraConstraints, MediaDeviceSnapshot,
  WcsCameraCoreValues, WcsCameraValues, WcsCameraInputs, WcsCameraCoreCommands, WcsCameraCommands,
  RecorderOptions, WcsRecordedDetail,
  WcsRecorderCoreValues, WcsRecorderValues, WcsRecorderInputs, WcsRecorderCoreCommands, WcsRecorderCommands,
} from "./types.js";
