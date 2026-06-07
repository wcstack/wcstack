import { vi } from "vitest";

export interface MockPosition {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
  };
  timestamp: number;
}

/**
 * Build a GeolocationPosition-like object with sensible defaults so individual
 * tests only specify the fields they care about.
 */
export function makePosition(overrides: Partial<MockPosition["coords"]> & { timestamp?: number } = {}): MockPosition {
  const { timestamp, ...coords } = overrides;
  return {
    coords: {
      latitude: 35.0,
      longitude: 139.0,
      accuracy: 10,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      ...coords,
    },
    timestamp: timestamp ?? 1000,
  };
}

export interface GeolocationMock {
  getCurrentPosition: ReturnType<typeof vi.fn>;
  watchPosition: ReturnType<typeof vi.fn>;
  clearWatch: ReturnType<typeof vi.fn>;
  /** Emit a new fix to the most recent watchPosition() success callback. */
  emitWatch: (pos: MockPosition) => void;
  /** Emit an error to the most recent watchPosition() error callback. */
  emitWatchError: (err: { code: number; message: string }) => void;
  /**
   * Emit a fix to the success callback of the Nth watchPosition() call (0-based),
   * so a test can simulate the browser delivering a stale callback from an
   * already-cleared/superseded watch.
   */
  emitWatchOn: (index: number, pos: MockPosition) => void;
  /** Emit an error to the error callback of the Nth watchPosition() call (0-based). */
  emitWatchErrorOn: (index: number, err: { code: number; message: string }) => void;
}

/**
 * Install a controllable navigator.geolocation mock.
 *
 * - getCurrentPosition resolves with `position` (or rejects with `error` when
 *   provided), invoking the success/error callback on the next microtask to
 *   mimic the async nature of the real API.
 * - watchPosition records its callbacks so a test can push fixes/errors later
 *   via emitWatch / emitWatchError, and returns an incrementing watch id.
 */
export function installGeolocation(opts: {
  position?: MockPosition;
  error?: { code: number; message: string };
} = {}): GeolocationMock {
  // Record every watchPosition() callback pair so a test can target a specific
  // (possibly superseded) watch via emitWatchOn / emitWatchErrorOn.
  const watchCallbacks: Array<{
    success: (pos: MockPosition) => void;
    error: (err: { code: number; message: string }) => void;
  }> = [];
  let nextWatchId = 1;

  const getCurrentPosition = vi.fn((success: any, failure: any) => {
    Promise.resolve().then(() => {
      if (opts.error) {
        failure?.(opts.error);
      } else {
        success?.(opts.position ?? makePosition());
      }
    });
  });

  const watchPosition = vi.fn((success: any, failure: any) => {
    watchCallbacks.push({ success, error: failure });
    return nextWatchId++;
  });

  const clearWatch = vi.fn();

  const mock: GeolocationMock = {
    getCurrentPosition,
    watchPosition,
    clearWatch,
    emitWatch: (pos) => watchCallbacks[watchCallbacks.length - 1]?.success(pos),
    emitWatchError: (err) => watchCallbacks[watchCallbacks.length - 1]?.error(err),
    emitWatchOn: (index, pos) => watchCallbacks[index]?.success(pos),
    emitWatchErrorOn: (index, err) => watchCallbacks[index]?.error(err),
  };

  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition, watchPosition, clearWatch },
    configurable: true,
    writable: true,
  });

  return mock;
}

/** Remove navigator.geolocation so the "unsupported" branches can be tested. */
export function removeGeolocation(): void {
  Object.defineProperty(navigator, "geolocation", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

export interface PermissionStatusMock extends EventTarget {
  state: string;
  /** Flip the state and dispatch a `change` event, as the real API does. */
  change: (state: string) => void;
}

/** Build a controllable PermissionStatus-like object. */
export function makePermissionStatus(state = "prompt"): PermissionStatusMock {
  const status = new EventTarget() as PermissionStatusMock;
  status.state = state;
  status.change = (next: string) => {
    status.state = next;
    status.dispatchEvent(new Event("change"));
  };
  return status;
}

/**
 * Install a navigator.permissions mock whose query() resolves to a controllable
 * PermissionStatus. Pass `reject: true` to simulate a browser that does not
 * accept the "geolocation" permission name. By default every query() resolves to
 * the *same* status; pass `distinctPerQuery: true` to return a fresh status each
 * call (as real browsers do), and read them back via the returned `statuses`.
 */
export function installPermissions(opts: { state?: string; reject?: boolean; distinctPerQuery?: boolean } = {}): PermissionStatusMock & { statuses: PermissionStatusMock[] } {
  // `statuses` records every status actually returned by query(), in call order.
  const statuses: PermissionStatusMock[] = [];
  const base = makePermissionStatus(opts.state ?? "prompt");

  const query = opts.reject
    ? vi.fn(() => Promise.reject(new TypeError("unsupported permission name")))
    : vi.fn(() => {
        const s = opts.distinctPerQuery ? makePermissionStatus(opts.state ?? "prompt") : base;
        statuses.push(s);
        return Promise.resolve(s);
      });

  Object.defineProperty(navigator, "permissions", {
    value: { query },
    configurable: true,
    writable: true,
  });

  return Object.assign(base, { statuses });
}

/** Remove navigator.permissions so the "unsupported" branch can be tested. */
export function removePermissions(): void {
  Object.defineProperty(navigator, "permissions", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}
