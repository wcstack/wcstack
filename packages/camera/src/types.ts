import type { WcsIoErrorInfo } from "./core/platformCapability.js";

export interface ITagNames {
  readonly camera: string;
  readonly recorder: string;
}

export interface IWritableTagNames {
  camera?: string;
  recorder?: string;
}

export interface IConfig {
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  tagNames?: IWritableTagNames;
}

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

/**
 * Permission state for camera / microphone, mirroring the Permissions API
 * `PermissionState` plus `"unsupported"` for environments without
 * `navigator.permissions` (or where the `camera` / `microphone` descriptor
 * cannot be queried, e.g. Firefox).
 */
export type MediaPermissionState = "prompt" | "granted" | "denied" | "unsupported";

export type FacingMode = "user" | "environment";

/**
 * Normalized getUserMedia / MediaRecorder failure. `name` mirrors the DOMException
 * name (`"NotAllowedError"`, `"NotFoundError"`, `"NotReadableError"`,
 * `"OverconstrainedError"`, …); `"unsupported"` is surfaced when the API is absent
 * or the context is insecure.
 */
export interface WcsMediaErrorDetail {
  name: string;
  message: string;
}

/**
 * Settable camera constraints (Shell attributes). `audio` opts microphone in;
 * `facingMode` / `deviceId` / `width` / `height` shape the requested track.
 */
export interface CameraConstraints {
  audio?: boolean;
  facingMode?: FacingMode;
  deviceId?: string;
  width?: number;
  height?: number;
}

/**
 * Structured-clone-friendly snapshot of a `MediaDeviceInfo` (video inputs). The
 * live device objects are exposed as plain copies so the list flows through data
 * binding as a value.
 */
export interface MediaDeviceSnapshot {
  deviceId: string;
  label: string;
  groupId: string;
  kind: string;
}

/**
 * Value types for CameraCore (headless) — the observable state properties.
 *
 * Note: the live `MediaStream` is intentionally NOT here. It is a non-serializable
 * live handle and never flows through reactive state — it is published only via
 * the `wcs-camera:stream-ready` event for the direct element→element channel.
 * See docs/camera-recorder-tag-design.md §1.
 */
export interface WcsCameraCoreValues {
  active: boolean;
  permission: MediaPermissionState;
  audioPermission: MediaPermissionState | null;
  deviceId: string | null;
  devices: MediaDeviceSnapshot[];
  error: WcsMediaErrorDetail | null;
  /** Serializable Phase 6 failure taxonomy derived from `error`, or null. */
  errorInfo: WcsIoErrorInfo | null;
}

export type WcsCameraValues = WcsCameraCoreValues;

export interface WcsCameraInputs {
  audio: boolean;
  facingMode: FacingMode;
  deviceId: string;
  width: number;
  height: number;
  /** Acquire the camera automatically on connect (otherwise wait for `start()`). */
  autostart: boolean;
  /** Do not suspend the stream when the page is hidden (set while recording). */
  keepAlive: boolean;
}

export interface WcsCameraCoreCommands {
  start(): void;
  stop(): void;
  switchCamera(): void;
}

export type WcsCameraCommands = WcsCameraCoreCommands;

/**
 * Per-recording parameters accepted by `start()`, mirroring the settable fields
 * of `MediaRecorder`.
 */
export interface RecorderOptions {
  mimeType?: string;
  /** Emit `dataavailable` chunks on this interval (ms). Omit to receive one Blob on stop. */
  timeslice?: number;
  audioBitsPerSecond?: number;
  videoBitsPerSecond?: number;
}

/** Detail of the `wcs-recorder:recorded` event — the assembled clip. */
export interface WcsRecordedDetail {
  blob: Blob;
  objectURL: string;
  mimeType: string;
  duration: number;
}

/**
 * Value types for RecorderCore (headless) — the observable state properties.
 * `blob` is structured-clone-friendly (a settled value, unlike MediaStream) so it
 * may flow through state. `objectURL` is a string with a revoke lifecycle the Core
 * manages.
 */
export interface WcsRecorderCoreValues {
  recording: boolean;
  paused: boolean;
  /**
   * Recorded length in ms, **finalized at stop/pause** — there is no live ticking
   * during recording (no internal timer). It stays 0 from start() until the first
   * pause() or stop(). For a live elapsed display, drive your own client-side timer
   * off the `recording` flag.
   */
  duration: number;
  mimeType: string;
  /**
   * The last assembled clip — **retained across a new recording**. start() does NOT
   * clear `blob` / `objectURL`; they hold the previous clip until the next one is
   * assembled at stop() (the old object URL is revoked then, atomically). So while a
   * 2nd recording is in flight, `recording` is true *and* these still expose the prior
   * clip — intentional, so a "download last clip" affordance never goes briefly empty.
   */
  blob: Blob | null;
  objectURL: string | null;
  error: WcsMediaErrorDetail | null;
  /** Serializable Phase 6 failure taxonomy derived from `error`, or null. */
  errorInfo: WcsIoErrorInfo | null;
}

export type WcsRecorderValues = WcsRecorderCoreValues;

export interface WcsRecorderInputs {
  mimeType: string;
  timeslice: number;
  audioBitsPerSecond: number;
  videoBitsPerSecond: number;
}

export interface WcsRecorderCoreCommands {
  attachStream(stream: MediaStream): void;
  start(options?: RecorderOptions): void;
  stop(): void;
  pause(): void;
  resume(): void;
}

export interface WcsRecorderCommands {
  /** Borrow a stream for recording — the direct-channel sink (`command.attachStream`). */
  attachStream(stream: MediaStream): void;
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
}
