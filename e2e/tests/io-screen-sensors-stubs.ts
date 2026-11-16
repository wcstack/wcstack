// Stand-ins for what no browser on a CI machine has: an iPhone's sensor question, and Android's contact picker.
// Each is a function for page.addInitScript(); it follows what the platform is observed or specified to do.

/**
 * iOS Safari: no Generic Sensor classes, and DeviceOrientationEvent / DeviceMotionEvent.requestPermission —
 * asked only from a tap (a call without user activation rejects with NotAllowedError and shows nothing), and no
 * reading before it is allowed. `window.__ios`: `answer` ("granted" | "denied"), `asked` (questions shown),
 * `refusedNoGesture`, and `emit(type, init)`, which delivers a reading once allowed.
 */
export function iphoneSensors(): void {
  for (const name of ["Accelerometer", "Gyroscope", "Magnetometer", "AbsoluteOrientationSensor"]) (window as any)[name] = undefined;
  const ios: any = ((window as any).__ios = { answer: "granted", asked: 0, state: "prompt", refusedNoGesture: 0 });
  const ask = (): Promise<string> => {
    if (!navigator.userActivation.isActive) {
      ios.refusedNoGesture++;
      return Promise.reject(new DOMException("Requesting device orientation or motion access requires a user gesture to prompt", "NotAllowedError"));
    }
    if (ios.state === "prompt") { ios.asked++; ios.state = ios.answer; }
    return Promise.resolve(ios.state);
  };
  (DeviceOrientationEvent as any).requestPermission = ask;
  (DeviceMotionEvent as any).requestPermission = ask;
  ios.emit = (type: string, init: any): boolean => {
    if (ios.state !== "granted") return false;
    const event = type === "devicemotion" ? new DeviceMotionEvent(type, init) : new DeviceOrientationEvent(type, init);
    if (init && "webkitCompassHeading" in init) Object.defineProperty(event, "webkitCompassHeading", { value: init.webkitCompassHeading });
    window.dispatchEvent(event);
    return true;
  };
}

/**
 * The Contact Picker as its specification says: `select()` needs a user activation, and a picker closed
 * without a choice resolves with an empty list (no AbortError exists). `window.__contacts`: `result`, `mode`
 * ("ok" | "closed").
 */
export function contactPicker(): void {
  const c: any = ((window as any).__contacts = { result: [{ name: ["山田 花子"], email: ["hanako@example.jp"] }], mode: "ok" });
  const manager = {
    getProperties: () => Promise.resolve(["name", "email", "tel"]),
    select(): Promise<unknown[]> {
      if (!navigator.userActivation.isActive) return Promise.reject(new DOMException("A user gesture is required to call this method", "SecurityError"));
      return new Promise((resolve) => setTimeout(() => resolve(c.mode === "ok" ? structuredClone(c.result) : []), 20));
    },
  };
  Object.defineProperty(Navigator.prototype, "contacts", { configurable: true, get: () => manager });
}
