import { vi } from "vitest";

/**
 * Install a static `requestPermission` on the global `DeviceOrientationEvent`,
 * simulating iOS 13+ Safari's gating. happy-dom already provides a global
 * `DeviceOrientationEvent` constructor with NO `requestPermission` (the
 * non-iOS/Android/desktop shape) — this only adds the iOS-only static method.
 */
export function installRequestPermission(
  impl: () => Promise<"granted" | "denied">,
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  (globalThis as any).DeviceOrientationEvent.requestPermission = fn;
  return fn;
}

/** Remove the iOS-only static requestPermission, restoring the non-gated (Android/desktop) shape. */
export function removeRequestPermission(): void {
  delete (globalThis as any).DeviceOrientationEvent.requestPermission;
}

/** Temporarily remove the global DeviceOrientationEvent entirely (very old browsers). Returns a restore function. */
export function removeDeviceOrientationEventCtor(): () => void {
  const saved = (globalThis as any).DeviceOrientationEvent;
  delete (globalThis as any).DeviceOrientationEvent;
  return () => {
    (globalThis as any).DeviceOrientationEvent = saved;
  };
}

/** Dispatch a `deviceorientation` event on `window` with the given fields. */
export function emitDeviceOrientation(fields: {
  alpha?: number | null;
  beta?: number | null;
  gamma?: number | null;
  absolute?: boolean;
} = {}): void {
  const event = new Event("deviceorientation") as any;
  event.alpha = fields.alpha ?? null;
  event.beta = fields.beta ?? null;
  event.gamma = fields.gamma ?? null;
  event.absolute = fields.absolute ?? false;
  window.dispatchEvent(event);
}
