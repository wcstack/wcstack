/**
 * Shared Fake double for the Generic Sensor API family (Gyroscope /
 * Gyroscope / Magnetometer / AmbientLightSensor). Parameterized by
 * `readingFields` so the same strategy covers both the x/y/z sensors and
 * AmbientLightSensor's single `illuminance` scalar
 * (docs/sensor-tag-design.md §3).
 */
export class FakeSensor extends EventTarget {
  started = false;
  stopped = false;

  constructor(
    private readingFields: Record<string, number>,
    public options?: { frequency?: number },
  ) {
    super();
    Object.assign(this, readingFields);
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  /** Test helper: synthesize a `reading` event, updating own fields first
   *  (mirroring how the real sensor mutates its own properties before firing). */
  emitReading(values: Record<string, number>): void {
    Object.assign(this, values);
    this.dispatchEvent(new Event("reading"));
  }

  /** Test helper: synthesize an `error` event carrying a DOMException-like value. */
  emitError(name: string, message = ""): void {
    this.dispatchEvent(Object.assign(new Event("error"), { error: { name, message } }));
  }
}

/** A constructor stub that throws synchronously — models a permission-denied /
 *  feature-policy-blocked `new Gyroscope()` (SecurityError).
 *
 *  MUST be a plain `function`, not an arrow function: arrow functions have no
 *  `[[Construct]]` slot, so `new` on one throws its own `TypeError: ... is not
 *  a constructor` before the body ever runs — which would mask the intended
 *  SecurityError entirely and defeat the point of this fake. */
export function makeThrowingCtor(name = "SecurityError", message = "Permission denied"): new () => never {
  return function (): never {
    const err = new Error(message);
    (err as any).name = name;
    throw err;
  } as unknown as new () => never;
}

/** Install `globalThis.<GlobalClassName>` as a factory that returns FakeSensor
 *  instances parameterized by `readingFields`. Returns a getter for the most
 *  recently constructed instance so tests can drive it. */
export function installSensor(
  globalName: string,
  readingFields: Record<string, number>,
): { get current(): FakeSensor | undefined } {
  let current: FakeSensor | undefined;
  function Ctor(this: any, options?: { frequency?: number }) {
    const sensor = new FakeSensor(readingFields, options);
    current = sensor;
    return sensor;
  }
  (globalThis as any)[globalName] = Ctor;
  return {
    get current() {
      return current;
    },
  };
}

/** Install `globalThis.<GlobalClassName>` as a constructor that throws
 *  synchronously on every call (never reaches `.start()`). */
export function installThrowingSensor(globalName: string, name = "SecurityError", message = "Permission denied"): void {
  (globalThis as any)[globalName] = makeThrowingCtor(name, message);
}

/** Remove `globalThis.<GlobalClassName>` so the "unsupported" branch can be tested. */
export function removeSensor(globalName: string): void {
  delete (globalThis as any)[globalName];
}
