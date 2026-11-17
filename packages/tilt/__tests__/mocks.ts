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

/**
 * Temporarily remove the global DeviceOrientationEvent entirely (some desktop browsers, Playwright's
 * WebKit on Windows). Returns a restore function.
 */
export function removeDeviceOrientationEventCtor(): () => void {
  const saved = (globalThis as any).DeviceOrientationEvent;
  delete (globalThis as any).DeviceOrientationEvent;
  return () => {
    (globalThis as any).DeviceOrientationEvent = saved;
  };
}

/**
 * Temporarily remove `window.ondeviceorientationabsolute` (happy-dom has it), so that
 * `"ondeviceorientationabsolute" in window` is false, as in a browser without the event (iOS Safari).
 * Returns a restore function.
 */
export function removeAbsoluteOrientationHandler(): () => void {
  const saved = Object.getOwnPropertyDescriptor(window, "ondeviceorientationabsolute")!;
  delete (window as any).ondeviceorientationabsolute;
  return () => {
    Object.defineProperty(window, "ondeviceorientationabsolute", saved);
  };
}

interface OrientationFields {
  alpha?: number | null;
  beta?: number | null;
  gamma?: number | null;
  absolute?: boolean;
  /** iOS Safari's non-standard compass heading. Left off the event when not given. */
  webkitCompassHeading?: unknown;
}

function emitOrientation(type: string, fields: OrientationFields): void {
  const event = new Event(type) as any;
  event.alpha = fields.alpha ?? null;
  event.beta = fields.beta ?? null;
  event.gamma = fields.gamma ?? null;
  event.absolute = fields.absolute ?? false;
  if ("webkitCompassHeading" in fields) event.webkitCompassHeading = fields.webkitCompassHeading;
  window.dispatchEvent(event);
}

/** Dispatch a `deviceorientation` event on `window` with the given fields. */
export function emitDeviceOrientation(fields: OrientationFields = {}): void {
  emitOrientation("deviceorientation", fields);
}

/** Dispatch a `deviceorientationabsolute` event on `window` (Android Chrome: `absolute` is true there). */
export function emitDeviceOrientationAbsolute(fields: OrientationFields = {}): void {
  emitOrientation("deviceorientationabsolute", { absolute: true, ...fields });
}
