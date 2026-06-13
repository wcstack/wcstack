import { vi } from "vitest";

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

export interface PermissionsMock {
  query: ReturnType<typeof vi.fn>;
  /** Every status returned by query(), in call order. */
  statuses: PermissionStatusMock[];
  /** Every descriptor passed to query(), in call order. */
  descriptors: any[];
}

/**
 * Install a navigator.permissions mock whose query() resolves to a controllable
 * PermissionStatus on the next microtask (as the real API is async).
 *
 * - Pass `reject: true` to simulate a browser that does not accept the requested
 *   permission name (query() rejects).
 * - By default every query() resolves to a *fresh* status (as real browsers do);
 *   read them back via the returned `statuses`. The descriptor of each call is
 *   recorded in `descriptors`.
 */
export function installPermissions(opts: { state?: string; reject?: boolean } = {}): PermissionsMock {
  const statuses: PermissionStatusMock[] = [];
  const descriptors: any[] = [];

  const query = opts.reject
    ? vi.fn((descriptor: any) => {
        descriptors.push(descriptor);
        return Promise.reject(new TypeError("unsupported permission name"));
      })
    : vi.fn((descriptor: any) => {
        descriptors.push(descriptor);
        const s = makePermissionStatus(opts.state ?? "prompt");
        statuses.push(s);
        return Promise.resolve(s);
      });

  Object.defineProperty(navigator, "permissions", {
    value: { query },
    configurable: true,
    writable: true,
  });

  return { query, statuses, descriptors };
}

/** Remove navigator.permissions so the "unsupported" branch can be tested. */
export function removePermissions(): void {
  Object.defineProperty(navigator, "permissions", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

/** Flush pending microtasks so a query()'s .then() runs. */
export function flush(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}
