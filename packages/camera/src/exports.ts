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

// Error taxonomy: `errorInfo` is an additive wc-bindable property shared by both
// cores (CameraCore / RecorderCore), so its value type and the stable code constants
// are public. The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_MEDIA_ERROR_CODE } from "./core/mediaCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-camera")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/camera"` or a tsconfig `types` entry).
import type { WcsCamera } from "./components/Camera.js";
import type { WcsRecorder } from "./components/Recorder.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-camera": WcsCamera;
    "wcs-recorder": WcsRecorder;
  }
}
