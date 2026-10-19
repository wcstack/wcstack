import { CameraConstraints, MediaDeviceSnapshot, WcsMediaErrorDetail } from "../types.js";
import { featureUnavailable, featureUnavailableMessage } from "../core/platformCapability.js";

/** True when getUserMedia is reachable (secure context with a media-devices impl). */
export function hasMediaDevices(): boolean {
  return typeof navigator !== "undefined"
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === "function";
}

/** True when MediaRecorder is available in this environment. */
export function hasMediaRecorder(): boolean {
  return typeof globalThis !== "undefined"
    && typeof (globalThis as { MediaRecorder?: unknown }).MediaRecorder === "function";
}

/**
 * Translate a getUserMedia constraints object from the declarative
 * CameraConstraints surface. Always requests a video track; `audio` opts the
 * microphone in. `deviceId` (exact) takes precedence over `facingMode`.
 */
export function buildConstraints(c: CameraConstraints): MediaStreamConstraints {
  const video: MediaTrackConstraints = {};
  if (c.deviceId) {
    video.deviceId = { exact: c.deviceId };
  } else if (c.facingMode) {
    video.facingMode = c.facingMode;
  }
  if (typeof c.width === "number") video.width = c.width;
  if (typeof c.height === "number") video.height = c.height;
  const hasVideoConstraint = Object.keys(video).length > 0;
  return {
    video: hasVideoConstraint ? video : true,
    audio: c.audio === true,
  };
}

/** Normalize any thrown getUserMedia / MediaRecorder failure into a flat detail. */
export function normalizeMediaError(error: unknown): WcsMediaErrorDetail {
  if (error && typeof error === "object" && "name" in error) {
    const name = String((error as { name: unknown }).name) || "Error";
    const message = "message" in error && (error as { message?: unknown }).message
      ? String((error as { message: unknown }).message)
      : `Media request failed: ${name}.`;
    return { name, message };
  }
  return { name: "Error", message: "Media request failed." };
}

// getUserMedia is absent on an insecure origin, and in a browser without it: say which.
function unsupportedError(): WcsMediaErrorDetail {
  const reason = featureUnavailable("camera");
  return {
    name: "unsupported",
    message: reason === "insecure-context"
      ? featureUnavailableMessage("getUserMedia", "camera", reason)
      : "getUserMedia is not available in this browser.",
  };
}

/**
 * Why this page cannot use the camera (or, with `audio`, the microphone): not a secure
 * context, or turned off by a Permissions-Policy. `null` when it can, as far as the
 * platform tells. `device` says which one, for the permission output it makes unsupported.
 */
export function mediaUnavailable(audio: boolean): { device: "camera" | "microphone"; error: WcsMediaErrorDetail } | null {
  const camera = featureUnavailable("camera");
  if (camera !== null) {
    return { device: "camera", error: { name: "unsupported", message: featureUnavailableMessage("The camera", "camera", camera) } };
  }
  const microphone = audio ? featureUnavailable("microphone") : null;
  if (microphone !== null) {
    return { device: "microphone", error: { name: "unsupported", message: featureUnavailableMessage("The microphone", "microphone", microphone) } };
  }
  return null;
}

export interface UserMediaResult {
  stream?: MediaStream;
  error?: WcsMediaErrorDetail;
}

/**
 * Request a media stream. Never throws — resolves with `{ stream }` on success or
 * `{ error }` (normalized) on failure / when the API is unavailable.
 */
export async function requestUserMedia(constraints: MediaStreamConstraints): Promise<UserMediaResult> {
  if (!hasMediaDevices()) {
    return { error: unsupportedError() };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return { stream };
  } catch (error) {
    return { error: normalizeMediaError(error) };
  }
}

/** Stop every track of a stream, releasing the camera/microphone hardware. */
export function stopAllTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/**
 * Enumerate video input devices as plain snapshots. Labels are only populated
 * after a grant, so this is refreshed post-acquisition. Never throws.
 */
export async function enumerateVideoDevices(): Promise<MediaDeviceSnapshot[]> {
  if (!hasMediaDevices() || typeof navigator.mediaDevices.enumerateDevices !== "function") {
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "videoinput")
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label,
        groupId: d.groupId,
        kind: d.kind,
      }));
  } catch {
    return [];
  }
}
