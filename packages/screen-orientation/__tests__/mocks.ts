import { vi } from "vitest";

export interface ScreenOrientationMock extends EventTarget {
  type: string;
  angle: number;
  lock: ReturnType<typeof vi.fn>;
  unlock: ReturnType<typeof vi.fn>;
  /** Update fields and dispatch a `change` event, as the real API does. */
  change: (partial: Partial<Pick<ScreenOrientationMock, "type" | "angle">>) => void;
}

const DEFAULTS = {
  type: "portrait-primary",
  angle: 0,
};

/** Build a controllable ScreenOrientation-like object. `lock`/`unlock` default
 *  to resolving/no-op successfully; override via the returned object's fields. */
export function makeScreenOrientation(initial: Partial<typeof DEFAULTS> = {}): ScreenOrientationMock {
  const orientation = new EventTarget() as ScreenOrientationMock;
  Object.assign(orientation, DEFAULTS, initial);
  orientation.lock = vi.fn(() => Promise.resolve());
  orientation.unlock = vi.fn();
  orientation.change = (partial) => {
    Object.assign(orientation, partial);
    orientation.dispatchEvent(new Event("change"));
  };
  return orientation;
}

/** Install `screen.orientation` as a controllable fake. Returns the fake for inspection/mutation. */
export function installOrientation(initial: Partial<typeof DEFAULTS> = {}): ScreenOrientationMock {
  const orientation = makeScreenOrientation(initial);
  Object.defineProperty(screen, "orientation", {
    value: orientation,
    configurable: true,
    writable: true,
  });
  return orientation;
}

/** Remove screen.orientation so the "unsupported" branch can be tested. */
export function removeOrientation(): void {
  Object.defineProperty(screen, "orientation", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}
